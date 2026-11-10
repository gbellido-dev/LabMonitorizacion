# Solución docente: reto AtomLab

Acompaña a [`practica-node-red-thingsboard.md`](practica-node-red-thingsboard.md). Flujo resuelto: [`flows/atomlab-thingsboard-flow.json`](flows/atomlab-thingsboard-flow.json).

## Preparación del aula

1. Arrancar el laboratorio y comprobar AtomLab en `http://localhost:8040` (estado **OPERACION**).
2. Crear en ThingsBoard el dispositivo `Central-Reto`, importar el flujo resuelto y pegar el token en el broker **ThingsBoard · Central-Reto**.
3. **Deploy**: en unos segundos aparecen las 18 claves de R1 y R2.
4. Antes de cada grupo: *Escenario* → **Plena potencia** y escala **×1**.

Comprobado en el laboratorio de principio a fin, incluido el escenario de 1986 (resultados abajo).

## R1 y R2 · Indicadores

La suscripción y el **Agrupar** son los de la serie 1 (21 variables, incluido `Servidor.Latido` para que el *delay* siga enviando con la central estable). El nodo **Indicadores**:

```javascript
// ENTRADA: estado de la central agrupado por sistemas (1 mensaje/s)
// SALIDA:  telemetría con medidas e INDICADORES ANTICIPADOS calculados en la pasarela

const r = msg.payload.Reactor || {}, c = msg.payload.CircuitoPrimario || {};
const g = msg.payload.Generador || {}, pr = msg.payload.Proteccion || {};
const ahora = Date.now();

// Tendencia del ORM: recta de mínimos cuadrados con los últimos 3 minutos (barras por minuto)
const enMarcha = pr.Estado === "OPERACION";
let hist = (context.get("orm") || []).filter(m => ahora - m.t < 180000);
if (!enMarcha) hist = [];                                         // tras un disparo o un reinicio, se empieza de cero
else if (typeof r.ORM === "number") hist.push({ t: ahora, v: r.ORM });
context.set("orm", hist);
let pendiente = 0;
if (hist.length > 20) {
    const n = hist.length, mt = hist.reduce((a, m) => a + m.t, 0) / n, mv = hist.reduce((a, m) => a + m.v, 0) / n;
    const num = hist.reduce((a, m) => a + (m.t - mt) * (m.v - mv), 0), den = hist.reduce((a, m) => a + (m.t - mt) ** 2, 0);
    pendiente = den > 0 ? (num / den) * 60000 : 0;                 // barras / minuto (de reloj)
}
const minutosHasta15 = enMarcha && pendiente < -0.01 && r.ORM > 15 ? (r.ORM - 15) / -pendiente : 9999;

msg.payload = { ts: ahora, values: {
    potencia_mwt: r.PotenciaTermica, potencia_mwe: g.PotenciaElectrica, reactividad_beta: r.Reactividad,
    periodo_s: r.Periodo, orm_barras: r.ORM, xenon_rel: r.Xenon, vacio_pct: r.Vacio,
    caudal_kgs: c.Caudal, presion_mpa: c.Presion, nivel_pct: c.NivelSeparadores, bombas: c.BombasEnMarcha,
    estado: pr.Estado, scram: pr.Scram, protecciones: pr.ProteccionesActivas,
    // indicadores
    rendimiento_pct: r.PotenciaTermica > 50 ? Math.round(1000 * g.PotenciaElectrica / r.PotenciaTermica) / 10 : 0,
    orm_tendencia_barras_min: Math.round(pendiente * 100) / 100,
    minutos_hasta_orm15: Math.round(minutosHasta15 * 10) / 10,
    zona_inestable: enMarcha && r.PotenciaTermica < 700
}};
return msg;
```

Puntos que se valoran: la tendencia se **reinicia** tras un disparo o un cambio de escenario (si no, mezcla el ORM de antes y después del SCRAM y da pendientes absurdas); `minutos_hasta_orm15` solo tiene sentido con la central en operación y el ORM bajando.

Valores medidos (1600 MWt, escala ×60): el ORM baja de 30 a unas 19 barras en 4 minutos de reloj por el xenón; la tendencia se estabiliza en torno a **−2 barras/min** y `minutos_hasta_orm15` en **2–3 min**. A escala ×1 la misma bajada es unas 60 veces más lenta (≈ −0,03 barras/min, más de 2 horas hasta 15).

## R3 · Reglas de referencia

| Regla | Argumentos | Crear | Borrar | Severidad |
|---|---|---|---|---|
| ORM bajo | `orm_barras`, `estado` | ORM < 15 **y** estado = `OPERACION`, 5 s | ORM ≥ 15 | Major |
| Agotamiento del margen | `minutos_hasta_orm15` | < 30 durante 30 s | ≥ 60 | Warning |
| Zona inestable | `zona_inestable` | = `true` durante 60 s | = `false` | Major |
| Protecciones anuladas | `protecciones` | = `false` | = `true` | Critical |
| Accidente | `estado` | = `ACCIDENTE` | ≠ `ACCIDENTE` | Critical |
| Sin comunicación | `active` (atributo de servidor) con `inactivityTimeout` = 30000 | = `false` | = `true` | Critical |

Se aceptan otros umbrales si se justifican con los datos medidos. La duración de la regla de agotamiento evita que salte con el ruido de la pendiente justo después de un cambio de potencia.

## R4 · Caja negra

```javascript
// ENTRADA: PotenciaTermica, Reactividad y Proteccion.Estado suscritas cada 250 ms
// SALIDA:  cuando la central dispara (SCRAM o ACCIDENTE), un lote con 10 s ANTES y 10 s DESPUÉS
//          del disparo, cada muestra con su hora  →  v1/devices/me/telemetry

if (!String(msg.topic).startsWith("ns=")) return null;
let valor = msg.payload;
while (valor !== null && typeof valor === "object" && "value" in valor) valor = valor.value;
const variable = String(msg.topic).split(".").pop();
const ahora = Date.now();

const buf = (context.get("buf") || []).filter(m => ahora - m.ts < 20000);   // memoria circular de 20 s
let estado = context.get("estado") || {};

if (variable === "Estado") {
    const disparo = (valor === "SCRAM" || valor === "ACCIDENTE") && estado.ultimo === "OPERACION";
    estado.ultimo = valor;
    if (disparo && !estado.t) { estado.t = ahora; estado.tipo = valor; node.status({ fill: "red", shape: "dot", text: "grabando " + valor }); }
    if (valor === "ACCIDENTE") estado.tipo = "ACCIDENTE";
} else {
    buf.push({ ts: ahora, values: { [variable === "Reactividad" ? "caja_reactividad_beta" : "caja_potencia_mwt"]: valor } });
}
context.set("buf", buf);

if (estado.t && ahora - estado.t > 10000) {                 // 10 s después del disparo: enviar
    const lote = buf.filter(m => m.ts >= estado.t - 10000);
    lote.push({ ts: estado.t, values: { suceso: estado.tipo, suceso_muestras: lote.length } });
    node.status({ fill: "green", shape: "dot", text: lote.length + " muestras enviadas" });
    estado = { ultimo: estado.ultimo };
    context.set("estado", estado);
    return { payload: lote };
}
context.set("estado", estado);
return null;
```

Resultado en el laboratorio (escenario de 1986): un único lote con **155 muestras** (78 de potencia y 77 de reactividad) y el suceso `ACCIDENTE`. Pico registrado ≈ **25,8 GW** y reactividad máxima ≈ **1,65 β**; el pico real (`Reactor.PicoPotencia`) fue ≈ **40 GW**. El servidor OPC UA publica cada 250 ms y la excursión dura menos de un segundo: la caja negra ve la subida, pero no el máximo.

Errores típicos: enviar el lote **antes** de los 10 s posteriores (se pierde la parte del accidente); no filtrar los avisos del cliente (`subscriptionId`); detectar el disparo por el booleano `Scram` y no por el cambio de estado (no distingue SCRAM de accidente).

## R5 · Enclavamientos

Salida 1 → **OpcUa-Client** `WRITE`; salida 2 → respuesta RPC; salida 3 → auditoría (telemetría). Lee el estado de la central del contexto que guarda **Agrupar** (`flow.get("central")`), por eso tiene que estar en la misma pestaña.

```javascript
// ENTRADA: petición RPC de ThingsBoard · ENCLAVAMIENTOS antes de escribir en la central
// SALIDA 1: escritura OPC UA · SALIDA 2: respuesta RPC · SALIDA 3: auditoría

const id = msg.topic.split("/").pop(), metodo = msg.payload.method, valor = msg.payload.params;
const central = flow.get("central") || {};
const r = central.Reactor || {}, pr = central.Proteccion || {};

function respuesta(ok, texto, escritura) {
    return [escritura || null,
            { topic: "v1/devices/me/rpc/response/" + id, payload: ok ? { ok: true, orden: texto } : { ok: false, error: texto } },
            { payload: { ts: Date.now(), values: { orden_metodo: metodo, orden_valor: JSON.stringify(valor ?? null),
                                                   orden_resultado: ok ? "aceptada" : "rechazada: " + texto } } }];
}

if (metodo === "az5") {                                     // la parada de emergencia NUNCA se bloquea
    return respuesta(true, "AZ-5", { topic: "ns=2;s=Mandos.AZ5", datatype: "Boolean", payload: true });
}
if (metodo === "setPotencia") {
    const mwt = Number(valor);
    if (!Number.isFinite(mwt) || mwt < 0 || mwt > 3200) return respuesta(false, "Fuera de rango (0-3200 MWt)");
    if (mwt > 0 && mwt < 700) return respuesta(false, "Por debajo de 700 MWt el RBMK es inestable: no se permite operar ahí");
    if (r.ORM < 15 && mwt > r.ConsignaActual) return respuesta(false, "ORM < 15: no se permite subir potencia");
    return respuesta(true, "consigna " + mwt + " MWt", { topic: "ns=2;s=Mandos.ConsignaPotencia", datatype: "Double", payload: mwt });
}
if (metodo === "pruebaInercia") {
    const faltan = [];
    if (pr.Estado !== "OPERACION") faltan.push("central en operación");
    if (!(r.PotenciaTermica >= 700)) faltan.push("potencia ≥ 700 MWt");
    if (!(r.ORM >= 15)) faltan.push("ORM ≥ 15");
    if (pr.ProteccionesActivas !== true) faltan.push("protecciones activas");
    if (faltan.length) return respuesta(false, "Enclavamiento: falta " + faltan.join(", "));
    return respuesta(true, "prueba de inercia", { topic: "ns=2;s=Mandos.PruebaInercia", datatype: "Boolean", payload: true });
}
return respuesta(false, "Orden desconocida: " + metodo);
```

Resultados en el laboratorio:

| Situación | Orden | Respuesta |
|---|---|---|
| Plena potencia | `setPotencia 500` | `Por debajo de 700 MWt el RBMK es inestable: no se permite operar ahí` |
| Plena potencia | `setPotencia 2400` | aceptada; AtomLab muestra consigna 2400 |
| 26-04-1986 | `pruebaInercia` | `Enclavamiento: falta potencia ≥ 700 MWt, ORM ≥ 15, protecciones activas` |
| 26-04-1986 | `setPotencia 1000` | `ORM < 15: no se permite subir potencia` |
| 26-04-1986 tras la prueba | `az5` | aceptada (y la central estalla: la orden llega, pero ya es tarde) |

## R7 · Cronología esperada del 26-04-1986

| Momento | Lo que debe registrar el sistema |
|---|---|
| Carga del escenario (t = 0) | Protecciones anuladas (inmediata), ORM bajo (≈ 5 s, ORM 0,3), estado en operación a ≈ 200 MWt |
| t ≈ 60 s | Zona inestable (60 s por debajo de 700 MWt) |
| Prueba desde el panel | **Rechazada** con tres condiciones que faltan |
| Prueba desde la web de AtomLab | Sin aviso del sistema: el camino no pasa por la pasarela |
| AZ-5 desde el panel | Aceptada; a los ≈ 2 s, Accidente; 10 s después, lote de la caja negra |

## Preguntas finales · Orientación

1. Las alarmas de **configuración** (protecciones anuladas, ORM bajo) estaban activas desde el principio: el sistema avisaba con toda la antelación del escenario. La primera es **Protecciones anuladas**.
2. El enclavamiento de la pasarela solo bloquea las órdenes que pasan por ella: la prueba desde la web lo salta. Un enclavamiento de seguridad real tiene que estar en el **sistema de control y protección** de la central (cableado, independiente y redundante), nunca en una pasarela IT ni en la nube.
3. Lo que explica un disparo es lo que pasó **antes** (en 1986, la caída de caudal y la subida de reactividad antes del AZ-5).
4. ≈ 26 GW frente a ≈ 40 GW. Lo limitan el periodo de publicación del servidor (250 ms), el muestreo de la suscripción y la propia rapidez del fenómeno.
5. Una recta de 3 minutos reacciona tarde a cambios bruscos y se dispara con el ruido justo después de un escalón de potencia. Mejoras: ventana adaptativa, filtrar antes de derivar, exigir duración, o usar el modelo del xenón (se conoce cómo evoluciona tras un cambio de potencia).
