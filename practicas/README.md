# Prácticas

Las prácticas están organizadas en **tres series** que se pueden hacer en orden con cada simulador. Todas siguen el mismo esquema: una **Fase 1** de monitorización (leer, mostrar, histórico, incidencia, alarmas, pérdida de comunicación) y una **Fase 2** que amplía (órdenes a la máquina o varios equipos).

| Serie | Qué se aprende | AeroLab (Modbus TCP) | OceanLab (MQTT) | SolarLab (OPC UA) | ReactorLab (protocolos web) | AtomLab (OPC UA) |
|---|---|---|---|---|---|---|
| **1 · Node-RED + Dashboard** | Adquirir datos con Node-RED y construir un dashboard con alarmas (Dashboard 2.0) | [guía](1-dashboard/aerolab/README.md) · [.docx](1-dashboard/aerolab/Practica_AeroLab_NodeRED_ES.docx) | [guía](1-dashboard/oceanlab/README.md) · [.docx](1-dashboard/oceanlab/Practica_OceanLab_NodeRED_ES.docx) | [guía](1-dashboard/solarlab/README.md) · [.docx](1-dashboard/solarlab/Practica_SolarLab_NodeRED_ES.docx) | [guía](1-dashboard/reactorlab/README.md) · [.docx](1-dashboard/reactorlab/Practica_ReactorLab_NodeRED_ES.docx) | [guía](1-dashboard/atomlab/README.md) · [.docx](1-dashboard/atomlab/Practica_AtomLab_NodeRED_ES.docx) |
| **2 · Node-RED + ThingsBoard** | Node-RED como pasarela: dispositivo, telemetría y atributos, panel, reglas de alarma, inactividad, RPC y API de gateway | [guía](2-thingsboard/aerolab/README.md) · [.docx](2-thingsboard/aerolab/Practica_AeroLab_ThingsBoard_ES.docx) | [guía](2-thingsboard/oceanlab/README.md) · [.docx](2-thingsboard/oceanlab/Practica_OceanLab_ThingsBoard_ES.docx) | [guía](2-thingsboard/solarlab/README.md) · [.docx](2-thingsboard/solarlab/Practica_SolarLab_ThingsBoard_ES.docx) | [guía](2-thingsboard/reactorlab/README.md) · [.docx](2-thingsboard/reactorlab/Practica_ReactorLab_ThingsBoard_ES.docx) | [guía](2-thingsboard/atomlab/README.md) · [.docx](2-thingsboard/atomlab/Practica_AtomLab_ThingsBoard_ES.docx) |
| **3 · Reto** | La misma integración, menos guiada, con criterios de evaluación y rúbrica | [guion](3-reto/aerolab-modbus/practica-node-red-thingsboard.md) · [solución](3-reto/aerolab-modbus/solucion-practica-node-red-thingsboard.md) | [guion](3-reto/oceanlab-mqtt/practica-node-red-thingsboard.md) · [solución](3-reto/oceanlab-mqtt/solucion-practica-node-red-thingsboard.md) | [guion](3-reto/solarlab-opcua/practica-node-red-thingsboard.md) | — | — |

## ReactorLab: las mismas ideas con protocolos web

| Parte | 1 · Dashboard | 2 · ThingsBoard |
|---|---|---|
| 1–3 | Petición `GET` REST, ruta en el JSON, comprobar el código de estado | Lectura REST, token como **credencial** de Node-RED |
| 4–6 | Reactor, caudales y **válvulas** (el esfuerzo del control) | Telemetría y atributos por la **API HTTP** de ThingsBoard, primer panel |
| 7–8 | Histórico; avería oculta: **válvula sucia** | Histórico de medidas y válvulas; avería oculta: **sensor en deriva** |
| 9–10 | Alarma, estado general y pérdida de comunicación | Reglas de alarma (medida, válvula y coste) e inactividad |
| 11 | **WebSocket**: el servidor empuja los datos | **Webhook** de la planta directo a ThingsBoard |
| 12 | Órdenes `PUT`/`POST` con **clave API** (401, 403, 422) | Órdenes RPC por **long polling HTTP** |
| 13 | **Webhooks**: Node-RED como servidor web | Mandos en el panel (sliders y botones RPC) |

> Para explicar cada protocolo antes de la práctica hay una presentación en [`docs/presentaciones`](../docs/presentaciones/README.md) (OPC UA, Modbus TCP, MQTT, protocolos web y panorama).

## AtomLab: una central nuclear RBMK por OPC UA

| Parte | 1 · Dashboard | 2 · ThingsBoard |
|---|---|---|
| 1–3 | Suscripción OPC UA a 21 variables, **latido** (OPC UA solo avisa de los cambios), agrupado por sistemas | Suscripción y agrupado, dispositivo y telemetría con claves planas |
| 4–6 | Reactor (potencia, reactividad, **ORM**), circuito, turbogenerador y radiación | MQTT, atributos (ficha de la central) y primer panel |
| 7–8 | Histórico e **intoxicación por xenón**; incidencia: menos bombas y disparo de turbina | Histórico y rendimiento; la misma incidencia vista desde la plataforma |
| 9–10 | Alarma de ORM, estado general y pérdida de comunicación | Reglas `ORM bajo` (dos argumentos y duración), `Accidente` e inactividad |
| 11 | **Escritura OPC UA**: consigna y pulsador AZ-5, rechazo de valores no válidos | **Dosímetros** como dispositivos (API de gateway) y regla en el perfil `dosimetro` |
| 12 | **Caja negra**: suscripción a 250 ms | Órdenes RPC → escritura OPC UA (`setPotencia`, `setBombas`, `az5`) |
| 13 | Reconstruir el **26-04-1986** y comparar el pico registrado con el real | **Registrador por lotes** con `ts` de la pasarela y el mismo experimento |

## Serie 2 · Contenido de cada práctica

| Parte | AeroLab | OceanLab | SolarLab |
|---|---|---|---|
| 1 | Leer y decodificar registros (FC 4) | Recibir la boya de Mosquitto | Suscripción OPC UA y agrupado |
| 2 | Dispositivo y token en ThingsBoard | Dispositivo y token | Dispositivo y token |
| 3 | Telemetría `{ts, values}` con claves planas | Telemetría con la hora de la boya | Telemetría con las claves del NodeId |
| 4 | Publicar por MQTT (+ señales FC 2) | Publicar por MQTT: dos MQTT distintos | Publicar por MQTT |
| 5 | Atributos: ficha de la máquina | Atributos: océano y posición | Atributos: ficha del parque |
| 6 | Primer panel (Value cards) | Primer panel | Primer panel |
| 7 | Histórico y agregación | Histórico | Histórico |
| 8 | Incidencia: vibración | Incidencia: tormenta | Incidencia: disparo de inversor |
| 9 | Regla de alarma con duración e histéresis | Regla de alarma (+ batería) | Regla de alarma de rendimiento |
| 10 | Inactividad (`inactivityTimeout`) | Inactividad: boya desconectada | Inactividad |
| 11 | Leer consignas (FC 3) | Pasarela: API de gateway | Zonas como dispositivos (gateway) |
| 12 | Órdenes RPC → Modbus Write | Regla de alarma en el perfil `boya` | Regla en el perfil `zona-fv` y tabla de zonas |
| 13 | Mandos en el panel (switch, botón, slider) | Panel de la flota (tabla, alarmas, mapa) | Consignas RPC → escritura OPC UA |

Cada práctica de la serie 2 incluye el **flujo resuelto** (`flows/*-thingsboard-solucion.json`) y el **panel resuelto** de ThingsBoard (`thingsboard/panel-*.json`, se importa en **Dashboards → + → Import dashboard**; busca los dispositivos por nombre, así que hay que usar los nombres de la guía). El código de las guías es exactamente el de los flujos resueltos.

## Valores para el entorno Docker integrado

Los guiones de las series 1 y 3 están escritos también para instalaciones sueltas (`localhost`, IP del equipo, `host.docker.internal`). Con el `docker-compose.yml` del repositorio usa estos valores:

| Dónde | Valor |
|---|---|
| Servidor Modbus (AeroLab) | host `aerolab`, puerto `1502`, Unit ID `1` |
| Broker MQTT (OceanLab) | host `mosquitto`, puerto `1883`, el broker único del laboratorio |
| Endpoint OPC UA SolarLab | `opc.tcp://solarlab:4840/solarlab/server/` |
| Endpoint OPC UA AtomLab | `opc.tcp://atomlab:4842/atomlab/` (seguridad `None`, `ns=2`) |
| API de ReactorLab | `http://reactorlab:8030` (REST), `ws://reactorlab:8030/ws`, clave `X-API-Key: reactorlab` |
| URL de webhooks hacia Node-RED | `http://nodered:1880/...` |
| API HTTP de ThingsBoard | `http://thingsboard:8080/api/v1/{TOKEN}/...` |
| Endpoint OPC UA Fundición (ampliación) | `opc.tcp://fundicion-opcua:4841/UA/Fundicion` |
| MQTT de ThingsBoard | host `thingsboard`, puerto `1883`, access token como *Username* |
| Web de ThingsBoard | `http://localhost:8080` (`tenant@thingsboard.org` / `tenant`) |
| Dashboard 2.0 | `http://localhost:1880/dashboard` |
| Copias (snapshots) | `http://localhost:8090` |

Los flujos de la biblioteca de Node-RED (**Import → Local → LabMonitorizacion**) ya traen estos hosts. Ningún flujo incluye tokens: cada grupo pega el suyo.

## Comprobación del entorno

Con el compose levantado y ThingsBoard 4.3.1 se ha verificado de extremo a extremo:

- **Serie 2 completa**, con los tres flujos resueltos desplegados a la vez:
  - telemetría y atributos de AeroLab (23 claves), BOY-001 (11) y SolarLab (11);
  - API de gateway: BOY-001…BOY-008 con perfil `boya` y las cuatro zonas con perfil `zona-fv` se crean solas;
  - reglas de alarma: vibración (con duración), rendimiento bajo, oleaje en el perfil `boya`, zona fuera de servicio en el perfil `zona-fv` y sin comunicación por `inactivityTimeout`. Todas se crean con la incidencia y se borran solas al quitarla;
  - RPC: `setLimite`, `setMarcha` y `rearmar` llegan a AeroLab por Modbus; `setIrradiancia` y `setAveria` llegan a SolarLab por OPC UA; los valores fuera de rango se rechazan;
  - paneles resueltos: el interruptor y el slider del panel de AeroLab paran y arrancan la máquina y cambian el límite de potencia.
- **ReactorLab**: dashboard completo por REST y WebSocket, órdenes con clave (401/403/422), webhooks hacia Node-RED y directos a ThingsBoard, telemetría por la API HTTP de ThingsBoard y órdenes RPC por long polling (incluidos los botones y sliders del panel).
- **AtomLab**: dashboard completo por OPC UA (suscripción, escritura de consigna y AZ-5, caja negra a 250 ms) y pasarela a ThingsBoard (18 claves de telemetría, atributos, cuatro dosímetros por la API de gateway con regla de perfil, reglas `ORM bajo`, `Accidente` y sin comunicación, RPC `setPotencia`/`setBombas`/`az5` y registrador por lotes), incluido el escenario del 26-04-1986 de principio a fin.
- Serie 3: SolarLab → Node-RED → ThingsBoard y OceanLab → Mosquitto → Node-RED → ThingsBoard.
- Snapshot de Node-RED + ThingsBoard → borrar dispositivo y flujos → restaurar: todo vuelve y la telemetría sigue llegando.
