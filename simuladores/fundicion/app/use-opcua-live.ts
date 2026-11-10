"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LiveValue = { v: number | string | boolean; u: string };
export type Traz = {
  Id?: string; Molde?: string; Prensa?: string; Lote?: string; TemperaturaColada?: number; HumedadArena?: number;
  Inoculada?: boolean; TiempoEnfriamiento?: number; TemperaturaDesmoldeo?: number; Desviacion?: number;
  Resultado?: string; Defecto?: string; PiezasInspeccionadas?: number; PiezasRechazadas?: number;
};
export type LiveSnapshot = {
  type: "snapshot";
  ts: number;
  opcua: boolean;
  kpis: Record<string, LiveValue | undefined>;
  assets: Record<string, Record<string, LiveValue | undefined> | undefined>;
  tags: Record<string, Record<string, LiveValue | undefined> | undefined>;
  traz?: Traz;
  sim?: { Velocidad?: number; TiempoSimulado?: number; Averia?: number; AveriaNombre?: string };
};
/** Punto de la historia larga (una muestra cada 2 s, hasta 1 h) */
export type Punto = { t: number; oee: number; conf: number; energia: number; prod: number; vib: number; tcol: number };

const WS_PORT = 8081;
const RETRY_MS = 3000;
const num = (lv: LiveValue | undefined) => (typeof lv?.v === "number" ? lv.v : NaN);

/**
 * Se conecta al puente OPC UA → WebSocket (opcua/bridge.mjs). Devuelve el último snapshot, una historia
 * corta (14 muestras) y otra larga (1 h), las últimas piezas inspeccionadas y `escribir()` para enviar
 * órdenes al puente (solo las variables que el puente permite).
 */
export function useOpcUaLive() {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [history, setHistory] = useState<LiveSnapshot[]>([]);
  const [larga, setLarga] = useState<Punto[]>([]);
  const [piezas, setPiezas] = useState<Traz[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const ultimoId = useRef<string | undefined>(undefined);
  const ultimoPunto = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let timer = 0;
    const connect = () => {
      const port = new URLSearchParams(location.search).get("wsport") ?? WS_PORT;
      ws = new WebSocket(`ws://${location.hostname}:${port}`);
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data as string) as LiveSnapshot;
          if (d.type !== "snapshot") return;
          setSnap(d);
          setHistory((h) => [...h.slice(-13), d]);
          const id = d.traz?.Id;
          if (id && id !== ultimoId.current) {
            ultimoId.current = id;
            setPiezas((p) => [{ ...d.traz }, ...p].slice(0, 200));
          }
          if (d.opcua && d.ts - ultimoPunto.current >= 2000) {
            ultimoPunto.current = d.ts;
            const a = d.assets;
            setLarga((l) => [...l.slice(-1799), {
              t: d.ts, oee: num(d.kpis.OEEPlanta), conf: num(d.kpis.PiezasConformes), energia: num(d.kpis.EnergiaEspecifica),
              prod: num(d.kpis.ProduccionTurno), vib: num(a["DES-01"]?.Vibracion), tcol: num(a["COL-01"]?.TemperaturaColada),
            }]);
          }
        } catch { /* mensaje no JSON: se ignora */ }
      };
      ws.onclose = () => {
        setWsConnected(false);
        setSnap(null);
        if (!closed) timer = window.setTimeout(connect, RETRY_MS);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, []);

  const escribir = useCallback((nodo: "Simulacion.Velocidad" | "Mantenimiento.Averia", valor: number) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "escribir", nodo, valor }));
  }, []);

  // "en vivo" de verdad solo si el WS está abierto y el puente tiene sesión OPC UA
  return { live: wsConnected && !!snap?.opcua, snap, history, larga, piezas, escribir };
}

/** Formatea un LiveValue numérico con coma decimal es-ES; null si no hay dato. */
export function fmtLive(lv: LiveValue | undefined, dp = 1): string | null {
  if (!lv || typeof lv.v !== "number") return null;
  const n = lv.v.toLocaleString("es-ES", { maximumFractionDigits: dp, minimumFractionDigits: 0 });
  if (!lv.u) return n;
  return lv.u === "%" ? `${n}%` : `${n} ${lv.u}`;
}

/** Número con coma decimal; "—" si no hay dato. */
export function fmt(x: number | undefined | null, dp = 1, u = ""): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const n = x.toLocaleString("es-ES", { maximumFractionDigits: dp, minimumFractionDigits: 0 });
  return u ? (u === "%" ? `${n}%` : `${n} ${u}`) : n;
}
