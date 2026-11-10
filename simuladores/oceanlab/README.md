# OceanLab · Simulador de boyas meteorológicas MQTT

OceanLab es un banco de prácticas para la asignatura **Monitorización de Máquinas** de la especialización en Digitalización del Mantenimiento. Representa una red mundial de boyas en un globo 3D y publica su telemetría mediante un broker MQTT real integrado.

## Qué incluye

- Globo 3D con costas construidas a partir de cartografía mundial y cámara orbital.
- 96 boyas distribuidas entre los cinco océanos y 25 mares o regiones marítimas, seleccionables desde el mapa o la lista.
- Temperatura, oleaje, viento, presión, humedad, batería, cobertura y estado de cada estación.
- Broker MQTT 3.1.1 integrado: TCP `1883` y WebSocket `8083`.
- Topics jerárquicos, QoS 0/1/2, mensajes retained y topic de alertas.
- Visor del payload JSON y traza didáctica de publicaciones.
- Inyección de tormenta, batería baja, desconexión y restablecimiento.
- API HTTP, WebSocket, OpenAPI y modo demostración del frontend.

## Puesta en marcha local

Requisitos: Python 3.12 o posterior y Node.js 22 o posterior.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
npm.cmd --prefix frontend install
```

En desarrollo se abren dos terminales:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --host 0.0.0.0 --port 8020
```

```powershell
npm.cmd --prefix frontend run dev
```

La interfaz estará en `http://localhost:5173`, la API en `http://localhost:8020`, la documentación en `http://localhost:8020/docs` y MQTT en `localhost:1883`.

También se puede iniciar con doble clic en `start_oceanlab.cmd` después de instalar las dependencias.

## Ejecución integrada

```powershell
npm.cmd --prefix frontend run build
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8020
```

Abrir `http://localhost:8020`. FastAPI servirá también el frontend construido.

## Conexión con clientes MQTT

Se puede usar MQTT Explorer, Node-RED, mosquitto_sub, Python, un SCADA o un gateway industrial:

```powershell
mosquitto_sub -h localhost -p 1883 -t "oceanlab/buoys/+/telemetry" -v
```

Topics principales:

| Topic | QoS configurable | Contenido |
|---|---:|---|
| `oceanlab/buoys/{id}/telemetry` | 0, 1 o 2 | Telemetría completa en JSON |
| `oceanlab/buoys/{id}/alerts` | 1 | Incidencia inyectada por el docente |

Ejemplo de suscripción con comodines:

- `oceanlab/buoys/+/telemetry`: telemetría de todas las boyas.
- `oceanlab/buoys/BOY-001/#`: todos los mensajes de una boya.
- `oceanlab/#`: red completa del laboratorio.

El broker acepta conexiones anónimas únicamente para facilitar la práctica dentro de una red de aula. No debe exponerse directamente a Internet.

## Secuencia didáctica sugerida

1. Identificar publicador, broker, suscriptor, topic y payload en la interfaz.
2. Suscribirse a una boya con MQTT Explorer o Node-RED.
3. Comparar el tráfico generado por QoS 0, 1 y 2.
4. Activar `retained`, reconectar el suscriptor y observar el último valor.
5. Inyectar una tormenta y construir una alarma por altura de ola.
6. Desconectar una boya y debatir el uso de Last Will and Testament.
7. Crear un dashboard histórico y calcular disponibilidad o consumo de batería.

## Práctica Node-RED + ThingsBoard

El proyecto incluye una práctica completa para suscribirse a la flota, transformar la telemetría y enviarla a ThingsBoard:

- Guion del alumnado: [`practicas/02-oceanlab-mqtt/practica-node-red-thingsboard.md`](../../practicas/02-oceanlab-mqtt/practica-node-red-thingsboard.md).
- Solución docente: [`practicas/02-oceanlab-mqtt/solucion-practica-node-red-thingsboard.md`](../../practicas/02-oceanlab-mqtt/solucion-practica-node-red-thingsboard.md).
- Flujo inicial: [`practicas/02-oceanlab-mqtt/flows/oceanlab-starter-flow.json`](../../practicas/02-oceanlab-mqtt/flows/oceanlab-starter-flow.json).
- Flujo resuelto: [`practicas/02-oceanlab-mqtt/flows/oceanlab-thingsboard-flow.json`](../../practicas/02-oceanlab-mqtt/flows/oceanlab-thingsboard-flow.json).

## Pruebas

```powershell
.\.venv\Scripts\python.exe -m pytest
npm.cmd --prefix frontend run build
```

## Alcance

El modelo es didáctico: reproduce relaciones plausibles entre variables y estados, pero no sustituye fuentes oceanográficas oficiales ni un sistema de seguridad marítima.
