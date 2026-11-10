from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .model import FaultCode, SolarPlantSimulator
from .opcua_server import NAMESPACE_URI, OpcUaBridge


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
OPCUA_HOST = os.getenv("OPCUA_HOST", "0.0.0.0")
OPCUA_PORT = int(os.getenv("OPCUA_PORT", "4840"))
OPCUA_PUBLIC_HOST = os.getenv("OPCUA_PUBLIC_HOST", "localhost")


class ControlUpdate(BaseModel):
    run_command: bool | None = None
    irradiance_wm2: float | None = Field(default=None, ge=0, le=1200)
    ambient_temperature_c: float | None = Field(default=None, ge=-10, le=50)
    cloud_cover_pct: float | None = Field(default=None, ge=0, le=100)
    soiling_pct: float | None = Field(default=None, ge=0, le=50)
    tracking_enabled: bool | None = None
    fault_code: int | None = Field(default=None, ge=0, le=max(item.value for item in FaultCode))
    simulation_speed: float | None = Field(default=None, ge=0.1, le=10)


async def simulation_loop(simulator: SolarPlantSimulator) -> None:
    loop = asyncio.get_running_loop()
    previous = loop.time()
    while True:
        now = loop.time()
        simulator.step(now - previous)
        previous = now
        await asyncio.sleep(0.05)


@asynccontextmanager
async def lifespan(app: FastAPI):
    simulator = SolarPlantSimulator()
    bridge = OpcUaBridge(simulator, OPCUA_HOST, OPCUA_PORT)
    app.state.simulator = simulator
    app.state.opcua = bridge
    simulation_task = asyncio.create_task(simulation_loop(simulator), name="solar-physics")
    opcua_task = asyncio.create_task(bridge.run(), name="opcua-server")
    app.state.opcua_task = opcua_task
    try:
        yield
    finally:
        simulation_task.cancel()
        opcua_task.cancel()
        with suppress(Exception):
            await asyncio.gather(simulation_task, opcua_task, return_exceptions=True)


app = FastAPI(
    title="SolarLab OPC UA",
    description="Simulador didáctico de un parque fotovoltaico de 5 MW con servidor OPC UA real.",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def simulator() -> SolarPlantSimulator:
    return app.state.simulator


def opcua() -> OpcUaBridge:
    return app.state.opcua


def connection_payload() -> dict[str, Any]:
    return {
        "endpoint": f"opc.tcp://{OPCUA_PUBLIC_HOST}:{OPCUA_PORT}/solarlab/server/",
        "namespace_uri": NAMESPACE_URI,
        "namespace_index": opcua().namespace_index,
        "security": "None",
        "running": opcua().running,
    }


def snapshot() -> dict[str, Any]:
    payload = simulator().snapshot()
    payload.update({
        "opcua": connection_payload(),
        "nodes": opcua().address_space(),
        "events": opcua().latest_events(12),
    })
    return payload


@app.get("/api/health")
async def health() -> dict[str, Any]:
    task: asyncio.Task[Any] = app.state.opcua_task
    return {
        "status": "ok",
        "opcua": connection_payload(),
        "task_running": not task.done(),
        "error": str(task.exception()) if task.done() and not task.cancelled() and task.exception() else None,
    }


@app.get("/api/state")
async def state() -> dict[str, Any]:
    return snapshot()


@app.patch("/api/control")
async def control(payload: ControlUpdate) -> dict[str, Any]:
    simulator().apply_controls(payload.model_dump(exclude_none=True))
    return snapshot()


@app.post("/api/reset")
async def reset() -> dict[str, Any]:
    simulator().reset()
    return snapshot()


@app.get("/api/opcua/nodes")
async def nodes() -> dict[str, Any]:
    return {"connection": connection_payload(), "nodes": opcua().address_space()}


@app.get("/api/opcua/events")
async def events(limit: int = Query(default=20, ge=1, le=40)) -> dict[str, Any]:
    return {"events": opcua().latest_events(limit)}


@app.websocket("/ws")
async def websocket_state(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(snapshot())
            await asyncio.sleep(0.4)
    except WebSocketDisconnect:
        return


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def frontend(full_path: str) -> FileResponse:
        candidate = (FRONTEND_DIST / full_path).resolve()
        if candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.getenv("API_HOST", "0.0.0.0"),
        port=int(os.getenv("API_PORT", "8000")),
        reload=False,
    )
