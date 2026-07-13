# AeroLab · Simulador de aerogenerador Modbus TCP

AeroLab es un banco de prácticas para la asignatura de Monitorización de Máquinas. Simula un aerogenerador de 5 MW, expone sus variables mediante un servidor Modbus TCP real y representa su estado en una escena web 3D.

## Qué incluye este MVP

- Rotor 3D cuya velocidad sigue las RPM simuladas.
- Pitch independiente de las palas y orientación yaw de la nacelle.
- Cámara orbital para inspeccionar el aerogenerador.
- Curva de potencia simplificada con cut-in, potencia nominal y cut-out.
- Dinámica de inercia, temperaturas, vibración y energía acumulada.
- Inyección de sobretemperatura, vibración, pérdida de red y sobrevelocidad.
- Servidor Modbus TCP asíncrono en el puerto `1502`.
- Coils, discrete inputs, input registers y holding registers.
- Dirección PDU base cero junto a la referencia didáctica 30001/40001.
- Visor de tramas con cabecera MBAP y bytes en hexadecimal.
- API HTTP, WebSocket, documentación OpenAPI y despliegue Docker.

## Puesta en marcha local

Requisitos: Python 3.12 o posterior y Node.js 22 o posterior.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
npm.cmd --prefix frontend install
```

Para desarrollo, se pueden abrir dos terminales:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --host 0.0.0.0 --port 8010
```

```powershell
npm.cmd --prefix frontend run dev
```

La interfaz estará disponible en `http://localhost:5173`. La API está en `http://localhost:8010`, su documentación en `http://localhost:8010/docs` y Modbus TCP escucha en `localhost:1502`.

También se puede iniciar todo el modo desarrollo con:

```powershell
.\scripts\run-dev.ps1
```

## Ejecución integrada

Después de construir el frontend, FastAPI sirve la aplicación completa:

```powershell
npm.cmd --prefix frontend run build
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8010
```

Abrir `http://localhost:8010`.

En este proyecto ya preparado también se puede iniciar haciendo doble clic en `start_aerolab.cmd`.

Para proyectar únicamente la escena 3D, sin cabecera, controles ni laboratorio, abrir `http://localhost:8010/fullscreen`. Desde otro equipo del aula se usa la misma ruta sustituyendo `localhost` por la IP del simulador.

## Docker

```powershell
docker compose up --build
```

La aplicación se publica en `8010` y Modbus TCP en `1502`. Si el aula necesita el puerto estándar, se puede cambiar el mapeo del compose a `"502:1502"`; en algunos sistemas el puerto 502 requiere privilegios.

## Mapa Modbus principal

| Tabla | Offset PDU | Referencia | Variable | Formato |
|---|---:|---:|---|---|
| Coil | 0 | 00001 | Orden de marcha | Boolean |
| Coil | 1 | 00002 | Freno | Boolean |
| Coil | 2 | 00003 | Reset de alarma | Pulso Boolean |
| Coil | 3 | 00004 | Modo manual | Boolean |
| Discrete Input | 0–4 | 10001–10005 | Preparado, marcha, alarma, red y viento válido | Boolean |
| Input Register | 0 | 30001 | Viento | UInt16 × 0,1 m/s |
| Input Register | 1 | 30002 | Rotor | UInt16 × 0,01 rpm |
| Input Register | 2 | 30003 | Pitch real | UInt16 × 0,01° |
| Input Register | 3–4 | 30004–30005 | Potencia | UInt32, palabra alta primero, kW |
| Input Register | 5–15 | 30006–30016 | Yaw, vibración, temperaturas, energía y estados | Mixto |
| Holding Register | 0 | 40001 | Modo automático/manual | Enum |
| Holding Register | 1 | 40002 | Viento simulado | UInt16 × 0,1 m/s |
| Holding Register | 2 | 40003 | Consigna de pitch | UInt16 × 0,01° |
| Holding Register | 3 | 40004 | Consigna de yaw | UInt16 × 0,1° |
| Holding Register | 4 | 40005 | Límite de potencia | UInt16 kW |
| Holding Register | 5 | 40006 | Inyección de avería | Enum 0–4 |

El mapa completo y sus valores actuales están disponibles en `GET /api/registers`.

## Cliente de prueba

Con el servidor en marcha:

```powershell
.\.venv\Scripts\python.exe scripts\modbus_client_demo.py
```

También se puede usar QModMaster, Modbus Poll, Node-RED, un PLC o cualquier SCADA indicando la IP del equipo docente y el puerto `1502`.

## Práctica Node-RED + ThingsBoard

El proyecto incluye una práctica completa para convertir las variables Modbus del aerogenerador, publicarlas por MQTT y construir un dashboard con alarmas en ThingsBoard:

- Guion del alumnado: `docs/practica-node-red-thingsboard.md`.
- Solución docente: `docs/solucion-practica-node-red-thingsboard.md`.
- Flujo inicial: `integrations/node-red/aerolab-starter-flow.json`.
- Flujo resuelto: `integrations/node-red/aerolab-thingsboard-flow.json`.

## Pruebas

```powershell
.\.venv\Scripts\python.exe -m pytest
npm.cmd --prefix frontend run build
```

## Alcance del modelo

El modelo reproduce relaciones de proceso y condición de máquina para docencia. No es un modelo aeroelástico, CFD ni una herramienta de diseño o seguridad funcional.
