from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
import json
import logging
import os
from pathlib import Path

from amqtt.broker import Broker
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import paho.mqtt.client as mqtt
from pydantic import BaseModel, Field

from .model import OceanModel


log = logging.getLogger("oceanlab")
model = OceanModel()
clients: set[WebSocket] = set()
events: list[dict] = []
mqtt_client: mqtt.Client | None = None
broker: Broker | None = None


class SettingsUpdate(BaseModel):
    running: bool | None = None
    publish_interval_s: float | None = Field(default=None, ge=0.25, le=30)
    qos: int | None = Field(default=None, ge=0, le=2)
    retained: bool | None = None


class FaultRequest(BaseModel):
    buoy_id: str
    fault: str


def record_event(kind: str, topic: str, payload: dict, qos: int = 0, retained: bool = False) -> None:
    events.append({"kind": kind, "topic": topic, "qos": qos, "retained": retained, "payload": payload})
    del events[:-60]


EXTERNAL_BROKER_HOST = os.getenv("BUOYLAB_MQTT_EXTERNAL_HOST", "").strip()
EXTERNAL_BROKER_PORT = int(os.getenv("BUOYLAB_MQTT_EXTERNAL_PORT", "1883"))
external_connected = False


def _on_connect(_client, _userdata, _flags, reason_code, _properties=None) -> None:
    global external_connected
    external_connected = not reason_code.is_failure
    if external_connected:
        log.info("Conectado al broker MQTT externo %s:%s", EXTERNAL_BROKER_HOST, EXTERNAL_BROKER_PORT)


def _on_disconnect(_client, _userdata, _flags, _reason_code, _properties=None) -> None:
    global external_connected
    external_connected = False


async def start_mqtt() -> None:
    global broker, mqtt_client
    if EXTERNAL_BROKER_HOST:
        # Modo broker externo (p. ej. Mosquitto del laboratorio): no se arranca
        # el broker integrado y el simulador publica como un cliente más.
        mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="oceanlab-simulator")
        mqtt_client.on_connect = _on_connect
        mqtt_client.on_disconnect = _on_disconnect
        mqtt_client.reconnect_delay_set(min_delay=1, max_delay=10)
        mqtt_client.connect_async(EXTERNAL_BROKER_HOST, EXTERNAL_BROKER_PORT)
        mqtt_client.loop_start()
        log.info("Publicando en el broker externo %s:%s", EXTERNAL_BROKER_HOST, EXTERNAL_BROKER_PORT)
        return
    config = {
        "listeners": {
            "default": {"type": "tcp", "bind": f"0.0.0.0:{os.getenv('BUOYLAB_MQTT_PORT', '1883')}"},
            "ws": {"type": "ws", "bind": f"0.0.0.0:{os.getenv('BUOYLAB_MQTT_WS_PORT', '8083')}", "max_connections": 50},
        },
        "sys_interval": 10,
        "auth": {"allow-anonymous": True},
        "topic-check": {"enabled": False},
    }
    try:
        broker = Broker(config)
        await broker.start()
        mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="oceanlab-simulator")
        mqtt_client.connect("127.0.0.1", int(os.getenv("BUOYLAB_MQTT_PORT", "1883")))
        mqtt_client.loop_start()
        log.info("Broker MQTT iniciado")
    except Exception:
        log.exception("El broker MQTT no pudo iniciarse; la interfaz seguirá disponible")
        broker = None


async def simulation_loop() -> None:
    accumulator = 0.0
    while True:
        await asyncio.sleep(0.25)
        model.step(0.25)
        accumulator += 0.25
        if accumulator >= model.publish_interval_s:
            accumulator = 0.0
            if mqtt_client:
                for buoy in model.buoys:
                    if buoy.status != "online":
                        continue
                    payload = model.payload(buoy)
                    topic = f"oceanlab/buoys/{buoy.id}/telemetry"
                    mqtt_client.publish(topic, json.dumps(payload), qos=model.qos, retain=model.retained)
                sample = model.buoys[model.tick_count % len(model.buoys)]
                record_event("PUBLISH", f"oceanlab/buoys/{sample.id}/telemetry", model.payload(sample), model.qos, model.retained)
        snapshot = model.snapshot()
        snapshot["events"] = events[-12:]
        stale = []
        for socket in clients:
            try:
                await socket.send_json(snapshot)
            except Exception:
                stale.append(socket)
        for socket in stale:
            clients.discard(socket)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await start_mqtt()
    task = asyncio.create_task(simulation_loop())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
    if broker:
        await broker.shutdown()


app = FastAPI(title="OceanLab MQTT API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health() -> dict:
    mqtt_ok = external_connected if EXTERNAL_BROKER_HOST else broker is not None
    return {"status": "ok", "mqtt_broker": mqtt_ok, "mqtt_mode": "externo" if EXTERNAL_BROKER_HOST else "integrado", "buoys": len(model.buoys)}


@app.get("/api/snapshot")
def snapshot() -> dict:
    value = model.snapshot()
    value["events"] = events[-12:]
    return value


@app.patch("/api/settings")
def settings(update: SettingsUpdate) -> dict:
    for key, value in update.model_dump(exclude_none=True).items():
        setattr(model, key, value)
    return model.snapshot()


@app.post("/api/fault")
def fault(request: FaultRequest) -> dict:
    try:
        buoy = model.inject(request.buoy_id, request.fault)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    payload = model.payload(buoy)
    record_event("ALERT", f"oceanlab/buoys/{buoy.id}/alerts", {"fault": request.fault, **payload}, 1, False)
    if mqtt_client:
        mqtt_client.publish(f"oceanlab/buoys/{buoy.id}/alerts", json.dumps({"fault": request.fault, **payload}), qos=1)
    return payload


@app.websocket("/ws")
async def websocket(socket: WebSocket) -> None:
    await socket.accept()
    clients.add(socket)
    try:
        while True:
            await socket.receive_text()
    except WebSocketDisconnect:
        clients.discard(socket)


dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if dist.exists():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str) -> FileResponse:
        candidate = dist / path
        return FileResponse(candidate if candidate.is_file() else dist / "index.html")
