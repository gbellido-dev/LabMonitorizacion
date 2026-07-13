import "./styles.css";

import { connectSnapshots, resetSimulation, updateControls } from "./api";
import { SolarScene } from "./solar-scene";
import type { Commands, OpcNode, Snapshot } from "./types";


function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Elemento ausente: ${id}`);
  return found as T;
}


const number0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const number1 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const canvas = element<HTMLCanvasElement>("render-canvas");
let latest: Snapshot | undefined;
let selectedNodeId = "Plant.ActivePower";
let controlTimer: number | undefined;
let selectedZone = 0;
const solarScene = new SolarScene(canvas, (zone) => {
  selectedZone = zone;
  renderZones();
});


const controls = {
  irradiance_wm2: element<HTMLInputElement>("irradiance-control"),
  cloud_cover_pct: element<HTMLInputElement>("cloud-control"),
  ambient_temperature_c: element<HTMLInputElement>("temperature-control"),
  soiling_pct: element<HTMLInputElement>("soiling-control"),
};


function formatValue(value: number | boolean, unit = ""): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return `${number1.format(value)}${unit ? ` ${unit}` : ""}`;
}


function updateOutput(key: keyof typeof controls): void {
  const outputIds: Record<keyof typeof controls, string> = {
    irradiance_wm2: "irradiance-output",
    cloud_cover_pct: "cloud-output",
    ambient_temperature_c: "temperature-output",
    soiling_pct: "soiling-output",
  };
  const units: Record<keyof typeof controls, string> = {
    irradiance_wm2: "W/m²", cloud_cover_pct: "%", ambient_temperature_c: "°C", soiling_pct: "%",
  };
  element<HTMLOutputElement>(outputIds[key]).value = `${controls[key].value} ${units[key]}`;
}


function scheduleControl(update: Partial<Commands>): void {
  if (controlTimer !== undefined) window.clearTimeout(controlTimer);
  controlTimer = window.setTimeout(() => updateControls(update).catch(console.error), 100);
}


Object.entries(controls).forEach(([key, input]) => {
  input.addEventListener("input", () => {
    updateOutput(key as keyof typeof controls);
    scheduleControl({ [key]: Number(input.value) });
  });
});


element<HTMLInputElement>("tracking-control").addEventListener("change", (event) => {
  updateControls({ tracking_enabled: (event.target as HTMLInputElement).checked }).catch(console.error);
});
element<HTMLSelectElement>("fault-control").addEventListener("change", (event) => {
  updateControls({ fault_code: Number((event.target as HTMLSelectElement).value) }).catch(console.error);
});
element<HTMLButtonElement>("run-button").addEventListener("click", () => {
  if (latest) updateControls({ run_command: !latest.commands.run_command }).catch(console.error);
});
element<HTMLButtonElement>("reset-button").addEventListener("click", () => resetSimulation().catch(console.error));
element<HTMLButtonElement>("copy-endpoint").addEventListener("click", async () => {
  if (!latest) return;
  await navigator.clipboard.writeText(latest.opcua.endpoint);
  const button = element<HTMLButtonElement>("copy-endpoint");
  button.textContent = "COPIADO";
  window.setTimeout(() => { button.textContent = "COPIAR"; }, 1300);
});


function renderZones(): void {
  if (!latest) return;
  const strip = element("zone-strip");
  strip.replaceChildren(...latest.zones.map((zone, index) => {
    const button = document.createElement("button");
    button.className = index === selectedZone ? "zone active" : "zone";
    button.dataset.alarm = String(zone.alarm);
    button.innerHTML = `<span><i></i>${zone.name}</span><strong>${number0.format(zone.active_power_kw)} <small>kW</small></strong><em>${number1.format(zone.panel_temperature_c)} °C</em>`;
    button.addEventListener("click", () => {
      selectedZone = index;
      selectedNodeId = `Zone${String(index + 1).padStart(2, "0")}.ActivePower`;
      renderZones();
      renderNodes();
      document.querySelector("#explorador")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return button;
  }));
}


function groupLabel(node: OpcNode): string {
  if (node.node_id.includes(";s=Controls.")) return "Controls";
  if (node.node_id.includes(";s=Zone")) return node.node_id.split(";s=")[1].split(".")[0];
  return "Plant";
}


function shortNodeId(node: OpcNode): string {
  return node.node_id.split(";s=")[1] ?? node.node_id;
}


function renderNodes(): void {
  if (!latest) return;
  const query = element<HTMLInputElement>("node-search").value.trim().toLocaleLowerCase("es");
  const filtered = latest.nodes.filter((node) => !query || `${node.node_id} ${node.display_name} ${node.browse_path}`.toLocaleLowerCase("es").includes(query));
  const groups = new Map<string, OpcNode[]>();
  for (const node of filtered) {
    const group = groupLabel(node);
    groups.set(group, [...(groups.get(group) ?? []), node]);
  }
  const tree = element("node-tree");
  const root = document.createElement("div");
  root.className = "tree-root";
  root.innerHTML = `<div class="root-row"><span class="chevron">⌄</span><i class="server-icon">S</i><div><strong>SolarLab</strong><small>Objects / ns=${latest.opcua.namespace_index}</small></div></div>`;
  for (const [group, nodes] of groups) {
    const branch = document.createElement("div");
    branch.className = "tree-branch";
    const branchTitle = document.createElement("div");
    branchTitle.className = "branch-title";
    branchTitle.innerHTML = `<span class="chevron">⌄</span><i>◇</i><strong>${group}</strong><small>${nodes.length}</small>`;
    branch.append(branchTitle);
    for (const node of nodes) {
      const button = document.createElement("button");
      button.className = shortNodeId(node) === selectedNodeId ? "node-row selected" : "node-row";
      button.innerHTML = `<i class="type-icon" data-type="${node.data_type}">${node.data_type === "Boolean" ? "B" : node.data_type === "Int32" ? "I" : "D"}</i><span><strong>${node.display_name}</strong><small>${shortNodeId(node)}</small></span><em>${formatValue(node.value, node.unit)}</em>`;
      button.addEventListener("click", () => {
        selectedNodeId = shortNodeId(node);
        renderNodes();
      });
      branch.append(button);
    }
    root.append(branch);
  }
  tree.replaceChildren(root);
  const selected = latest.nodes.find((node) => shortNodeId(node) === selectedNodeId) ?? filtered[0];
  renderNodeDetail(selected);
}


function renderNodeDetail(node?: OpcNode): void {
  const detail = element("node-detail");
  if (!node) {
    detail.innerHTML = `<div class="empty-detail"><strong>Sin resultados</strong><p>Prueba con otro término de búsqueda.</p></div>`;
    return;
  }
  detail.innerHTML = `
    <div class="detail-top"><span class="detail-type">${node.data_type}</span><span class="access ${node.access.includes("Escritura") ? "writable" : ""}">${node.access}</span></div>
    <p class="detail-path">${node.browse_path}</p>
    <h3>${node.display_name}</h3>
    <p class="description">${node.description}</p>
    <div class="live-value"><span>VALOR ACTUAL <i></i></span><strong>${formatValue(node.value, node.unit)}</strong></div>
    <dl>
      <div><dt>NodeId</dt><dd>${node.node_id}</dd></div>
      <div><dt>BrowseName</dt><dd>${shortNodeId(node).split(".").at(-1)}</dd></div>
      <div><dt>DataType</dt><dd>${node.data_type}</dd></div>
      <div><dt>AccessLevel</dt><dd>${node.access}</dd></div>
      <div><dt>Namespace URI</dt><dd>${latest?.opcua.namespace_uri}</dd></div>
    </dl>`;
}


function renderEvents(): void {
  if (!latest) return;
  const list = element("event-list");
  const events = [...latest.events].reverse();
  if (events.length === 0) {
    list.innerHTML = `<p class="no-events">Aún no hay escrituras OPC UA. Modifica una consigna desde UAExpert o el cliente de ejemplo.</p>`;
    return;
  }
  list.replaceChildren(...events.map((event) => {
    const row = document.createElement("div");
    row.className = "event-row";
    const time = new Date(event.timestamp).toLocaleTimeString("es-ES");
    row.innerHTML = `<time>${time}</time><span class="event-kind ${event.kind.toLowerCase()}">${event.kind}</span><code>${event.node}</code><strong>${String(event.value)}</strong>`;
    return row;
  }));
}


function renderSnapshot(snapshot: Snapshot): void {
  latest = snapshot;
  solarScene.update(snapshot.state, snapshot.zones, snapshot.commands.cloud_cover_pct);
  element("power-metric").textContent = number0.format(snapshot.state.active_power_kw);
  element("irradiance-metric").textContent = number0.format(snapshot.state.irradiance_wm2);
  element("energy-metric").textContent = number1.format(snapshot.state.daily_energy_kwh);
  element("pr-metric").textContent = number1.format(snapshot.state.performance_ratio_pct);
  element("endpoint-label").textContent = snapshot.opcua.endpoint;
  element("node-count").textContent = String(snapshot.nodes.length);
  element("namespace-index").textContent = `ns=${snapshot.opcua.namespace_index}`;
  const statePill = element("state-pill");
  statePill.textContent = snapshot.state.alarm ? `${snapshot.state.operating_state_name} · ${snapshot.state.fault_name}` : snapshot.state.operating_state_name;
  statePill.dataset.state = snapshot.state.alarm ? "fault" : snapshot.commands.run_command ? "running" : "stopped";
  element<HTMLButtonElement>("run-button").textContent = snapshot.commands.run_command ? "PARAR PLANTA" : "ARRANCAR PLANTA";

  (Object.keys(controls) as Array<keyof typeof controls>).forEach((key) => {
    if (document.activeElement !== controls[key]) controls[key].value = String(snapshot.commands[key]);
    updateOutput(key);
  });
  const tracking = element<HTMLInputElement>("tracking-control");
  if (document.activeElement !== tracking) tracking.checked = snapshot.commands.tracking_enabled;
  const fault = element<HTMLSelectElement>("fault-control");
  if (document.activeElement !== fault) fault.value = String(snapshot.commands.fault_code);
  renderZones();
  renderNodes();
  renderEvents();
}


element<HTMLInputElement>("node-search").addEventListener("input", renderNodes);
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;
    document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((item) => item.setAttribute("aria-selected", String(item === button)));
    element("nodes-tab").hidden = tab !== "nodes";
    element("events-tab").hidden = tab !== "events";
    element<HTMLElement>("node-search").style.visibility = tab === "nodes" ? "visible" : "hidden";
  });
});


connectSnapshots(renderSnapshot, (connected) => {
  const connection = element("connection");
  connection.dataset.connected = String(connected);
  element("connection-label").textContent = connected ? "SERVIDOR ACTIVO" : "RECONECTANDO…";
});
