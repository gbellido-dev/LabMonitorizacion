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
