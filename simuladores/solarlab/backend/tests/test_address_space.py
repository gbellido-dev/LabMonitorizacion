from app.opcua_server import CONTROL_NODES, PLANT_NODES


def test_node_ids_are_unique() -> None:
    definitions = (*PLANT_NODES, *CONTROL_NODES)
    assert len({item.node_id for item in definitions}) == len(definitions)


def test_controls_are_writable_and_documented() -> None:
    assert all(item.access == "Lectura/Escritura" for item in CONTROL_NODES)
    assert {item.node_id for item in CONTROL_NODES} >= {
        "Controls.RunCommand", "Controls.IrradianceSetpoint", "Controls.FaultCode"
    }
