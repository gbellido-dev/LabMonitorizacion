import "./styles.css";

import { connectSnapshots, getRegisterMap, resetSimulation, updateControls } from "./api";
import { TurbineScene } from "./turbine-scene";
import type { ModbusTransaction, RawRegisters, RegisterDefinition, Snapshot } from "./types";


if (window.location.pathname.replace(/\/+$/, "") === "/fullscreen") {
  document.body.classList.add("fullscreen-mode");
}


function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Elemento ausente: ${id}`);
  return value as T;
}


const locale = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const integer = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const canvas = element<HTMLCanvasElement>("render-canvas");
const turbineScene = new TurbineScene(canvas);
const connection = element<HTMLDivElement>("connection");
const connectionLabel = element<HTMLSpanElement>("connection-label");
const runButton = element<HTMLButtonElement>("run-button");
const brakeButton = element<HTMLButtonElement>("brake-button");
const manualMode = element<HTMLInputElement>("manual-mode");
const windControl = element<HTMLInputElement>("wind-control");
const directionControl = element<HTMLInputElement>("direction-control");
const pitchControl = element<HTMLInputElement>("pitch-control");
const yawControl = element<HTMLInputElement>("yaw-control");
const faultControl = element<HTMLSelectElement>("fault-control");
let latestSnapshot: Snapshot | undefined;
let registerDefinitions: RegisterDefinition[] = [];
let rawRegisters: RawRegisters | undefined;
let controlTimer: number | undefined;


function scheduleControl(values: Parameters<typeof updateControls>[0]): void {
  if (controlTimer !== undefined) window.clearTimeout(controlTimer);
  controlTimer = window.setTimeout(() => {
    updateControls(values).catch((error) => console.error(error));
  }, 90);
}


function setSliderOutput(control: HTMLInputElement, outputId: string, suffix: string, digits = 1): void {
  const output = element<HTMLOutputElement>(outputId);
  output.value = `${Number(control.value).toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}


function renderSnapshot(snapshot: Snapshot): void {
  latestSnapshot = snapshot;
  rawRegisters = snapshot.raw_registers;
  const state = snapshot.state;
  const commands = snapshot.commands;
  turbineScene.update(state);

  element("wind-metric").textContent = `${locale.format(state.wind_speed_mps)} m/s`;
  element("rpm-metric").textContent = `${locale.format(state.rotor_rpm)} rpm`;
  element("power-metric").textContent = `${integer.format(state.active_power_kw)} kW`;
  element("pitch-live").textContent = `${locale.format(state.pitch_deg)}°`;
  element("yaw-live").textContent = `${locale.format(state.nacelle_yaw_deg)}°`;
  element("vibration-live").textContent = `${locale.format(state.vibration_mms)} mm/s`;
  element("temperature-live").textContent = `${locale.format(state.bearing_temperature_c)} °C`;

  const statePill = element("state-pill");
  statePill.textContent = state.alarm ? `${state.operating_state_name.toUpperCase()} · ${state.fault_name.toUpperCase()}` : state.operating_state_name.toUpperCase();
  statePill.setAttribute("data-state", state.alarm ? "fault" : state.running ? "running" : "stopped");

  runButton.textContent = commands.run_command ? "Parar aerogenerador" : "Arrancar aerogenerador";
  brakeButton.textContent = commands.brake_command ? "Liberar freno" : "Aplicar freno";
  brakeButton.setAttribute("aria-pressed", String(commands.brake_command));
  manualMode.checked = commands.manual_mode;
  pitchControl.disabled = !commands.manual_mode;
  yawControl.disabled = !commands.manual_mode;

  if (document.activeElement !== windControl) windControl.value = String(commands.wind_speed_mps);
  if (document.activeElement !== directionControl) directionControl.value = String(commands.wind_direction_deg);
  if (document.activeElement !== pitchControl) pitchControl.value = String(commands.pitch_command_deg);
  if (document.activeElement !== yawControl) yawControl.value = String(commands.yaw_command_deg);
  if (document.activeElement !== faultControl) faultControl.value = String(commands.fault_code);
  setSliderOutput(windControl, "wind-output", " m/s");
  setSliderOutput(directionControl, "direction-output", "°", 0);
  setSliderOutput(pitchControl, "pitch-output", "°");
  setSliderOutput(yawControl, "yaw-output", "°", 0);

  if (snapshot.modbus) connectionLabel.textContent = `API conectada · Modbus TCP :${snapshot.modbus.port}`;
  renderRegisterTable();
  renderTransactions(snapshot.transactions ?? []);
}


function rawValue(definition: RegisterDefinition): string {
  if (!rawRegisters) return "—";
  let source: Array<number | boolean> | undefined;
  if (definition.table === "coil") source = rawRegisters.coils;
  if (definition.table === "discrete") source = rawRegisters.discrete;
  if (definition.table === "holding") source = rawRegisters.holding;
  if (definition.table === "input") source = rawRegisters.input;
  if (!source) return "—";
  const values = source.slice(definition.pdu_address, definition.pdu_address + definition.words);
  return values.map((value) => typeof value === "boolean" ? (value ? "1" : "0") : String(value)).join(" · ");
}


function renderRegisterTable(): void {
  const body = element<HTMLTableSectionElement>("register-table-body");
  if (registerDefinitions.length === 0) return;
  body.replaceChildren(...registerDefinitions.map((definition) => {
    const row = document.createElement("tr");
    const values = [
      definition.table,
      String(definition.pdu_address),
      definition.reference,
      definition.name,
      `${definition.data_type} · ×${definition.scale} ${definition.unit}`,
      rawValue(definition),
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  }));
}


function functionLabel(code?: number): string {
  const labels: Record<number, string> = { 1: "FC01", 2: "FC02", 3: "FC03", 4: "FC04", 5: "FC05", 6: "FC06", 15: "FC15", 16: "FC16" };
  return code === undefined ? "—" : labels[code & 0x7f] ?? `FC${String(code).padStart(2, "0")}`;
}


function renderTransactions(transactions: ModbusTransaction[]): void {
  const frameList = element("frame-list");
  if (transactions.length === 0) return;
  const newestFirst = [...transactions].reverse();
  frameList.replaceChildren(...newestFirst.map((transaction) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "frame-item";
    item.innerHTML = `<span class="direction ${transaction.direction.toLowerCase()}">${transaction.direction}</span><strong>${functionLabel(transaction.function_code)}</strong><span>TID ${transaction.transaction_id ?? "—"}</span><small>${transaction.length} bytes</small>`;
    item.addEventListener("click", () => renderFrameInspector(transaction));
    return item;
  }));
  renderFrameInspector(newestFirst[0]);
}


function renderFrameInspector(transaction: ModbusTransaction): void {
  element("frame-summary").textContent = `${transaction.direction} · ${functionLabel(transaction.function_code)} · ${transaction.length} bytes`;
  element("frame-hex").textContent = transaction.hex;
  const values = [
    transaction.transaction_id ?? "—",
    transaction.protocol_id ?? "—",
    transaction.mbap_length ?? "—",
    transaction.unit_id ?? "—",
    functionLabel(transaction.function_code),
  ];
  const cells = element("mbap-grid").querySelectorAll("strong");
  cells.forEach((cell, index) => { cell.textContent = String(values[index]); });
}


runButton.addEventListener("click", () => {
  if (latestSnapshot) updateControls({ run_command: !latestSnapshot.commands.run_command }).catch(console.error);
});
brakeButton.addEventListener("click", () => {
  if (latestSnapshot) updateControls({ brake_command: !latestSnapshot.commands.brake_command }).catch(console.error);
});
manualMode.addEventListener("change", () => updateControls({ manual_mode: manualMode.checked }).catch(console.error));
windControl.addEventListener("input", () => {
  setSliderOutput(windControl, "wind-output", " m/s");
  scheduleControl({ wind_speed_mps: Number(windControl.value) });
});
directionControl.addEventListener("input", () => {
  setSliderOutput(directionControl, "direction-output", "°", 0);
  scheduleControl({ wind_direction_deg: Number(directionControl.value) });
});
pitchControl.addEventListener("input", () => {
  setSliderOutput(pitchControl, "pitch-output", "°");
  scheduleControl({ pitch_command_deg: Number(pitchControl.value) });
});
yawControl.addEventListener("input", () => {
  setSliderOutput(yawControl, "yaw-output", "°", 0);
  scheduleControl({ yaw_command_deg: Number(yawControl.value) });
});
faultControl.addEventListener("change", () => updateControls({ fault_code: Number(faultControl.value) }).catch(console.error));
element<HTMLButtonElement>("reset-button").addEventListener("click", () => resetSimulation().catch(console.error));

document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    const selected = button.dataset.tab;
    document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((tab) => tab.setAttribute("aria-selected", String(tab === button)));
    element("registers-tab").hidden = selected !== "registers";
    element("frames-tab").hidden = selected !== "frames";
  });
});

getRegisterMap().then((definitions) => {
  registerDefinitions = definitions;
  renderRegisterTable();
}).catch(console.error);

connectSnapshots(renderSnapshot, (connected) => {
  connection.dataset.connected = String(connected);
  if (!connected) connectionLabel.textContent = "Reconectando al simulador…";
});
