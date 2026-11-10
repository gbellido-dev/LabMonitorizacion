"use client";

import { useEffect, useState } from "react";

export type LiveValue = { v: number | string | boolean; u: string };
export type LiveSnapshot = {
  type: "snapshot";
  ts: number;
  opcua: boolean;
  kpis: Record<string, LiveValue | undefined>;
  assets: Record<string, Record<string, LiveValue | undefined> | undefined>;
  tags: Record<string, Record<string, LiveValue | undefined> | undefined>;
};

// Puerto del puente OPC UA->WS; se puede cambiar con ?wsport=NNNN en la URL
const WS_PORT = 8081;
const RETRY_MS = 3000;

/**
 * Se conecta al puente OPC UA -> WebSocket (opcua/bridge.mjs) y devuelve el
 * último snapshot de telemetría. Reintenta la conexión cada pocos segundos;
 * si no hay puente, `snap` queda en null y el dashboard usa sus valores
 * estáticos de respaldo.
 */
export function useOpcUaLive() {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [history, setHistory] = useState<LiveSnapshot[]>([]);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let timer = 0;
    const connect = () => {
      const port = new URLSearchParams(location.search).get("wsport") ?? WS_PORT;
      ws = new WebSocket(`ws://${location.hostname}:${port}`);
      ws.onopen = () => setWsConnected(true);
      ws.onmessage = e => {
        try {
          const d = JSON.parse(e.data as string) as LiveSnapshot;
          if (d.type === "snapshot") {
            setSnap(d);
            setHistory(h => [...h.slice(-13), d]); // últimos 14 para sparklines
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

  // "en vivo" de verdad solo si el WS está abierto y el puente tiene sesión OPC UA
  return { live: wsConnected && !!snap?.opcua, snap, history };
}

/** Formatea un LiveValue numérico con coma decimal es-ES; null si no hay dato. */
export function fmtLive(lv: LiveValue | undefined, dp = 1): string | null {
  if (!lv || typeof lv.v !== "number") return null;
  const num = lv.v.toLocaleString("es-ES", { maximumFractionDigits: dp, minimumFractionDigits: 0 });
  if (!lv.u) return num;
  return lv.u === "%" ? `${num}%` : `${num} ${lv.u}`;
}
