from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any, Callable

from asyncua import Server, ua

from .model import SolarPlantSimulator


NAMESPACE_URI = "urn:solarlab:parque-fotovoltaico"


@dataclass(frozen=True)
class NodeDefinition:
    node_id: str
    browse_path: str
    display_name: str
    data_type: str
    unit: str
    access: str
    source: str
    description: str


PLANT_NODES = (
    NodeDefinition("Plant.ActivePower", "SolarLab/Plant/ActivePower", "Potencia activa", "Double", "kW", "Lectura", "state.active_power_kw", "Potencia AC instantánea entregada a red"),
    NodeDefinition("Plant.DailyEnergy", "SolarLab/Plant/DailyEnergy", "Energía diaria", "Double", "kWh", "Lectura", "state.daily_energy_kwh", "Energía acumulada desde el inicio de la simulación"),
    NodeDefinition("Plant.Irradiance", "SolarLab/Plant/Irradiance", "Irradiancia", "Double", "W/m²", "Lectura", "state.irradiance_wm2", "Irradiancia efectiva sobre el campo"),
    NodeDefinition("Plant.AmbientTemperature", "SolarLab/Plant/AmbientTemperature", "Temperatura ambiente", "Double", "°C", "Lectura", "state.ambient_temperature_c", "Temperatura ambiente simulada"),
    NodeDefinition("Plant.PanelTemperature", "SolarLab/Plant/PanelTemperature", "Temperatura de panel", "Double", "°C", "Lectura", "state.panel_temperature_c", "Temperatura media de los módulos"),
    NodeDefinition("Plant.DCVoltage", "SolarLab/Plant/DCVoltage", "Tensión DC", "Double", "V", "Lectura", "state.dc_voltage_v", "Tensión del bus de continua"),
    NodeDefinition("Plant.DCCurrent", "SolarLab/Plant/DCCurrent", "Corriente DC", "Double", "A", "Lectura", "state.dc_current_a", "Corriente total del campo"),
    NodeDefinition("Plant.GridVoltage", "SolarLab/Plant/GridVoltage", "Tensión de red", "Double", "V", "Lectura", "state.grid_voltage_v", "Tensión eficaz en el punto de conexión"),
    NodeDefinition("Plant.GridFrequency", "SolarLab/Plant/GridFrequency", "Frecuencia de red", "Double", "Hz", "Lectura", "state.grid_frequency_hz", "Frecuencia en el punto de conexión"),
    NodeDefinition("Plant.PerformanceRatio", "SolarLab/Plant/PerformanceRatio", "Performance ratio", "Double", "%", "Lectura", "state.performance_ratio_pct", "Rendimiento real frente a potencia solar disponible"),
    NodeDefinition("Plant.TrackerAngle", "SolarLab/Plant/TrackerAngle", "Ángulo de seguidores", "Double", "°", "Lectura", "state.tracker_angle_deg", "Inclinación media de los seguidores"),
    NodeDefinition("Plant.Availability", "SolarLab/Plant/Availability", "Disponibilidad", "Double", "%", "Lectura", "state.availability_pct", "Porcentaje de zonas disponibles"),
    NodeDefinition("Plant.AlarmActive", "SolarLab/Plant/AlarmActive", "Alarma activa", "Boolean", "", "Lectura", "state.alarm", "Existe al menos una alarma activa"),
    NodeDefinition("Plant.Connected", "SolarLab/Plant/Connected", "Conectado a red", "Boolean", "", "Lectura", "state.connected", "Estado de conexión a la red"),
    NodeDefinition("Plant.OperatingState", "SolarLab/Plant/OperatingState", "Estado de operación", "Int32", "", "Lectura", "state.operating_state", "0 parado, 1 marcha, 2 alarma"),
)

CONTROL_NODES = (
    NodeDefinition("Controls.RunCommand", "SolarLab/Controls/RunCommand", "Orden de marcha", "Boolean", "", "Lectura/Escritura", "commands.run_command", "Arranque o parada de la planta"),
    NodeDefinition("Controls.IrradianceSetpoint", "SolarLab/Controls/IrradianceSetpoint", "Consigna de irradiancia", "Double", "W/m²", "Lectura/Escritura", "commands.irradiance_wm2", "Irradiancia base entre 0 y 1200 W/m²"),
    NodeDefinition("Controls.AmbientTemperature", "SolarLab/Controls/AmbientTemperature", "Temperatura ambiente", "Double", "°C", "Lectura/Escritura", "commands.ambient_temperature_c", "Temperatura ambiente entre -10 y 50 °C"),
    NodeDefinition("Controls.CloudCover", "SolarLab/Controls/CloudCover", "Nubosidad", "Double", "%", "Lectura/Escritura", "commands.cloud_cover_pct", "Variación periódica de irradiancia"),
    NodeDefinition("Controls.Soiling", "SolarLab/Controls/Soiling", "Suciedad", "Double", "%", "Lectura/Escritura", "commands.soiling_pct", "Pérdida óptica por suciedad"),
    NodeDefinition("Controls.TrackingEnabled", "SolarLab/Controls/TrackingEnabled", "Seguimiento habilitado", "Boolean", "", "Lectura/Escritura", "commands.tracking_enabled", "Activa el seguimiento solar"),
    NodeDefinition("Controls.FaultCode", "SolarLab/Controls/FaultCode", "Código de avería", "Int32", "", "Lectura/Escritura", "commands.fault_code", "0 ninguna, 1 suciedad, 2 inversor, 3 hotspot, 4 string, 5 red"),
)


def _variant(value: Any, data_type: str) -> ua.Variant:
    types = {"Double": ua.VariantType.Double, "Boolean": ua.VariantType.Boolean, "Int32": ua.VariantType.Int32}
    return ua.Variant(value, types[data_type])


def _resolve(simulator: SolarPlantSimulator, source: str) -> Any:
    root, name = source.split(".", 1)
    return getattr(getattr(simulator, root), name)


class OpcUaBridge:
    def __init__(self, simulator: SolarPlantSimulator, host: str, port: int) -> None:
        self.simulator = simulator
        self.host = host
        self.port = port
        self.endpoint = f"opc.tcp://{host}:{port}/solarlab/server/"
        self.server = Server()
        self.namespace_index = 0
        self.nodes: dict[str, Any] = {}
        self.definitions: dict[str, NodeDefinition] = {}
        self._last_controls: dict[str, Any] = {}
        self._events: deque[dict[str, Any]] = deque(maxlen=40)
        self.running = False

    async def setup(self) -> None:
        await self.server.init()
        self.server.set_endpoint(self.endpoint)
        self.server.set_server_name("SolarLab · Parque fotovoltaico didáctico")
        self.namespace_index = await self.server.register_namespace(NAMESPACE_URI)
        root = await self.server.nodes.objects.add_object(ua.NodeId("SolarLab", self.namespace_index), "SolarLab")
        plant = await root.add_object(ua.NodeId("Plant", self.namespace_index), "Plant")
        zones = await root.add_object(ua.NodeId("Zones", self.namespace_index), "Zones")
        controls = await root.add_object(ua.NodeId("Controls", self.namespace_index), "Controls")

        for definition in PLANT_NODES:
            await self._add_variable(plant, definition, _resolve(self.simulator, definition.source), writable=False)
        for definition in CONTROL_NODES:
            value = _resolve(self.simulator, definition.source)
            await self._add_variable(controls, definition, value, writable=True)
            self._last_controls[definition.node_id] = value
        for index, zone in enumerate(self.simulator.zones):
            folder = await zones.add_object(ua.NodeId(f"Zone{index + 1:02d}", self.namespace_index), f"Zone{index + 1:02d}")
            specs = (
                ("ActivePower", "Potencia activa", "Double", "kW", "active_power_kw"),
                ("DCCurrent", "Corriente DC", "Double", "A", "dc_current_a"),
                ("PanelTemperature", "Temperatura de panel", "Double", "°C", "panel_temperature_c"),
                ("PerformanceRatio", "Performance ratio", "Double", "%", "performance_ratio_pct"),
                ("Available", "Disponible", "Boolean", "", "available"),
                ("Alarm", "Alarma", "Boolean", "", "alarm"),
            )
            for suffix, label, data_type, unit, attribute in specs:
                definition = NodeDefinition(
                    f"Zone{index + 1:02d}.{suffix}", f"SolarLab/Zones/Zone{index + 1:02d}/{suffix}", label,
                    data_type, unit, "Lectura", f"zones.{index}.{attribute}", f"{label} de la zona {index + 1:02d}",
                )
                await self._add_variable(folder, definition, getattr(zone, attribute), writable=False)

    async def _add_variable(self, parent: Any, definition: NodeDefinition, value: Any, writable: bool) -> None:
        node = await parent.add_variable(
            ua.NodeId(definition.node_id, self.namespace_index),
            definition.node_id.split(".")[-1],
            _variant(value, definition.data_type),
        )
        if writable:
            await node.set_writable()
        self.nodes[definition.node_id] = node
        self.definitions[definition.node_id] = definition

    async def run(self) -> None:
        if not self.nodes:
            await self.setup()
        async with self.server:
            self.running = True
            self._record("SERVER", "Servidor OPC UA iniciado", self.endpoint)
            try:
                while True:
                    await self.sync()
                    await asyncio.sleep(0.2)
            finally:
                self.running = False

    async def sync(self) -> None:
        updates: dict[str, Any] = {}
        for definition in CONTROL_NODES:
            node = self.nodes[definition.node_id]
            value = await node.read_value()
            previous = self._last_controls[definition.node_id]
            if value != previous:
                updates[definition.source.split(".", 1)[1]] = value
                self._record("WRITE", definition.node_id, value)
                self._last_controls[definition.node_id] = value
        if updates:
            self.simulator.apply_controls(updates)

        for definition in CONTROL_NODES:
            value = _resolve(self.simulator, definition.source)
            if value != self._last_controls[definition.node_id]:
                await self.nodes[definition.node_id].write_value(_variant(value, definition.data_type))
                self._last_controls[definition.node_id] = value
        for definition in self.definitions.values():
            if definition.access != "Lectura":
                continue
            if definition.source.startswith("zones."):
                _, index, attribute = definition.source.split(".")
                value = getattr(self.simulator.zones[int(index)], attribute)
            else:
                value = _resolve(self.simulator, definition.source)
            await self.nodes[definition.node_id].write_value(_variant(value, definition.data_type))

    def _record(self, kind: str, node: str, value: Any) -> None:
        self._events.append({
            "timestamp": datetime.now(UTC).isoformat(), "kind": kind, "node": node, "value": value,
        })

    def address_space(self) -> list[dict[str, Any]]:
        result = []
        for definition in self.definitions.values():
            payload = asdict(definition)
            payload["node_id"] = f"ns={self.namespace_index};s={definition.node_id}"
            if definition.source.startswith("zones."):
                _, index, attribute = definition.source.split(".")
                value = getattr(self.simulator.zones[int(index)], attribute)
            else:
                value = _resolve(self.simulator, definition.source)
            payload["value"] = value
            result.append(payload)
        return result

    def latest_events(self, limit: int = 20) -> list[dict[str, Any]]:
        return list(self._events)[-limit:]
