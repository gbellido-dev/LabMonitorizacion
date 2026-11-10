# SolarLab · Simulador de parque fotovoltaico OPC UA

SolarLab es un banco de prácticas para la asignatura de **Monitorización de Máquinas** de la especialización en Digitalización del Mantenimiento. Simula un parque fotovoltaico de 5 MWp, expone sus variables mediante un servidor OPC UA real y representa la instalación en una escena web 3D interactiva.

![Estado](https://img.shields.io/badge/estado-MVP_funcional-b9f232?labelColor=12392c) ![OPC UA](https://img.shields.io/badge/OPC_UA-asyncua-193e56) ![Python](https://img.shields.io/badge/Python-3.12%20%7C%203.13-3776ab)

## Qué incluye

- Campo 3D con 96 seguidores distribuidos en cuatro zonas, subestación, nubes y carretera de servicio.
- Potencia, irradiancia, energía, temperatura, corriente, tensión, frecuencia, PR y disponibilidad en tiempo real.
- Escenarios regulables de irradiancia, nubosidad, temperatura, suciedad y seguimiento solar.
- Averías de suciedad severa, disparo de inversor, punto caliente, string abierto y pérdida de red.
- Servidor OPC UA real en el puerto `4840`, accesible desde UAExpert, Node-RED, un SCADA o un cliente Python.
- Espacio de direcciones con objetos `Plant`, `Zones` y `Controls`, NodeIds de cadena estables y variables de lectura/escritura.
- Explorador OPC UA integrado que muestra BrowsePath, NodeId, DataType, AccessLevel, Namespace URI y valor actual.
- Registro visual de escrituras realizadas desde clientes externos.
- API HTTP, WebSocket, documentación OpenAPI y despliegue Docker.
- Itinerario de cuatro prácticas incluido en la propia interfaz.

## Puesta en marcha local

### Requisitos

- Python **3.12 o 3.13**. Actualmente `asyncua 1.1.8` no es compatible con Python 3.14 para el cliente de ejemplo.
- Node.js 22 o posterior.

Desde PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
npm.cmd --prefix frontend install
```

Abrir dos terminales. En la primera:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

En la segunda:

```powershell
npm.cmd --prefix frontend run dev
```

Abrir `http://localhost:5173`. La API está en `http://localhost:8000`, OpenAPI en `http://localhost:8000/docs` y el servidor OPC UA en:

```text
opc.tcp://localhost:4840/solarlab/server/
```

También se puede iniciar el modo desarrollo con:

```powershell
.\scripts\run-dev.ps1
```

## Ejecución integrada

FastAPI sirve el frontend compilado y todo queda disponible en el puerto 8000:

```powershell
npm.cmd --prefix frontend run build
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

Abrir `http://localhost:8000`.

## Conectar UAExpert

1. Iniciar SolarLab.
2. En UAExpert, añadir un servidor con la dirección `opc.tcp://localhost:4840/solarlab/server/`.
3. Elegir el endpoint con política `None` y modo `None`.
4. Conectar y desplegar `Objects > SolarLab`.
5. Arrastrar variables de `Plant` o `Zones` a *Data Access View*.
6. Para escribir, usar las variables de `Controls`.

La seguridad está desactivada intencionadamente para las primeras prácticas. No se debe exponer este servidor directamente a Internet. Una ampliación didáctica natural consiste en añadir certificados, usuarios y políticas `Basic256Sha256`.

En otro equipo del aula hay que sustituir `localhost` por la IP del ordenador que ejecuta SolarLab y permitir los puertos TCP `4840` y `8000` en el firewall.

## Espacio de direcciones

El Namespace URI estable es:

```text
urn:solarlab:parque-fotovoltaico
```

El índice (`ns=2` normalmente) lo asigna el servidor en cada ejecución. En aplicaciones reales se debe resolver el índice a partir del URI y no asumir que siempre será 2.

| Rama | Ejemplo de NodeId | Tipo | Acceso | Descripción |
|---|---|---|---|---|
| Plant | `Plant.ActivePower` | Double | Lectura | Potencia activa total en kW |
| Plant | `Plant.Irradiance` | Double | Lectura | Irradiancia efectiva en W/m² |
| Plant | `Plant.AlarmActive` | Boolean | Lectura | Alarma general de planta |
| Zones | `Zone02.ActivePower` | Double | Lectura | Potencia de la zona 02 |
| Zones | `Zone02.Available` | Boolean | Lectura | Disponibilidad de la zona 02 |
| Controls | `Controls.RunCommand` | Boolean | Lectura/Escritura | Marcha o parada |
| Controls | `Controls.IrradianceSetpoint` | Double | Lectura/Escritura | Consigna de 0 a 1200 W/m² |
| Controls | `Controls.FaultCode` | Int32 | Lectura/Escritura | Inyección de averías 0–5 |

El mapa completo y los valores actuales se consultan en `GET /api/opcua/nodes` o en el explorador de la web.

## Cliente Python de ejemplo

Lectura de variables:

```powershell
.\.venv\Scripts\python.exe scripts\opcua_client_demo.py
```

Lectura y escritura de una consigna:

```powershell
.\.venv\Scripts\python.exe scripts\opcua_client_demo.py --write-irradiance 525
```

## Propuesta de prácticas

La práctica completa **OPC UA → Node-RED → ThingsBoard**, con flujo importable, dashboard, alarmas, reto y rúbrica, está disponible en [practicas/3-reto/solarlab-opcua](../../practicas/3-reto/solarlab-opcua/practica-node-red-thingsboard.md). La guía paso a paso con Dashboard 2.0 está en [practicas/1-dashboard/solarlab](../../practicas/1-dashboard/solarlab/README.md).

### 1. Descubrimiento y navegación

Conectar UAExpert, localizar el Namespace URI y documentar las diferencias entre DisplayName, BrowseName y NodeId. Reiniciar el servidor y comprobar cómo se resuelve el índice del namespace.

### 2. Suscripciones

Crear una suscripción a `Plant.ActivePower`, `Plant.Irradiance` y `Plant.PanelTemperature`. Comparar *sampling interval* y *publishing interval*. Introducir nubosidad y observar el efecto de distintos intervalos.

### 3. Lectura, escritura y tipos

Escribir `Controls.IrradianceSetpoint` y `Controls.CloudCover`. Intentar escribir un tipo incorrecto y una variable de solo lectura. Interpretar los StatusCodes devueltos por el servidor.

### 4. Mantenimiento basado en condición

El docente inyecta una avería sin comunicarla. El alumnado debe comparar las cuatro zonas, localizar el activo afectado y justificar un diagnóstico usando temperatura, PR, potencia, disponibilidad y alarma.

### Ampliaciones recomendadas

- Eventos y alarmas OPC UA con reconocimiento.
- Histórico con SQLite o InfluxDB.
- Autenticación, certificados y roles alumno/docente.
- Companion Specification basada en modelos de energía solar.
- Integración con Node-RED, Grafana o un gemelo digital de mantenimiento.

## Docker

```powershell
docker compose up --build
```

La web/API se publica en `8000` y OPC UA en `4840`.

## Pruebas

```powershell
.\.venv\Scripts\python.exe -m pytest
npm.cmd --prefix frontend run build
```

## Alcance del modelo

El modelo reproduce relaciones de proceso y condición de máquina con fines docentes. No es una herramienta de dimensionamiento fotovoltaico, predicción de producción, protección eléctrica ni seguridad funcional.
