# Prácticas

| Nº | Carpeta | Guion del alumnado | Material docente | Flujos Node-RED |
|---|---|---|---|---|
| 01 | `01-aerolab-modbus` | [Modbus TCP → ThingsBoard](01-aerolab-modbus/practica-node-red-thingsboard.md) | [Solución](01-aerolab-modbus/solucion-practica-node-red-thingsboard.md) | [inicial](01-aerolab-modbus/flows/aerolab-starter-flow.json) · [resuelto](01-aerolab-modbus/flows/aerolab-thingsboard-flow.json) |
| 02 | `02-oceanlab-mqtt` | [MQTT → ThingsBoard](02-oceanlab-mqtt/practica-node-red-thingsboard.md) | [Solución](02-oceanlab-mqtt/solucion-practica-node-red-thingsboard.md) | [inicial](02-oceanlab-mqtt/flows/oceanlab-starter-flow.json) · [resuelto](02-oceanlab-mqtt/flows/oceanlab-thingsboard-flow.json) |
| 03 | `03-solarlab-opcua` | [OPC UA → ThingsBoard](03-solarlab-opcua/practica-node-red-thingsboard.md) | incluido en el guion (reto y rúbrica) | [flujo](03-solarlab-opcua/flows/solarlab-thingsboard-flow.json) |
| 04 | `04-solarlab-dashboard-node-red` | [OPC UA → Dashboard 2.0](04-solarlab-dashboard-node-red/README.md) ([.docx](04-solarlab-dashboard-node-red/Practica_SolarLab_NodeRED_ES.docx)) | — | se construye paso a paso |

## Valores para el entorno Docker integrado

Los guiones están escritos para instalaciones sueltas (`localhost`, `127.0.0.1`, `host.docker.internal`). Si Node-RED es el del `docker-compose.yml` del repositorio, usa estos valores en los nodos de configuración:

| Dónde | Valor |
|---|---|
| Nodo Modbus (práctica 01) | host `aerolab`, puerto `1502`, Unit ID `1` |
| Broker MQTT de OceanLab (práctica 02) | host `mosquitto`, puerto `1883` (el broker único del laboratorio) |
| Endpoint OPC UA SolarLab (prácticas 03 y 04) | `opc.tcp://solarlab:4840/solarlab/server/` |
| Endpoint OPC UA Fundición (ampliación) | `opc.tcp://fundicion-opcua:4841/UA/Fundicion` |
| Broker ThingsBoard | host `thingsboard`, puerto `1883`, access token como *Username* |
| Web de ThingsBoard | `http://localhost:8080` (o la IP del equipo) |
| Dashboard 2.0 | `http://localhost:1880/dashboard` |

Los flujos de la biblioteca de Node-RED (**Import → Local → LabMonitorizacion**) ya traen estos hosts. Ningún flujo incluye tokens: cada grupo pega el suyo.

## Comprobación del entorno

Con el compose levantado se ha verificado de extremo a extremo:

- SolarLab → Node-RED (OPC UA, flujo 03) → ThingsBoard: 8 claves de telemetría en el dispositivo.
- OceanLab → Mosquitto → Node-RED (solución 02) → ThingsBoard: 14 claves por boya.
- Snapshot de Node-RED + ThingsBoard → borrar dispositivo y flujos → restaurar: el dispositivo, los flujos y el token vuelven y la telemetría sigue llegando.
- OceanLab publica en Mosquitto (broker único) y Node-RED lo consume desde ahí.
- Fundición: el puente WebSocket se suscribe a 144 variables del servidor OPC UA en `4841`.
- AeroLab responde a lecturas FC04 en `1502`.
