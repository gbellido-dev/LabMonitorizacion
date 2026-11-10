"""labia · utilidades de la capa de IA del laboratorio.

La misma librería la usan el servicio de IA (que recibe datos de Node-RED y
publica predicciones) y los cuadernos de Jupyter (que entrenan los modelos).
Las dos partes comparten una carpeta:

    /lab/datos/<conjunto>.csv          datos recogidos (una fila por lectura)
    /lab/modelos/<modelo>.joblib       modelo entrenado en Jupyter
    /lab/modelos/<modelo>.json         su ficha: tipo, entradas, métricas, versión
    /lab/modelos/historial/            versiones anteriores de cada modelo
    /lab/continuo/<modelo>.pkl         modelos de aprendizaje continuo (River)

Uso típico en un cuaderno:

    from labia import datos, guardar
    df = datos("aerolab")
    ...
    guardar(modelo, "aerolab-curva", entradas=["viento"], tipo="regresion", salida="potencia")
"""
from __future__ import annotations

import csv
import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import joblib
import pandas as pd

RAIZ = Path(os.environ.get("LABIA_DIR", "/lab"))
DATOS = RAIZ / "datos"
MODELOS = RAIZ / "modelos"
CONTINUO = RAIZ / "continuo"
TIPOS = ("regresion", "clasificacion", "anomalias")
_NOMBRE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")

__all__ = ["datos", "conjuntos", "registrar", "borrar_datos", "guardar", "cargar", "modelos",
           "predecir", "aplanar", "desde_thingsboard", "RAIZ", "DATOS", "MODELOS"]


def _nombre(nombre: str) -> str:
    if not _NOMBRE.match(nombre or ""):
        raise ValueError(f"Nombre no válido: {nombre!r}. Usa letras, números, '-', '_' o '.' (máx. 64).")
    return nombre


def aplanar(d: dict, prefijo: str = "") -> dict:
    """{"a": {"b": 1}} -> {"a.b": 1}. Las listas se ignoran."""
    plano: dict[str, Any] = {}
    for k, v in d.items():
        clave = f"{prefijo}{k}"
        if isinstance(v, dict):
            plano.update(aplanar(v, clave + "."))
        elif isinstance(v, bool):
            plano[clave] = int(v)
        elif isinstance(v, (int, float, str)) or v is None:
            plano[clave] = v
    return plano


# ── Datos ──────────────────────────────────────────────────────────────────

def _ruta_datos(nombre: str) -> Path:
    return DATOS / f"{_nombre(nombre)}.csv"


def registrar(nombre: str, filas: dict | Iterable[dict]) -> int:
    """Añade filas al conjunto de datos `nombre` (lo crea si no existe).

    Cada fila es un diccionario; se aplana y se le pone la hora (`ts`) si no
    la trae. Si aparecen columnas nuevas, el fichero se reescribe con ellas.
    Devuelve el número total de filas del conjunto.
    """
    if isinstance(filas, dict):
        filas = [filas]
    filas = [aplanar(f) for f in filas]
    if not filas:
        raise ValueError("No hay filas que registrar")
    ahora = datetime.now().isoformat(timespec="milliseconds")
    for f in filas:
        f.setdefault("ts", ahora)
    ruta = _ruta_datos(nombre)
    DATOS.mkdir(parents=True, exist_ok=True)
    cabecera: list[str] = []
    if ruta.exists() and ruta.stat().st_size:
        with ruta.open(encoding="utf-8", newline="") as fh:
            cabecera = next(csv.reader(fh), [])
    nuevas = [k for f in filas for k in f if k not in cabecera]
    nuevas = list(dict.fromkeys(nuevas))
    if cabecera and nuevas:                      # columnas nuevas: reescribir el fichero
        df = pd.read_csv(ruta, dtype=str, keep_default_na=False)
        for c in nuevas:
            df[c] = ""
        cabecera = cabecera + nuevas
        df[cabecera].to_csv(ruta, index=False)
    elif not cabecera:
        cabecera = ["ts"] + [k for k in nuevas if k != "ts"]
        with ruta.open("w", encoding="utf-8", newline="") as fh:
            csv.writer(fh).writerow(cabecera)
    with ruta.open("a", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cabecera, extrasaction="ignore")
        w.writerows(filas)
    return _contar(ruta)


def _contar(ruta: Path) -> int:
    with ruta.open("rb") as fh:
        return max(0, sum(1 for _ in fh) - 1)


def datos(nombre: str, ultimas: int | None = None) -> pd.DataFrame:
    """Lee un conjunto de datos como DataFrame (la columna `ts` como fecha)."""
    ruta = _ruta_datos(nombre)
    if not ruta.exists():
        hay = ", ".join(c["nombre"] for c in conjuntos()) or "ninguno"
        raise FileNotFoundError(f"No existe el conjunto {nombre!r}. Disponibles: {hay}")
    df = pd.read_csv(ruta)
    if "ts" in df:
        df["ts"] = pd.to_datetime(df["ts"], errors="coerce", format="mixed")
    return df.tail(ultimas).reset_index(drop=True) if ultimas else df


def conjuntos() -> list[dict]:
    if not DATOS.exists():
        return []
    salida = []
    for ruta in sorted(DATOS.glob("*.csv")):
        with ruta.open(encoding="utf-8", newline="") as fh:
            cabecera = next(csv.reader(fh), [])
        salida.append({"nombre": ruta.stem, "filas": _contar(ruta), "columnas": cabecera,
                       "kb": round(ruta.stat().st_size / 1024, 1),
                       "modificado": datetime.fromtimestamp(ruta.stat().st_mtime).isoformat(timespec="seconds")})
    return salida


def borrar_datos(nombre: str) -> bool:
    ruta = _ruta_datos(nombre)
    if ruta.exists():
        ruta.unlink()
        return True
    return False


# ── Modelos entrenados ─────────────────────────────────────────────────────

def guardar(modelo: Any, nombre: str, entradas: list[str], tipo: str, salida: str | None = None,
            descripcion: str = "", metricas: dict | None = None) -> dict:
    """Publica un modelo para que el servicio de IA (y Node-RED) lo use.

    modelo   objeto de scikit-learn ya entrenado (o un Pipeline)
    entradas columnas que espera, en orden (las mismas claves que enviará Node-RED)
    tipo     "regresion", "clasificacion" o "anomalias"
    salida   qué predice (solo informativo, p. ej. "potencia")
    """
    if tipo not in TIPOS:
        raise ValueError(f"tipo debe ser uno de {TIPOS}")
    if not entradas:
        raise ValueError("Indica las columnas de entrada (entradas=[...])")
    import sklearn

    _nombre(nombre)
    MODELOS.mkdir(parents=True, exist_ok=True)
    ficha_ruta = MODELOS / f"{nombre}.json"
    version = 1
    if ficha_ruta.exists():                      # la versión anterior pasa al historial
        anterior = json.loads(ficha_ruta.read_text(encoding="utf-8"))
        version = anterior.get("version", 1) + 1
        hist = MODELOS / "historial"
        hist.mkdir(exist_ok=True)
        v = anterior.get("version", 1)
        shutil.copy2(ficha_ruta, hist / f"{nombre}.v{v}.json")
        if (MODELOS / f"{nombre}.joblib").exists():
            shutil.copy2(MODELOS / f"{nombre}.joblib", hist / f"{nombre}.v{v}.joblib")
    ficha = {"nombre": nombre, "tipo": tipo, "entradas": list(entradas), "salida": salida,
             "descripcion": descripcion, "metricas": metricas or {}, "version": version,
             "clase": type(modelo).__name__, "sklearn": sklearn.__version__,
             "creado": datetime.now().isoformat(timespec="seconds")}
    joblib.dump(modelo, MODELOS / f"{nombre}.joblib")
    ficha_ruta.write_text(json.dumps(ficha, ensure_ascii=False, indent=2), encoding="utf-8")
    return ficha


def cargar(nombre: str) -> tuple[Any, dict]:
    ficha_ruta = MODELOS / f"{_nombre(nombre)}.json"
    if not ficha_ruta.exists():
        raise FileNotFoundError(f"No existe el modelo {nombre!r}")
    ficha = json.loads(ficha_ruta.read_text(encoding="utf-8"))
    return joblib.load(MODELOS / f"{nombre}.joblib"), ficha


def modelos() -> list[dict]:
    if not MODELOS.exists():
        return []
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(MODELOS.glob("*.json"))]


def predecir(modelo: Any, ficha: dict, filas: list[dict]) -> list[dict]:
    """Aplica un modelo a una lista de filas (diccionarios) y devuelve un
    diccionario de resultado por fila, según el tipo del modelo."""
    filas = [aplanar(f) for f in filas]
    faltan = sorted({c for f in filas for c in ficha["entradas"] if f.get(c) is None})
    if faltan:
        raise KeyError(f"Faltan entradas del modelo {ficha['nombre']!r}: {', '.join(faltan)}")
    X = pd.DataFrame([[f[c] for c in ficha["entradas"]] for f in filas], columns=ficha["entradas"]).astype(float)
    tipo = ficha["tipo"]
    if tipo == "regresion":
        return [{"prediccion": round(float(p), 4)} for p in modelo.predict(X)]
    if tipo == "clasificacion":
        clases = modelo.predict(X)
        res = [{"clase": c.item() if hasattr(c, "item") else c} for c in clases]
        if hasattr(modelo, "predict_proba"):
            for r, p in zip(res, modelo.predict_proba(X)):
                r["probabilidad"] = round(float(max(p)), 4)
        return res
    # anomalias: convenio de scikit-learn, predict = -1 (anómalo) / 1 (normal)
    etiquetas = modelo.predict(X)
    res = [{"anomalia": bool(e == -1)} for e in etiquetas]
    if hasattr(modelo, "decision_function"):
        for r, s in zip(res, modelo.decision_function(X)):
            r["puntuacion"] = round(float(-s), 4)      # > 0: más anómalo que el umbral
    return res


# ── Otras fuentes ──────────────────────────────────────────────────────────

def desde_thingsboard(dispositivo: str, claves: list[str], horas: float = 1,
                      url: str = "http://thingsboard:8080", usuario: str = "tenant@thingsboard.org",
                      clave: str = "tenant") -> pd.DataFrame:
    """Descarga el histórico de telemetría de un dispositivo de ThingsBoard
    (una columna por clave, una fila por instante)."""
    import requests

    tok = requests.post(f"{url}/api/auth/login", json={"username": usuario, "password": clave}, timeout=10)
    tok.raise_for_status()
    h = {"X-Authorization": "Bearer " + tok.json()["token"]}
    d = requests.get(f"{url}/api/tenant/devices", params={"deviceName": dispositivo}, headers=h, timeout=10)
    if d.status_code == 404:
        raise FileNotFoundError(f"ThingsBoard no tiene el dispositivo {dispositivo!r}")
    d.raise_for_status()
    fin = int(datetime.now().timestamp() * 1000)
    r = requests.get(f"{url}/api/plugins/telemetry/DEVICE/{d.json()['id']['id']}/values/timeseries",
                     params={"keys": ",".join(claves), "startTs": fin - int(horas * 3600_000), "endTs": fin,
                             "limit": 100000, "agg": "NONE", "orderBy": "ASC"}, headers=h, timeout=30)
    r.raise_for_status()
    series = [pd.Series({p["ts"]: p["value"] for p in puntos}, name=k) for k, puntos in r.json().items()]
    if not series:
        return pd.DataFrame(columns=["ts", *claves])
    df = pd.concat(series, axis=1).sort_index()
    for c in df.columns:                         # números como números; el texto se queda
        num = pd.to_numeric(df[c], errors="coerce")
        if num.notna().sum() == df[c].notna().sum():
            df[c] = num
    df.index = pd.to_datetime(df.index, unit="ms")
    return df.rename_axis("ts").reset_index()
