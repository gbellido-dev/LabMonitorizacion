from app.model import FaultCode, SolarPlantSimulator


def advance(simulator: SolarPlantSimulator, seconds: int = 20) -> None:
    for _ in range(seconds * 10):
        simulator.step(0.1)


def test_clear_day_produces_power() -> None:
    simulator = SolarPlantSimulator()
    simulator.apply_controls({"irradiance_wm2": 1000, "cloud_cover_pct": 0, "soiling_pct": 0})
    advance(simulator)
    # At 1,000 W/m² the modules heat above STC, so the temperature coefficient
    # intentionally keeps the AC output below the 5 MWp nameplate value.
    assert 4200 < simulator.state.active_power_kw <= simulator.rated_power_kw
    assert simulator.state.performance_ratio_pct > 85
    assert all(zone.available for zone in simulator.zones)


def test_inverter_trip_only_stops_one_zone() -> None:
    simulator = SolarPlantSimulator()
    simulator.apply_controls({"irradiance_wm2": 900, "fault_code": FaultCode.INVERTER_TRIP})
    advance(simulator)
    assert simulator.zones[1].active_power_kw == 0
    assert simulator.zones[1].alarm
    assert simulator.state.alarm
    assert simulator.state.availability_pct == 75


def test_grid_outage_disconnects_plant() -> None:
    simulator = SolarPlantSimulator()
    simulator.apply_controls({"fault_code": FaultCode.GRID_OUTAGE})
    advance(simulator, 3)
    assert simulator.state.grid_voltage_v == 0
    assert not simulator.state.connected
    assert simulator.state.active_power_kw < 1


def test_opcua_controls_are_clamped_to_safe_simulation_limits() -> None:
    simulator = SolarPlantSimulator()
    simulator.apply_controls({"irradiance_wm2": 9000, "fault_code": 99})
    assert simulator.commands.irradiance_wm2 == 1200
    assert simulator.commands.fault_code == FaultCode.GRID_OUTAGE
