export interface Buoy {
  id: string; name: string; ocean: string; latitude: number; longitude: number; status: "online" | "offline";
  battery_pct: number; water_temperature_c: number; air_temperature_c: number; wave_height_m: number;
  wind_speed_mps: number; wind_direction_deg: number; pressure_hpa: number; humidity_pct: number;
  signal_rssi_dbm: number; sequence: number;
}

export interface MqttEvent { kind: string; topic: string; qos: number; retained: boolean; payload: Record<string, unknown>; }
export interface Snapshot {
  timestamp: string; running: boolean; settings: { publish_interval_s: number; qos: number; retained: boolean };
  broker: { host: string; tcp_port: number; ws_port: number; topic_pattern: string }; buoys: Buoy[]; events: MqttEvent[];
}

