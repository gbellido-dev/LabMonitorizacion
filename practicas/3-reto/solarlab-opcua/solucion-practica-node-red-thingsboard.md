# Solución docente: SolarLab, Node-RED y ThingsBoard

Este documento acompaña a [`practica-node-red-thingsboard.md`](practica-node-red-thingsboard.md). El flujo resuelto está en [`flows/solarlab-thingsboard-flow.json`](flows/solarlab-thingsboard-flow.json) y el de partida del alumnado en [`flows/solarlab-starter-flow.json`](flows/solarlab-starter-flow.json).

## Preparación del aula

1. Arrancar el laboratorio y comprobar SolarLab en `http://localhost:8000` y ThingsBoard en `http://localhost:8080`.
2. El flujo resuelto ya trae los hosts del laboratorio: endpoint `opc.tcp://solarlab:4840/solarlab/server/` y MQTT `thingsboard:1883`.
3. Crear el dispositivo `Parque Solar SolarLab`, importar el flujo y pegar el access token en el **Username** del broker.
4. **Deploy** y pulsar `INICIAR SUSCRIPCIONES`. En **Latest telemetry** deben aparecer las ocho claves en unos segundos.

El flujo no contiene credenciales: Node-RED guarda el usuario MQTT en su fichero de credenciales local.

## Parte 1 · Respuestas

| Dato | Valor |
|---|---|
| Endpoint | `opc.tcp://localhost:4840/solarlab/server/` desde el ordenador; `opc.tcp://solarlab:4840/solarlab/server/` desde Node-RED |
| Namespace URI | `urn:solarlab:parque-fotovoltaico` |
| Índice de namespace | `2` |
| Potencia inicial | unos 3150–3250 kW con 760 W/m² y 18 % de nubosidad |
| Zonas | 4 (`Zone01` … `Zone04`) |

**Cuestiones 1**

1. El índice depende del orden en que el servidor registra sus espacios de nombres: puede cambiar con una actualización o en otro servidor. Lo estable es el **Namespace URI**; un cliente robusto lee la *NamespaceArray* al conectar y obtiene el índice.
2. `NodeId` identifica el nodo de forma única (es lo que se usa en Read/Write/Subscribe); `BrowseName` es el nombre cualificado usado para navegar por rutas; `DisplayName` es el texto para personas, localizable.
3. Las variables de `Controls` (consignas y avería). Lo indican los atributos `AccessLevel` / `UserAccessLevel` (bit *CurrentWrite*).

## Parte 3 · Transformación de referencia

```javascript
const mapping = {
    'Plant.ActivePower': 'activePowerKw',
    'Plant.Irradiance': 'irradianceWm2',
    'Plant.PanelTemperature': 'panelTemperatureC',
    'Plant.GridFrequency': 'gridFrequencyHz',
    'Plant.PerformanceRatio': 'performanceRatioPct',
    'Plant.Availability': 'availabilityPct',
    'Plant.AlarmActive': 'alarmActive',
    'Zone02.ActivePower': 'zone02PowerKw'
};

const topic = String(msg.topic || '');
if (!topic.startsWith('ns=')) {
    return null;   // aviso propio del cliente OPC UA (p. ej. subscriptionId), no es un dato
}
const match = topic.match(/;s=([^;]+)/);
const source = match ? match[1] : topic;
const key = mapping[source];
if (!key) {
    node.warn('NodeId sin correspondencia: ' + topic);
    return null;
}

function scalar(value) {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
        return scalar(value.value);
    }
    return value;
}

const cache = flow.get('solarlabTelemetry') || {};
cache[key] = scalar(msg.payload);
flow.set('solarlabTelemetry', cache);

if (Object.keys(cache).length < 4) {
    node.status({fill:'yellow', shape:'ring', text:'recibiendo variables'});
    return null;
}

node.status({fill:'green', shape:'dot', text:Object.keys(cache).length + ' variables'});
msg.topic = 'v1/devices/me/telemetry';
msg.qos = 1;
msg.retain = false;
msg.payload = { ts: Date.now(), values: cache };
return msg;
```

**Cuestiones 2**

1. Leer cada segundo genera tráfico aunque nada cambie y puede perder cambios entre lecturas; la suscripción hace que el servidor muestree y envíe **solo los cambios** (*MonitoredItems* y *Publish*).
2. `OpcUa-Item` solo define qué variable (NodeId y tipo); `OpcUa-Client` mantiene la sesión y ejecuta la acción (SUBSCRIBE, READ, WRITE…).
3. Cada variable que cambia produce un mensaje: sin límite saldrían unos 8 por segundo hacia ThingsBoard, con el mismo contenido casi repetido.
4. Tipo de dato, unidades, rango, descripción, calidad (`StatusCode`), *SourceTimestamp* y la jerarquía (a qué equipo pertenece cada variable).

## Parte 4 · Dashboard y experimentos

| Cambio en SolarLab | Respuesta esperada | Retraso hasta ThingsBoard |
|---|---|---|
| Irradiancia 760 → 1000 W/m² | La potencia sube a unos 4000–4200 kW en pocos segundos; la temperatura de panel sube lentamente (inercia térmica) | 1–2 s |
| Nubosidad 70 % | La irradiancia oscila con amplitud grande; la potencia la sigue | 1–2 s |
| Suciedad 25 % | Baja la potencia y el **PR** (unos 20 puntos) **sin** que cambie la irradiancia | 1–2 s |

## Parte 5 · Alarmas

- Regla `Indisponibilidad FV`: argumento `availabilityPct` (*Latest telemetry*), **Major** si `availabilityPct < 100`, se borra si `availabilityPct >= 100`.
- Con `Disparo inversor Z02` la disponibilidad pasa a **75 %**, la alarma se crea en 1–2 s; al reconocerla pasa a *Active Acknowledged* y al quitar la avería, a *Cleared Acknowledged*.
- Alarmas complementarias: la temperatura alta salta con *Punto caliente*; la frecuencia anómala con *Pérdida de red* (frecuencia 0); el **PR bajo con contexto** (`PR < 70` **y** `irradianza > 500`) salta con *Suciedad severa* y no con una nube.

## Parte 6 · Cuestiones 3

1. El cliente no puede construir un `Double` a partir de un texto no numérico: la escritura falla (`BadTypeMismatch`) y el valor no cambia.
2. Es una **medida** del proceso, no una consigna: su `AccessLevel` es solo lectura.
3. Autenticación (usuario o certificado), política `SignAndEncrypt`, permisos por rol, límites de valores, confirmación y registro de auditoría.
4. La **orden** es el valor escrito; el **estado confirmado** es lo que el servidor acepta y vuelve a publicar en `Controls`; la **variable de proceso** (potencia, irradiancia efectiva) responde después, con su dinámica.

## Reto final · Firmas de las averías

Valores medidos en el laboratorio con 760 W/m², 24 °C y 18 % de nubosidad (sin avería: unos 3150 kW, PR 86 %, disponibilidad 100 %, panel 46 °C). Zonas en el orden Z01 / Z02 / Z03 / Z04.

| Avería (código) | Potencia | PR | Disponibilidad | Otras pistas | Alarma de zona | Diagnóstico |
|---|---|---|---|---|---|---|
| Suciedad severa (1) | ≈ 2280 kW | ≈ 61 % | 100 % | Las cuatro zonas bajan por igual; irradiancia normal | ninguna | Pérdida óptica en todo el parque: **limpieza** |
| Disparo inversor Z02 (2) | ≈ 2500 kW | ≈ 64 % | **75 %** | Zona 02 a 0 kW; las demás normales | Z02 | Fallo del inversor de la zona 02: **revisar y rearmar el inversor** |
| Punto caliente Z01 (3) | ≈ 3100 kW | ≈ 78 % | 100 % | **Temperatura de panel ≈ 66 °C** (Z01 ≈ 73 °C); poca pérdida de potencia | Z01 | Célula o conexión defectuosa en la zona 01: **termografía** |
| String abierto Z03 (4) | ≈ 3110 kW | ≈ 80 % | 100 % | Zona 03 cae a ≈ 620 kW (−26 %), temperatura normal | Z03 | Un string desconectado en la zona 03: **revisar fusibles y conectores** |
| Pérdida de red (5) | **0 kW** | 0 % | 0 % | Tensión y frecuencia de red **0**; `alarmActive` | — | Fallo de la red o del punto de conexión: **comunicar con la distribuidora** |

Con solo las ocho claves del dashboard (incluye `zone02PowerKw`) se distinguen bien la suciedad, el disparo de Z02 y la pérdida de red. El punto caliente se identifica por la temperatura de panel. El **string abierto de Z03 es el caso difícil**: la planta solo pierde un 2 % y el PR baja unos 6 puntos; sin datos por zona solo se puede sospechar. Es un buen argumento para la ampliación 3 (cada zona como dispositivo por la API de gateway, que hace la serie 2).

## Preguntas de ampliación · Orientación

1. Leer `ns=0;i=2255` (*NamespaceArray*) al arrancar y buscar `urn:solarlab:parque-fotovoltaico`; construir los NodeId con ese índice.
2. QoS 0 puede perder muestras; QoS 1 garantiza la entrega con posibles duplicados (inocuos con `ts`); QoS 2 añade latencia sin ventaja real para telemetría.
3. Igual que la serie 2 (`2-thingsboard/solarlab`): `v1/gateway/connect` con `type: "zona-fv"` y `v1/gateway/telemetry`.
4. El `OpcUa-Client` entrega el `statusCode` en el mensaje: descartar o marcar los valores que no sean `Good`.
5. Node-RED es flexible y visual; ThingsBoard IoT Gateway es un conector configurable y mantenido por la plataforma (OPC UA, Modbus, BACnet…) con menos lógica a medida.

## Errores frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| *invalid endpoint* | Endpoint con `localhost` dentro de Docker | `opc.tcp://solarlab:4840/solarlab/server/` |
| Solo aparecen algunas claves | Aún no han cambiado todas las variables | Esperar unos segundos o cambiar la irradiancia |
| Aviso `NodeId sin correspondencia` | No se filtran los avisos del cliente | Ignorar los `msg.topic` que no empiezan por `ns=` |
| `alarmActive` llega como texto | Se ha convertido el valor | Publicar el booleano tal cual |
| La escritura no cambia nada | Tipo incorrecto en el `OpcUa-Item` | `Double` para la irradiancia, `Int32` para la avería |
