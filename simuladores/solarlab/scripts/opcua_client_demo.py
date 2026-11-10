"""Small client used in the first SolarLab OPC UA exercise."""
from __future__ import annotations

import asyncio
import argparse

from asyncua import Client


ENDPOINT = "opc.tcp://localhost:4840/solarlab/server/"
NAMESPACE_URI = "urn:solarlab:parque-fotovoltaico"


async def main(write_irradiance: float | None = None) -> None:
    async with Client(url=ENDPOINT) as client:
        namespace = await client.get_namespace_index(NAMESPACE_URI)
        power = client.get_node(f"ns={namespace};s=Plant.ActivePower")
        irradiance = client.get_node(f"ns={namespace};s=Plant.Irradiance")
        fault = client.get_node(f"ns={namespace};s=Controls.FaultCode")
        irradiance_setpoint = client.get_node(f"ns={namespace};s=Controls.IrradianceSetpoint")
        print(f"Namespace asignado: ns={namespace}")
        print(f"Potencia activa: {await power.read_value():.1f} kW")
        print(f"Irradiancia: {await irradiance.read_value():.1f} W/m²")
        print(f"Código de avería: {await fault.read_value()}")
        if write_irradiance is not None:
            await irradiance_setpoint.write_value(float(write_irradiance))
            await asyncio.sleep(0.4)
            print(f"Nueva consigna escrita: {await irradiance_setpoint.read_value():.1f} W/m²")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cliente OPC UA de ejemplo para SolarLab")
    parser.add_argument("--write-irradiance", type=float, help="Escribe una consigna de irradiancia")
    args = parser.parse_args()
    asyncio.run(main(args.write_irradiance))
