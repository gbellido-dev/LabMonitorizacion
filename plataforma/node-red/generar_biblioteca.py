"""Genera la biblioteca de flujos de Node-RED para el entorno Docker integrado.

Toma los flujos de ``practicas/*/flows`` y sustituye los hosts pensados para una
instalación local (127.0.0.1, localhost) por los nombres de servicio de
``docker-compose.yml``. Los originales no se modifican.

Uso (desde la raíz del repositorio):

    python plataforma/node-red/generar_biblioteca.py
"""

from __future__ import annotations

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
DESTINO = Path(__file__).resolve().parent / "biblioteca"

# (flujo de origen, carpeta de la biblioteca, nombre en la biblioteca)
FLUJOS = [
    ("01-aerolab-modbus/flows/aerolab-starter-flow.json", "alumnado", "01 AeroLab Modbus - inicial"),
    ("02-oceanlab-mqtt/flows/oceanlab-starter-flow.json", "alumnado", "02 OceanLab MQTT - inicial"),
    ("03-solarlab-opcua/flows/solarlab-thingsboard-flow.json", "alumnado", "03 SolarLab OPC UA - ThingsBoard"),
    ("01-aerolab-modbus/flows/aerolab-thingsboard-flow.json", "soluciones", "01 AeroLab Modbus - solucion"),
    ("02-oceanlab-mqtt/flows/oceanlab-thingsboard-flow.json", "soluciones", "02 OceanLab MQTT - solucion"),
]


def adaptar(nodo: dict) -> dict:
    tipo = nodo.get("type")
    nombre = (nodo.get("name") or "").lower()
    if tipo == "modbus-client":
        nodo["tcpHost"] = "aerolab"
    elif tipo == "mqtt-broker":
        if "thingsboard" in nombre:
            nodo["broker"] = "thingsboard"
            nodo["port"] = "1883"
        elif "oceanlab" in nombre:
            nodo["broker"] = "mosquitto"
            nodo["port"] = "1883"
    elif tipo == "OpcUa-Endpoint":
        nodo["endpoint"] = nodo["endpoint"].replace("localhost", "solarlab").replace("127.0.0.1", "solarlab")
    return nodo


def main() -> None:
    for origen, carpeta, nombre in FLUJOS:
        flujo = json.loads((RAIZ / "practicas" / origen).read_text(encoding="utf-8"))
        salida = DESTINO / carpeta / f"{nombre}.json"
        salida.parent.mkdir(parents=True, exist_ok=True)
        salida.write_text(
            json.dumps([adaptar(n) for n in flujo], ensure_ascii=False, indent=4) + "\n",
            encoding="utf-8",
        )
        print(f"{origen} -> {salida.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
