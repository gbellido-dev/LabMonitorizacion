from app.model import FaultCode, OperatingState, TurbineSimulator


def advance(simulator: TurbineSimulator, seconds: float, step: float = 0.1) -> None:
    for _ in range(int(seconds / step)):
        simulator.step(step)


def test_turbine_reaches_generation_at_normal_wind() -> None:
    simulator = TurbineSimulator()
    simulator.apply_controls({"wind_speed_mps": 10.0, "turbulence_pct": 0.0})
    advance(simulator, 30.0)
    assert simulator.state.operating_state == int(OperatingState.RUNNING)
    assert simulator.state.rotor_rpm > 7.0
    assert simulator.state.active_power_kw > 1000.0


def test_cut_out_wind_stops_generation() -> None:
    simulator = TurbineSimulator()
    simulator.apply_controls({"wind_speed_mps": 28.0, "turbulence_pct": 0.0})
    advance(simulator, 4.0)
    assert simulator.state.wind_ok is False
    assert simulator.state.active_power_kw == 0.0


def test_fault_injection_sets_alarm_and_brakes() -> None:
    simulator = TurbineSimulator()
    simulator.apply_controls({"fault_code": int(FaultCode.HIGH_VIBRATION), "turbulence_pct": 0.0})
    advance(simulator, 5.0)
    assert simulator.state.alarm is True
    assert simulator.state.operating_state == int(OperatingState.FAULT)
    assert simulator.state.active_power_kw == 0.0
    assert simulator.state.vibration_mms > 2.0

