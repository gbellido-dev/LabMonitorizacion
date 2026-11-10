"""Descarga los binarios de la vista 3D de GRFICSv3 (GPL-3.0) y comprueba su SHA-256.

Uso: python descargar.py <1|0> <commit> <directorio de salida>
Nunca hace fallar la construcción de la imagen: si algo va mal, la vista 3D
queda sin instalar y ReactorLab funciona igual.
"""
import hashlib
from pathlib import Path
import shutil
import sys
import tempfile
import urllib.request

FICHEROS = [
    ("92221f4cf6ba2f79b2b4b170f7024a99a8a5eab983eaabe7c3d57dac6184cd55", "lfs", "Build/ChemicalPlant.data.unityweb"),
    ("305968661bd9cc7819ac4874cd4855ff1057868c1b6b35c81af27097fdd01db6", "lfs", "Build/ChemicalPlant.wasm.code.unityweb"),
    ("0d8a8ec409d291a0b828b810e5fc0743362ec329caad01c80f68c1486b940a37", "lfs", "Build/ChemicalPlant.wasm.framework.unityweb"),
    ("53b1775ce550b52c1ad252e6a11510bcbaa8d4d76b1623fc13f01d91fd5b7060", "raw", "LowQuality.mp4"),
]


def main(activa: str, commit: str, salida: str) -> None:
    destino = Path(salida)
    (destino / "Build").mkdir(parents=True, exist_ok=True)
    if activa != "1":
        print(f"Vista 3D desactivada (VISTA_3D={activa})")
        return
    bases = {
        "lfs": f"https://media.githubusercontent.com/media/Fortiphyd/GRFICSv3/{commit}/simulation/web_visualization/",
        "raw": f"https://raw.githubusercontent.com/Fortiphyd/GRFICSv3/{commit}/simulation/web_visualization/",
    }
    tmp = Path(tempfile.mkdtemp())
    try:
        for sha, base, ruta in FICHEROS:
            local = tmp / ruta
            local.parent.mkdir(parents=True, exist_ok=True)
            h = hashlib.sha256()
            with urllib.request.urlopen(bases[base] + ruta, timeout=120) as r, open(local, "wb") as f:
                while bloque := r.read(1 << 20):
                    h.update(bloque)
                    f.write(bloque)
            if h.hexdigest() != sha:
                raise ValueError(f"SHA-256 incorrecto en {ruta}")
            print("OK  ", ruta)
        for _, _, ruta in FICHEROS:
            shutil.move(str(tmp / ruta), str(destino / ruta))
        # el cargador de Unity pide también el fichero de símbolos; basta con uno vacío
        (destino / "Build" / "ChemicalPlant.wasm.symbols.unityweb").write_bytes(b"")
        print("Vista 3D instalada")
    except Exception as exc:  # sin red, URL caducada, hash distinto...
        print(f"AVISO: vista 3D no instalada ({exc}); ReactorLab funciona sin ella")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main(*sys.argv[1:4])
