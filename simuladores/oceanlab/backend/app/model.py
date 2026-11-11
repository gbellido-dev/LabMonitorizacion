"""Modelo de OceanLab: una flota de boyas bajo un tiempo meteorológico acoplado.

El tiempo no es ruido independiente en cada variable:

* **Borrascas** (centros de bajas presiones) que nacen, se mueven, se profundizan y se rellenan.
  La presión de cada boya es la de su latitud más la depresión de las borrascas cercanas.
* **Viento**: el de fondo de su latitud (alisios, ponientes) más el que generan las borrascas, que
  crece con el gradiente de presión y gira alrededor del centro (al revés en cada hemisferio).
* **Oleaje**: tiende al de un mar desarrollado para ese viento (≈ 0,0214·U², Pierson-Moskowitz) más
  el mar de fondo, con horas de retraso: sube despacio y baja aún más despacio.
* Temperatura del aire (ciclo diario y enfriamiento con tormenta), humedad, carga solar de la batería
  según la hora local y cobertura que empeora con el oleaje.

`escala`: segundos simulados por segundo real (60 por defecto: un minuto de tiempo por segundo, así una
borrasca cruza una zona en unas decenas de minutos de clase). Variable de entorno `OCEANLAB_ESCALA`.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
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
    # estado interno del modelo (no se publica)
    swell_m: float = field(default=0.8, repr=False)
    p_ruido: float = field(default=0.0, repr=False)
    tormenta: float = field(default=0.0, repr=False)


@dataclass
class Borrasca:
    lat: float
    lon: float
    profundidad_hpa: float      # depresión en el centro (negativa)
    radio_km: float
    u_kmh: float                # desplazamiento hacia el este
    v_kmh: float                # desplazamiento hacia el norte
    vida_h: float
    edad_h: float = 0.0
    anclada: str | None = None  # tormenta inyectada sobre una boya: no se mueve


R_TIERRA_KM = 6371.0
K_VIENTO = 700.0                # m/s por hPa/km de gradiente
N_BORRASCAS = 14


def _distancia_km(lat1: float, lon1: float, lat2: float, lon2: float) -> tuple[float, float, float]:
    """Distancia y componentes este/norte (km, aproximación local) del punto 2 al punto 1."""
    dlat = math.radians(lat1 - lat2)
    dlon = math.radians((lon1 - lon2 + 540) % 360 - 180)
    norte = dlat * R_TIERRA_KM
    este = dlon * R_TIERRA_KM * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(este, norte), este, norte


def _presion_base(lat: float) -> float:
    """Altas subtropicales (~30°) y bajas subpolares (~60°)."""
    return 1013.0 + 7.0 * math.cos(math.radians(lat * 3.0)) * (1 if abs(lat) < 70 else 0.4)


def _viento_base(lat: float) -> tuple[float, float]:
    """Viento de fondo (este, norte) en m/s: alisios del este en los trópicos, ponientes en latitudes medias."""
    a = abs(lat)
    if a < 30:
        return -6.0 * math.cos(math.radians(a * 3)), (-1.5 if lat > 0 else 1.5)
    if a < 60:
        return 7.5 * math.sin(math.radians((a - 30) * 6)), 0.0
    return -3.0, 0.0


class OceanModel:
    def __init__(self, count: int = 96, seed: int = 2407, escala: float | None = None) -> None:
        self.random = random.Random(seed)
        self.tick_count = 0
        self.publish_interval_s = 2.0
        self.qos = 0
        self.retained = False
        self.running = True
        self.escala = float(escala if escala is not None else os.getenv("OCEANLAB_ESCALA", "60"))
        self.t_sim_h = self.random.uniform(0, 24)          # hora UTC simulada de partida
        self.borrascas: list[Borrasca] = []
        self.buoys = self._create_buoys(count)
        for _ in range(N_BORRASCAS):
            self.borrascas.append(self._nueva_borrasca(edad_aleatoria=True))
        for b in self.buoys:                                 # el mar ya está hecho al empezar
            self._actualizar(b, 0.0, inicial=True)

    # ------------------------------------------------------------------ creación
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
                water_temperature_c=round(temperature, 1), air_temperature_c=round(temperature, 1),
                wave_height_m=1.0, wind_speed_mps=5.0, wind_direction_deg=0.0, pressure_hpa=1013.0,
                humidity_pct=75.0, signal_rssi_dbm=round(self.random.uniform(-80, -50), 0),
                swell_m=self.random.uniform(0.4, 1.4),
            ))
        return result

    def _nueva_borrasca(self, edad_aleatoria: bool = False) -> Borrasca:
        r = self.random
        # nacen sobre todo en latitudes medias (frentes polares), algunas en los trópicos (ciclones)
        if r.random() < 0.8:
            lat = r.choice((1, -1)) * r.uniform(35, 65)
            u, v = r.uniform(20, 55), r.uniform(-10, 15) * (1 if lat > 0 else -1)     # hacia el este
            prof, radio = -r.uniform(10, 30), r.uniform(800, 1500)
        else:
            lat = r.choice((1, -1)) * r.uniform(10, 25)
            u, v = -r.uniform(10, 25), r.uniform(5, 15) * (1 if lat > 0 else -1)      # hacia el oeste y el polo
            prof, radio = -r.uniform(12, 30), r.uniform(450, 800)
        vida = r.uniform(60, 160)
        return Borrasca(lat, r.uniform(-180, 180), prof, radio, u, v, vida,
                        edad_h=r.uniform(0, vida * 0.8) if edad_aleatoria else 0.0)

    # ------------------------------------------------------------------ física
    def _intensidad(self, c: Borrasca) -> float:
        """Ciclo de vida: se profundiza, madura y se rellena."""
        if c.anclada:
            return max(0.0, 1.0 - max(0.0, c.edad_h - 30.0) / 30.0)       # 30 h madura y 30 h rellenándose
        k = c.edad_h / c.vida_h
        return math.sin(math.pi * min(1.0, k)) ** 0.7

    def _campo(self, lat: float, lon: float) -> tuple[float, float, float, float]:
        """Presión (hPa), viento este/norte (m/s) e intensidad de tormenta (0-1) en un punto."""
        p = _presion_base(lat)
        ve, vn = _viento_base(lat)
        tormenta = 0.0
        signo = 1.0 if lat >= 0 else -1.0
        for c in self.borrascas:
            d, este, norte = _distancia_km(lat, lon, c.lat, c.lon)
            if d > 3 * c.radio_km:
                continue
            g = math.exp(-(d / c.radio_km) ** 2)
            prof = c.profundidad_hpa * self._intensidad(c)
            p += prof * g
            # gradiente de la depresión (hPa/km) y viento que gira alrededor del centro
            grad = -prof * 2 * d / c.radio_km ** 2 * g
            w = K_VIENTO * grad
            if d > 1e-6:
                ve += w * (-norte / d) * signo
                vn += w * (este / d) * signo
            tormenta = max(tormenta, min(1.0, -prof * g / 25.0))
        return p, ve, vn, tormenta

    def _actualizar(self, b: Buoy, dt_h: float, inicial: bool = False) -> None:
        r = self.random
        b.p_ruido += (-b.p_ruido / 3.0) * dt_h + r.gauss(0, 0.25) * math.sqrt(max(dt_h, 1e-9))
        p, ve, vn, tormenta = self._campo(b.latitude, b.longitude)
        b.tormenta = tormenta
        racha = 1.0 + r.gauss(0, 0.06)
        u = max(0.0, min(35.0, math.hypot(ve, vn) * racha))
        b.pressure_hpa = round(p + b.p_ruido, 2)
        b.wind_speed_mps = round(u, 2)
        # dirección meteorológica: de dónde viene el viento
        b.wind_direction_deg = round((math.degrees(math.atan2(-ve, -vn)) + 360) % 360, 1)
        # oleaje: tiende al de un mar desarrollado con horas de retraso (sube en ~4 h, baja en ~9 h)
        h_eq = min(9.0, math.hypot(0.0214 * u * u, b.swell_m))
        if inicial:
            b.wave_height_m = round(h_eq, 2)
        else:
            tau = 4.0 if h_eq > b.wave_height_m else 9.0
            h = b.wave_height_m + (h_eq - b.wave_height_m) * min(1.0, dt_h / tau)
            b.wave_height_m = round(max(0.1, min(9.0, h + r.gauss(0, 0.02))), 2)
        b.swell_m = max(0.3, min(2.0, b.swell_m + r.gauss(0, 0.03) * math.sqrt(max(dt_h, 1e-9))))
        # hora solar local: ciclo diario de la temperatura del aire, la humedad y la carga solar
        hora = (self.t_sim_h + b.longitude / 15.0) % 24
        sol = max(0.0, math.sin(math.pi * (hora - 6) / 12))
        b.water_temperature_c = round(b.water_temperature_c + r.gauss(0, 0.01) * math.sqrt(max(dt_h, 1e-9)), 2)
        b.air_temperature_c = round(b.water_temperature_c + 2.2 * sol - 0.8 - 3.0 * tormenta + r.gauss(0, 0.1), 2)
        b.humidity_pct = round(max(40.0, min(100.0, 78 - 10 * sol + 18 * tormenta + r.gauss(0, 0.8))), 1)
        carga = 1.6 * sol * (1 - 0.6 * tormenta) - 0.55                    # %/h: panel solar menos consumo
        b.battery_pct = round(max(0.0, min(100.0, b.battery_pct + carga * dt_h)), 2)
        b.signal_rssi_dbm = round(max(-110.0, min(-40.0, -55 - 3.5 * b.wave_height_m + r.gauss(0, 1.5))), 0)

    def _mover_borrascas(self, dt_h: float) -> None:
        vivas = []
        for c in self.borrascas:
            c.edad_h += dt_h
            if not c.anclada:
                c.lat += c.v_kmh * dt_h / 111.0
                c.lon = (c.lon + c.u_kmh * dt_h / (111.0 * max(0.2, math.cos(math.radians(c.lat)))) + 540) % 360 - 180
            fin = c.edad_h > (60.0 if c.anclada else c.vida_h) or abs(c.lat) > 75
            if not fin:
                vivas.append(c)
        self.borrascas = vivas
        while sum(1 for c in self.borrascas if not c.anclada) < N_BORRASCAS:
            self.borrascas.append(self._nueva_borrasca())

    def step(self, dt: float = 1.0) -> None:
        if not self.running:
            return
        self.tick_count += 1
        dt_h = dt * self.escala / 3600.0
        self.t_sim_h += dt_h
        self._mover_borrascas(dt_h)
        for buoy in self.buoys:
            self._actualizar(buoy, dt_h)
            buoy.sequence += 1

    # ------------------------------------------------------------------ vistas
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
            "simulation": {"escala": self.escala, "hora_utc": round(self.t_sim_h % 24, 2),
                           "borrascas": len(self.borrascas)},
            "broker": {
                "host": os.getenv("BUOYLAB_MQTT_PUBLIC_HOST", "localhost"),
                "tcp_port": int(os.getenv("BUOYLAB_MQTT_PUBLIC_PORT", "1883")),
                "ws_port": int(os.getenv("BUOYLAB_MQTT_PUBLIC_WS_PORT", "8083")),
                "topic_pattern": "oceanlab/buoys/{buoy_id}/telemetry"},
            "buoys": [{k: v for k, v in asdict(buoy).items() if k not in ("swell_m", "p_ruido", "tormenta")}
                      for buoy in self.buoys],
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
            # una borrasca profunda centrada en la boya (se rellena en unas 60 h simuladas)
            self.borrascas = [c for c in self.borrascas if c.anclada != buoy.id]
            # la boya queda donde el viento es máximo (a radio/√2 del centro: en el ojo apenas sopla)
            base, radio = _presion_base(buoy.latitude), 1300.0
            d = radio / math.sqrt(2) / 111.0
            centro_lat = buoy.latitude + (d if buoy.latitude < 60 else -d)
            self.borrascas.append(Borrasca(centro_lat, buoy.longitude, -(base - 975.0) / math.exp(-0.5), radio,
                                           0.0, 0.0, 60.0, edad_h=10.0, anclada=buoy.id))
            buoy.wave_height_m, buoy.wind_speed_mps, buoy.pressure_hpa = 8.4, 29.0, 975.0
        elif fault == "offline":
            buoy.status = "offline"
        elif fault == "reset":
            self.borrascas = [c for c in self.borrascas if c.anclada != buoy.id]
            buoy.status = "online"
            buoy.battery_pct = 82.0
            buoy.wave_height_m = 1.4
        else:
            raise ValueError(fault)
        return buoy
