# Copias de seguridad de Node-RED y ThingsBoard

Web en **http://localhost:8090** para guardar y recuperar el trabajo del laboratorio.

| Acción | Qué hace |
|---|---|
| **Crear snapshot** | Guarda Node-RED, ThingsBoard o ambos en un único `.tar.gz` |
| **Descargar** | Baja ese archivo para entregarlo, archivarlo o llevarlo a otro PC |
| **Importar** | Sube un `.tar.gz` a la lista; no cambia nada hasta pulsar *Restaurar* |
| **Restaurar** | Sustituye el estado actual por el del snapshot (Node-RED, ThingsBoard o ambos). Por defecto hace antes una copia automática |
| **Eliminar** | Borra el snapshot de la lista |

## Qué contiene un snapshot

```text
manifest.json                  nombre, fecha, contenido y versión de ThingsBoard
nodered/                       flows.json, flows_cred.json, package.json, lib/, context/...
thingsboard/thingsboard.dump   pg_dump de la base de datos de ThingsBoard
```

- **Node-RED**: flujos, credenciales cifradas, biblioteca propia, contexto persistente y la lista de paletas instaladas. Si el snapshot trae paletas que no hay en el equipo, se instalan al restaurar (requiere Internet). Los flujos de ejemplo del laboratorio no se copian porque se regeneran al arrancar.
- **ThingsBoard**: base de datos completa (dispositivos y sus tokens, perfiles, paneles, alarmas, cadenas de reglas, clientes y usuarios) con los últimos valores de telemetría. El histórico de telemetría es opcional. Los eventos de depuración y el registro de auditoría no se copian.
- Un snapshot de ThingsBoard solo se puede restaurar en la misma versión de ThingsBoard.

Las credenciales de Node-RED se cifran con `NODE_RED_CREDENTIAL_SECRET` (igual en todos los equipos del aula), así que un snapshot restaurado en otro PC sigue pudiendo publicar en ThingsBoard. Quien tenga el archivo puede leer esos tokens: trátalo como un secreto.

## Cómo funciona

El servicio usa el socket de Docker para parar y arrancar `nodered` y `thingsboard` y para ejecutar `pg_dump` / `pg_restore` dentro de `tb-postgres`. Los snapshots se guardan en el volumen `labmonitorizacion_copias`.

Dar acceso al socket de Docker equivale a dar control sobre el equipo, por eso el puerto 8090 solo escucha en `127.0.0.1` (no es accesible desde otros PC del aula).

## API

| Método | Ruta | |
|---|---|---|
| GET | `/api/estado` | estado de los servicios |
| GET | `/api/snapshots` | lista |
| POST | `/api/snapshots` | crear `{nombre, descripcion, nodered, thingsboard, telemetria}` |
| GET | `/api/snapshots/{id}/descargar` | descargar |
| POST | `/api/snapshots/importar` | importar (multipart, campo `archivo`) |
| POST | `/api/snapshots/{id}/restaurar` | restaurar `{nodered, thingsboard, copia_previa}` |
| DELETE | `/api/snapshots/{id}` | eliminar |
