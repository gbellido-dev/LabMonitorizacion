"""Copias de seguridad (snapshots) de Node-RED y ThingsBoard para LabMonitorizacion.

Un snapshot es un único archivo ``.tar.gz`` que se puede descargar, llevar a otro
equipo e importar. Contiene:

    manifest.json                 metadatos (nombre, fecha, contenido, versión)
    nodered/...                   ficheros del directorio de usuario de Node-RED
                                  (flows.json, flows_cred.json, lib/, context/...)
    thingsboard/thingsboard.dump  volcado pg_dump (formato custom) de ThingsBoard

El servicio necesita acceso al socket de Docker para parar y arrancar los
contenedores durante una restauración y para lanzar pg_dump / pg_restore dentro
del contenedor de PostgreSQL.
"""

from __future__ import annotations

from datetime import datetime, timezone
import io
import json
import logging
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
import threading
import time
import unicodedata

import docker
from docker.errors import DockerException
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

log = logging.getLogger("copias")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

FORMATO = 1
SNAPSHOTS = Path(os.getenv("COPIAS_DIR", "/snapshots"))
NODERED_DATA = Path(os.getenv("NODERED_DATA", "/nodered-data"))
INTERCAMBIO = Path(os.getenv("INTERCAMBIO_DIR", "/intercambio"))  # compartido con tb-postgres
INTERCAMBIO_EN_PG = os.getenv("INTERCAMBIO_EN_POSTGRES", "/intercambio")
PROYECTO = os.getenv("COMPOSE_PROJECT", "labmonitorizacion")
SERVICIO_NODERED = os.getenv("SERVICIO_NODERED", "nodered")
SERVICIO_TB = os.getenv("SERVICIO_THINGSBOARD", "thingsboard")
SERVICIO_PG = os.getenv("SERVICIO_POSTGRES", "tb-postgres")
NODERED_UID = int(os.getenv("NODERED_UID", "1000"))

# Ficheros de /data de Node-RED que no forman parte del snapshot
NODERED_EXCLUIR_RAIZ = {"node_modules", ".npm", "settings.js", ".config.runtime.json", ".config.nodes.json"}
NODERED_EXCLUIR_RUTAS = {"lib/flows/LabMonitorizacion"}  # biblioteca regenerada al arrancar
NODERED_CONSERVAR_AL_RESTAURAR = {"node_modules", ".npm", "settings.js"}

# Tablas de ThingsBoard cuyos datos nunca se copian (depuración y eventos internos)
TB_EXCLUIR_SIEMPRE = [
    "rule_node_debug_event", "rule_chain_debug_event", "cf_debug_event",
    "error_event", "lc_event*", "stats_event", "edge_event", "audit_log*",
]
# Histórico de telemetría (opcional). ts_kv_latest y ts_kv_dictionary se conservan.
TB_TELEMETRIA = ["ts_kv", "ts_kv_2*", "ts_kv_indefinite"]

lock = threading.Lock()
app = FastAPI(title="LabMonitorizacion · Copias de seguridad", version="1.0.0")


# --------------------------------------------------------------------- Docker
def docker_client() -> docker.DockerClient:
    try:
        return docker.from_env()
    except DockerException as exc:  # pragma: no cover - depende del entorno
        raise HTTPException(503, f"No se puede acceder a Docker: {exc}") from exc


def contenedor(servicio: str):
    encontrados = docker_client().containers.list(
        all=True,
        filters={"label": [f"com.docker.compose.project={PROYECTO}", f"com.docker.compose.service={servicio}"]},
    )
    return encontrados[0] if encontrados else None


def exigir_contenedor(servicio: str, en_marcha: bool = True):
    c = contenedor(servicio)
    if c is None:
        raise HTTPException(409, f"No existe el contenedor del servicio «{servicio}». ¿Está levantado el compose?")
    if en_marcha and c.status != "running":
        raise HTTPException(409, f"El servicio «{servicio}» no está en marcha ({c.status}).")
    return c


def ejecutar(c, cmd: list[str], user: str = "") -> str:
    codigo, salida = c.exec_run(cmd, user=user, demux=False)
    texto = (salida or b"").decode("utf-8", "replace")
    if codigo != 0:
        raise RuntimeError(f"{' '.join(cmd[:2])} terminó con código {codigo}: {texto[-800:]}")
    return texto


def esperar_estado(c, estado: str, segundos: int = 60) -> None:
    limite = time.time() + segundos
    while time.time() < limite:
        c.reload()
        if c.status == estado:
            return
        time.sleep(1)


# -------------------------------------------------------------------- utilidades
def slug(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    texto = re.sub(r"[^A-Za-z0-9]+", "-", texto).strip("-").lower()
    return texto[:40] or "snapshot"


def ruta_snapshot(ident: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}", ident):
        raise HTTPException(400, "Identificador no válido")
    ruta = SNAPSHOTS / f"{ident}.tar.gz"
    if not ruta.is_file():
        raise HTTPException(404, "Snapshot no encontrado")
    return ruta


def leer_manifest(ruta: Path) -> dict:
    with tarfile.open(ruta, "r:gz") as tar:
        for miembro in tar:
            if miembro.name == "manifest.json":
                datos = json.load(tar.extractfile(miembro))
                break
        else:
            raise ValueError("El archivo no contiene manifest.json")
    if datos.get("formato") != FORMATO:
        raise ValueError("Formato de snapshot no compatible")
    return datos


def ruta_segura(nombre: str, prefijo: str) -> PurePosixPath | None:
    """Devuelve la ruta relativa dentro de ``prefijo`` o None si no pertenece/es insegura."""
    p = PurePosixPath(nombre)
    if p.is_absolute() or ".." in p.parts or not p.parts or p.parts[0] != prefijo:
        return None
    return PurePosixPath(*p.parts[1:]) if len(p.parts) > 1 else None


def validar_tar(ruta: Path) -> dict:
    manifest = leer_manifest(ruta)
    with tarfile.open(ruta, "r:gz") as tar:
        for m in tar:
            if m.name == "manifest.json":
                continue
            if not (m.isfile() or m.isdir()):
                raise ValueError(f"Entrada no permitida: {m.name}")
            if ruta_segura(m.name, "nodered") is None and ruta_segura(m.name, "thingsboard") is None:
                if m.name not in ("nodered", "thingsboard"):
                    raise ValueError(f"Ruta no permitida: {m.name}")
    return manifest


def version_tb() -> str | None:
    c = contenedor(SERVICIO_PG)
    if c is None or c.status != "running":
        return None
    try:
        return ejecutar(c, ["psql", "-U", "postgres", "-d", "thingsboard", "-tAc",
                            "select schema_version from tb_schema_settings"], user="postgres").strip() or None
    except RuntimeError:
        return None


def anadir_bytes(tar: tarfile.TarFile, nombre: str, datos: bytes) -> None:
    info = tarfile.TarInfo(nombre)
    info.size = len(datos)
    info.mtime = int(time.time())
    tar.addfile(info, io.BytesIO(datos))


def ficheros_nodered():
    for raiz, dirs, ficheros in os.walk(NODERED_DATA):
        rel_raiz = Path(raiz).relative_to(NODERED_DATA)
        dirs[:] = [
            d for d in dirs
            if not (rel_raiz == Path(".") and d in NODERED_EXCLUIR_RAIZ)
            and (rel_raiz / d).as_posix() not in NODERED_EXCLUIR_RUTAS
        ]
        for f in ficheros:
            rel = rel_raiz / f
            if rel_raiz == Path(".") and f in NODERED_EXCLUIR_RAIZ:
                continue
            if f.endswith(".backup"):
                continue
            yield Path(raiz) / f, rel.as_posix()


# ----------------------------------------------------------------- operaciones
def crear_snapshot(nombre: str, descripcion: str, nodered: bool, thingsboard: bool,
                   telemetria: bool, automatico: bool = False) -> dict:
    if not (nodered or thingsboard):
        raise HTTPException(400, "Elige al menos Node-RED o ThingsBoard")
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    ahora = datetime.now(timezone.utc)
    ident = f"{ahora.astimezone().strftime('%Y%m%d-%H%M%S')}-{slug(nombre)}"
    manifest = {
        "formato": FORMATO,
        "id": ident,
        "nombre": nombre,
        "descripcion": descripcion,
        "creado": ahora.isoformat(),
        "automatico": automatico,
        "contenido": {"nodered": nodered, "thingsboard": thingsboard, "telemetria": thingsboard and telemetria},
        "thingsboard_version": None,
        "nodered_flujos": None,
    }
    destino = SNAPSHOTS / f"{ident}.tar.gz"
    temporal = SNAPSHOTS / f".{ident}.tmp"
    dump = INTERCAMBIO / f"{ident}.dump"
    try:
        if thingsboard:
            pg = exigir_contenedor(SERVICIO_PG)
            manifest["thingsboard_version"] = version_tb()
            cmd = ["pg_dump", "-U", "postgres", "-Fc", "-f", f"{INTERCAMBIO_EN_PG}/{dump.name}"]
            excluir = TB_EXCLUIR_SIEMPRE + ([] if telemetria else TB_TELEMETRIA)
            for tabla in excluir:
                cmd += [f"--exclude-table-data={tabla}"]
            ejecutar(pg, cmd + ["thingsboard"], user="postgres")
        if nodered:
            flujos = NODERED_DATA / "flows.json"
            if flujos.is_file():
                try:
                    manifest["nodered_flujos"] = sum(
                        1 for n in json.loads(flujos.read_text(encoding="utf-8")) if n.get("type") == "tab")
                except (ValueError, AttributeError):
                    pass
        with tarfile.open(temporal, "w:gz") as tar:
            anadir_bytes(tar, "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode())
            if nodered:
                for origen, rel in ficheros_nodered():
                    tar.add(origen, arcname=f"nodered/{rel}", recursive=False)
            if thingsboard:
                tar.add(dump, arcname="thingsboard/thingsboard.dump")
        temporal.rename(destino)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc)) from exc
    finally:
        temporal.unlink(missing_ok=True)
        dump.unlink(missing_ok=True)
    log.info("Snapshot creado: %s", destino.name)
    return describir(destino)


def describir(ruta: Path) -> dict:
    manifest = leer_manifest(ruta)
    manifest["tamano"] = ruta.stat().st_size
    manifest["id"] = ruta.name.removesuffix(".tar.gz")
    return manifest


def restaurar_nodered(ruta: Path) -> list[str]:
    avisos: list[str] = []
    c = exigir_contenedor(SERVICIO_NODERED, en_marcha=False)
    paquete_antes = (NODERED_DATA / "package.json").read_text(encoding="utf-8") \
        if (NODERED_DATA / "package.json").is_file() else ""
    c.stop(timeout=15)
    esperar_estado(c, "exited", 30)
    try:
        for hijo in NODERED_DATA.iterdir():
            if hijo.name in NODERED_CONSERVAR_AL_RESTAURAR:
                continue
            if hijo.is_dir() and not hijo.is_symlink():
                shutil.rmtree(hijo)
            else:
                hijo.unlink()
        with tarfile.open(ruta, "r:gz") as tar:
            for m in tar:
                rel = ruta_segura(m.name, "nodered")
                if rel is None or rel.parts[0] in NODERED_CONSERVAR_AL_RESTAURAR:
                    continue
                destino = NODERED_DATA / rel
                if m.isdir():
                    destino.mkdir(parents=True, exist_ok=True)
                elif m.isfile():
                    destino.parent.mkdir(parents=True, exist_ok=True)
                    with tar.extractfile(m) as origen, open(destino, "wb") as salida:
                        shutil.copyfileobj(origen, salida)
        for raiz, dirs, ficheros in os.walk(NODERED_DATA):
            if Path(raiz) == NODERED_DATA:
                dirs[:] = [d for d in dirs if d not in ("node_modules", ".npm")]
            for nombre in dirs + ficheros:
                os.chown(Path(raiz) / nombre, NODERED_UID, NODERED_UID)
    finally:
        c.start()
    paquete_despues = (NODERED_DATA / "package.json").read_text(encoding="utf-8") \
        if (NODERED_DATA / "package.json").is_file() else ""
    if paquete_despues and paquete_despues != paquete_antes:
        try:
            esperar_estado(c, "running", 30)
            ejecutar(c, ["npm", "install", "--omit=dev", "--no-audit", "--no-fund", "--prefix", "/data"])
            c.restart(timeout=15)
            avisos.append("Se han instalado las paletas adicionales del snapshot.")
        except RuntimeError as exc:
            avisos.append(f"No se pudieron instalar las paletas adicionales: {exc}")
    return avisos


def restaurar_thingsboard(ruta: Path, manifest: dict) -> list[str]:
    avisos: list[str] = []
    pg = exigir_contenedor(SERVICIO_PG)
    tb = exigir_contenedor(SERVICIO_TB, en_marcha=False)
    actual = version_tb()
    origen = manifest.get("thingsboard_version")
    if actual and origen and actual != origen:
        raise HTTPException(409, f"El snapshot es de ThingsBoard {origen} y este equipo tiene {actual}.")
    dump = INTERCAMBIO / f"restaurar-{manifest['id']}.dump"
    with tarfile.open(ruta, "r:gz") as tar:
        try:
            miembro = tar.getmember("thingsboard/thingsboard.dump")
        except KeyError as exc:
            raise HTTPException(400, "El snapshot no contiene ThingsBoard") from exc
        with tar.extractfile(miembro) as origen_f, open(dump, "wb") as salida:
            shutil.copyfileobj(origen_f, salida)
    dump.chmod(0o644)
    tb.stop(timeout=60)
    esperar_estado(tb, "exited", 90)
    try:
        psql = ["psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c"]
        ejecutar(pg, psql + ["DROP DATABASE IF EXISTS thingsboard WITH (FORCE)"], user="postgres")
        ejecutar(pg, psql + ["CREATE DATABASE thingsboard"], user="postgres")
        try:
            ejecutar(pg, ["pg_restore", "-U", "postgres", "-d", "thingsboard", "--no-owner",
                          f"{INTERCAMBIO_EN_PG}/{dump.name}"], user="postgres")
        except RuntimeError as exc:
            avisos.append(f"pg_restore terminó con avisos: {exc}")
    finally:
        dump.unlink(missing_ok=True)
        tb.start()
    avisos.append("ThingsBoard se está reiniciando: tardará 1-2 minutos en volver a responder.")
    return avisos


# ------------------------------------------------------------------------ API
class NuevoSnapshot(BaseModel):
    nombre: str = Field(min_length=1, max_length=80)
    descripcion: str = Field(default="", max_length=500)
    nodered: bool = True
    thingsboard: bool = True
    telemetria: bool = False


class Restauracion(BaseModel):
    nodered: bool = True
    thingsboard: bool = True
    copia_previa: bool = True


def con_bloqueo(funcion, *args, **kwargs):
    if not lock.acquire(blocking=False):
        raise HTTPException(409, "Hay otra operación en curso. Espera a que termine.")
    try:
        return funcion(*args, **kwargs)
    finally:
        lock.release()


@app.on_event("startup")
def preparar() -> None:
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    INTERCAMBIO.mkdir(parents=True, exist_ok=True)
    INTERCAMBIO.chmod(0o1777)
    for resto in SNAPSHOTS.glob(".*.tmp"):
        resto.unlink(missing_ok=True)


@app.get("/api/estado")
def estado() -> dict:
    servicios = {}
    for clave, servicio in (("nodered", SERVICIO_NODERED), ("thingsboard", SERVICIO_TB), ("postgres", SERVICIO_PG)):
        c = contenedor(servicio)
        if c is None:
            servicios[clave] = {"estado": "ausente"}
            continue
        salud = c.attrs.get("State", {}).get("Health", {}).get("Status")
        servicios[clave] = {"estado": c.status, "salud": salud}
    v = version_tb()
    if v and v.isdigit() and len(v) >= 10:  # 4003001008 -> 4.3.1
        v = f"{int(v[:-9])}.{int(v[-9:-6])}.{int(v[-6:-3])}"
    servicios["thingsboard"]["version"] = v
    libre = shutil.disk_usage(SNAPSHOTS)
    return {"servicios": servicios, "ocupado": lock.locked(), "disco_libre": libre.free}


@app.get("/api/snapshots")
def listar() -> list[dict]:
    resultado = []
    for ruta in sorted(SNAPSHOTS.glob("*.tar.gz"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            resultado.append(describir(ruta))
        except (ValueError, tarfile.TarError, OSError) as exc:
            resultado.append({"id": ruta.name.removesuffix(".tar.gz"), "nombre": ruta.name,
                              "error": str(exc), "tamano": ruta.stat().st_size})
    return resultado


@app.post("/api/snapshots", status_code=201)
def crear(datos: NuevoSnapshot) -> dict:
    return con_bloqueo(crear_snapshot, datos.nombre.strip(), datos.descripcion.strip(),
                       datos.nodered, datos.thingsboard, datos.telemetria)


@app.get("/api/snapshots/{ident}/descargar")
def descargar(ident: str) -> FileResponse:
    ruta = ruta_snapshot(ident)
    return FileResponse(ruta, media_type="application/gzip", filename=ruta.name)


@app.post("/api/snapshots/importar", status_code=201)
def importar(archivo: UploadFile = File(...)) -> dict:
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=SNAPSHOTS, prefix=".importar-", suffix=".tmp", delete=False) as tmp:
        shutil.copyfileobj(archivo.file, tmp)
        temporal = Path(tmp.name)
    try:
        manifest = validar_tar(temporal)
    except (ValueError, tarfile.TarError, OSError, json.JSONDecodeError) as exc:
        temporal.unlink(missing_ok=True)
        raise HTTPException(400, f"No es un snapshot válido: {exc}") from exc
    base = slug(str(manifest.get("id") or Path(archivo.filename or "importado").stem))
    ident, n = base, 1
    while (SNAPSHOTS / f"{ident}.tar.gz").exists():
        n += 1
        ident = f"{base}-{n}"
    destino = SNAPSHOTS / f"{ident}.tar.gz"
    temporal.rename(destino)
    log.info("Snapshot importado: %s", destino.name)
    return describir(destino)


@app.post("/api/snapshots/{ident}/restaurar")
def restaurar(ident: str, datos: Restauracion) -> dict:
    ruta = ruta_snapshot(ident)
    manifest = describir(ruta)
    contenido = manifest.get("contenido", {})
    hacer_nr = datos.nodered and contenido.get("nodered")
    hacer_tb = datos.thingsboard and contenido.get("thingsboard")
    if not (hacer_nr or hacer_tb):
        raise HTTPException(400, "No hay nada que restaurar con esa selección")

    def operacion() -> dict:
        avisos: list[str] = []
        previa = None
        if datos.copia_previa:
            previa = crear_snapshot(f"Antes de restaurar {manifest.get('nombre', ident)}",
                                    "Copia automática previa a una restauración",
                                    bool(hacer_nr), bool(hacer_tb), True, automatico=True)
        if hacer_tb:
            avisos += restaurar_thingsboard(ruta, manifest)
        if hacer_nr:
            avisos += restaurar_nodered(ruta)
        return {"restaurado": {"nodered": bool(hacer_nr), "thingsboard": bool(hacer_tb)},
                "copia_previa": previa["id"] if previa else None, "avisos": avisos}

    return con_bloqueo(operacion)


@app.delete("/api/snapshots/{ident}", status_code=204)
def eliminar(ident: str) -> None:
    ruta_snapshot(ident).unlink()


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="web")
