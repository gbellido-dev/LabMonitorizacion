# ThingsBoard CE en el laboratorio

El `docker-compose.yml` de la raíz arranca ThingsBoard Community Edition
4.3.1 (`thingsboard/tb-node:4.3.1.8`) con PostgreSQL 16 y cola en memoria, la
configuración recomendada por ThingsBoard para un único nodo.

> **Por qué 4.3.1 y no 4.4.** Desde la 4.4 las ediciones CE y PE se unificaron y
> la plataforma exige una clave de licencia; una instalación nueva de 4.4 no crea
> las cuentas de demostración. La 4.3.1 es la última CE sin licencia y ya incluye
> las *Alarm rules* que piden las prácticas.

## Primera puesta en marcha

La base de datos se inicializa una sola vez:

```bash
./scripts/thingsboard-init.sh        # Linux / macOS
scripts\thingsboard-init.cmd         # Windows
```

El script ejecuta `docker compose run --rm -e INSTALL_TB=true -e LOAD_DEMO=true thingsboard`.
Con `LOAD_DEMO=true` se crean las cuentas de demostración:

| Rol | Usuario | Contraseña |
|---|---|---|
| Administrador del sistema | `sysadmin@thingsboard.org` | `sysadmin` |
| Administrador de tenant | `tenant@thingsboard.org` | `tenant` |
| Cliente | `customer@thingsboard.org` | `customer` |

Cambia las contraseñas antes de usar la instancia con el alumnado y crea un
tenant o un cliente por grupo.

## Puertos

| Servicio | Dentro de Docker | En el equipo anfitrión |
|---|---|---|
| Web / API REST | `thingsboard:8080` | `http://localhost:8080` |
| MQTT dispositivos | `thingsboard:1883` | `localhost:1885` |

Node-RED, al estar en la misma red de Docker, publica en `thingsboard:1883`,
que es el puerto que indican los guiones de las prácticas. El puerto `1883`
del anfitrión lo ocupa Mosquitto, por eso ThingsBoard se publica en `1885`.

## Requisitos

ThingsBoard necesita al menos 4 GB de RAM libres. El primer arranque tarda
1–2 minutos; hasta entonces la web no responde.

## Reiniciar desde cero

```bash
docker compose down
docker volume rm labmonitorizacion_tb-postgres-data labmonitorizacion_tb-data labmonitorizacion_tb-logs
./scripts/thingsboard-init.sh
```
