# Solución docente: reto ReactorLab

Acompaña a [`practica-node-red-thingsboard.md`](practica-node-red-thingsboard.md). Flujo resuelto: [`flows/reactorlab-thingsboard-flow.json`](flows/reactorlab-thingsboard-flow.json).

## Preparación del aula

1. Arrancar el laboratorio y comprobar ReactorLab en `http://localhost:8030`.
2. Crear en ThingsBoard el dispositivo `Reactor-Reto` y copiar su token.
3. Importar el flujo resuelto. En la pestaña, **Edit → Environment variables**: `REACTORLAB_KEY` (tipo credencial) = `reactorlab`. En el broker **ThingsBoard · Reactor-Reto**, el token como *Username*.
4. **Deploy**. En unos segundos aparecen 21 claves de telemetría y 6 atributos; en el debug **Alta webhook** llega `201` (o `200` si ya existía).

Comprobado en el laboratorio: las 21 claves, la ficha, los eventos por webhook, las seis órdenes de prueba de R7 y las tres reglas de R6 con las averías de la tabla de R8.

## R1 · Comparación esperada

| Mecanismo | Retraso típico | Peticiones/min | Si ReactorLab se reinicia | Valoración |
|---|---|---|---|---|
| Polling REST cada 1 s | ≤ 1 s + petición | 60 | Errores mientras está caído; se recupera solo | Válido, pero en el límite de tráfico de R1 |
| WebSocket | ≤ 1 s (la planta empuja cada 1 s) | 0 (una conexión) | El nodo reconecta solo | **Recomendado** para la telemetría |
| SSE | inmediato, pero solo **eventos** | 0 (una conexión) | El navegador reconecta; en Node-RED hace falta un nodo extra o una petición *streaming* | Bueno para eventos, no trae medidas periódicas |
| Webhook | inmediato, solo eventos | 0 (ReactorLab llama) | Hay que repetir el alta (idempotente) | **Recomendado** para eventos; Node-RED debe ser alcanzable |

La solución usa **WebSocket** para la telemetría y **webhook** para los eventos. Cualquier otra combinación que cumpla los requisitos y esté bien justificada es correcta (por ejemplo, polling a 1 s + SSE).

## Código de referencia

**Comprobar respuesta** (sirve para REST y WebSocket):

```javascript
// ENTRADA: la respuesta de ReactorLab (por HTTP o, más adelante, por WebSocket)
//   msg.statusCode = código HTTP (200 = correcto). Por WebSocket no existe.
//   msg.payload    = el estado de la planta en JSON
// SALIDA:  el mismo mensaje, solo si la respuesta es correcta

if (msg.statusCode !== undefined && msg.statusCode !== 200) {
    node.status({ fill: "red", shape: "dot", text: "HTTP " + msg.statusCode });
    return null;                          // 404, 500, ECONNREFUSED... no seguimos
}
if (typeof msg.payload !== "object" || !msg.payload.medidas) {
    node.status({ fill: "red", shape: "ring", text: "respuesta no válida" });
    return null;
}
node.status({ fill: "green", shape: "dot", text: "secuencia " + msg.payload.secuencia });
return msg;
```

**Telemetría** (R2 y R3: claves planas y hora de la planta):

```javascript
// ENTRADA: estado completo de ReactorLab (por WebSocket, ya comprobado)
// SALIDA:  { ts, values } con claves planas; ts = hora de la PLANTA

const p = msg.payload, m = p.medidas, v = p.valvulas, c = p.consignas, e = p.estado;
msg.payload = {
    ts: Date.parse(p.timestamp),
    values: {
        presion_kpa: m.presion_kpa,          nivel_pct: m.nivel_pct,
        caudal_f1_kmolh: m.caudal_kmolh.f1,  caudal_f2_kmolh: m.caudal_kmolh.f2,
        caudal_purga_kmolh: m.caudal_kmolh.purga, caudal_producto_kmolh: m.caudal_kmolh.producto,
        a_purga_pct: m.composicion_purga_pct.A, coste_relativo: m.coste_relativo,
        valvula_f1_pct: v.f1.posicion_pct,   valvula_f2_pct: v.f2.posicion_pct,
        valvula_purga_pct: v.purga.posicion_pct, valvula_producto_pct: v.producto.posicion_pct,
        sp_presion_kpa: c.presion_kpa,       sp_produccion_kmolh: c.caudal_producto_kmolh,
        sp_a_purga_pct: c.a_purga_pct,       sp_nivel_pct: c.nivel_pct,
        modo: e.modo, en_marcha: e.en_marcha, paro_emergencia: e.paro_emergencia,
        alarmas_activas: e.alarmas_activas,  secuencia: p.secuencia
    }
};
return msg;
```

**Ficha** (atributos a partir de `GET /api/v1/info`):

```javascript
// ENTRADA: GET /api/v1/info de ReactorLab
// SALIDA:  atributos de cliente para ThingsBoard

if (msg.statusCode !== 200) { node.status({ fill: "red", shape: "dot", text: "info HTTP " + msg.statusCode }); return null; }
const i = msg.payload;
msg.payload = {
    planta: i.planta, descripcion: i.descripcion, version: i.version,
    escala_tiempo: i.escala_tiempo, api: "http://reactorlab:8030/docs", pasarela: "Node-RED"
};
return msg;
```

**Alta del webhook** (R4; se repite cada 10 min, la planta reconoce la URL y no la duplica):

```javascript
// SALIDA: alta (idempotente) del webhook que avisa a este Node-RED
// La clave NO está en el código: variable de entorno REACTORLAB_KEY de la pestaña (tipo credencial)

msg.method  = "POST";
msg.url     = "http://reactorlab:8030/api/v1/webhooks";
msg.headers = { "X-API-Key": env.get("REACTORLAB_KEY"), "Content-Type": "application/json" };
msg.payload = {
    url: "http://nodered:1880/reto/reactorlab/eventos",
    eventos: ["alarma", "averia", "consigna", "estado"]
};
return msg;
```

**Evento → telemetría** (el `http in` `/reto/reactorlab/eventos` responde siempre `200`):

```javascript
// ENTRADA: aviso de ReactorLab (webhook) · SALIDA: telemetría de evento con la hora del evento

const ev = msg.payload;
let detalle = "";
if (ev.alarma)           detalle = ev.alarma.codigo + " · " + ev.alarma.texto;
else if (ev.consignas)   detalle = JSON.stringify(ev.consignas);
else if (ev.modo)        detalle = "modo " + ev.modo;
else if ("activo" in ev) detalle = ev.activo ? "paro de emergencia" : "paro rearmado";
else if ("en_marcha" in ev) detalle = ev.en_marcha ? "planta en marcha" : "planta parada";
else if (ev.averia)      detalle = ev.averia.tipo + " " + (ev.averia.objetivo || "");

return { payload: { ts: Date.parse(ev.timestamp), values: { evento: ev.evento, evento_detalle: detalle } } };
```

**Validar orden** (R7; salida 1 → `http request` con *Method* `- set by msg.method -`, salida 2 → respuesta RPC):

```javascript
// ENTRADA: petición RPC de ThingsBoard (v1/devices/me/rpc/request/{id})
// SALIDA 1: petición HTTP para ReactorLab · SALIDA 2: respuesta de rechazo para ThingsBoard

const id = msg.topic.split("/").pop();
const metodo = msg.payload.method, valor = msg.payload.params;
const LIMITES = { setPresion: ["presion_kpa", 2500, 2950], setProduccion: ["caudal_producto_kmolh", 60, 110] };

function rechazo(motivo) {
    return [null, { topic: "v1/devices/me/rpc/response/" + id, payload: { ok: false, error: motivo } }];
}
const base = { rpcId: id, rpcMetodo: metodo, rpcValor: valor,
               headers: { "X-API-Key": env.get("REACTORLAB_KEY"), "Content-Type": "application/json" } };

if (LIMITES[metodo]) {
    const [clave, min, max] = LIMITES[metodo];
    const x = Number(valor);
    if (!Number.isFinite(x) || x < min || x > max) return rechazo(`Fuera de rango (${min}-${max})`);
    return [Object.assign(base, { method: "PUT", url: "http://reactorlab:8030/api/v1/consignas",
                                  payload: { [clave]: x } }), null];
}
if (metodo === "paroEmergencia") {
    if (typeof valor !== "boolean") return rechazo("El parámetro debe ser true o false");
    return [Object.assign(base, { method: "POST", url: "http://reactorlab:8030/api/v1/paro-emergencia",
                                  payload: { activo: valor } }), null];
}
return rechazo("Orden desconocida: " + metodo);
```

**Responder y auditar** (salida 1 → respuesta RPC, salida 2 → telemetría de auditoría):

```javascript
// ENTRADA: respuesta de ReactorLab a la orden
// SALIDA 1: respuesta RPC a ThingsBoard · SALIDA 2: registro de auditoría (telemetría)

const ok = msg.statusCode === 200;
const resultado = ok ? "aceptada" : "rechazada HTTP " + msg.statusCode;
return [
    { topic: "v1/devices/me/rpc/response/" + msg.rpcId,
      payload: ok ? { ok: true } : { ok: false, http: msg.statusCode, error: msg.payload && msg.payload.detail } },
    { payload: { ts: Date.now(), values: {
        orden_metodo: msg.rpcMetodo, orden_valor: JSON.stringify(msg.rpcValor), orden_resultado: resultado } } }
];
```

Resultados de las órdenes en el laboratorio:

| Orden RPC | Respuesta | Auditoría (`orden_resultado`) |
|---|---|---|
| `setPresion 2750` | `{"ok": true}` | aceptada |
| `setPresion 3200` | `{"ok": false, "error": "Fuera de rango (2500-2950)"}` | — (no llega a la planta) |
| `setProduccion "x"` | `{"ok": false, "error": "Fuera de rango (60-110)"}` | — |
| `paroEmergencia true` / `false` | `{"ok": true}` | aceptada |
| `hola 1` | `{"ok": false, "error": "Orden desconocida: hola"}` | — |

> Variante válida: registrar también las órdenes rechazadas en la auditoría.

## R2 · Comunicación perdida

- Atributo de servidor `inactivityTimeout` = `30000` en `Reactor-Reto` y regla `Sin comunicación` (`active` = `false`, **Critical**), como en la serie 2.
- El nodo **Comprobar respuesta** pone su estado en rojo con el código HTTP; con WebSocket, el estado del nodo `websocket in` muestra la desconexión.

## R6 · Reglas de referencia

| Regla | Argumento | Crear | Borrar | Qué detecta |
|---|---|---|---|---|
| Presión alta (Major) | `presion_kpa` | `> 2850` durante 10 s | `< 2800` | El proceso ya se está saliendo |
| Válvula de producto forzada (Warning) | `valvula_producto_pct` | `> 70` durante 30 s | `< 60` | El lazo de nivel trabaja de más: válvula sucia u obstrucción aguas abajo |
| Coste anómalo (Warning) | `coste_relativo` | `> 0.4` durante 30 s | `< 0.3` | El proceso consume de más para mantener las medidas: sensor en deriva o congelado |

Valores normales: válvula de producto ≈ 47 %, coste ≈ 0,23–0,24. Comprobado: con la válvula de producto al 60 % de su capacidad la válvula sube a ≈ 78 % y salta la segunda regla; con la deriva del sensor de presión el coste pasa a ≈ 0,65 y salta la tercera. Las dos se borran al quitar la avería.

Otras reglas válidas: válvula de purga `> 2 %` sostenida (normal ≈ 0,4 %); producción `< 95` con presión en consigna; diferencia entre `sp_a_purga_pct` y `a_purga_pct` mayor de 1 punto durante 2 minutos (detecta la válvula F2 atascada **después** de un cambio de consigna).

## R8 · Firmas de las averías

Medidas en el laboratorio partiendo del estado normal (presión 2700 kPa, nivel 44 %, producción 100 kmol/h, A 47 %, válvulas F1 31 % · F2 13 % · purga 0,4 % · producto 47 %, coste 0,23), 45 s reales después (= 90 min de proceso).

| Avería | Medidas | Esfuerzo del control | Cómo se confirma | Orden de trabajo |
|---|---|---|---|---|
| Válvula de producto sucia (60 % de Cv) | Todo en consigna | Válvula de producto **47 → 78 %** | Alarma de válvula forzada | Limpiar o sustituir la válvula de producto |
| Válvula de purga sucia (50 % de Cv) | Todo en consigna | Válvula de purga 0,4 → 0,8 % | Cambiar la consigna de presión: la purga necesita abrir el doble | Limpiar la válvula de purga |
| Válvula F2 atascada | Todo en consigna | F2 inmóvil | **Provocar**: subir la consigna de A en la purga a 51 %. Sin avería llega en ≈ 25 s; atascada, A se queda en 47 % y F2 no se mueve | Revisar actuador y posicionador de F2 |
| Válvula de purga lenta (20 %/h) | Todo en consigna | — | **Provocar**: bajar la consigna de presión a 2600 kPa. Sin avería llega en ≈ 12 s; lenta, la presión oscila (bajada a ≈ 2360 kPa) y la producción cae a ≈ 80 kmol/h | Revisar el actuador de la purga |
| Sensor de presión en deriva (+50 kPa/h) | Presión «perfecta» en 2700 | F1 sube, producción baja a ≈ 97 | **Coste ×3 (≈ 0,65)**: el control mantiene una lectura falsa | Calibrar el transmisor de presión |
| Sensor de nivel congelado | Nivel fijo en 44,0 % | Válvula de producto baja a ≈ 43 %, F1 sube | El nivel **no varía nada**, ni con ruido; coste ≈ 0,5 | Revisar el transmisor de nivel |

Idea clave para la corrección: las averías de **válvula** se ven en el esfuerzo del control o al provocar un cambio; las de **sensor**, en el coste y en la incoherencia entre variables (presión perfecta con producción baja, nivel sin ninguna variación).

## Preguntas finales · Orientación

1. Si la red o la pasarela se retrasan o se envían lotes, la hora de llegada desordena los sucesos y falsea las duraciones de las alarmas.
2. El webhook no mantiene conexiones abiertas y es inmediato; a cambio, el emisor necesita **alcanzar** al receptor (abrir un puerto entrante hacia la pasarela).
3. Vigilan el **esfuerzo** que hace el control para mantener la medida, que cambia antes de que la medida se salga.
4. En un almacén de secretos o como credencial cifrada de Node-RED (nunca en el código); el registro, el responsable de la instalación y auditoría, con acceso de solo lectura.
5. Defensa en profundidad: la pasarela responde al instante con un motivo claro, evita tráfico inútil y protege si otra planta no valida.
