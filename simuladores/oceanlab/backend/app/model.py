from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import math
import os
import random


WATER_REGIONS: dict[str, list[tuple[float, float]]] = {
    "Atlántico Norte": [(35, -45), (45, -30), (25, -35)],
    "Atlántico Sur": [(-20, -25), (-35, -15), (-10, -30)],
    "Pacífico Norte": [(35, -150), (25, -140), (45, -165)],
    "Pacífico Sur": [(-25, -130), (-40, -110), (-15, -150)],
    "Océano Índico": [(-20, 80), (-30, 65), (-10, 90)],
    "Océano Ártico": [(82, 0), (80, 120), (78, -150)],
    "Océano Austral": [(-60, 0), (-62, 90), (-58, -120)],
    "Mar Mediterráneo": [(38, 5), (35, 18), (34, 28)],
    "Mar Caribe": [(15, -75), (17, -65), (13, -80)],
    "Mar Báltico": [(57, 19), (59, 22), (55.5, 16)],
    "Mar del Norte": [(56, 3), (58, 1), (54, 4)],
    "Mar Negro": [(43, 34), (42, 30), (44, 37)],
    "Mar Rojo": [(20, 38), (17, 40), (24, 36)],
    "Mar Arábigo": [(15, 65), (12, 60), (18, 68)],
    "Bahía de Bengala": [(15, 87), (12, 90), (18, 89)],
    "Mar de China Meridional": [(14, 114), (10, 112), (17, 116)],
    "Mar de China Oriental": [(28, 126), (30, 124), (26, 125)],
    "Mar del Japón": [(40, 135), (42, 138), (38, 132)],
    "Mar de Filipinas": [(18, 132), (12, 130), (22, 135)],
    "Mar del Coral": [(-18, 155), (-22, 157), (-15, 150)],
    "Mar de Tasmania": [(-40, 160), (-35, 165), (-43, 155)],
    "Mar de Bering": [(57, -175), (60, 175), (55, 170)],
    "Mar de Ojotsk": [(52, 150), (55, 148), (49, 154)],
    "Mar del Labrador": [(58, -52), (55, -48), (61, -56)],
    "Mar de Noruega": [(66, 2), (68, 5), (64, -2)],
    "Mar de Groenlandia": [(72, -8), (74, -2), (70, -12)],
    "Mar de Barents": [(74, 35), (72, 40), (76, 30)],
    "Mar de Weddell": [(-70, -35), (-68, -45), (-72, -25)],
    "Golfo de México": [(24, -90), (22, -94), (26, -87)],
    "Mar de Java": [(-5, 110), (-4, 113), (-6, 107)],
    "Mar de Andamán": [(10, 95), (12, 96), (8, 97)],
    "Mar de Arafura": [(-10, 137), (-8, 133), (-12, 140)],
}


@dataclass
class Buoy:
    id: str
    name: str
    ocean: str
    latitude: float
    longitude: float
    status: str
    battery_pct: float
    water_temperature_c: float
    air_temperature_c: float
    wave_height_m: float
    wind_speed_mps: float
    wind_direction_deg: float
    pressure_hpa: float
    humidity_pct: float
    signal_rssi_dbm: float
    sequence: int = 0


class OceanModel:
    def __init__(self, count: int = 96, seed: int = 2407) -> None:
        self.random = random.Random(seed)
        self.tick_count = 0
        self.publish_interval_s = 2.0
        self.qos = 0
        self.retained = False
        self.running = True
        self.buoys = self._create_buoys(count)

    def _create_buoys(self, count: int) -> list[Buoy]:
        regions = list(WATER_REGIONS.items())
        result: list[Buoy] = []
        for index in range(count):
            region_index = index % len(regions)
            point_index = (index // len(regions)) % 3
            ocean, positions = regions[region_index]
            lat, lon = positions[point_index]
            temperature = 27 - abs(lat) * 0.34 + self.random.uniform(-1.5, 1.5)
            result.append(Buoy(
                id=f"BOY-{index + 1:03d}", name=f"Estación {ocean} {point_index + 1}",
                ocean=ocean, latitude=round(lat, 4), longitude=round(lon, 4), status="online",
                battery_pct=round(self.random.uniform(62, 100), 1),
                water_temperature_c=round(temperature, 1), air_temperature_c=round(temperature + self.random.uniform(-2, 3), 1),
                wave_height_m=round(self.random.uniform(0.4, 3.8), 2), wind_speed_mps=round(self.random.uniform(2, 15), 1),
                wind_direction_deg=round(self.random.uniform(0, 360), 0), pressure_hpa=round(self.random.uniform(995, 1025), 1),
                humidity_pct=round(self.random.uniform(58, 94), 1), signal_rssi_dbm=round(self.random.uniform(-88, -48), 0),
            ))
        return result

    def step(self, dt: float = 1.0) -> None:
        if not self.running:
            return
        self.tick_count += 1
        for index, buoy in enumerate(self.buoys):
            phase = self.tick_count * 0.045 + index * 0.37
            noise = self.random.uniform(-0.08, 0.08)
            buoy.water_temperature_c = round(buoy.water_temperature_c + math.sin(phase) * 0.012 + noise * 0.03, 2)
            buoy.air_temperature_c = round(buoy.air_temperature_c + math.sin(phase * 1.4) * 0.025 + noise, 2)
            buoy.wave_height_m = round(max(0.1, min(9.0, buoy.wave_height_m + math.sin(phase * 0.8) * 0.012 + noise * 0.25)), 2)
            buoy.wind_speed_mps = round(max(0.0, min(35.0, buoy.wind_speed_mps + math.sin(phase * 1.2) * 0.04 + noise * 0.4)), 2)
            buoy.wind_direction_deg = round((buoy.wind_direction_deg + math.sin(phase) * 0.7) % 360, 1)
            buoy.pressure_hpa = round(buoy.pressure_hpa + math.sin(phase * 0.25) * 0.018, 2)
            buoy.battery_pct = round(max(0, buoy.battery_pct - dt * 0.00008), 2)
            buoy.sequence += 1

    def payload(self, buoy: Buoy) -> dict:
        return {
            "buoy_id": buoy.id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sequence": buoy.sequence,
            "location": {"latitude": buoy.latitude, "longitude": buoy.longitude, "ocean": buoy.ocean},
            "weather": {
                "water_temperature_c": buoy.water_temperature_c, "air_temperature_c": buoy.air_temperature_c,
                "wave_height_m": buoy.wave_height_m, "wind_speed_mps": buoy.wind_speed_mps,
                "wind_direction_deg": buoy.wind_direction_deg, "pressure_hpa": buoy.pressure_hpa,
                "humidity_pct": buoy.humidity_pct,
            },
            "device": {"battery_pct": buoy.battery_pct, "signal_rssi_dbm": buoy.signal_rssi_dbm, "status": buoy.status},
        }

    def snapshot(self) -> dict:
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(), "running": self.running,
            "settings": {"publish_interval_s": self.publish_interval_s, "qos": self.qos, "retained": self.retained},
            "broker": {
                "host": os.getenv("BUOYLAB_MQTT_PUBLIC_HOST", "localhost"),
                "tcp_port": int(os.getenv("BUOYLAB_MQTT_PUBLIC_PORT", "1883")),
                "ws_port": int(os.getenv("BUOYLAB_MQTT_PUBLIC_WS_PORT", "8083")),
                "topic_pattern": "oceanlab/buoys/{buoy_id}/telemetry"},
            "buoys": [asdict(buoy) for buoy in self.buoys],
        }

    def get(self, buoy_id: str) -> Buoy | None:
        return next((buoy for buoy in self.buoys if buoy.id == buoy_id), None)

    def inject(self, buoy_id: str, fault: str) -> Buoy:
        buoy = self.get(buoy_id)
        if buoy is None:
            raise KeyError(buoy_id)
        if fault == "battery":
            buoy.battery_pct = 8.0
        elif fault == "storm":
            buoy.wave_height_m, buoy.wind_speed_mps, buoy.pressure_hpa = 8.4, 29.0, 975.0
        elif fault == "offline":
            buoy.status = "offline"
        elif fault == "reset":
            buoy.status = "online"
            buoy.battery_pct = 82.0
            buoy.wave_height_m = 1.4
        else:
            raise ValueError(fault)
        return buoy
