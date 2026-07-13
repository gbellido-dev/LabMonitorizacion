from __future__ import annotations

import math
import time
from dataclasses import asdict, dataclass
from enum import IntEnum
from typing import Any


class OperatingState(IntEnum):
    STOPPED = 0
    STARTING = 1
    RUNNING = 2
    BRAKING = 3
    FAULT = 4


class FaultCode(IntEnum):
    NONE = 0
    BEARING_OVERTEMPERATURE = 1
    HIGH_VIBRATION = 2
    GRID_LOSS = 3
    OVERSPEED = 4


STATE_NAMES = {
    OperatingState.STOPPED: "Parado",
    OperatingState.STARTING: "Arrancando",
    OperatingState.RUNNING: "En marcha",
    OperatingState.BRAKING: "Frenando",
    OperatingState.FAULT: "Avería",
}

FAULT_NAMES = {
    FaultCode.NONE: "Sin avería",
    FaultCode.BEARING_OVERTEMPERATURE: "Sobretemperatura de rodamiento",
    FaultCode.HIGH_VIBRATION: "Vibración elevada",
    FaultCode.GRID_LOSS: "Pérdida de red",
    FaultCode.OVERSPEED: "Sobrevelocidad",
}


@dataclass(slots=True)
class TurbineCommands:
    run_command: bool = True
    brake_command: bool = False
    manual_mode: bool = False
    wind_speed_mps: float = 9.0
    wind_direction_deg: float = 235.0
    pitch_command_deg: float = 2.0
    yaw_command_deg: float = 235.0
    power_limit_kw: float = 5000.0
    fault_code: int = int(FaultCode.NONE)
    turbulence_pct: float = 4.0
    simulation_speed: float = 1.0


@dataclass(slots=True)
class TurbineState:
    simulated_seconds: float = 0.0
    wind_speed_mps: float = 9.0
    wind_direction_deg: float = 235.0
    nacelle_yaw_deg: float = 220.0
    rotor_rpm: float = 0.0
    generator_rpm: float = 0.0
    pitch_deg: float = 12.0
    active_power_kw: float = 0.0
    torque_nm: float = 0.0
    energy_kwh: float = 0.0
    vibration_mms: float = 0.7
    bearing_temperature_c: float = 28.0
    gearbox_temperature_c: float = 30.0
    operating_state: int = int(OperatingState.STARTING)
    fault_code: int = int(FaultCode.NONE)
    ready: bool = True
    running: bool = False
    alarm: bool = False
    grid_connected: bool = True
    wind_ok: bool = True


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _move_towards(value: float, target: float, max_delta: float) -> float:
    if abs(target - value) <= max_delta:
        return target
    return value + math.copysign(max_delta, target - value)


def _angle_delta(target: float, current: float) -> float:
    return (target - current + 180.0) % 360.0 - 180.0


class TurbineSimulator:
    """Small deterministic wind-turbine model suitable for teaching, not design."""

    RATED_POWER_KW = 5000.0
    CUT_IN_MPS = 3.0
    RATED_WIND_MPS = 12.0
    CUT_OUT_MPS = 25.0
    RATED_ROTOR_RPM = 12.1
    GEAR_RATIO = 97.0

    def __init__(self) -> None:
        self.commands = TurbineCommands()
        self.state = TurbineState()
        self.started_at = time.time()

    def apply_controls(self, values: dict[str, Any]) -> None:
        ranges: dict[str, tuple[float, float]] = {
            "wind_speed_mps": (0.0, 35.0),
            "wind_direction_deg": (0.0, 359.9),
            "pitch_command_deg": (0.0, 90.0),
            "yaw_command_deg": (0.0, 359.9),
            "power_limit_kw": (0.0, self.RATED_POWER_KW),
            "turbulence_pct": (0.0, 30.0),
            "simulation_speed": (0.1, 10.0),
        }
        for key, value in values.items():
            if not hasattr(self.commands, key):
                continue
            if key in ranges:
                low, high = ranges[key]
                value = _clamp(float(value), low, high)
            elif key == "fault_code":
                value = int(_clamp(int(value), 0, max(item.value for item in FaultCode)))
            elif key in {"run_command", "brake_command", "manual_mode"}:
                value = bool(value)
            setattr(self.commands, key, value)

    def reset(self) -> None:
        self.commands = TurbineCommands()
        retained_energy = self.state.energy_kwh
        self.state = TurbineState(energy_kwh=retained_energy)
        self.started_at = time.time()

    def reset_alarm(self) -> None:
        self.commands.fault_code = int(FaultCode.NONE)

    def step(self, real_dt: float) -> TurbineState:
        dt = _clamp(real_dt * self.commands.simulation_speed, 0.001, 0.5)
        s = self.state
        c = self.commands
        s.simulated_seconds += dt

        turbulence = c.turbulence_pct / 100.0
        gust = math.sin(s.simulated_seconds * 0.67) * 0.62 + math.sin(s.simulated_seconds * 1.91) * 0.23
        s.wind_speed_mps = max(0.0, c.wind_speed_mps * (1.0 + turbulence * gust))
        s.wind_direction_deg = c.wind_direction_deg % 360.0

        fault = FaultCode(c.fault_code)
        s.fault_code = int(fault)
        s.alarm = fault is not FaultCode.NONE
        s.grid_connected = fault is not FaultCode.GRID_LOSS
        s.wind_ok = self.CUT_IN_MPS <= s.wind_speed_mps < self.CUT_OUT_MPS

        yaw_target = c.yaw_command_deg if c.manual_mode else s.wind_direction_deg
        yaw_error = _angle_delta(yaw_target, s.nacelle_yaw_deg)
        s.nacelle_yaw_deg = (s.nacelle_yaw_deg + _clamp(yaw_error, -1.4 * dt, 1.4 * dt)) % 360.0
        wind_alignment = max(0.0, math.cos(math.radians(_angle_delta(s.wind_direction_deg, s.nacelle_yaw_deg))))
        effective_wind = s.wind_speed_mps * wind_alignment

        auto_pitch = 2.0 if effective_wind <= self.RATED_WIND_MPS else 2.0 + (effective_wind - self.RATED_WIND_MPS) * 4.2
        pitch_target = c.pitch_command_deg if c.manual_mode else _clamp(auto_pitch, 2.0, 32.0)
        if c.brake_command or not c.run_command or fault is not FaultCode.NONE or not s.wind_ok:
            pitch_target = 86.0
        s.pitch_deg = _move_towards(s.pitch_deg, pitch_target, 7.5 * dt)

        can_generate = c.run_command and not c.brake_command and s.wind_ok and fault is FaultCode.NONE and s.grid_connected
        pitch_efficiency = _clamp(1.0 - max(0.0, s.pitch_deg - 2.0) / 40.0, 0.0, 1.0)
        if can_generate:
            target_rpm = _clamp(3.5 + (effective_wind - self.CUT_IN_MPS) * 0.95, 3.5, self.RATED_ROTOR_RPM)
            target_rpm *= 0.35 + 0.65 * pitch_efficiency
        else:
            target_rpm = 0.0

        response_time = 7.0 if target_rpm > s.rotor_rpm else (1.6 if c.brake_command or s.alarm else 4.0)
        alpha = 1.0 - math.exp(-dt / response_time)
        s.rotor_rpm += (target_rpm - s.rotor_rpm) * alpha
        if s.rotor_rpm < 0.01:
            s.rotor_rpm = 0.0
        s.generator_rpm = s.rotor_rpm * self.GEAR_RATIO

        if can_generate and effective_wind >= self.CUT_IN_MPS:
            if effective_wind < self.RATED_WIND_MPS:
                cubic = (effective_wind**3 - self.CUT_IN_MPS**3) / (self.RATED_WIND_MPS**3 - self.CUT_IN_MPS**3)
                aerodynamic_power = self.RATED_POWER_KW * _clamp(cubic, 0.0, 1.0)
            else:
                aerodynamic_power = self.RATED_POWER_KW
            rotor_factor = _clamp(s.rotor_rpm / max(target_rpm, 0.1), 0.0, 1.0)
            s.active_power_kw = min(c.power_limit_kw, aerodynamic_power * pitch_efficiency * wind_alignment**2 * rotor_factor)
        else:
            s.active_power_kw = 0.0

        s.torque_nm = 0.0 if s.generator_rpm < 1.0 else s.active_power_kw * 9550.0 / s.generator_rpm
        s.energy_kwh += s.active_power_kw * dt / 3600.0

        load = _clamp(s.active_power_kw / self.RATED_POWER_KW, 0.0, 1.0)
        bearing_target = 28.0 + 36.0 * load
        gearbox_target = 30.0 + 42.0 * load
        vibration_target = 0.65 + 1.5 * load + 0.025 * s.rotor_rpm**2
        if fault is FaultCode.BEARING_OVERTEMPERATURE:
            bearing_target = 105.0
        if fault is FaultCode.HIGH_VIBRATION:
            vibration_target = 12.5
        if fault is FaultCode.OVERSPEED:
            vibration_target = max(vibration_target, 8.0)
        thermal_alpha = 1.0 - math.exp(-dt / 24.0)
        vibration_alpha = 1.0 - math.exp(-dt / 2.5)
        s.bearing_temperature_c += (bearing_target - s.bearing_temperature_c) * thermal_alpha
        s.gearbox_temperature_c += (gearbox_target - s.gearbox_temperature_c) * thermal_alpha
        s.vibration_mms += (vibration_target - s.vibration_mms) * vibration_alpha

        if s.alarm:
            operation = OperatingState.FAULT
        elif can_generate and s.rotor_rpm < max(2.0, target_rpm * 0.82):
            operation = OperatingState.STARTING
        elif can_generate:
            operation = OperatingState.RUNNING
        elif s.rotor_rpm > 0.15:
            operation = OperatingState.BRAKING
        else:
            operation = OperatingState.STOPPED
        s.operating_state = int(operation)
        s.running = operation in {OperatingState.STARTING, OperatingState.RUNNING}
        s.ready = not s.alarm and s.grid_connected
        return s

    def snapshot(self) -> dict[str, Any]:
        state = asdict(self.state)
        commands = asdict(self.commands)
        operation = OperatingState(self.state.operating_state)
        fault = FaultCode(self.state.fault_code)
        state["operating_state_name"] = STATE_NAMES[operation]
        state["fault_name"] = FAULT_NAMES[fault]
        return {
            "state": state,
            "commands": commands,
            "model": {
                "rated_power_kw": self.RATED_POWER_KW,
                "cut_in_mps": self.CUT_IN_MPS,
                "rated_wind_mps": self.RATED_WIND_MPS,
                "cut_out_mps": self.CUT_OUT_MPS,
            },
        }
