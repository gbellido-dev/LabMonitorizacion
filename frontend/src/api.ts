import type { Snapshot } from "./types";

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
};

export const getSnapshot = () => api<Snapshot>("/api/snapshot");
export const updateSettings = (value: Partial<Snapshot["settings"]> & { running?: boolean }) => api<Snapshot>("/api/settings", { method: "PATCH", body: JSON.stringify(value) });
export const injectFault = (buoy_id: string, fault: string) => api<Record<string, unknown>>("/api/fault", { method: "POST", body: JSON.stringify({ buoy_id, fault }) });

export function connectSnapshots(onSnapshot: (value: Snapshot) => void, onConnection: (value: boolean) => void): () => void {
  let closed = false;
  let socket: WebSocket;
  const connect = () => {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${protocol}://${location.host}/ws`);
    socket.onopen = () => onConnection(true);
    socket.onmessage = (event) => onSnapshot(JSON.parse(event.data) as Snapshot);
    socket.onclose = () => { onConnection(false); if (!closed) window.setTimeout(connect, 1200); };
  };
  connect();
  return () => { closed = true; socket?.close(); };
}

