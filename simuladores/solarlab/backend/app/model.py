from __future__ import annotations

import math
import random
from dataclasses import asdict, dataclass
from enum import IntEnum
from typing import Any


class FaultCode(IntEnum):
    NONE = 0
    DIRTY_PANELS = 1
    INVERTER_TRIP = 2
    HOTSPOT = 3
    STRING_OPEN = 4
    GRID_OUTAGE = 5


FAULT_NAMES = {
    FaultCode.NONE: "Sin avería",
    FaultCode.DIRTY_PANELS: "Suciedad severa",
    FaultCode.INVERTER_TRIP: "Disparo de inversor",
    FaultCode.HOTSPOT: "Punto caliente",
    FaultCode.STRING_OPEN: "String abierto",
    FaultCode.GRID_OUTAGE: "Pérdida de red",
}


@dataclass
class PlantCommands:
    run_command: bool = True
    irradiance_wm2: float = 760.0
    ambient_temperature_c: float = 24.0
    cloud_cover_pct: float = 18.0
    soiling_pct: float = 4.0
    tracking_enabled: bool = True
    fault_code: int = 0
    simulation_speed: float = 1.0


@dataclass
class PlantState:
    active_power_kw: float = 0.0
    daily_energy_kwh: float = 0.0
    irradiance_wm2: float = 0.0
    ambient_temperature_c: float = 24.0
    panel_temperature_c: float = 24.0
    dc_voltage_v: float = 0.0
    dc_current_a: float = 0.0
    grid_voltage_v: float = 400.0
    grid_frequency_hz: float = 50.0
    performance_ratio_pct: float = 0.0
    tracker_angle_deg: float = 0.0
    availability_pct: float = 100.0
    alarm: bool = False
    connected: bool = True
    operating_state: int = 1
    operating_state_name: str = "EN MARCHA"
    fault_name: str = "Sin avería"


@dataclass
class ZoneState:
    zone_id: int
    name: str
    active_power_kw: float = 0.0
    dc_current_a: float = 0.0
    panel_temperature_c: float = 24.0
    performance_ratio_pct: float = 0.0
    available: bool = True
    alarm: bool = False


class SolarPlantSimulator:
    """Simplified 5 MW photovoltaic plant model for protocol training."""

    rated_power_kw = 5000.0
    zone_factors = (0.255, 0.247, 0.251, 0.247)

    def __init__(self, seed: int = 7) -> None:
        self._random = random.Random(seed)
        self.commands = PlantCommands()
        self.state = PlantState()
        self.zones = [ZoneState(i + 1, f"Zona {i + 1:02d}") for i in range(4)]
        self._elapsed_s = 0.0
        self._effective_irradiance = 0.0
        self.step(0.1)

    def reset(self) -> None:
        self.commands = PlantCommands()
        self.state = PlantState()
        self.zones = [ZoneState(i + 1, f"Zona {i + 1:02d}") for i in range(4)]
        self._elapsed_s = 0.0
        self._effective_irradiance = 0.0
        self.step(0.1)

    def apply_controls(self, controls: dict[str, Any]) -> None:
        limits = {
            "irradiance_wm2": (0.0, 1200.0),
            "ambient_temperature_c": (-10.0, 50.0),
            "cloud_cover_pct": (0.0, 100.0),
            "soiling_pct": (0.0, 50.0),
            "simulation_speed": (0.1, 10.0),
        }
        for key, value in controls.items():
            if not hasattr(self.commands, key):
                continue
            if key in limits:
                minimum, maximum = limits[key]
                value = max(minimum, min(float(value), maximum))
            elif key == "fault_code":
                value = max(0, min(int(value), max(item.value for item in FaultCode)))
            elif key in ("run_command", "tracking_enabled"):
                value = bool(value)
            setattr(self.commands, key, value)

    def step(self, dt: float) -> None:
        dt = max(0.0, min(dt, 1.0)) * self.commands.simulation_speed
        self._elapsed_s += dt
        fault = FaultCode(self.commands.fault_code)
        cloud_wave = math.sin(self._elapsed_s * 0.18) * self.commands.cloud_cover_pct * 1.6
        irradiance_target = max(0.0, self.commands.irradiance_wm2 - cloud_wave)
        response = min(1.0, dt * 1.8)
        self._effective_irradiance += (irradiance_target - self._effective_irradiance) * response

        ambient = self.commands.ambient_temperature_c
        panel_target = ambient + self._effective_irradiance * 0.029
        if fault == FaultCode.HOTSPOT:
            panel_target += 19.0
        self.state.panel_temperature_c += (panel_target - self.state.panel_temperature_c) * min(1.0, dt * 0.35)

        temp_factor = max(0.7, 1.0 - max(0.0, self.state.panel_temperature_c - 25.0) * 0.004)
        soil_loss = self.commands.soiling_pct / 100.0
        if fault == FaultCode.DIRTY_PANELS:
            soil_loss = max(soil_loss, 0.32)
        available = self.commands.run_command and fault != FaultCode.GRID_OUTAGE
        base_power = self.rated_power_kw * min(self._effective_irradiance / 1000.0, 1.08)
        base_power *= temp_factor * (1.0 - soil_loss) * 0.975 if available else 0.0
        zone_power: list[float] = []
        for index, zone in enumerate(self.zones):
            zone_available = available and not (fault == FaultCode.INVERTER_TRIP and index == 1)
            factor = self.zone_factors[index] * (1.0 + math.sin(self._elapsed_s * 0.12 + index) * 0.008)
            power = base_power * factor if zone_available else 0.0
            if fault == FaultCode.STRING_OPEN and index == 2:
                power *= 0.74
            zone_temp = self.state.panel_temperature_c + (7.0 if fault == FaultCode.HOTSPOT and index == 0 else index * 0.35)
            ideal = self.rated_power_kw * factor * max(self._effective_irradiance / 1000.0, 0.001)
            pr = max(0.0, min(100.0, power / ideal * 100.0)) if zone_available else 0.0
            zone.active_power_kw = power
            zone.dc_current_a = power * 1000.0 / 780.0 if power else 0.0
            zone.panel_temperature_c = zone_temp
            zone.performance_ratio_pct = pr
            zone.available = zone_available
            zone.alarm = (fault == FaultCode.INVERTER_TRIP and index == 1) or (fault in (FaultCode.HOTSPOT, FaultCode.STRING_OPEN) and index in (0, 2))
            zone_power.append(power)

        power = sum(zone_power)
        self.state.active_power_kw += (power - self.state.active_power_kw) * min(1.0, dt * 2.4)
        self.state.daily_energy_kwh += self.state.active_power_kw * dt / 3600.0
        self.state.irradiance_wm2 = self._effective_irradiance
        self.state.ambient_temperature_c = ambient
        self.state.dc_voltage_v = 780.0 if self.state.active_power_kw > 1 else 0.0
        self.state.dc_current_a = self.state.active_power_kw * 1000.0 / self.state.dc_voltage_v if self.state.dc_voltage_v else 0.0
        self.state.grid_voltage_v = 400.0 + math.sin(self._elapsed_s * 0.7) * 1.4 if fault != FaultCode.GRID_OUTAGE else 0.0
        self.state.grid_frequency_hz = 50.0 + math.sin(self._elapsed_s * 0.23) * 0.018 if fault != FaultCode.GRID_OUTAGE else 0.0
        expected = self.rated_power_kw * max(self._effective_irradiance / 1000.0, 0.001)
        self.state.performance_ratio_pct = max(0.0, min(100.0, self.state.active_power_kw / expected * 100.0))
        solar_angle = 45.0 * math.sin(self._elapsed_s / 90.0)
        target_angle = solar_angle if self.commands.tracking_enabled else 20.0
        self.state.tracker_angle_deg += (target_angle - self.state.tracker_angle_deg) * min(1.0, dt * 0.25)
        available_zones = sum(zone.available for zone in self.zones)
        self.state.availability_pct = available_zones / len(self.zones) * 100.0 if available else 0.0
        self.state.alarm = fault != FaultCode.NONE
        self.state.connected = fault != FaultCode.GRID_OUTAGE
        self.state.operating_state = 2 if self.state.alarm else (1 if available else 0)
        self.state.operating_state_name = "ALARMA" if self.state.alarm else ("EN MARCHA" if available else "PARADO")
        self.state.fault_name = FAULT_NAMES[fault]

    def snapshot(self) -> dict[str, Any]:
        return {
            "commands": asdict(self.commands),
            "state": asdict(self.state),
            "zones": [asdict(zone) for zone in self.zones],
            "meta": {"rated_power_kw": self.rated_power_kw, "model": "Planta FV didáctica de 5 MW"},
        }
