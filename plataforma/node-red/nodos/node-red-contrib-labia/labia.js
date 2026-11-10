// Nodos de la capa de IA del laboratorio. Hablan con el servicio "ia"
// (plataforma/ia) por su API REST; no contienen ningún modelo.
module.exports = function (RED) {
    "use strict";

    async function llamar(url, ruta, cuerpo, query) {
        const qs = query ? "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== "")).toString() : "";
        const r = await fetch(url.replace(/\/+$/, "") + ruta + qs, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cuerpo),
            signal: AbortSignal.timeout(10000)
        });
        const texto = await r.text();
        let datos;
        try { datos = JSON.parse(texto); } catch (e) { datos = texto; }
        if (!r.ok) {
            const det = datos && datos.detail ? (typeof datos.detail === "string" ? datos.detail : JSON.stringify(datos.detail)) : texto;
            const err = new Error(`IA ${r.status}: ${det}`);
            err.status = r.status;
            throw err;
        }
        return datos;
    }

    function servidor(n) {
        const s = RED.nodes.getNode(n.servidor);
        return s ? s.url : "http://ia:8000";
    }

    // "2026-11-10T19:31:00.267", hora local sin zona (como la que pone el servicio)
    function horaLocal() {
        const d = new Date();
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
    }

    function esObjeto(p) {
        return p !== null && typeof p === "object";
    }

    // Une el resultado del modelo a la lectura original (con prefijo opcional)
    function unir(entrada, resultado, prefijo) {
        const fuera = Object.assign({}, entrada);
        for (const [k, v] of Object.entries(resultado)) {
            if (k === "modelo" || k === "version") continue;
            fuera[prefijo + k] = v;
        }
        return fuera;
    }

    // ── servidor (configuración) ───────────────────────────────────────────
    function IaServidor(n) {
        RED.nodes.createNode(this, n);
        this.url = n.url || "http://ia:8000";
    }
    RED.nodes.registerType("ia-servidor", IaServidor);

    // ── ia registrar ───────────────────────────────────────────────────────
    function IaRegistrar(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        const lote = Math.max(1, parseInt(n.lote, 10) || 1);
        let pendientes = [];
        node.on("input", async function (msg, send, done) {
            const conjunto = msg.conjunto || n.conjunto;
            if (!conjunto) { done(new Error("Indica el conjunto de datos (propiedad del nodo o msg.conjunto)")); return; }
            if (!esObjeto(msg.payload)) { done(new Error("msg.payload debe ser un objeto con las lecturas")); return; }
            // cada lectura con SU hora (si no la trae): con lotes, el servicio recibiría todas a la vez
            const ahora = horaLocal();
            const filas = (Array.isArray(msg.payload) ? msg.payload : [msg.payload])
                .map((f) => (f.ts === undefined ? Object.assign({ ts: ahora }, f) : f));
            pendientes = pendientes.concat(filas);
            if (pendientes.length < lote) {
                node.status({ fill: "grey", shape: "ring", text: `${pendientes.length}/${lote} en espera` });
                send(msg); done(); return;
            }
            const envio = pendientes; pendientes = [];
            try {
                const r = await llamar(servidor(n), "/datos/" + encodeURIComponent(conjunto), envio);
                node.status({ fill: "green", shape: "dot", text: `${conjunto}: ${r.filas} filas` });
                msg.ia = r;
                send(msg); done();
            } catch (e) {
                node.status({ fill: "red", shape: "ring", text: e.message.slice(0, 40) });
                done(e);
            }
        });
        node.on("close", () => { pendientes = []; node.status({}); });
    }
    RED.nodes.registerType("ia-registrar", IaRegistrar);

    // ── ia predecir ────────────────────────────────────────────────────────
    function IaPredecir(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.on("input", async function (msg, send, done) {
            const modelo = msg.modelo || n.modelo;
            if (!modelo) { done(new Error("Indica el modelo (propiedad del nodo o msg.modelo)")); return; }
            if (!esObjeto(msg.payload)) { done(new Error("msg.payload debe ser un objeto con las entradas del modelo")); return; }
            try {
                const r = await llamar(servidor(n), "/modelos/" + encodeURIComponent(modelo) + "/predecir", msg.payload);
                const prefijo = n.prefijo || "";
                msg.prediccion = r;
                if (n.salida !== "aparte") {
                    msg.payload = Array.isArray(r) ? r.map((x, i) => unir(msg.payload[i], x, prefijo)) : unir(msg.payload, r, prefijo);
                }
                const uno = Array.isArray(r) ? r[r.length - 1] : r;
                const txt = "anomalia" in uno ? (uno.anomalia ? "ANOMALÍA" : "normal")
                    : "clase" in uno ? `clase ${uno.clase}` : `${uno.prediccion}`;
                node.status({ fill: uno.anomalia ? "red" : "green", shape: "dot", text: `${modelo} v${uno.version}: ${txt}` });
                send(msg); done();
            } catch (e) {
                node.status({ fill: "red", shape: "ring", text: e.message.slice(0, 40) });
                done(e);
            }
        });
    }
    RED.nodes.registerType("ia-predecir", IaPredecir);

    // ── ia aprender (aprendizaje continuo) ─────────────────────────────────
    function IaAprender(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.on("input", async function (msg, send, done) {
            const modelo = msg.modelo || n.modelo;
            if (!modelo) { done(new Error("Indica el nombre del modelo continuo")); return; }
            if (!esObjeto(msg.payload)) { done(new Error("msg.payload debe ser un objeto con las lecturas")); return; }
            const aprender = msg.aprender !== undefined ? !!msg.aprender : n.aprender !== false;
            try {
                const r = await llamar(servidor(n), "/continuo/" + encodeURIComponent(modelo), msg.payload, {
                    tipo: n.tipo, objetivo: n.objetivo, entradas: n.entradas, umbral: n.umbral, aprender
                });
                const prefijo = n.prefijo || "";
                msg.prediccion = r;
                if (n.salida !== "aparte") {
                    msg.payload = Array.isArray(r) ? r.map((x, i) => unir(msg.payload[i], x, prefijo)) : unir(msg.payload, r, prefijo);
                }
                const uno = Array.isArray(r) ? r[r.length - 1] : r;
                let txt = `${uno.aprendidas} aprendidas`;
                if (uno.mae !== undefined) txt += ` · MAE ${uno.mae}`;
                if (uno.anomalia !== undefined) txt += uno.anomalia ? " · ANOMALÍA" : " · normal";
                if (uno.derivas) txt += ` · derivas ${uno.derivas}`;
                node.status({ fill: uno.deriva || uno.anomalia ? "red" : (aprender ? "blue" : "green"), shape: "dot", text: txt });
                send(msg); done();
            } catch (e) {
                node.status({ fill: "red", shape: "ring", text: e.message.slice(0, 40) });
                done(e);
            }
        });
    }
    RED.nodes.registerType("ia-aprender", IaAprender);
};
