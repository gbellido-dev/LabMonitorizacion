from __future__ import annotations

from collections import deque
from datetime import UTC, datetime
from typing import Any

from pymodbus.server import StartAsyncTcpServer
from pymodbus.simulator import DataType, SimData, SimDevice

from .model import TurbineSimulator
from .register_map import (
    decode_modbus_commands,
    encode_coils,
    encode_discrete_inputs,
    encode_holding_registers,
    encode_input_registers,
)


def _pack_bits(bits: list[bool], register_count: int) -> list[int]:
    registers = [0] * register_count
    for index, value in enumerate(bits):
        if value and index // 16 < register_count:
            registers[index // 16] |= 1 << (index % 16)
    return registers


class ModbusBridge:
    def __init__(self, simulator: TurbineSimulator, host: str, port: int) -> None:
        self.simulator = simulator
        self.host = host
        self.port = port
        block_size = 128
        self.device = SimDevice(
            id=1,
            simdata=(
                [SimData(0, count=block_size, values=False, datatype=DataType.BITS)],
                [SimData(0, count=block_size, values=False, datatype=DataType.BITS, readonly=True)],
                [SimData(0, count=block_size, values=0, datatype=DataType.REGISTERS)],
                [SimData(0, count=block_size, values=0, datatype=DataType.REGISTERS, readonly=True)],
            ),
            action=self._register_action,
        )
        self.transactions: deque[dict[str, Any]] = deque(maxlen=100)

    def trace_packet(self, sending: bool, data: bytes) -> bytes:
        packet = bytes(data)
        entry: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "direction": "TX" if sending else "RX",
            "hex": packet.hex(" ").upper(),
            "length": len(packet),
        }
        if len(packet) >= 8:
            entry.update(
                {
                    "transaction_id": int.from_bytes(packet[0:2]),
                    "protocol_id": int.from_bytes(packet[2:4]),
                    "mbap_length": int.from_bytes(packet[4:6]),
                    "unit_id": packet[6],
                    "function_code": packet[7],
                }
            )
        self.transactions.append(entry)
        return data

    def latest_transactions(self, limit: int = 10) -> list[dict[str, Any]]:
        return list(self.transactions)[-max(1, min(limit, 100)) :]

    async def _register_action(
        self,
        function_code: int,
        start_address: int,
        address: int,
        _count: int,
        current_registers: list[int],
        set_values: list[int] | list[bool] | None,
    ) -> None:
        relative_address = address - start_address
        if function_code in {1, 5, 15}:
            if set_values:
                coils = encode_coils(self.simulator.commands)
                coils[relative_address : relative_address + len(set_values)] = [bool(value) for value in set_values]
                holding = encode_holding_registers(self.simulator.commands)
                updates, reset_requested = decode_modbus_commands(coils, holding)
                self.simulator.apply_controls(updates)
                if reset_requested:
                    self.simulator.reset_alarm()
            packed = _pack_bits(encode_coils(self.simulator.commands), len(current_registers))
            current_registers[: len(packed)] = packed
            return

        if function_code == 2:
            packed = _pack_bits(encode_discrete_inputs(self.simulator.state), len(current_registers))
            current_registers[: len(packed)] = packed
            return

        if function_code in {3, 6, 16, 22, 23}:
            holding = encode_holding_registers(self.simulator.commands)
            if set_values:
                holding[relative_address : relative_address + len(set_values)] = [int(value) for value in set_values]
                updates, reset_requested = decode_modbus_commands(encode_coils(self.simulator.commands), holding)
                self.simulator.apply_controls(updates)
                if reset_requested:
                    self.simulator.reset_alarm()
                holding = encode_holding_registers(self.simulator.commands)
            current_registers[: len(holding)] = holding
            return

        if function_code == 4:
            input_registers = encode_input_registers(self.simulator.state)
            current_registers[: len(input_registers)] = input_registers

    async def run(self) -> None:
        await StartAsyncTcpServer(
            context=self.device,
            address=(self.host, self.port),
            trace_packet=self.trace_packet,
        )

