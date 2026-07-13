import type { RegisterDefinition, Snapshot } from "./types";

export type Controls = Partial<Snapshot["commands"]>;

export async function updateControls(controls: Controls): Promise<Snapshot> {
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

export async function getRegisterMap(): Promise<RegisterDefinition[]> {
  const response = await fetch("/api/registers");
  if (!response.ok) throw new Error(`No se pudo cargar el mapa (${response.status})`);
  const payload = (await response.json()) as { map: RegisterDefinition[] };
  return payload.map;
}

export function connectSnapshots(
  onSnapshot: (snapshot: Snapshot) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let socket: WebSocket | undefined;
  let retryTimer: number | undefined;
  let closed = false;

  const connect = () => {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${scheme}://${window.location.host}/ws`);
    socket.addEventListener("open", () => onStatus(true));
    socket.addEventListener("message", (event) => {
      try {
        onSnapshot(JSON.parse(String(event.data)) as Snapshot);
      } catch (error) {
        console.error("Snapshot no válido", error);
      }
    });
    socket.addEventListener("close", () => {
      onStatus(false);
      if (!closed) retryTimer = window.setTimeout(connect, 1500);
    });
    socket.addEventListener("error", () => socket?.close());
  };
  connect();

  return () => {
    closed = true;
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    socket?.close();
  };
}

