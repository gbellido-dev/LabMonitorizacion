import "./styles.css";
import { connectSnapshots, getSnapshot, injectFault, updateSettings } from "./api";
import { GlobeScene } from "./globe-scene";
import type { Buoy, MqttEvent, Snapshot } from "./types";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const number1 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const number0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
let snapshot: Snapshot;
let selectedId = "BOY-001";
let selectedOcean = "all";
let localEvents: MqttEvent[] = [];
let chartHistory = Array.from({ length: 24 }, (_, i) => 18 + Math.sin(i / 4) * 0.4);

const demoSnapshot = (): Snapshot => {
  const regions: Array<[string, Array<[number, number]>]> = [
    ["Atlántico Norte", [[35,-45],[45,-30],[25,-35]]], ["Atlántico Sur", [[-20,-25],[-35,-15],[-10,-30]]],
    ["Pacífico Norte", [[35,-150],[25,-140],[45,-165]]], ["Pacífico Sur", [[-25,-130],[-40,-110],[-15,-150]]],
    ["Océano Índico", [[-20,80],[-30,65],[-10,90]]], ["Océano Ártico", [[82,0],[80,120],[78,-150]]],
    ["Océano Austral", [[-60,0],[-62,90],[-58,-120]]], ["Mar Mediterráneo", [[38,5],[35,18],[34,28]]],
    ["Mar Caribe", [[15,-75],[17,-65],[13,-80]]], ["Mar Báltico", [[57,19],[59,22],[55.5,16]]],
    ["Mar del Norte", [[56,3],[58,1],[54,4]]], ["Mar Negro", [[43,34],[42,30],[44,37]]],
    ["Mar Rojo", [[20,38],[17,40],[24,36]]], ["Mar Arábigo", [[15,65],[12,60],[18,68]]],
    ["Bahía de Bengala", [[15,87],[12,90],[18,89]]], ["Mar de China Meridional", [[14,114],[10,112],[17,116]]],
    ["Mar de China Oriental", [[28,126],[30,124],[26,125]]], ["Mar del Japón", [[40,135],[42,138],[38,132]]],
    ["Mar de Filipinas", [[18,132],[12,130],[22,135]]], ["Mar del Coral", [[-18,155],[-22,157],[-15,150]]],
    ["Mar de Tasmania", [[-40,160],[-35,165],[-43,155]]], ["Mar de Bering", [[57,-175],[60,175],[55,170]]],
    ["Mar de Ojotsk", [[52,150],[55,148],[49,154]]], ["Mar del Labrador", [[58,-52],[55,-48],[61,-56]]],
    ["Mar de Noruega", [[66,2],[68,5],[64,-2]]], ["Mar de Groenlandia", [[72,-8],[74,-2],[70,-12]]],
    ["Mar de Barents", [[74,35],[72,40],[76,30]]], ["Mar de Weddell", [[-70,-35],[-68,-45],[-72,-25]]],
    ["Golfo de México", [[24,-90],[22,-94],[26,-87]]], ["Mar de Java", [[-5,110],[-4,113],[-6,107]]],
    ["Mar de Andamán", [[10,95],[12,96],[8,97]]], ["Mar de Arafura", [[-10,137],[-8,133],[-12,140]]],
  ];
  const buoys = Array.from({ length: 96 }, (_, index): Buoy => {
    const regionIndex = index % regions.length; const pointIndex = Math.floor(index / regions.length) % 3;
    const [ocean, positions] = regions[regionIndex]; const [lat, lon] = positions[pointIndex]; const wave = 0.6 + (index * 17 % 34) / 10;
    return { id: `BOY-${String(index + 1).padStart(3, "0")}`, name: `Estación ${ocean} ${pointIndex + 1}`, ocean,
      latitude: lat, longitude: lon,
      status: "online", battery_pct: 68 + index % 31, water_temperature_c: 26 - Math.abs(lat) * .32 + (index % 7) * .15,
      air_temperature_c: 22, wave_height_m: wave, wind_speed_mps: 4 + index % 12, wind_direction_deg: index * 47 % 360,
      pressure_hpa: 998 + index % 25, humidity_pct: 72, signal_rssi_dbm: -48 - index % 38, sequence: index * 4 };
  });
  return { timestamp: new Date().toISOString(), running: true, settings: { publish_interval_s: 2, qos: 0, retained: false }, broker: { host: "localhost", tcp_port: 1883, ws_port: 8083, topic_pattern: "oceanlab/buoys/{buoy_id}/telemetry" }, buoys, events: [] };
};

const globe = new GlobeScene(el<HTMLCanvasElement>("globe-canvas"), (id) => selectBuoy(id, true));

function selected(): Buoy { return snapshot.buoys.find((buoy) => buoy.id === selectedId) ?? snapshot.buoys[0]; }
function coordinate(value: number, positive: string, negative: string): string { return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`; }
function direction(value: number): string { return ["N", "NE", "E", "SE", "S", "SO", "O", "NO"][Math.round(value / 45) % 8]; }

function createSparkline(values: number[]): string {
  const min = Math.min(...values) - .2, max = Math.max(...values) + .2;
  const points = values.map((v, i) => `${i / (values.length - 1) * 260},${62 - (v - min) / (max - min) * 52}`).join(" ");
  return `<svg viewBox="0 0 260 70" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#5ce9c5" stop-opacity=".28"/><stop offset="1" stop-color="#5ce9c5" stop-opacity="0"/></linearGradient></defs><polygon points="0,70 ${points} 260,70" fill="url(#fill)"/><polyline points="${points}" fill="none" stroke="#5ce9c5" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderDetail(): void {
  const buoy = selected();
  el("selected-ocean").textContent = buoy.ocean; el("selected-name").textContent = buoy.name;
  el("selected-coordinates").textContent = `${coordinate(buoy.latitude, "N", "S")} · ${coordinate(buoy.longitude, "E", "O")}`;
  const status = el("selected-status"); status.className = `status-badge ${buoy.status}`; status.innerHTML = `<span></span>${buoy.status === "online" ? "En línea" : "Sin conexión"}`;
  el("water-value").innerHTML = `${number1.format(buoy.water_temperature_c)} <small>°C</small>`;
  el("wave-value").innerHTML = `${number1.format(buoy.wave_height_m)} <small>m</small>`;
  el<HTMLElement>("wave-meter").style.width = `${Math.min(100, buoy.wave_height_m / 9 * 100)}%`;
  el("wind-value").innerHTML = `${number1.format(buoy.wind_speed_mps)} <small>m/s</small>`;
  el("wind-direction").textContent = `↗ ${number0.format(buoy.wind_direction_deg)}° ${direction(buoy.wind_direction_deg)}`;
  el("pressure-value").innerHTML = `${number0.format(buoy.pressure_hpa)} <small>hPa</small>`;
  el("battery-value").innerHTML = `${number0.format(buoy.battery_pct)} <small>%</small>`;
  el<HTMLElement>("battery-meter").style.width = `${buoy.battery_pct}%`;
  el("signal-value").innerHTML = `${number0.format(buoy.signal_rssi_dbm)} <small>dBm</small>`;
  chartHistory = [...chartHistory.slice(1), buoy.water_temperature_c]; el("temperature-chart").innerHTML = createSparkline(chartHistory);
  el("publisher-id").textContent = buoy.id; el("topic-value").textContent = `oceanlab/buoys/${buoy.id}/telemetry`;
  const payload = { buoy_id: buoy.id, timestamp: snapshot.timestamp, sequence: buoy.sequence, weather: { water_temperature_c: buoy.water_temperature_c, wave_height_m: buoy.wave_height_m, wind_speed_mps: buoy.wind_speed_mps, pressure_hpa: buoy.pressure_hpa }, device: { battery_pct: buoy.battery_pct, status: buoy.status } };
  el("payload-view").innerHTML = syntaxHighlight(payload);
  globe.select(buoy);
}

function syntaxHighlight(value: object): string {
  return JSON.stringify(value, null, 2).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/(".*?")(?=\s*:)|(".*?")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g, (match, key, string, bool, num) => `<span class="${key ? "json-key" : string ? "json-string" : bool ? "json-bool" : num ? "json-number" : ""}">${match}</span>`);
}

function renderList(): void {
  const query = el<HTMLInputElement>("buoy-search").value.toLowerCase();
  const matches = snapshot.buoys.filter((buoy) => {
    const polar = buoy.ocean.includes("Ártico") || buoy.ocean.includes("Austral") || buoy.ocean.includes("Weddell") || buoy.ocean.includes("Barents") || buoy.ocean.includes("Groenlandia");
    const openOceans = buoy.ocean.includes("Atlántico") || buoy.ocean.includes("Pacífico") || buoy.ocean.includes("Índico") || buoy.ocean.startsWith("Océano");
    const oceanMatch = selectedOcean === "all" || (selectedOcean === "Polar" ? polar : selectedOcean === "Mares" ? !openOceans : buoy.ocean.includes(selectedOcean));
    return oceanMatch && `${buoy.id} ${buoy.name} ${buoy.ocean}`.toLowerCase().includes(query);
  });
  el("filtered-count").textContent = String(matches.length);
  el("buoy-list").replaceChildren(...matches.map((buoy) => {
    const button = document.createElement("button"); button.className = `buoy-row ${buoy.id === selectedId ? "selected" : ""}`;
    const alert = buoy.status === "offline" || buoy.battery_pct < 20 || buoy.wave_height_m > 6;
    button.innerHTML = `<span class="row-dot ${buoy.status}${alert ? " warning" : ""}"></span><span><strong>${buoy.id}</strong><small>${buoy.ocean}</small></span><span><strong>${number1.format(buoy.water_temperature_c)}°</strong><small>${number1.format(buoy.wave_height_m)} m ola</small></span>`;
    button.addEventListener("click", () => selectBuoy(buoy.id, true)); return button;
  }));
}

function renderEvents(): void {
  const events = localEvents.length ? localEvents : snapshot.events;
  el("event-list").replaceChildren(...(events.length ? [...events].reverse().slice(0, 8).map((event, index) => {
    const row = document.createElement("div"); row.className = "event-row";
    row.innerHTML = `<time>${new Date(Date.now() - index * 1700).toLocaleTimeString("es-ES")}</time><span class="event-kind ${event.kind.toLowerCase()}">${event.kind}</span><code>${event.topic}</code><small>QoS ${event.qos}${event.retained ? " · RETAIN" : ""}</small>`; return row;
  }) : [Object.assign(document.createElement("p"), { className: "empty-events", textContent: "Esperando mensajes del broker…" })]));
}

function render(next: Snapshot): void {
  snapshot = next; globe.update(snapshot.buoys); el("fleet-count").textContent = String(snapshot.buoys.filter((b) => b.status === "online").length);
  el("message-rate").textContent = String(Math.round(snapshot.buoys.length * 60 / snapshot.settings.publish_interval_s));
  el("publish-label").textContent = `PUBLISH · QoS ${snapshot.settings.qos}`;
  el<HTMLSelectElement>("qos-control").value = String(snapshot.settings.qos); el<HTMLSelectElement>("interval-control").value = String(snapshot.settings.publish_interval_s);
  el<HTMLInputElement>("retain-control").checked = snapshot.settings.retained;
  const toggle = el<HTMLButtonElement>("simulation-toggle"); toggle.innerHTML = snapshot.running ? "<span>Ⅱ</span> Pausar simulación" : "<span>▶</span> Reanudar simulación";
  renderList(); renderDetail(); renderEvents();
}

function selectBuoy(id: string, focus = false): void { selectedId = id; renderList(); renderDetail(); globe.select(selected(), focus); }

el<HTMLInputElement>("buoy-search").addEventListener("input", renderList);
el("ocean-filters").querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.addEventListener("click", () => {
  selectedOcean = button.dataset.ocean ?? "all"; el("ocean-filters").querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button)); renderList();
}));
document.querySelectorAll<HTMLButtonElement>("[data-fault]").forEach((button) => button.addEventListener("click", async () => {
  const fault = button.dataset.fault ?? "reset";
  try { await injectFault(selectedId, fault); } catch { const buoy = selected(); if (fault === "offline") buoy.status = "offline"; if (fault === "battery") buoy.battery_pct = 8; if (fault === "storm") { buoy.wave_height_m = 8.4; buoy.wind_speed_mps = 29; } if (fault === "reset") { buoy.status = "online"; buoy.battery_pct = 82; buoy.wave_height_m = 1.4; } render(snapshot); }
}));
el("simulation-toggle").addEventListener("click", () => updateSettings({ running: !snapshot.running }).catch(() => { snapshot.running = !snapshot.running; render(snapshot); }));
el<HTMLSelectElement>("qos-control").addEventListener("change", (event) => updateSettings({ qos: Number((event.target as HTMLSelectElement).value) }).catch(() => undefined));
el<HTMLSelectElement>("interval-control").addEventListener("change", (event) => updateSettings({ publish_interval_s: Number((event.target as HTMLSelectElement).value) }).catch(() => undefined));
el<HTMLInputElement>("retain-control").addEventListener("change", (event) => updateSettings({ retained: (event.target as HTMLInputElement).checked }).catch(() => undefined));
el("clear-events").addEventListener("click", () => { localEvents = []; snapshot.events = []; renderEvents(); });
el("fullscreen-button").addEventListener("click", () => document.documentElement.requestFullscreen?.());

snapshot = demoSnapshot(); render(snapshot);
getSnapshot().then(render).catch(() => { el("connection-label").textContent = "Modo demostración · inicia el backend para MQTT real"; });
connectSnapshots(render, (connected) => { el("connection-label").textContent = connected ? "Broker MQTT conectado · localhost:1883" : "Modo demostración · reconectando…"; });
