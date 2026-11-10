# Fundición · Gemelo digital de una planta de fundición con OPC UA

La Fundición simula la **Planta Norte** de una fundición de hierro completa: dos hornos de inducción, moldeo, colada automática, túnel de enfriamiento, desmoldeo, robots y control de calidad. Publica **11 activos y 127 variables** en un servidor **OPC UA** y tiene un **gemelo digital 3D** en el navegador que se mueve con esos datos.

Es el simulador con más activos del laboratorio: sirve para practicar el **descubrimiento** de un espacio de direcciones grande, el modelado de una planta como **jerarquía de activos** y los indicadores de planta (OEE, producción, energía).

## Servicios

| Servicio (compose) | Puerto | Qué hace |
|---|---|---|
| `fundicion-opcua` | `4841` | Servidor OPC UA: `opc.tcp://localhost:4841/UA/Fundicion` (desde otro contenedor, `opc.tcp://fundicion-opcua:4841/UA/Fundicion`) |
| `fundicion-bridge` | `8081` | Puente OPC UA → WebSocket: se suscribe a las variables y envía una instantánea cada segundo a la escena 3D |
| `fundicion-web` | `3000` | Gemelo digital 3D: `http://localhost:3000` |

Seguridad `None` y acceso anónimo (también admite las políticas seguras por defecto de node-opcua).

## El proceso

```
 Fusión            Moldeo                 Colada            Enfriamiento     Acabado            Calidad
 IF-01, IF-02  →   MP-01, MP-02, ROB-03 → COL-01, ROB-01 →  ENF-01       →   DES-01, ROB-02  →  QC-01
 (hornos)          (prensas, machos)      (cuchara)         (túnel)          (desmoldeo)        (escáner 3D)
```

La dinámica es coherente entre activos:

- **Hornos**: ciclo de fases `CARGA` → `FUSION` → `AFINO` → `LISTO` (variable `Fase`); la temperatura del metal y la potencia de la bobina siguen la fase.
- **Línea y colada** con *interlock*: la línea avanza, se para con un molde bajo la cuchara (`MoldeEnPosicion`), cuela (`Colando`, `CaudalColada`, `NivelLlenado`) solo si la cuchara tiene metal (`PesoCuchara`) y reanuda; la grúa repone la cuchara por lotes.
- **Desmoldeo**: alterna marcha (35 s) y paro (25 s); vibración, frecuencia y potencia siguen el estado.
- El resto de variables evolucionan alrededor de su valor nominal.

## Espacio de direcciones

```
Objects
├── PlantaNorte
│   ├── KPIs                OEEPlanta, ProduccionTurno, PiezasConformes, EnergiaEspecifica,
│   │                       CO2Estimado, VelocidadLinea, PosicionLinea, LoteActivo
│   ├── Fusion   ─ IF-01, IF-02
│   ├── Moldeo   ─ MP-01, MP-02, ROB-03
│   ├── Colada   ─ COL-01, ROB-01
│   ├── Enfriamiento ─ ENF-01
│   ├── Acabado  ─ DES-01, ROB-02
│   └── Calidad  ─ QC-01
└── Mantenimiento           Averia (escribible), AveriaNombre
```

Cada activo tiene `Nombre`, `Estado` (`RUN`, `IDLE`, `WARN`, `ALARM`), `PLC`, `Zona`, sus variables de proceso, sus señales (`Fase`, `Colando`, `Marcha`…) y una carpeta `TagsS7` con la correspondencia a direcciones de un PLC Siemens (ver [docs/S7_INTEGRATION.md](docs/S7_INTEGRATION.md)).

**NodeId**: `ns=1;s=<ACTIVO>.<Variable>`, por ejemplo `ns=1;s=IF-01.TemperaturaMetal`, `ns=1;s=COL-01.PesoCuchara`, `ns=1;s=KPIs.OEEPlanta`. Las carpetas de zona son `ns=1;s=Zona.Fusion`, etc.

## Averías (para las prácticas)

Escribiendo un `Int32` en `ns=1;s=Mantenimiento.Averia` (un valor fuera de 0–4 se rechaza con `BadOutOfRange`):

| Código | Avería | Síntomas |
|---|---|---|
| 0 | Sin avería | — |
| 1 | Rodamiento del desmoldeo DES-01 | La vibración crece +0,03 mm/s cada segundo (hasta +9) y sube la temperatura; `Estado` pasa a `WARN` |
| 2 | Extracción de humos IF-02 | La presión del recinto del horno pasa de ≈ −9 Pa (depresión) a ≈ +6 Pa; `Estado` `ALARM` |
| 3 | Retraso de la grúa de cuchara | La cuchara no se repone: la línea se queda esperando metal (`VelocidadLinea` 0), se para la producción y el OEE de planta cae a ≈ 61 % |
| 4 | Deriva del escáner 3D QC-01 | Crece `DesviacionEscaneo` y bajan las piezas conformes (de la célula y de planta); `Estado` `WARN` |

## Puesta en marcha

Con el laboratorio completo: `docker compose up -d fundicion-opcua fundicion-bridge fundicion-web`.

Por separado (Node.js ≥ 22.13):

```bash
cd simuladores/fundicion
npm install
npm run opcua          # servidor OPC UA (variable OPCUA_PORT, por defecto 4840)
npm run opcua:bridge   # puente WebSocket en el puerto 8081 (OPCUA_ENDPOINT)
npm run dev            # gemelo digital 3D en desarrollo
npm run opcua:test     # cliente de prueba
```

`OPCUA_ALTERNATE_HOSTNAME` admite varios nombres separados por comas: son los que el servidor anuncia en sus endpoints (en el compose, `localhost` y `fundicion-opcua`).

## Prácticas

- Serie 1 · Node-RED + Dashboard: [`practicas/1-dashboard/fundicion`](../../practicas/1-dashboard/fundicion/README.md)
- Serie 2 · Node-RED + ThingsBoard: [`practicas/2-thingsboard/fundicion`](../../practicas/2-thingsboard/fundicion/README.md)
