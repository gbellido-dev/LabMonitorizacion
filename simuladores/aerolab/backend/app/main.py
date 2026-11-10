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

from .modbus_server import ModbusBridge
from .model import FaultCode, TurbineSimulator
from .register_map import (
    encode_coils,
    encode_discrete_inputs,
    encode_holding_registers,
    encode_input_registers,
    register_map_payload,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
MODBUS_HOST = os.getenv("MODBUS_HOST", "0.0.0.0")
MODBUS_PORT = int(os.getenv("MODBUS_PORT", "1502"))


class ControlUpdate(BaseModel):
    run_command: bool | None = None
    brake_command: bool | None = None
    manual_mode: bool | None = None
    wind_speed_mps: float | None = Field(default=None, ge=0, le=35)
    wind_direction_deg: float | None = Field(default=None, ge=0, lt=360)
    pitch_command_deg: float | None = Field(default=None, ge=0, le=90)
    yaw_command_deg: float | None = Field(default=None, ge=0, lt=360)
    power_limit_kw: float | None = Field(default=None, ge=0, le=5000)
    fault_code: int | None = Field(default=None, ge=0, le=max(item.value for item in FaultCode))
    turbulence_pct: float | None = Field(default=None, ge=0, le=30)
    simulation_speed: float | None = Field(default=None, ge=0.1, le=10)


async def simulation_loop(simulator: TurbineSimulator) -> None:
    loop = asyncio.get_running_loop()
    previous = loop.time()
    while True:
        now = loop.time()
        simulator.step(now - previous)
        previous = now
        await asyncio.sleep(0.05)


@asynccontextmanager
async def lifespan(app: FastAPI):
    simulator = TurbineSimulator()
    modbus = ModbusBridge(simulator, MODBUS_HOST, MODBUS_PORT)
    app.state.simulator = simulator
    app.state.modbus = modbus
    simulation_task = asyncio.create_task(simulation_loop(simulator), name="turbine-physics")
    modbus_task = asyncio.create_task(modbus.run(), name="modbus-tcp-server")
    app.state.modbus_task = modbus_task
    try:
        yield
    finally:
        simulation_task.cancel()
        modbus_task.cancel()
        with suppress(Exception):
            await asyncio.gather(simulation_task, modbus_task, return_exceptions=True)


app = FastAPI(
    title="AeroLab Modbus TCP",
    description="Simulador didáctico de un aerogenerador de 5 MW.",
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


def simulator() -> TurbineSimulator:
    return app.state.simulator


def bridge() -> ModbusBridge:
    return app.state.modbus


@app.get("/api/health")
async def health() -> dict[str, Any]:
    task: asyncio.Task[Any] = app.state.modbus_task
    return {
        "status": "ok",
        "modbus": {
            "host": MODBUS_HOST,
            "port": MODBUS_PORT,
            "running": not task.done(),
            "error": str(task.exception()) if task.done() and not task.cancelled() and task.exception() else None,
        },
    }


@app.get("/api/state")
async def state() -> dict[str, Any]:
    return simulator().snapshot()


@app.patch("/api/control")
async def control(payload: ControlUpdate) -> dict[str, Any]:
    simulator().apply_controls(payload.model_dump(exclude_none=True))
    return simulator().snapshot()


@app.post("/api/reset")
async def reset() -> dict[str, Any]:
    simulator().reset()
    return simulator().snapshot()


@app.get("/api/registers")
async def registers() -> dict[str, Any]:
    sim = simulator()
    return {
        "map": register_map_payload(),
        "raw": {
            "coils": encode_coils(sim.commands),
            "discrete": encode_discrete_inputs(sim.state),
            "holding": encode_holding_registers(sim.commands),
            "input": encode_input_registers(sim.state),
        },
    }


@app.get("/api/transactions")
async def transactions(limit: int = Query(default=20, ge=1, le=100)) -> dict[str, Any]:
    return {"transactions": bridge().latest_transactions(limit)}


@app.websocket("/ws")
async def websocket_state(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            payload = simulator().snapshot()
            payload.update(
                {
                    "type": "snapshot",
                    "transactions": bridge().latest_transactions(6),
                    "raw_registers": {
                        "coils": encode_coils(simulator().commands),
                        "discrete": encode_discrete_inputs(simulator().state),
                        "holding": encode_holding_registers(simulator().commands),
                        "input": encode_input_registers(simulator().state),
                    },
                    "modbus": {"host": MODBUS_HOST, "port": MODBUS_PORT},
                }
            )
            await websocket.send_json(payload)
            await asyncio.sleep(0.25)
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
        port=int(os.getenv("API_PORT", "8010")),
        reload=False,
    )
