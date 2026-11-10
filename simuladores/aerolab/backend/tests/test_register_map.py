from app.model import TurbineSimulator
from app.register_map import decode_modbus_commands, encode_input_registers, register_map_payload


def test_uint32_power_uses_big_endian_word_order() -> None:
    simulator = TurbineSimulator()
    simulator.state.active_power_kw = 70_000
    registers = encode_input_registers(simulator.state)
    assert (registers[3] << 16) | registers[4] == 70_000


def test_decode_holding_registers_and_coils() -> None:
    coils = [True, False, False, True] + [False] * 12
    holding = [1, 123, 450, 1820, 3200, 2, 75, 250] + [0] * 24
    commands, reset = decode_modbus_commands(coils, holding)
    assert reset is False
    assert commands["manual_mode"] is True
    assert commands["wind_speed_mps"] == 12.3
    assert commands["pitch_command_deg"] == 4.5
    assert commands["simulation_speed"] == 2.5


def test_map_exposes_human_and_zero_based_addresses() -> None:
    wind = next(item for item in register_map_payload() if item["name"] == "Velocidad del viento")
    assert wind["pdu_address"] == 0
    assert wind["reference"] == "30001"



def test_manual_mode_can_be_left_from_either_table() -> None:
    # Estado en manual: la coil 3 y el HR0 lo reflejan a la vez
    coils = [True, False, False, True]
    holding = [1, 90, 200, 2350, 5000, 0, 40, 100]
    commands, _ = decode_modbus_commands(coils, [0] + holding[1:], written="holding")
    assert commands["manual_mode"] is False
    commands, _ = decode_modbus_commands([True, False, False, False], holding, written="coil")
    assert commands["manual_mode"] is False
