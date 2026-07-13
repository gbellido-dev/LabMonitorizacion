export interface TurbineState {
  simulated_seconds: number;
  wind_speed_mps: number;
  wind_direction_deg: number;
  nacelle_yaw_deg: number;
  rotor_rpm: number;
  generator_rpm: number;
  pitch_deg: number;
  active_power_kw: number;
  torque_nm: number;
  energy_kwh: number;
  vibration_mms: number;
  bearing_temperature_c: number;
  gearbox_temperature_c: number;
  operating_state: number;
  operating_state_name: string;
  fault_code: number;
  fault_name: string;
  ready: boolean;
  running: boolean;
  alarm: boolean;
  grid_connected: boolean;
  wind_ok: boolean;
}

export interface TurbineCommands {
  run_command: boolean;
  brake_command: boolean;
  manual_mode: boolean;
  wind_speed_mps: number;
  wind_direction_deg: number;
  pitch_command_deg: number;
  yaw_command_deg: number;
  power_limit_kw: number;
  fault_code: number;
  turbulence_pct: number;
  simulation_speed: number;
}

export interface ModbusTransaction {
  timestamp: string;
  direction: "RX" | "TX";
  hex: string;
  length: number;
  transaction_id?: number;
  protocol_id?: number;
  mbap_length?: number;
  unit_id?: number;
  function_code?: number;
}

export interface RawRegisters {
  coils: boolean[];
  holding: number[];
  input: number[];
  discrete?: boolean[];
}

export interface Snapshot {
  type?: string;
  state: TurbineState;
  commands: TurbineCommands;
  model: {
    rated_power_kw: number;
    cut_in_mps: number;
    rated_wind_mps: number;
    cut_out_mps: number;
  };
  transactions?: ModbusTransaction[];
  raw_registers?: RawRegisters;
  modbus?: { host: string; port: number };
}

export interface RegisterDefinition {
  table: "coil" | "discrete" | "input" | "holding";
  pdu_address: number;
  reference: string;
  name: string;
  access: string;
  data_type: string;
  scale: string;
  unit: string;
  words: number;
}

