export interface Commands {
  run_command: boolean;
  irradiance_wm2: number;
  ambient_temperature_c: number;
  cloud_cover_pct: number;
  soiling_pct: number;
  tracking_enabled: boolean;
  fault_code: number;
  simulation_speed: number;
}

export interface PlantState {
  active_power_kw: number;
  daily_energy_kwh: number;
  irradiance_wm2: number;
  ambient_temperature_c: number;
  panel_temperature_c: number;
  dc_voltage_v: number;
  dc_current_a: number;
  grid_voltage_v: number;
  grid_frequency_hz: number;
  performance_ratio_pct: number;
  tracker_angle_deg: number;
  availability_pct: number;
  alarm: boolean;
  connected: boolean;
  operating_state: number;
  operating_state_name: string;
  fault_name: string;
}

export interface ZoneState {
  zone_id: number;
  name: string;
  active_power_kw: number;
  dc_current_a: number;
  panel_temperature_c: number;
  performance_ratio_pct: number;
  available: boolean;
  alarm: boolean;
}

export interface OpcNode {
  node_id: string;
  browse_path: string;
  display_name: string;
  data_type: string;
  unit: string;
  access: string;
  source: string;
  description: string;
  value: number | boolean;
}

export interface OpcEvent {
  timestamp: string;
  kind: string;
  node: string;
  value: unknown;
}

export interface Snapshot {
  commands: Commands;
  state: PlantState;
  zones: ZoneState[];
  opcua: {
    endpoint: string;
    namespace_uri: string;
    namespace_index: number;
    security: string;
    running: boolean;
  };
  nodes: OpcNode[];
  events: OpcEvent[];
  meta: { rated_power_kw: number; model: string };
}
