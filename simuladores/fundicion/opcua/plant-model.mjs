// Catálogo de la planta: activos, variables (con unidad y valor inicial),
// señales discretas y mapa de tags S7. Define el espacio de direcciones OPC UA
// (server.mjs) y lo que reenvía el puente WebSocket (bridge.mjs).
//
// Los VALORES los calcula el motor de proceso (motor.mjs) a partir de la física
// y de la trazabilidad de cada molde; aquí solo están los nombres y unidades.
//
// Cada variable: { n: nombre, unit, v: valor inicial, dp: decimales }
// flags: señales discretas por activo { n, type: "bool"|"string", v }

export const kpis = [
  { n: "OEEPlanta", unit: "%", v: 87.4, w: 0.6, dp: 1 },
  { n: "ProduccionTurno", unit: "t", v: 186, w: 0, dp: 2, kind: "counter", rate: 0.009 },
  { n: "PiezasConformes", unit: "%", v: 98.4, w: 0.15, dp: 2 },
  { n: "EnergiaEspecifica", unit: "kWh/t", v: 548, w: 4, dp: 0 },
  { n: "CO2Estimado", unit: "t/t", v: 0.42, w: 0.008, dp: 3 },
  { n: "VelocidadLinea", unit: "m/min", v: 1.5, w: 0.05, dp: 2, kind: "managed" },
  { n: "PosicionLinea", unit: "m", v: 0, w: 0, dp: 2, kind: "managed" },
];

export const loteActivo = { n: "LoteActivo", value: "FE-260713-084" };

export const assets = [
  {
    short: "IF-01", name: "Horno de inducción 01", zone: "Fusion", status: "RUN", plc: "PLC-FUS-01 · S7-1515",
    flags: [{ n: "Fase", type: "string", v: "FUSION" }],
    vars: [
      { n: "TemperaturaMetal", unit: "°C", v: 1487, w: 8, dp: 1, kind: "managed" },
      { n: "PotenciaBobina", unit: "kW", v: 1840, w: 45, dp: 0, kind: "managed" },
      { n: "Vibracion", unit: "mm/s", v: 2.1, w: 0.25, dp: 2 },
      { n: "Presion", unit: "Pa", v: -12, w: 2, dp: 1 },
      { n: "OEE", unit: "%", v: 91.2, w: 0.4, dp: 1 },
      { n: "NivelCarga", unit: "%", v: 68, w: 2.5, dp: 1 },
      { n: "Inclinacion", unit: "°", v: 0, dp: 0 },
      { n: "EnergiaConsumida", unit: "kWh", v: 0, dp: 1 },
    ],
    tags: [["Metal.Temp", "DB10.DBD0"], ["Coil.Power", "DB10.DBD8"], ["Tilt.Angle", "DB11.DBD4"], ["ReadyToPour", "DB11.DBX12.0"]],
  },
  {
    short: "IF-02", name: "Horno de inducción 02", zone: "Fusion", status: "WARN", plc: "PLC-FUS-01 · S7-1515",
    flags: [{ n: "Fase", type: "string", v: "CARGA" }],
    vars: [
      { n: "TemperaturaMetal", unit: "°C", v: 1362, w: 11, dp: 1, kind: "managed" },
      { n: "PotenciaBobina", unit: "kW", v: 1460, w: 55, dp: 0, kind: "managed" },
      { n: "Vibracion", unit: "mm/s", v: 3.8, w: 0.45, dp: 2 },
      { n: "Presion", unit: "Pa", v: -9, w: 2, dp: 1 },
      { n: "OEE", unit: "%", v: 84.7, w: 0.5, dp: 1 },
      { n: "NivelCarga", unit: "%", v: 42, w: 2.5, dp: 1 },
      { n: "Inclinacion", unit: "°", v: 0, dp: 0 },
      { n: "EnergiaConsumida", unit: "kWh", v: 0, dp: 1 },
    ],
    tags: [["Metal.Temp", "DB10.DBD20"], ["Coil.Power", "DB10.DBD28"], ["Cooling.Flow", "DB12.DBD0"], ["Alarm.Word", "DB90.DBW4"]],
  },
  {
    short: "MP-01", name: "Prensa de moldeo superior", zone: "Moldeo", status: "RUN", plc: "PLC-MOL-01 · S7-1512",
    vars: [
      { n: "TiempoCiclo", unit: "s", v: 18.4, w: 0.35, dp: 2 },
      { n: "Temperatura", unit: "°C", v: 46, w: 1.8, dp: 1 },
      { n: "Potencia", unit: "kW", v: 72, w: 4, dp: 1 },
      { n: "Vibracion", unit: "mm/s", v: 1.7, w: 0.2, dp: 2 },
      { n: "Presion", unit: "bar", v: 6.2, w: 0.15, dp: 2 },
      { n: "OEE", unit: "%", v: 88.9, w: 0.4, dp: 1 },
      { n: "HumedadArena", unit: "%", v: 3.6, dp: 2 },
    ],
    tags: [["Cycle.Time", "DB20.DBD0"], ["Press.Force", "DB20.DBD8"], ["Sand.Moisture", "DB21.DBD4"], ["Mould.OK", "DB22.DBX0.2"]],
  },
  {
    short: "MP-02", name: "Prensa de moldeo inferior", zone: "Moldeo", status: "RUN", plc: "PLC-MOL-01 · S7-1512",
    vars: [
      { n: "TiempoCiclo", unit: "s", v: 18.1, w: 0.35, dp: 2 },
      { n: "Temperatura", unit: "°C", v: 44, w: 1.8, dp: 1 },
      { n: "Potencia", unit: "kW", v: 68, w: 4, dp: 1 },
      { n: "Vibracion", unit: "mm/s", v: 1.5, w: 0.2, dp: 2 },
      { n: "Presion", unit: "bar", v: 6.0, w: 0.15, dp: 2 },
      { n: "OEE", unit: "%", v: 90.1, w: 0.4, dp: 1 },
      { n: "HumedadArena", unit: "%", v: 3.65, dp: 2 },
    ],
    tags: [["Cycle.Time", "DB20.DBD20"], ["Press.Force", "DB20.DBD28"], ["Sand.Density", "DB21.DBD16"], ["Mould.OK", "DB22.DBX0.3"]],
  },
  {
    short: "ROB-03", name: "Robot posicionador de machos", zone: "Moldeo", status: "RUN", plc: "PLC-MOL-01 · S7-1512",
    vars: [
      { n: "TiempoCiclo", unit: "s", v: 16.8, w: 0.3, dp: 2 },
      { n: "Temperatura", unit: "°C", v: 38, w: 1.2, dp: 1 },
      { n: "Potencia", unit: "kW", v: 7, w: 0.8, dp: 2 },
      { n: "Vibracion", unit: "mm/s", v: 0.3, w: 0.05, dp: 2 },
      { n: "Presion", unit: "bar", v: 6.2, w: 0.12, dp: 2 },
      { n: "OEE", unit: "%", v: 95.1, w: 0.3, dp: 1 },
      { n: "MachosColocados", unit: "uds", v: 1240, w: 0, dp: 0, kind: "counter", rate: 1 / 17 },
    ],
    tags: [["Axis.J1..J6", "DB25.DBD0"], ["Grip.Closed", "DB25.DBX28.0"], ["Core.Present", "DB25.DBX28.1"], ["Cell.Safe", "DB26.DBX0.0"]],
  },
  {
    short: "COL-01", name: "Estación de colada automática", zone: "Colada", status: "RUN", plc: "PLC-COL-01 · S7-1516F",
    flags: [{ n: "Colando", type: "bool", v: false }, { n: "MoldeEnPosicion", type: "bool", v: false }, { n: "CambioCuchara", type: "bool", v: false }],
    vars: [
      { n: "TemperaturaColada", unit: "°C", v: 1421, w: 7, dp: 1 },
      { n: "TiempoCiclo", unit: "s", v: 31.2, w: 0.7, dp: 2 },
      { n: "Potencia", unit: "kW", v: 38, w: 3, dp: 1 },
      { n: "Vibracion", unit: "mm/s", v: 0.8, w: 0.1, dp: 2 },
      { n: "PesoCuchara", unit: "kg", v: 1240, w: 70, dp: 0, kind: "managed" },
      { n: "CaudalColada", unit: "kg/s", v: 8.2, w: 0.55, dp: 2, kind: "managed" },
      { n: "NivelLlenado", unit: "%", v: 0, w: 0, dp: 0, kind: "managed" },
      { n: "OEE", unit: "%", v: 86.5, w: 0.4, dp: 1 },
    ],
    tags: [["Ladle.Weight", "DB30.DBD0"], ["Pour.Temp", "DB30.DBD8"], ["Flow.Rate", "DB31.DBD0"], ["Safety.Zone", "DB32.DBX1.0"]],
  },
  {
    short: "ROB-01", name: "Robot de inoculación y escoriado", zone: "Colada", status: "RUN", plc: "PLC-COL-01 · S7-1516F",
    vars: [
      { n: "TiempoCiclo", unit: "s", v: 24.5, w: 0.4, dp: 2 },
      { n: "Temperatura", unit: "°C", v: 41, w: 1.4, dp: 1 },
      { n: "Potencia", unit: "kW", v: 9, w: 0.9, dp: 2 },
      { n: "Vibracion", unit: "mm/s", v: 0.4, w: 0.06, dp: 2 },
      { n: "Presion", unit: "bar", v: 6.0, w: 0.12, dp: 2 },
      { n: "VelocidadTCP", unit: "m/s", v: 1.2, w: 0.18, dp: 2 },
      { n: "OEE", unit: "%", v: 93.6, w: 0.3, dp: 1 },
    ],
    tags: [["Axis.J1..J6", "DB35.DBD0"], ["TCP.Speed", "DB35.DBD24"], ["Program.No", "DB35.DBW30"], ["Cell.Safe", "DB36.DBX0.0"]],
  },
  {
    short: "ENF-01", name: "Túnel de enfriamiento", zone: "Enfriamiento", status: "RUN", plc: "PLC-LIN-01 · ET200SP",
    vars: [
      { n: "TemperaturaMolde", unit: "°C", v: 612, w: 12, dp: 1 },
      { n: "TiempoResidencia", unit: "min", v: 47, w: 0.8, dp: 1 },
      { n: "Potencia", unit: "kW", v: 54, w: 3.5, dp: 1 },
      { n: "Vibracion", unit: "mm/s", v: 1.2, w: 0.15, dp: 2 },
      { n: "Presion", unit: "kPa", v: 1.8, w: 0.1, dp: 2 },
      { n: "VelocidadVentiladores", unit: "rpm", v: 780, w: 22, dp: 0 },
      { n: "OEE", unit: "%", v: 94.3, w: 0.3, dp: 1 },
      { n: "MoldesEnTunel", unit: "uds", v: 54, dp: 0 },
    ],
    tags: [["Mould.Temp", "DB40.DBD0"], ["Residence.Time", "DB40.DBD8"], ["Fan.Speed", "DB41.DBD0"], ["Exit.Ready", "DB42.DBX0.0"]],
  },
  {
    short: "DES-01", name: "Desmoldeo vibratorio", zone: "Acabado", status: "IDLE", plc: "PLC-ACA-01 · S7-1512",
    flags: [{ n: "Marcha", type: "bool", v: false }],
    vars: [
      { n: "TiempoCiclo", unit: "s", v: 22.8, w: 0.4, dp: 2 },
      { n: "Temperatura", unit: "°C", v: 88, w: 3.5, dp: 1 },
      { n: "Potencia", unit: "kW", v: 110, w: 7, dp: 0, kind: "managed" },
      { n: "Vibracion", unit: "mm/s", v: 8.6, w: 0.7, dp: 2, kind: "managed" },
      { n: "Presion", unit: "bar", v: 4.8, w: 0.15, dp: 2 },
      { n: "FrecuenciaVibracion", unit: "Hz", v: 24, w: 0.5, dp: 1, kind: "managed" },
      { n: "OEE", unit: "%", v: 81.6, w: 0.5, dp: 1 },
    ],
    tags: [["Vib.Frequency", "DB50.DBD0"], ["Motor.Current", "DB50.DBD8"], ["Dust.FilterDP", "DB51.DBD4"], ["Part.Present", "DB52.DBX0.0"]],
  },
  {
    short: "ROB-02", name: "Robot de manipulación de piezas", zone: "Acabado", status: "RUN", plc: "PLC-ACA-01 · S7-1512",
    vars: [
      { n: "TiempoCiclo", unit: "s", v: 21.2, w: 0.35, dp: 2 },
      { n: "Temperatura", unit: "°C", v: 44, w: 1.4, dp: 1 },
      { n: "Potencia", unit: "kW", v: 11, w: 1, dp: 2 },
      { n: "Vibracion", unit: "mm/s", v: 0.5, w: 0.07, dp: 2 },
      { n: "Presion", unit: "bar", v: 6.1, w: 0.12, dp: 2 },
      { n: "CargaUtil", unit: "kg", v: 34, w: 6, dp: 1 },
      { n: "PiezasManipuladas", unit: "uds", v: 3180, w: 0, dp: 0, kind: "counter", rate: 1 / 21 },
      { n: "OEE", unit: "%", v: 92.4, w: 0.3, dp: 1 },
    ],
    tags: [["Axis.J1..J6", "DB55.DBD0"], ["Payload.Kg", "DB55.DBD24"], ["Pick.Count", "DB55.DBD28"], ["Cell.Safe", "DB56.DBX0.0"]],
  },
  {
    short: "QC-01", name: "Célula de calidad 3D", zone: "Calidad", status: "RUN", plc: "PLC-QA-01 · S7-1500",
    vars: [
      { n: "TiempoCiclo", unit: "s", v: 14.6, w: 0.25, dp: 2 },
      { n: "Temperatura", unit: "°C", v: 24, w: 0.4, dp: 1 },
      { n: "Potencia", unit: "kW", v: 12, w: 1, dp: 2 },
      { n: "Vibracion", unit: "mm/s", v: 0.2, w: 0.03, dp: 2 },
      { n: "Presion", unit: "bar", v: 6.1, w: 0.1, dp: 2 },
      { n: "DesviacionEscaneo", unit: "mm", v: 0.08, w: 0.025, dp: 3 },
      { n: "PiezasConformes", unit: "%", v: 98.4, w: 0.2, dp: 2 },
      { n: "OEE", unit: "%", v: 97.8, w: 0.2, dp: 1 },
    ],
    tags: [["Scan.Deviation", "DB60.DBD0"], ["Part.Weight", "DB60.DBD8"], ["Defect.Class", "DB61.DBW0"], ["Part.Accepted", "DB62.DBX0.0"]],
  },
];

export const zones = [...new Set(assets.map(a => a.zone))];
