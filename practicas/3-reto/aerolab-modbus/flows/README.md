# Flujos del reto AeroLab

- `aerolab-starter-flow.json`: punto de partida para el alumnado; solo contiene las lecturas Modbus y la depuración de datos crudos.
- `aerolab-thingsboard-flow.json`: solución completa con decodificación, MQTT y mandos Modbus didácticos.
- Guion: [`../practica-node-red-thingsboard.md`](../practica-node-red-thingsboard.md) · solución: [`../solucion-practica-node-red-thingsboard.md`](../solucion-practica-node-red-thingsboard.md).

Los dos flujos traen los hosts del laboratorio Docker: Modbus `aerolab:1502` (Unit ID 1) y MQTT de ThingsBoard `thingsboard:1883`. Solo hay que pegar el access token del dispositivo en el **Username** del broker de ThingsBoard (Password vacío). Los JSON no incluyen el token.

Con equipos sueltos, cambia los hosts por la IP de cada equipo (y abre el puerto TCP `1502` en el firewall del equipo de AeroLab).

## Seguridad

- No exportar ni entregar las credenciales de Node-RED.
- No reutilizar el token del dispositivo entre grupos.
- En una red no aislada, usar MQTT sobre TLS (`8883`) y restringir el puerto Modbus al segmento de laboratorio.
- Los nodos de escritura son solo para docencia. Deshabilitarlos si la práctica se limita a monitorización.
