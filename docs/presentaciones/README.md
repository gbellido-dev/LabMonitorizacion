# Presentaciones de protocolos

Una presentación por cada protocolo del laboratorio, una de panorama que las une, una de OPC UA avanzado y una de IA (serie 4). Están pensadas para explicar en clase antes de cada práctica (llevan notas del ponente en algunas diapositivas) y se pueden editar en PowerPoint: usan un tema propio, diseños de diapositiva y secciones.

| Presentación | Diapositivas | Contenido | Simuladores |
|---|---|---|---|
| [00 · Panorama](00_Panorama_protocolos.pptx) | 12 | Pirámide ISA-95, comparativa, patrones (polling, suscripción, pub/sub, push), la pasarela, tiempo y calidad del dato, seguridad OT (IEC 62443), **otros protocolos** que no están en el laboratorio y cómo elegir | todos |
| [01 · OPC UA](01_OPC_UA.pptx) | 18 | Cliente-servidor, espacio de direcciones y NodeId, nodos y atributos, leer frente a suscribirse, escritura y métodos, seguridad y endpoints, patrón en Node-RED, errores típicos | SolarLab, Fundición, AtomLab |
| [02 · Modbus TCP](02_Modbus_TCP.pptx) | 17 | Variantes RTU/ASCII/TCP, las cuatro tablas, códigos de función y excepciones, trama MBAP, escalado, signo y 32 bits, direcciones 0/40001, mapa de AeroLab, polling y seguridad | AeroLab |
| [03 · MQTT](03_MQTT.pptx) | 17 | Publicar/suscribir y broker, topics y comodines, QoS, retained, last will, sesiones, JSON y Sparkplug B, MQTT 5, seguridad, API MQTT de ThingsBoard, línea de comandos | OceanLab, ThingsBoard |
| [04 · Protocolos web](04_Protocolos_web.pptx) | 17 | HTTP y REST, códigos de estado, autenticación, polling, long polling, SSE, WebSocket y webhooks, API HTTP de ThingsBoard, nodos web de Node-RED | ReactorLab, ThingsBoard, Fundición |
| [05 · S7](05_S7.pptx) | 15 | Áreas de memoria (I, Q, M, DB), direcciones y tipos, un REAL en bytes (big-endian), ISO-on-TCP, rack y slot, S7comm frente a S7comm-plus (PUT/GET), patrón en Node-RED, S7 frente a OPC UA, errores típicos | Fundición (`fundicion-s7`) |
| [06 · OPC UA avanzado](06_OPC_UA_avanzado.pptx) | 13 | Alarmas y condiciones (ExclusiveLimitAlarm), dónde poner las reglas, métodos con argumentos desde Node-RED, HistoryRead, modelos de información y Companion Specifications, errores típicos | Fundición |
| [07 · IA en planta](07_IA_en_planta.pptx) | 14 | El recorrido de la serie 4, regresión, clasificación y anomalías, etiquetas, excitación y retrasos, cómo separar la prueba, métricas y umbral, comparar con algo sencillo, la serie 4 en los cinco simuladores, llevarlo a producción | AeroLab, ReactorLab, Fundición, AtomLab, OceanLab |

## Regenerarlas

Las presentaciones se generan con [pptxgenjs](https://gitbrent.github.io/PptxGenJS/) a partir del contenido de [`fuente/`](fuente) (un archivo por presentación; `comun.js` tiene el tema, los diseños y los bloques gráficos):

```bash
cd docs/presentaciones/fuente
npm install
node generar.js            # todas
node generar.js mqtt       # solo una
```

Para cambiar un texto, edita el archivo de esa presentación (`opcua.js`, `modbus.js`, `mqtt.js`, `web.js`, `panorama.js`, `s7.js`, `opcua_avanzado.js`, `ia.js`) y vuelve a generar. Los colores de cada protocolo están en su `meta`.
