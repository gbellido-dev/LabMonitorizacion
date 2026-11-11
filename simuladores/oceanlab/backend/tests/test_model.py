from app.model import OceanModel


def test_model_creates_global_fleet_and_payload() -> None:
    model = OceanModel(count=21)
    assert len(model.buoys) == 21
    assert len({buoy.ocean for buoy in model.buoys}) >= 7
    assert all(-180 <= buoy.longitude <= 180 for buoy in model.buoys)
    assert all(-90 <= buoy.latitude <= 90 for buoy in model.buoys)
    payload = model.payload(model.buoys[0])
    assert payload["buoy_id"] == "BOY-001"
    assert "weather" in payload and "device" in payload


def test_fault_injection_and_reset() -> None:
    model = OceanModel(count=3)
    model.inject("BOY-001", "storm")
    assert model.buoys[0].wave_height_m > 8
    model.inject("BOY-001", "offline")
    assert model.buoys[0].status == "offline"
    model.inject("BOY-001", "reset")
    assert model.buoys[0].status == "online"


def test_step_changes_sequence_only_when_running() -> None:
    model = OceanModel(count=1)
    model.step()
    assert model.buoys[0].sequence == 1
    model.running = False
    model.step()
    assert model.buoys[0].sequence == 1


def test_tiempo_acoplado_viento_presion_y_oleaje() -> None:
    """El viento sale de las borrascas (presión baja) y el oleaje lo sigue con retraso."""
    import statistics
    model = OceanModel(count=96, seed=5)
    for _ in range(4 * 60 * 10):                     # 10 min reales = 10 h simuladas
        model.step(0.25)
    presion = [b.pressure_hpa for b in model.buoys]
    viento = [b.wind_speed_mps for b in model.buoys]
    ola = [b.wave_height_m for b in model.buoys]
    assert statistics.correlation(viento, ola) > 0.6
    assert statistics.correlation(presion, viento) < -0.2
    # tormenta inyectada: sopla fuerte y el oleaje se mantiene alto un rato
    b = model.buoys[0]
    model.inject(b.id, "storm")
    for _ in range(4 * 60 * 5):
        model.step(0.25)
    assert b.wind_speed_mps > 20 and b.wave_height_m > 6 and b.pressure_hpa < 990
    model.inject(b.id, "reset")
    for _ in range(4 * 60 * 10):
        model.step(0.25)
    assert b.wind_speed_mps < 20
