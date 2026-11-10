import pytest

from app.modbus_server import ModbusBridge
from app.model import TurbineSimulator


@pytest.mark.asyncio
async def test_holding_register_write_updates_simulator() -> None:
    simulator = TurbineSimulator()
    bridge = ModbusBridge(simulator, "127.0.0.1", 1502)
    registers = [0] * 129
    await bridge._register_action(6, 0, 5, 1, registers, [2])
    assert simulator.commands.fault_code == 2


@pytest.mark.asyncio
async def test_coil_write_stops_turbine_and_input_read_refreshes_values() -> None:
    simulator = TurbineSimulator()
    bridge = ModbusBridge(simulator, "127.0.0.1", 1502)
    coil_registers = [0] * 9
    await bridge._register_action(5, 0, 0, 1, coil_registers, [False])
    assert simulator.commands.run_command is False

    simulator.state.wind_speed_mps = 12.3
    input_registers = [0] * 129
    await bridge._register_action(4, 0, 0, 16, input_registers, None)
    assert input_registers[0] == 123

