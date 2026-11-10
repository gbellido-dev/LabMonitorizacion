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
    # Serie 3 · Reto: flujos de partida para el alumnado
    ("3-reto/aerolab-modbus/flows/aerolab-starter-flow.json", "alumnado", "Reto AeroLab Modbus - inicial"),
    ("3-reto/oceanlab-mqtt/flows/oceanlab-starter-flow.json", "alumnado", "Reto OceanLab MQTT - inicial"),
    ("3-reto/solarlab-opcua/flows/solarlab-starter-flow.json", "alumnado", "Reto SolarLab OPC UA - inicial"),
    ("3-reto/reactorlab-web/flows/reactorlab-starter-flow.json", "alumnado", "Reto ReactorLab web - inicial"),
    ("3-reto/atomlab-opcua/flows/atomlab-starter-flow.json", "alumnado", "Reto AtomLab OPC UA - inicial"),
    ("3-reto/fundicion-trazabilidad/flows/fundicion-trazabilidad-starter-flow.json", "alumnado", "Reto Fundicion Trazabilidad - inicial"),
    # Serie 4 · Analítica e IA
    ("4-ia/aerolab/flows/ia-aerolab-recogida.json", "alumnado", "Serie 4 AeroLab - Recoger datos"),
    # Soluciones (solo con NODE_RED_INCLUIR_SOLUCIONES=true)
    ("2-thingsboard/aerolab/flows/aerolab-thingsboard-solucion.json", "soluciones", "Serie 2 AeroLab - ThingsBoard"),
    ("2-thingsboard/oceanlab/flows/oceanlab-thingsboard-solucion.json", "soluciones", "Serie 2 OceanLab - ThingsBoard"),
    ("2-thingsboard/solarlab/flows/solarlab-thingsboard-solucion.json", "soluciones", "Serie 2 SolarLab - ThingsBoard"),
    ("1-dashboard/reactorlab/flows/reactorlab-dashboard-solucion.json", "soluciones", "Serie 1 ReactorLab - Dashboard"),
    ("2-thingsboard/reactorlab/flows/reactorlab-thingsboard-solucion.json", "soluciones", "Serie 2 ReactorLab - ThingsBoard HTTP"),
    ("1-dashboard/atomlab/flows/atomlab-dashboard-solucion.json", "soluciones", "Serie 1 AtomLab - Dashboard"),
    ("2-thingsboard/atomlab/flows/atomlab-thingsboard-solucion.json", "soluciones", "Serie 2 AtomLab - ThingsBoard"),
    ("1-dashboard/fundicion/flows/fundicion-dashboard-solucion.json", "soluciones", "Serie 1 Fundicion - Dashboard"),
    ("2-thingsboard/fundicion/flows/fundicion-thingsboard-solucion.json", "soluciones", "Serie 2 Fundicion - ThingsBoard"),
    ("1-dashboard/fundicion-s7/flows/fundicion-s7-opcua-solucion.json", "soluciones", "Serie 1 Fundicion - S7 frente a OPC UA"),
    ("3-reto/aerolab-modbus/flows/aerolab-thingsboard-flow.json", "soluciones", "Reto AeroLab Modbus - solucion"),
    ("3-reto/oceanlab-mqtt/flows/oceanlab-thingsboard-flow.json", "soluciones", "Reto OceanLab MQTT - solucion"),
    ("3-reto/solarlab-opcua/flows/solarlab-thingsboard-flow.json", "soluciones", "Reto SolarLab OPC UA - solucion"),
    ("3-reto/reactorlab-web/flows/reactorlab-thingsboard-flow.json", "soluciones", "Reto ReactorLab web - solucion"),
    ("3-reto/atomlab-opcua/flows/atomlab-thingsboard-flow.json", "soluciones", "Reto AtomLab OPC UA - solucion"),
    ("3-reto/fundicion-trazabilidad/flows/fundicion-trazabilidad-flow.json", "soluciones", "Reto Fundicion Trazabilidad - solucion"),
    ("4-ia/aerolab/flows/ia-aerolab-solucion.json", "soluciones", "Serie 4 AeroLab - IA"),
    ("4-ia/solarlab/flows/ia-solarlab-solucion.json", "soluciones", "Serie 4 SolarLab - IA"),
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
    for vieja in DESTINO.glob("*/*.json"):
        vieja.unlink()
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
