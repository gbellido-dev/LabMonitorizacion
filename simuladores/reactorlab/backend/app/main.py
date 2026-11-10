"""ReactorLab · servidor web.

Protocolos que ofrece (todos sobre HTTP en el mismo puerto):

- REST (JSON)   GET /api/v1/...            consulta (polling)
                PUT/POST/DELETE /api/v1/... órdenes (requieren X-API-Key)
- WebSocket     /ws                         el servidor empuja el estado cada segundo
- SSE           /api/v1/stream              eventos (alarmas, cambios) en text/event-stream
- Webhooks      POST a la URL que se registre cuando ocurre un evento
- OpenAPI       /docs  y  /openapi.json
"""

from __future__ import annotations

import asyncio
from collections import deque
from contextlib import asynccontextmanager, suppress
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import re
import secrets
import time
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
import httpx
from pydantic import BaseModel, Field

from .planta import Planta, ahora_iso

log = logging.getLogger("reactorlab")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

API_KEY = os.getenv("REACTORLAB_API_KEY", "reactorlab")
TICK_S = 0.25
planta = Planta(escala_tiempo=float(os.getenv("REACTORLAB_ESCALA_TIEMPO", "120")))

DATOS = Path(os.getenv("REACTORLAB_DATOS", "/tmp/reactorlab"))
ws_clientes: dict[WebSocket, float] = {}           # socket -> intervalo de envío [s]
sse_colas: set[asyncio.Queue] = set()
webhooks: dict[str, dict] = {}
trafico: deque = deque(maxlen=80)
entregas: deque = deque(maxlen=50)


# ---------------------------------------------------------------------- utilidades
def guardar_webhooks() -> None:
    """Los webhooks se conservan aunque se reinicie el contenedor."""
    try:
        DATOS.mkdir(parents=True, exist_ok=True)
        (DATOS / "webhooks.json").write_text(json.dumps(webhooks, ensure_ascii=False, indent=1))
    except OSError as exc:
        log.warning("No se pudieron guardar los webhooks: %s", exc)


def cargar_webhooks() -> None:
    try:
        webhooks.update(json.loads((DATOS / "webhooks.json").read_text()))
        log.info("%d webhook(s) recuperados", len(webhooks))
    except (OSError, ValueError):
        pass


def registrar(tipo: str, metodo: str, ruta: str, estado: int | str, cliente: str = "", ms: float = 0.0) -> None:
    trafico.append({"t": ahora_iso(), "tipo": tipo, "metodo": metodo, "ruta": ruta, "estado": estado,
                    "cliente": cliente, "ms": round(ms, 1)})


TOKEN_EN_URL = re.compile(r"/api/v1/[A-Za-z0-9_-]{12,}/")


def ocultar(url: str) -> str:
    """Oculta tokens de acceso incluidos en la ruta (p. ej. la API HTTP de ThingsBoard)."""
    return TOKEN_EN_URL.sub("/api/v1/••••/", url)


def requiere_clave(x_api_key: str | None = Header(default=None, description="Clave de la API (órdenes)")) -> None:
    if x_api_key is None:
        raise HTTPException(401, "Falta la cabecera X-API-Key")
    if not hmac.compare_digest(x_api_key, API_KEY):
        raise HTTPException(403, "X-API-Key no válida")


def plano(ev: dict) -> dict:
    """Versión sin anidar de un evento (útil para plataformas que esperan pares clave-valor)."""
    salida = {}
    for k, v in ev.items():
        if isinstance(v, dict):
            for k2, v2 in v.items():
                salida[f"{k}_{k2}"] = v2
        else:
            salida[k] = v
    return salida


async def entregar_webhook(cliente: httpx.AsyncClient, wh: dict, ev: dict) -> None:
    cuerpo = plano(ev) if wh["formato"] == "plano" else ev
    datos = json.dumps(cuerpo, ensure_ascii=False).encode()
    cabeceras = {"Content-Type": "application/json", "User-Agent": "ReactorLab-Webhook/1.0",
                 "X-ReactorLab-Evento": ev["evento"]}
    if wh.get("secreto"):
        firma = hmac.new(wh["secreto"].encode(), datos, hashlib.sha256).hexdigest()
        cabeceras["X-ReactorLab-Firma"] = f"sha256={firma}"
    inicio = time.perf_counter()
    try:
        r = await cliente.post(wh["url"], content=datos, headers=cabeceras, timeout=3.0)
        estado = r.status_code
    except httpx.HTTPError as exc:
        estado = f"error: {type(exc).__name__}"
    ms = (time.perf_counter() - inicio) * 1000
    wh["ultimo_estado"] = estado
    wh["entregas"] = wh.get("entregas", 0) + 1
    entregas.append({"t": ahora_iso(), "webhook": wh["id"], "url": ocultar(wh["url"]), "evento": ev["evento"],
                     "estado": estado, "ms": round(ms, 1)})
    registrar("webhook", "POST", ocultar(wh["url"]), estado, "ReactorLab →", ms)


async def difundir_eventos(cliente: httpx.AsyncClient, eventos: list[dict]) -> None:
    for ev in eventos:
        for cola in list(sse_colas):
            with suppress(asyncio.QueueFull):
                cola.put_nowait(ev)
        for wh in list(webhooks.values()):
            if any(ev["evento"].startswith(p) for p in wh["eventos"]):
                asyncio.create_task(entregar_webhook(cliente, wh, ev))


async def bucle() -> None:
    ultimo_envio: dict[WebSocket, float] = {}
    async with httpx.AsyncClient() as cliente:
        ultimo = time.monotonic()
        while True:
            await asyncio.sleep(TICK_S)
            ahora = time.monotonic()
            nuevos = planta.avanzar(ahora - ultimo)
            ultimo = ahora
            # eventos generados también por órdenes recibidas entre ticks
            pendientes = [ev for ev in list(planta.eventos)[-20:] if not ev.get("_difundido")]
            for ev in pendientes:
                ev["_difundido"] = True
            visibles = [{k: v for k, v in ev.items() if not k.startswith("_")} for ev in pendientes]
            await difundir_eventos(cliente, visibles or [])
            if ws_clientes:
                foto = planta.snapshot()
                for ws, intervalo in list(ws_clientes.items()):
                    if ahora - ultimo_envio.get(ws, 0) >= intervalo:
                        ultimo_envio[ws] = ahora
                        try:
                            await ws.send_json(foto)
                        except Exception:
                            ws_clientes.pop(ws, None)
            del nuevos


@asynccontextmanager
async def lifespan(_: FastAPI):
    cargar_webhooks()
    tarea = asyncio.create_task(bucle())
    log.info("ReactorLab en marcha · escala de tiempo x%s · clave API '%s'", planta.escala_tiempo,
             "por defecto" if API_KEY == "reactorlab" else "personalizada")
    yield
    tarea.cancel()
    with suppress(asyncio.CancelledError):
        await tarea


app = FastAPI(
    title="ReactorLab API",
    version="1.0.0",
    description="Planta química simulada (reactor Tennessee Eastman simplificado) con protocolos web. "
                "Las lecturas son libres; las órdenes necesitan la cabecera `X-API-Key`.",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def medir_trafico(request: Request, call_next):
    inicio = time.perf_counter()
    respuesta = await call_next(request)
    ruta = request.url.path
    propia = request.headers.get("x-reactorlab-ui") == "1"      # peticiones de la propia interfaz
    if ruta.startswith("/api/") and not ruta.startswith("/api/v1/interno") and not propia:
        cliente = request.client.host if request.client else ""
        consulta = f"?{request.url.query}" if request.url.query else ""
        registrar("http", request.method, ruta + consulta, respuesta.status_code, cliente,
                  (time.perf_counter() - inicio) * 1000)
    return respuesta


# ---------------------------------------------------------------------- modelos
class ConsignasIn(BaseModel):
    caudal_producto_kmolh: float | None = Field(None, ge=60, le=110, examples=[100])
    presion_kpa: float | None = Field(None, ge=2500, le=2950, examples=[2700])
    a_purga_pct: float | None = Field(None, ge=40, le=55, examples=[47])
    nivel_pct: float | None = Field(None, ge=20, le=75, examples=[44])


class ModoIn(BaseModel):
    modo: Literal["auto", "manual"]


class ValvulasIn(BaseModel):
    f1: float | None = Field(None, ge=0, le=100)
    f2: float | None = Field(None, ge=0, le=100)
    purga: float | None = Field(None, ge=0, le=100)
    producto: float | None = Field(None, ge=0, le=100)


class ActivoIn(BaseModel):
    activo: bool


class MarchaIn(BaseModel):
    en_marcha: bool


class AveriaIn(BaseModel):
    tipo: Literal["valvula_atascada", "valvula_lenta", "valvula_sucia", "sensor"]
    objetivo: str = Field(examples=["purga"])
    valor: float | None = Field(None, description="lenta: %/h · sucia: fracción de Cv (0-1) · sensor: severidad")
    modo: Literal["ok", "congelado", "deriva", "ruido", "perdida"] | None = None


class WebhookIn(BaseModel):
    url: str = Field(examples=["http://nodered:1880/reactorlab/eventos"])
    eventos: list[str] = Field(default=["alarma"], description="Prefijos de evento: alarma, estado, consigna, averia, planta")
    formato: Literal["completo", "plano"] = "completo"
    secreto: str | None = Field(None, description="Si se indica, se firma el cuerpo con HMAC-SHA256")


class EscalaIn(BaseModel):
    escala: float = Field(ge=1, le=600)


def _error(exc: Exception):
    if isinstance(exc, PermissionError):
        raise HTTPException(409, str(exc))
    raise HTTPException(422, str(exc))


# ---------------------------------------------------------------------- lectura
@app.get("/api/v1/info", tags=["lectura"], summary="Información del simulador y de sus protocolos")
def info(request: Request) -> dict:
    base = str(request.base_url).rstrip("/")
    ws = base.replace("http", "ws", 1)
    return {
        "planta": "ReactorLab",
        "descripcion": "Reactor químico continuo A + C → D (Tennessee Eastman simplificado)",
        "version": app.version,
        "escala_tiempo": planta.escala_tiempo,
        "protocolos": {
            "rest": f"{base}/api/v1/proceso",
            "websocket": f"{ws}/ws",
            "sse": f"{base}/api/v1/stream",
            "webhooks": f"{base}/api/v1/webhooks",
            "openapi": f"{base}/docs",
        },
        "ordenes": "PUT/POST/DELETE requieren la cabecera X-API-Key",
    }


@app.get("/api/v1/proceso", tags=["lectura"], summary="Estado completo de la planta")
def proceso() -> dict:
    return planta.snapshot()


@app.get("/api/v1/medidas", tags=["lectura"], summary="Medidas en formato plano (clave: valor)")
def medidas() -> dict:
    return {"timestamp": ahora_iso(), **planta.medidas_planas()}


@app.get("/api/v1/medidas/{variable}", tags=["lectura"], summary="Una sola medida")
def medida(variable: str) -> dict:
    m = planta.medidas_planas()
    if variable not in m:
        raise HTTPException(404, f"Variable desconocida. Disponibles: {', '.join(m)}")
    return {"variable": variable, "valor": m[variable], "timestamp": ahora_iso()}


@app.get("/api/v1/consignas", tags=["lectura"])
def leer_consignas() -> dict:
    return planta.consignas()


@app.get("/api/v1/historico", tags=["lectura"], summary="Histórico (1 muestra por segundo, última hora)")
def historico(variables: str = Query("presion_kpa,nivel_pct", description="Lista separada por comas"),
              minutos: float = Query(10, gt=0, le=60)) -> dict:
    nombres = [v.strip() for v in variables.split(",") if v.strip()]
    validas = set(planta.medidas_planas())
    malas = [v for v in nombres if v not in validas]
    if malas:
        raise HTTPException(404, f"Variables desconocidas: {', '.join(malas)}")
    desde = (time.time() - minutos * 60) * 1000
    muestras = [h for h in planta.historico if h["ts"] >= desde]
    return {"variables": {v: [{"ts": h["ts"], "valor": h[v]} for h in muestras] for v in nombres},
            "muestras": len(muestras)}


@app.get("/api/v1/alarmas", tags=["lectura"], summary="Alarmas activas")
def alarmas() -> list[dict]:
    return list(planta.activas.values())


@app.get("/api/v1/eventos", tags=["lectura"], summary="Últimos eventos (alarmas, órdenes, averías)")
def eventos(limite: int = Query(50, ge=1, le=200)) -> list[dict]:
    return [{k: v for k, v in ev.items() if not k.startswith("_")} for ev in list(planta.eventos)[-limite:]][::-1]


@app.get("/api/v1/averias", tags=["lectura"])
def leer_averias() -> list[dict]:
    return list(planta.averias.values())


# ---------------------------------------------------------------------- órdenes
@app.put("/api/v1/consignas", tags=["órdenes"], dependencies=[Depends(requiere_clave)])
def cambiar_consignas(datos: ConsignasIn) -> dict:
    try:
        return planta.fijar_consignas(datos.model_dump())
    except (ValueError, PermissionError) as exc:
        _error(exc)


@app.put("/api/v1/modo", tags=["órdenes"], dependencies=[Depends(requiere_clave)])
def cambiar_modo(datos: ModoIn) -> dict:
    planta.fijar_modo(datos.modo)
    return {"modo": planta.control.modo}


@app.put("/api/v1/valvulas", tags=["órdenes"], dependencies=[Depends(requiere_clave)],
         summary="Mover válvulas (solo en modo manual)")
def mover_valvulas(datos: ValvulasIn) -> dict:
    try:
        planta.fijar_valvulas(datos.model_dump())
    except (ValueError, PermissionError) as exc:
        _error(exc)
    return planta.snapshot()["valvulas"]


@app.post("/api/v1/marcha", tags=["órdenes"], dependencies=[Depends(requiere_clave)])
def marcha(datos: MarchaIn) -> dict:
    planta.fijar_marcha(datos.en_marcha)
    return {"en_marcha": planta.control.en_marcha}


@app.post("/api/v1/paro-emergencia", tags=["órdenes"], dependencies=[Depends(requiere_clave)])
def paro(datos: ActivoIn) -> dict:
    planta.fijar_paro(datos.activo)
    return {"paro_emergencia": planta.control.paro_emergencia}


@app.post("/api/v1/averias", tags=["órdenes"], dependencies=[Depends(requiere_clave)], status_code=201)
def inyectar(datos: AveriaIn) -> dict:
    try:
        return planta.inyectar(datos.tipo, datos.objetivo, datos.valor, datos.modo)
    except ValueError as exc:
        _error(exc)


@app.delete("/api/v1/averias", tags=["órdenes"], dependencies=[Depends(requiere_clave)], status_code=204)
def quitar_averias() -> None:
    planta.quitar_averias()


# ---------------------------------------------------------------------- webhooks
def _publico(w: dict) -> dict:
    return {k: v for k, v in w.items() if k != "secreto"} | {"url": ocultar(w["url"]), "firmado": bool(w.get("secreto"))}


@app.get("/api/v1/webhooks", tags=["webhooks"], dependencies=[Depends(requiere_clave)])
def listar_webhooks() -> list[dict]:
    return [_publico(w) for w in webhooks.values()]


@app.post("/api/v1/webhooks", tags=["webhooks"], dependencies=[Depends(requiere_clave)], status_code=201,
          summary="Registrar un webhook (si la URL ya existe, se actualiza y responde 200)")
def crear_webhook(datos: WebhookIn, respuesta: Response) -> dict:
    if not datos.url.startswith(("http://", "https://")):
        raise HTTPException(422, "La URL debe empezar por http:// o https://")
    for w in webhooks.values():
        if w["url"] == datos.url:
            w.update(eventos=datos.eventos, formato=datos.formato, secreto=datos.secreto)
            guardar_webhooks()
            respuesta.status_code = 200
            return _publico(w)
    if len(webhooks) >= 20:
        raise HTTPException(409, "Máximo 20 webhooks")
    wid = secrets.token_hex(4)
    webhooks[wid] = {"id": wid, "url": datos.url, "eventos": datos.eventos, "formato": datos.formato,
                     "secreto": datos.secreto, "creado": ahora_iso(), "entregas": 0, "ultimo_estado": None}
    guardar_webhooks()
    return _publico(webhooks[wid])


@app.delete("/api/v1/webhooks/{wid}", tags=["webhooks"], dependencies=[Depends(requiere_clave)], status_code=204)
def borrar_webhook(wid: str) -> None:
    if webhooks.pop(wid, None) is None:
        raise HTTPException(404, "Webhook no encontrado")
    guardar_webhooks()


@app.post("/api/v1/webhooks/prueba", tags=["webhooks"], dependencies=[Depends(requiere_clave)],
          summary="Envía un evento de prueba a todos los webhooks")
async def probar_webhooks() -> dict:
    ev = {"evento": "prueba", "timestamp": ahora_iso(), "planta": "ReactorLab", "mensaje": "Webhook de prueba"}
    async with httpx.AsyncClient() as cliente:
        await asyncio.gather(*(entregar_webhook(cliente, w, ev) for w in list(webhooks.values())))
    return {"enviados": len(webhooks)}


# ---------------------------------------------------------------------- tiempo real
@app.websocket("/ws")
async def websocket(ws: WebSocket, intervalo: float = 1.0):
    await ws.accept()
    intervalo = max(0.25, min(intervalo, 60.0))
    cliente = ws.client.host if ws.client else ""
    ws_clientes[ws] = intervalo
    registrar("ws", "CONNECT", f"/ws?intervalo={intervalo:g}", 101, cliente)
    try:
        await ws.send_json(planta.snapshot())
        while True:
            await ws.receive_text()          # se ignora: el canal es de bajada
    except WebSocketDisconnect:
        pass
    finally:
        ws_clientes.pop(ws, None)
        registrar("ws", "CLOSE", "/ws", 1000, cliente)


@app.get("/api/v1/stream", tags=["tiempo real"], summary="Eventos en tiempo real (Server-Sent Events)")
async def stream(request: Request) -> StreamingResponse:
    cola: asyncio.Queue = asyncio.Queue(maxsize=100)
    sse_colas.add(cola)

    async def generador():
        try:
            yield "retry: 3000\n\n"
            while not await request.is_disconnected():
                try:
                    ev = await asyncio.wait_for(cola.get(), timeout=15)
                    yield f"event: {ev['evento']}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": latido\n\n"
        finally:
            sse_colas.discard(cola)

    return StreamingResponse(generador(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------- interfaz (profesor)
@app.get("/api/v1/interno/trafico", include_in_schema=False)
def ver_trafico() -> dict:
    return {"trafico": list(trafico)[::-1], "entregas": list(entregas)[::-1],
            "websockets": len(ws_clientes), "sse": len(sse_colas), "webhooks": [_publico(w) for w in webhooks.values()],
            "clave_por_defecto": API_KEY == "reactorlab"}


@app.put("/api/v1/interno/escala", include_in_schema=False, dependencies=[Depends(requiere_clave)])
def escala(datos: EscalaIn) -> dict:
    planta.escala_tiempo = datos.escala
    return {"escala_tiempo": planta.escala_tiempo}


@app.post("/api/v1/interno/reiniciar", include_in_schema=False, dependencies=[Depends(requiere_clave)])
def reiniciar() -> dict:
    planta.reiniciar()
    return planta.snapshot()


@app.get("/api/health", include_in_schema=False)
def salud() -> dict:
    return {"status": "ok", "secuencia": planta.secuencia}


# ---------------------------------------------------------------------- vista 3D (GRFICS)
VISTA3D = Path(__file__).resolve().parents[2] / "vista3d"


@app.get("/data/index.php", include_in_schema=False)
@app.get("/3d/data/index.php", include_in_schema=False)
def datos_grfics() -> dict:
    """Endpoint compatible con GRFICS: la escena 3D de Unity lo consulta cada pocos segundos."""
    return planta.formato_grfics()


if VISTA3D.is_dir():
    @app.get("/LowQuality.mp4", include_in_schema=False)
    @app.get("/3d/LowQuality.mp4", include_in_schema=False)
    def video_3d() -> FileResponse:
        ruta = VISTA3D / "LowQuality.mp4"
        if not ruta.is_file():
            raise HTTPException(404, "Vídeo de la vista 3D no instalado")
        return FileResponse(ruta, media_type="video/mp4")

    @app.get("/3d", include_in_schema=False)
    def vista_3d_barra() -> Response:
        return Response(status_code=307, headers={"Location": "/3d/"})

    app.mount("/3d", StaticFiles(directory=VISTA3D, html=True), name="vista3d")

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
if FRONTEND.is_dir():
    app.mount("/static", StaticFiles(directory=FRONTEND), name="static")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(FRONTEND / "index.html")
