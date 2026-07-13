from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .model import TurbineCommands, TurbineState


@dataclass(frozen=True, slots=True)
class RegisterDefinition:
    table: str
    pdu_address: int
    reference: str
    name: str
    access: str
    data_type: str
    scale: str
    unit: str
    words: int = 1

    def as_dict(self) -> dict[str, Any]:
        return {
            "table": self.table,
            "pdu_address": self.pdu_address,
            "reference": self.reference,
            "name": self.name,
            "access": self.access,
            "data_type": self.data_type,
            "scale": self.scale,
            "unit": self.unit,
            "words": self.words,
        }


REGISTER_DEFINITIONS = [
    RegisterDefinition("coil", 0, "00001", "Orden de marcha", "R/W", "Boolean", "—", "—"),
    RegisterDefinition("coil", 1, "00002", "Freno mecánico", "R/W", "Boolean", "—", "—"),
    RegisterDefinition("coil", 2, "00003", "Reset de alarma", "W", "Boolean", "pulso", "—"),
    RegisterDefinition("coil", 3, "00004", "Modo manual", "R/W", "Boolean", "—", "—"),
    RegisterDefinition("discrete", 0, "10001", "Preparado", "R", "Boolean", "—", "—"),
    RegisterDefinition("discrete", 1, "10002", "En marcha", "R", "Boolean", "—", "—"),
    RegisterDefinition("discrete", 2, "10003", "Alarma activa", "R", "Boolean", "—", "—"),
    RegisterDefinition("discrete", 3, "10004", "Conectado a red", "R", "Boolean", "—", "—"),
    RegisterDefinition("input", 0, "30001", "Velocidad del viento", "R", "UInt16", "0,1", "m/s"),
    RegisterDefinition("input", 1, "30002", "Velocidad del rotor", "R", "UInt16", "0,01", "rpm"),
    RegisterDefinition("input", 2, "30003", "Pitch real", "R", "UInt16", "0,01", "°"),
    RegisterDefinition("input", 3, "30004–30005", "Potencia activa", "R", "UInt32 BE", "1", "kW", 2),
    RegisterDefinition("input", 5, "30006", "Dirección del viento", "R", "UInt16", "0,1", "°"),
    RegisterDefinition("input", 6, "30007", "Yaw de nacelle", "R", "UInt16", "0,1", "°"),
    RegisterDefinition("input", 7, "30008", "Vibración multiplicador", "R", "UInt16", "0,01", "mm/s"),
    RegisterDefinition("input", 8, "30009", "Temperatura rodamiento", "R", "Int16", "0,1", "°C"),
    RegisterDefinition("input", 9, "30010", "Temperatura multiplicador", "R", "Int16", "0,1", "°C"),
    RegisterDefinition("input", 10, "30011", "Velocidad del generador", "R", "UInt16", "1", "rpm"),
    RegisterDefinition("input", 11, "30012", "Par mecánico", "R", "UInt16", "10", "N·m"),
    RegisterDefinition("input", 12, "30013–30014", "Energía acumulada", "R", "UInt32 BE", "0,1", "kWh", 2),
    RegisterDefinition("input", 14, "30015", "Estado operativo", "R", "Enum", "1", "—"),
    RegisterDefinition("input", 15, "30016", "Código de avería", "R", "Enum", "1", "—"),
    RegisterDefinition("holding", 0, "40001", "Modo automático/manual", "R/W", "Enum", "1", "—"),
    RegisterDefinition("holding", 1, "40002", "Viento simulado", "R/W", "UInt16", "0,1", "m/s"),
    RegisterDefinition("holding", 2, "40003", "Consigna de pitch", "R/W", "UInt16", "0,01", "°"),
    RegisterDefinition("holding", 3, "40004", "Consigna de yaw", "R/W", "UInt16", "0,1", "°"),
    RegisterDefinition("holding", 4, "40005", "Límite de potencia", "R/W", "UInt16", "1", "kW"),
    RegisterDefinition("holding", 5, "40006", "Inyección de avería", "R/W", "Enum", "1", "—"),
    RegisterDefinition("holding", 6, "40007", "Turbulencia", "R/W", "UInt16", "0,1", "%"),
    RegisterDefinition("holding", 7, "40008", "Velocidad de simulación", "R/W", "UInt16", "0,01", "×"),
]


def _u16(value: float) -> int:
    return max(0, min(0xFFFF, int(round(value))))


def _i16(value: float) -> int:
    return int(round(value)) & 0xFFFF


def _u32_words(value: float) -> tuple[int, int]:
    integer = max(0, min(0xFFFFFFFF, int(round(value))))
    return (integer >> 16) & 0xFFFF, integer & 0xFFFF


def encode_input_registers(state: TurbineState) -> list[int]:
    power_hi, power_lo = _u32_words(state.active_power_kw)
    energy_hi, energy_lo = _u32_words(state.energy_kwh * 10.0)
    values = [0] * 32
    values[0] = _u16(state.wind_speed_mps * 10.0)
    values[1] = _u16(state.rotor_rpm * 100.0)
    values[2] = _u16(state.pitch_deg * 100.0)
    values[3:5] = [power_hi, power_lo]
    values[5] = _u16(state.wind_direction_deg * 10.0)
    values[6] = _u16(state.nacelle_yaw_deg * 10.0)
    values[7] = _u16(state.vibration_mms * 100.0)
    values[8] = _i16(state.bearing_temperature_c * 10.0)
    values[9] = _i16(state.gearbox_temperature_c * 10.0)
    values[10] = _u16(state.generator_rpm)
    values[11] = _u16(state.torque_nm / 10.0)
    values[12:14] = [energy_hi, energy_lo]
    values[14] = _u16(state.operating_state)
    values[15] = _u16(state.fault_code)
    return values


def encode_discrete_inputs(state: TurbineState) -> list[bool]:
    return [state.ready, state.running, state.alarm, state.grid_connected, state.wind_ok] + [False] * 11


def encode_coils(commands: TurbineCommands) -> list[bool]:
    return [commands.run_command, commands.brake_command, False, commands.manual_mode] + [False] * 12


def encode_holding_registers(commands: TurbineCommands) -> list[int]:
    values = [0] * 32
    values[0] = 1 if commands.manual_mode else 0
    values[1] = _u16(commands.wind_speed_mps * 10.0)
    values[2] = _u16(commands.pitch_command_deg * 100.0)
    values[3] = _u16(commands.yaw_command_deg * 10.0)
    values[4] = _u16(commands.power_limit_kw)
    values[5] = _u16(commands.fault_code)
    values[6] = _u16(commands.turbulence_pct * 10.0)
    values[7] = _u16(commands.simulation_speed * 100.0)
    return values


def decode_modbus_commands(coils: list[bool], holding: list[int]) -> tuple[dict[str, Any], bool]:
    reset_requested = bool(coils[2]) if len(coils) > 2 else False
    values: dict[str, Any] = {
        "run_command": bool(coils[0]),
        "brake_command": bool(coils[1]),
        "manual_mode": bool(coils[3]) or bool(holding[0]),
        "wind_speed_mps": holding[1] / 10.0,
        "pitch_command_deg": holding[2] / 100.0,
        "yaw_command_deg": holding[3] / 10.0,
        "power_limit_kw": float(holding[4]),
        "fault_code": int(holding[5]),
        "turbulence_pct": holding[6] / 10.0,
        "simulation_speed": max(0.1, holding[7] / 100.0),
    }
    return values, reset_requested


def register_map_payload() -> list[dict[str, Any]]:
    return [definition.as_dict() for definition in REGISTER_DEFINITIONS]

