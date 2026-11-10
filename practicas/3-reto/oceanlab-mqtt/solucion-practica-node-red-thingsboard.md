# Solución docente: OceanLab, Node-RED y ThingsBoard

Este documento acompaña a `practica-node-red-thingsboard.md`. El flujo completo está en `flows/oceanlab-thingsboard-flow.json`.

## Preparación del aula

1. Arrancar el laboratorio y comprobar OceanLab en `http://localhost:8020` (publica en Mosquitto).
2. Abrir Node-RED en `http://localhost:1880` e importar el flujo de solución.
3. Ya trae los hosts del laboratorio: **OceanLab MQTT** → `mosquitto:1883`; **ThingsBoard MQTT** → `thingsboard:1883`.
4. Crear en ThingsBoard el dispositivo `Boya-Aula-01` y pegar su access token como **Username** del broker de ThingsBoard.
5. Desplegar y comprobar **Latest telemetry**.

Los nodos MQTT son parte de la instalación estándar de Node-RED. El flujo exportado no contiene credenciales.

## Transformación esperada

El nodo **Validar BOY-001 y transformar** contiene:

```javascript
const p = msg.payload;
if (!p || typeof p !== "object" || Array.isArray(p)) {
    node.warn("Payload no válido");
    return null;
}
if (p.buoy_id !== "BOY-001") return null;
if (!p.weather || !p.device || !p.location) {
    node.warn("Estructura incompleta");
    return null;
}

const required = [
    p.weather.wave_height_m,
    p.weather.wind_speed_mps,
    p.device.battery_pct
];
if (!required.every(Number.isFinite)) {
    node.warn("Magnitudes obligatorias no numéricas");
    return null;
}

msg.payload = {
    water_temperature_c: p.weather.water_temperature_c,
    air_temperature_c: p.weather.air_temperature_c,
    wave_height_m: p.weather.wave_height_m,
    wind_speed_mps: p.weather.wind_speed_mps,
    wind_direction_deg: p.weather.wind_direction_deg,
    pressure_hpa: p.weather.pressure_hpa,
    humidity_pct: p.weather.humidity_pct,
    battery_pct: p.device.battery_pct,
    signal_rssi_dbm: p.device.signal_rssi_dbm,
    status: p.device.status,
    latitude: p.location.latitude,
    longitude: p.location.longitude,
    ocean: p.location.ocean,
    sequence: p.sequence
};
return msg;
```

Para asignar otra boya, se cambia una única línea:

```javascript
if (p.buoy_id !== "BOY-017") return null;
```

## Configuración MQTT esperada

### Entrada OceanLab

- Broker: `mosquitto` (el broker único del laboratorio, donde publica OceanLab).
- Puerto: `1883`.
- Protocolo: MQTT 3.1.1.
- Autenticación: ninguna dentro de la red de prácticas.
- Topic: `oceanlab/buoys/+/telemetry`.
- QoS inicial: 0.
- Salida: objeto JSON analizado.

### Salida ThingsBoard

- Host: instancia ThingsBoard.
- Puerto: `1883` o `8883` con TLS.
- Protocolo: MQTT 3.1.1.
- Username: access token del dispositivo.
- Password: vacío.
- Topic: `v1/devices/me/telemetry`.
- QoS: 0.
- Retain: desactivado.

## Resultados esperados

### Tormenta

- `wave_height_m` salta aproximadamente a 8,4 m.
- `wind_speed_mps` sube aproximadamente a 29 m/s.
- `pressure_hpa` baja aproximadamente a 975 hPa.
- La alarma `Oleaje peligroso` aparece tras cumplirse la duración.

### Restablecimiento

- La altura de ola vuelve aproximadamente a 1,4 m.
- La condición de borrado debe mantenerse 10 segundos.
- La histéresis 6/4 evita cambios repetidos cerca del umbral.

### Desconexión

- OceanLab deja de publicar el topic de telemetría de esa boya.
- ThingsBoard mantiene el último punto recibido.
- Sin LWT o regla de inactividad, el consumidor no puede distinguir inmediatamente entre una estación estable y una estación desconectada.

## Solución de la ampliación gateway

El nodo function puede producir el formato gateway así:

```javascript
const p = msg.payload;
if (!p?.buoy_id || !p.weather || !p.device) return null;

const timestamp = Date.parse(p.timestamp);
if (!Number.isFinite(timestamp)) return null;

msg.payload = {
    [p.buoy_id]: [{
        ts: timestamp,
        values: {
            water_temperature_c: p.weather.water_temperature_c,
            wave_height_m: p.weather.wave_height_m,
            wind_speed_mps: p.weather.wind_speed_mps,
            pressure_hpa: p.weather.pressure_hpa,
            battery_pct: p.device.battery_pct,
            status: p.device.status
        }
    }]
};
msg.topic = "v1/gateway/telemetry";
return msg;
```

En este caso las credenciales deben pertenecer a un dispositivo marcado como gateway.

## Respuestas orientativas

1. `+` sustituye exactamente un nivel; `#` sustituye cero o más niveles y solo puede aparecer al final del filtro.
2. QoS 0 no confirma la entrega; QoS 1 usa confirmación y reintento, por lo que puede entregar duplicados.
3. `retain` es útil para estado o configuración, pero un valor retenido puede parecer actual aunque el dispositivo lleve tiempo desconectado.
4. El broker desacopla emisores y consumidores en dirección, tiempo y ritmo de procesamiento.
5. ThingsBoard conserva el último dato porque no recibe un nuevo evento que lo cambie; el estado de conectividad debe modelarse explícitamente.
6. Un broker anónimo público permite lectura, inyección o saturación de topics. En producción requiere autenticación, autorización, TLS, límites y auditoría.

## Problemas frecuentes

| Síntoma | Causa probable | Comprobación |
|---|---|---|
| MQTT in desconectado | host incorrecto o broker parado | comprobar `mosquitto:1883` y que OceanLab está en marcha |
| Llegan cadenas en vez de objetos | salida del nodo MQTT configurada como texto | añadir nodo `json` |
| No sale nada del function | boya asignada distinta | revisar `p.buoy_id` |
| ThingsBoard desconectado | token usado como contraseña | token debe ir en Username |
| No hay históricos numéricos | valores enviados con unidades | enviar números puros |
| La alarma no se borra | no se cumple tiempo/umbral de borrado | revisar histéresis y esperar 10 s |

