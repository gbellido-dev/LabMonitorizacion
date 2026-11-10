# Solución docente: Node-RED y ThingsBoard

Este documento acompaña a `practica-node-red-thingsboard.md`. El flujo completo importable está en `flows/aerolab-thingsboard-flow.json`.

## Preparación rápida del aula

1. Iniciar AeroLab y comprobar `http://localhost:8010` y Modbus TCP en `1502`.
2. Iniciar Node-RED, normalmente en `http://localhost:1880`.
3. Instalar `node-red-contrib-modbus` desde **Manage palette**.
4. Importar el flujo de solución.
5. Editar únicamente estos dos nodos de configuración:
   - **AeroLab Modbus TCP:** host del simulador.
   - **ThingsBoard MQTT:** host, puerto y access token como nombre de usuario.
6. Crear el dispositivo `Aerogenerador-Aula` en ThingsBoard.
7. Desplegar y verificar **Latest telemetry** antes de construir el dashboard.

El flujo no contiene credenciales. Node-RED guarda el usuario y la contraseña MQTT en su fichero de credenciales local, no en el JSON exportado.

## Decodificación esperada

### Input registers

```javascript
const r = Array.isArray(msg.payload) ? msg.payload : msg.payload?.data;
if (!Array.isArray(r) || r.length < 16) {
    node.error("Se esperaban 16 input registers", msg);
    return null;
}

const int16 = (value) => value >= 0x8000 ? value - 0x10000 : value;
const uint32be = (high, low) => high * 65536 + low;
const stateNames = ["Parado", "Arrancando", "En marcha", "Frenando", "Avería"];
const faultNames = [
    "Sin avería",
    "Sobretemperatura de rodamiento",
    "Vibración elevada",
    "Pérdida de red",
    "Sobrevelocidad"
];

msg.payload = {
    wind_speed_mps: r[0] / 10,
    rotor_rpm: r[1] / 100,
    pitch_deg: r[2] / 100,
    active_power_kw: uint32be(r[3], r[4]),
    wind_direction_deg: r[5] / 10,
    nacelle_yaw_deg: r[6] / 10,
    vibration_mms: r[7] / 100,
    bearing_temperature_c: int16(r[8]) / 10,
    gearbox_temperature_c: int16(r[9]) / 10,
    generator_rpm: r[10],
    torque_nm: r[11] * 10,
    energy_kwh: uint32be(r[12], r[13]) / 10,
    operating_state: r[14],
    operating_state_name: stateNames[r[14]] ?? "Desconocido",
    fault_code: r[15],
    fault_name: faultNames[r[15]] ?? "Desconocida"
};
return msg;
```

La multiplicación por 65536 se usa deliberadamente en lugar de `high << 16`: los operadores binarios de JavaScript trabajan con enteros con signo de 32 bits.

### Discrete inputs

```javascript
const d = Array.isArray(msg.payload) ? msg.payload : msg.payload?.data;
if (!Array.isArray(d) || d.length < 5) {
    node.error("Se esperaban 5 discrete inputs", msg);
    return null;
}

msg.payload = {
    ready: Boolean(d[0]),
    running: Boolean(d[1]),
    alarm: Boolean(d[2]),
    grid_connected: Boolean(d[3]),
    wind_ok: Boolean(d[4])
};
return msg;
```

## Publicación MQTT esperada

- Host: instancia ThingsBoard.
- Puerto: `1883` sin TLS o `8883` con TLS correctamente configurado.
- Protocolo: MQTT 3.1.1.
- Username: access token del dispositivo.
- Password: vacío.
- Topic: `v1/devices/me/telemetry`.
- QoS: 0 para la práctica.
- Retain: desactivado.
- Payload: JSON de claves y valores.

El flujo envía dos mensajes por ciclo: magnitudes analógicas y estados booleanos. ThingsBoard consolida las claves como telemetría del mismo dispositivo.

## Escrituras Modbus incluidas

El flujo de solución utiliza `modbus-flex-write` y forma estas solicitudes:

```javascript
// Coil 00001, offset 0: orden de marcha
msg.payload = {
    value: Boolean(msg.payload),
    fc: 5,
    unitid: 1,
    address: 0,
    quantity: 1
};
```

```javascript
// Holding Register 40006, offset 5: código de avería
const fault = Number(msg.payload);
if (!Number.isInteger(fault) || fault < 0 || fault > 4) {
    node.error("Código de avería fuera de rango 0…4", msg);
    return null;
}
msg.payload = {
    value: [fault],
    fc: 16,
    unitid: 1,
    address: 5,
    quantity: 1
};
```

## Dashboard de referencia

Una distribución útil para proyectar en clase es:

```text
┌──────────────────── Producción ────────────────────┐
│ Potencia y viento       │ Rotor y generador        │
├──────────── Condición de máquina ──────────────────┤
│ Vibración               │ Temperaturas             │
├──────────────── Estado y diagnóstico ──────────────┤
│ Estado / avería         │ Red / alarma │ Alarmas   │
└─────────────────────────────────────────────────────┘
```

Configurar una ventana global de 10 minutos permite ver la respuesta completa de los ensayos sin acumular demasiado histórico.

## Regla de alarma de referencia

Para ThingsBoard 4.3 o posterior:

1. **Alarms → Alarm rules → Add alarm rule → Create new alarm rule**.
2. Tipo `Vibración elevada` y entidad `Aerogenerador-Aula`.
3. Argumento `vibration`: **Current entity → Latest telemetry → vibration_mms**.
4. Condición Major: `vibration > 7`, tipo **Duration**, 5 segundos.
5. Clear condition: `vibration < 6`, tipo **Duration**, 5 segundos.

La histéresis 7/6 evita alternancias rápidas cerca del umbral y permite borrar la alarma con carga nominal normal. En ThingsBoard anterior a 4.3 se puede crear la condición equivalente en el perfil de dispositivo.

## Resultados esperados de los ensayos

### Vibración elevada, código 2

- `fault_code` cambia a 2 y `fault_name` a `Vibración elevada`.
- `alarm` pasa a `true` y el estado operativo a `Avería`.
- La orden de protección lleva el pitch hacia 86°.
- RPM y potencia descienden; la vibración se aproxima progresivamente a 12,5 mm/s.
- ThingsBoard dispara la alarma cuando se cumplen umbral y duración.

### Pérdida de red, código 3

- `grid_connected` pasa a `false`.
- `fault_code` cambia a 3, `alarm` pasa a `true` y la potencia cae a cero.
- La diferencia principal respecto a vibración es que la pérdida de red se observa de inmediato en una señal discreta, mientras la vibración tiene dinámica gradual.

Al retirar la avería con código 0, las variables vuelven gradualmente a normal. La alarma de ThingsBoard se borra cuando la vibración permanece por debajo de 6 mm/s durante 5 segundos.

## Respuestas orientativas

1. **30001 y offset 0:** 30001 es una referencia humana que identifica la tabla de input registers; el campo dirección de la PDU contiene el offset cero.
2. **Palabras intercambiadas:** el valor queda multiplicado/dividido aproximadamente por 65536 según los datos y deja de guardar relación con la potencia observada.
3. **Sondeo frente a publicación:** Modbus es petición/respuesta y Node-RED pregunta periódicamente; MQTT desacopla productor y consumidor y entrega publicaciones mediante un broker.
4. **Node-RED detenido:** no llegan nuevos puntos; ThingsBoard conserva el histórico previo y muestra como último valor el dato anterior hasta que se detecte inactividad o se reanude la publicación.
5. **Escritura segura:** autenticación, autorización por rol, TLS, lista de órdenes permitidas, límites y enclavamientos locales, auditoría, confirmación y parada segura ante pérdida de comunicación.

## Diagnóstico rápido

| Síntoma | Causa probable | Comprobación |
|---|---|---|
| `Connection refused` en Modbus | AeroLab apagado, host o puerto incorrecto | abrir la web y comprobar TCP 1502 |
| Datos Modbus constantes en cero | tabla o función equivocada | `InputRegister`, offset 0, cantidad 16, Unit ID 1 |
| Potencia absurda | orden de palabras incorrecto | palabra 3 alta, palabra 4 baja |
| MQTT `bad username or password` | token ausente o incorrecto | pegar access token como Username, contraseña vacía |
| MQTT conectado pero sin telemetría | topic o payload erróneo | topic exacto y JSON válido |
| ThingsBoard recibe números como texto | se añadieron unidades al valor | enviar número y definir unidad en el widget |
| Alarma no se borra | falta clear condition o vibración aún alta | comprobar condición `< 6` y esperar la dinámica |
