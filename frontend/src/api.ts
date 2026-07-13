import type { Commands, Snapshot } from "./types";

export async function updateControls(controls: Partial<Commands>): Promise<Snapshot> {
  const response = await fetch("/api/control", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(controls),
  });
  if (!response.ok) throw new Error(`No se pudo actualizar el control (${response.status})`);
  return response.json() as Promise<Snapshot>;
}

export async function resetSimulation(): Promise<Snapshot> {
  const response = await fetch("/api/reset", { method: "POST" });
  if (!response.ok) throw new Error(`No se pudo reiniciar (${response.status})`);
  return response.json() as Promise<Snapshot>;
}

export function connectSnapshots(
  onSnapshot: (snapshot: Snapshot) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let socket: WebSocket | undefined;
  let timer: number | undefined;
  let closed = false;
  const connect = () => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    socket.addEventListener("open", () => onStatus(true));
    socket.addEventListener("message", (event) => onSnapshot(JSON.parse(String(event.data)) as Snapshot));
    socket.addEventListener("close", () => {
      onStatus(false);
      if (!closed) timer = window.setTimeout(connect, 1400);
    });
    socket.addEventListener("error", () => socket?.close());
  };
  connect();
  return () => {
    closed = true;
    if (timer) window.clearTimeout(timer);
    socket?.close();
  };
}
