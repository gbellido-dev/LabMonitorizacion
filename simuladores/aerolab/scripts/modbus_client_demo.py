from __future__ import annotations

import argparse

from pymodbus.client import ModbusTcpClient


def main() -> None:
    parser = argparse.ArgumentParser(description="Cliente de demostración para AeroLab")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=1502)
    args = parser.parse_args()

    client = ModbusTcpClient(args.host, port=args.port)
    if not client.connect():
        raise SystemExit(f"No se pudo conectar a {args.host}:{args.port}")

    try:
        response = client.read_input_registers(address=0, count=16, device_id=1)
        if response.isError():
            raise SystemExit(f"Respuesta de excepción: {response}")
        registers = response.registers
        power_kw = (registers[3] << 16) | registers[4]
        print(f"Viento:       {registers[0] / 10:.1f} m/s")
        print(f"Rotor:        {registers[1] / 100:.2f} rpm")
        print(f"Pitch:        {registers[2] / 100:.2f} °")
        print(f"Potencia:     {power_kw} kW")
        print(f"Vibración:    {registers[7] / 100:.2f} mm/s")
        print(f"Estado/código:{registers[14]} / {registers[15]}")
    finally:
        client.close()


if __name__ == "__main__":
    main()

