# Integración Node-RED y ThingsBoard

## Archivos

- `aerolab-starter-flow.json`: punto de partida para el alumnado; solo contiene las lecturas Modbus y la depuración de datos crudos.
- `aerolab-thingsboard-flow.json`: solución completa con decodificación, MQTT y mandos Modbus didácticos.
- `../practica-node-red-thingsboard.md`: guion de la práctica.
- `../solucion-practica-node-red-thingsboard.md`: solución y notas para el profesorado.

## Uso en cinco pasos

1. Iniciar AeroLab con `start_aerolab.cmd`.
2. Instalar `node-red-contrib-modbus` en Node-RED desde **Manage palette**.
3. Importar uno de los flujos desde **Menu → Import**.
4. Editar **AeroLab Modbus TCP** y configurar el host del simulador, puerto `1502` y Unit ID `1`.
5. En el flujo de solución, editar **ThingsBoard MQTT**, configurar el host y pegar el access token del dispositivo como **Username**; dejar **Password** vacío.

El topic de telemetría es `v1/devices/me/telemetry`. Los JSON no incluyen el access token.

## Direcciones según el despliegue

| Ubicación de Node-RED | Host Modbus habitual |
|---|---|
| Mismo equipo y sin Docker | `127.0.0.1` |
| Contenedor Docker, AeroLab en Windows | `host.docker.internal` |
| Otro equipo del aula | IP del equipo que ejecuta AeroLab |
| Misma red de Docker Compose | nombre del servicio, por ejemplo `aerolab` |

El firewall del equipo debe permitir conexiones entrantes a TCP `1502` cuando Node-RED se ejecuta en otro equipo.

## Seguridad

- No exportar ni entregar las credenciales de Node-RED.
- No reutilizar el token del dispositivo entre grupos.
- En una red no aislada, usar MQTT sobre TLS (`8883`) y restringir el puerto Modbus al segmento de laboratorio.
- Los nodos de escritura son solo para docencia. Deshabilitarlos si la práctica se limita a monitorización.

