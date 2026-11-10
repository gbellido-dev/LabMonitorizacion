# ThingsBoard CE en el laboratorio

El `docker-compose.yml` de la raíz arranca ThingsBoard Community Edition
4.3.1 con PostgreSQL 16 y cola en memoria, la configuración recomendada por
ThingsBoard para un único nodo.

> **Por qué 4.3.1 y no 4.4.** Desde la 4.4 las ediciones CE y PE se unificaron y
> la plataforma exige una clave de licencia; una instalación nueva de 4.4 no crea
> las cuentas de demostración. La 4.3.1 es la última CE sin licencia y ya incluye
> las *Alarm rules* que piden las prácticas.

## Instalación automática

La imagen oficial `thingsboard/tb-node` obliga a ejecutar una vez un comando de
instalación (`INSTALL_TB=true`). Aquí no hace falta: [`Dockerfile`](Dockerfile)
añade [`start-lab.sh`](start-lab.sh), que en cada arranque consulta la base de
datos ([`ComprobarBD.java`](ComprobarBD.java), con el driver JDBC que ya trae
ThingsBoard) y:

| Estado de la base de datos | Qué hace |
|---|---|
| vacía (primer arranque o volumen borrado) | instala ThingsBoard con datos de demostración y arranca |
| instalada | arranca directamente |
| a medio instalar | se detiene y pide borrar el volumen |

El primer arranque tarda 1–3 minutos más. El alumnado solo ejecuta
`docker compose up -d` (o `start_lab.cmd`).

Cuentas de demostración (`TB_LOAD_DEMO=true`):

| Rol | Usuario | Contraseña |
|---|---|---|
| Administrador del sistema | `sysadmin@thingsboard.org` | `sysadmin` |
| Administrador de tenant | `tenant@thingsboard.org` | `tenant` |
| Cliente | `customer@thingsboard.org` | `customer` |

## Puertos

| Servicio | Dentro de Docker | En el equipo anfitrión |
|---|---|---|
| Web / API REST | `thingsboard:8080` | `http://localhost:8080` |
| MQTT de dispositivos | `thingsboard:1883` | no publicado |

El MQTT de ThingsBoard no es un broker general sino su API de dispositivos, así
que el único broker del laboratorio es Mosquitto (`localhost:1883`). Si se
quieren conectar dispositivos reales (p. ej. un ESP32) directamente a
ThingsBoard, añade `- "1885:1883"` en `ports`.

## Requisitos

ThingsBoard necesita al menos 4 GB de RAM libres.

## Reiniciar desde cero

```bash
docker compose down
docker volume rm labmonitorizacion_tb-postgres-data
docker compose up -d
```
