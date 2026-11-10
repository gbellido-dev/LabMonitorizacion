"""AtomLab: central nuclear RBMK didáctica con servidor OPC UA, API REST y vista 3D."""

from __future__ import annotations

import asyncio
import contextlib
import os
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .fisica import P_NOMINAL
from .opcua_server import NAMESPACE_URI, ServidorOpcUa
from .planta import ALARMAS, Planta

RAIZ = Path(__file__).resolve().parents[2]
FRONTEND = Path(os.getenv("ATOMLAB_FRONTEND", RAIZ / "frontend"))
VENDOR = Path(os.getenv("ATOMLAB_VENDOR", FRONTEND / "vendor"))
PUERTO_OPCUA = int(os.getenv("ATOMLAB_OPCUA_PORT", "4842"))
HOST_PUBLICO = os.getenv("ATOMLAB_OPCUA_HOST", "localhost")
ESCALA = float(os.getenv("ATOMLAB_ESCALA_TIEMPO", "1"))
OPCUA_ACTIVO = os.getenv("ATOMLAB_OPCUA", "1") != "0"


async def bucle_simulacion(planta: Planta) -> None:
    anterior = time.monotonic()
    while True:
        await asyncio.sleep(0.05)
        ahora = time.monotonic()
        planta.avanzar(min(0.5, ahora - anterior))
        anterior = ahora


@contextlib.asynccontextmanager
async def ciclo_vida(app: FastAPI):
    planta = Planta(escala=ESCALA)
    app.state.planta = planta
    app.state.opcua = ServidorOpcUa(planta, puerto=PUERTO_OPCUA, nombre_publico=HOST_PUBLICO)
    tareas = [asyncio.create_task(bucle_simulacion(planta), name="atomlab-fisica")]
    if OPCUA_ACTIVO:
        tareas.append(asyncio.create_task(app.state.opcua.ejecutar(), name="atomlab-opcua"))
    try:
        yield
    finally:
        for t in tareas:
            t.cancel()
        await asyncio.gather(*tareas, return_exceptions=True)


app = FastAPI(title="AtomLab · Central RBMK", version="1.0.0", lifespan=ciclo_vida,
              description="Simulador didáctico de una central nuclear RBMK-1000 (tipo Chernóbil). "
                          "El protocolo de la práctica es OPC UA; esta API sirve a la sala de control web.")


def planta() -> Planta:
    return app.state.planta


def _orden(funcion, *args) -> dict:
    try:
        funcion(*args)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except (RuntimeError, PermissionError) as e:
        raise HTTPException(409, str(e)) from e
    return {"ok": True, "estado": planta().estado()}


# ---------------------------------------------------------------------- lectura
@app.get("/api/v1/info")
def info() -> dict:
    srv: ServidorOpcUa = app.state.opcua
    return {
        "planta": "AtomLab", "tipo": "RBMK-1000", "potencia_nominal_mwt": P_NOMINAL, "potencia_nominal_mwe": 1000,
        "opcua": {"endpoint": srv.endpoint_publico, "namespace": NAMESPACE_URI, "ns": srv.ns,
                  "en_marcha": srv.en_marcha, "error": srv.error, "seguridad": "None"},
        "escala_tiempo": planta().escala,
    }


@app.get("/api/v1/planta")
def estado_planta() -> dict:
    return planta().instantanea()


@app.get("/api/v1/medidas")
def medidas() -> dict:
    return planta().medidas()


@app.get("/api/v1/historico")
def historico(segundos: int = 300) -> dict:
    p = planta()
    with p.bloqueo:
        filas = list(p.historico)
    t_fin = filas[-1]["t_s"] if filas else 0
    return {"muestras": [f for f in filas if f["t_s"] >= t_fin - segundos]}


@app.get("/api/v1/alarmas")
def alarmas() -> dict:
    p = planta()
    with p.bloqueo:
        return {"activas": list(p.activas.values()),
                "catalogo": [{"codigo": a.codigo, "texto": a.texto, "severidad": a.severidad} for a in ALARMAS.values()]}


@app.get("/api/v1/eventos")
def eventos(limite: int = 50) -> dict:
    p = planta()
    with p.bloqueo:
        return {"eventos": list(p.eventos)[:limite]}


@app.get("/api/v1/opcua")
def opcua() -> dict:
    srv: ServidorOpcUa = app.state.opcua
    return {"endpoint": srv.endpoint_publico, "namespace": NAMESPACE_URI, "ns": srv.ns, "en_marcha": srv.en_marcha,
            "nodos": srv.espacio(), "registro": list(srv.registro)[:30]}


# ---------------------------------------------------------------------- mandos
class Potencia(BaseModel):
    mwt: float = Field(ge=0, le=P_NOMINAL)


class Regulador(BaseModel):
    auto: bool


class Barras(BaseModel):
    insercion_pct: float = Field(ge=0, le=100)


class Bombas(BaseModel):
    en_marcha: int = Field(ge=0, le=8)


class Protecciones(BaseModel):
    activas: bool


class Escenario(BaseModel):
    nombre: str = Field(pattern="^(normal|chernobil)$")


class Escala(BaseModel):
    valor: float = Field(ge=0.25, le=60)


@app.put("/api/v1/mandos/potencia")
def m_potencia(c: Potencia) -> dict:
    return _orden(planta().fijar_potencia, c.mwt)


@app.put("/api/v1/mandos/regulador")
def m_regulador(c: Regulador) -> dict:
    return _orden(planta().fijar_regulador, c.auto)


@app.put("/api/v1/mandos/barras/{grupo}")
def m_barras(grupo: str, c: Barras) -> dict:
    return _orden(planta().mover_barras, grupo.upper(), c.insercion_pct)


@app.put("/api/v1/mandos/bombas")
def m_bombas(c: Bombas) -> dict:
    return _orden(planta().fijar_bombas, c.en_marcha)


@app.put("/api/v1/mandos/protecciones")
def m_protecciones(c: Protecciones) -> dict:
    return _orden(planta().fijar_protecciones, c.activas)


@app.post("/api/v1/mandos/az5")
def m_az5() -> dict:
    return _orden(planta().az5, "AZ-5 manual")


@app.post("/api/v1/mandos/rearmar")
def m_rearmar() -> dict:
    return _orden(planta().rearmar)


@app.post("/api/v1/mandos/turbina/{accion}")
def m_turbina(accion: str) -> dict:
    acciones = {"disparo": lambda: planta().turbina(True), "rearme": lambda: planta().turbina(False),
                "prueba": planta().prueba_turbina}
    if accion not in acciones:
        raise HTTPException(404, "acción desconocida (disparo, rearme, prueba)")
    return _orden(acciones[accion])


@app.post("/api/v1/mandos/escenario")
def m_escenario(c: Escenario) -> dict:
    return _orden(planta().reiniciar, c.nombre)


@app.put("/api/v1/mandos/escala")
def m_escala(c: Escala) -> dict:
    planta().escala = c.valor
    return {"ok": True, "escala": c.valor}


# ---------------------------------------------------------------------- tiempo real
@app.websocket("/ws")
async def ws(socket: WebSocket, intervalo: float = 0.2) -> None:
    await socket.accept()
    intervalo = max(0.1, min(5.0, intervalo))
    try:
        while True:
            await socket.send_json(planta().instantanea())
            await asyncio.sleep(intervalo)
    except (WebSocketDisconnect, RuntimeError):
        pass


# ---------------------------------------------------------------------- web
if VENDOR.is_dir():
    app.mount("/vendor", StaticFiles(directory=VENDOR), name="vendor")


@app.get("/", include_in_schema=False)
def inicio() -> Any:
    return FileResponse(FRONTEND / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND), name="web")
