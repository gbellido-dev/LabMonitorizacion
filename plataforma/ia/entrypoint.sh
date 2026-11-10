#!/bin/sh
# servicio | jupyter
set -e
mkdir -p /lab/datos /lab/modelos /lab/continuo /lab/cuadernos
# Los cuadernos de la serie 4 se copian solo si no existen: el trabajo del
# alumnado no se sobrescribe nunca (para recuperar uno, bórralo y reinicia).
for f in /opt/ia/cuadernos/*.ipynb; do
  [ -e "$f" ] || continue
  [ -e "/lab/cuadernos/$(basename "$f")" ] || cp "$f" /lab/cuadernos/
done
case "$1" in
  servicio)
    exec uvicorn servicio.app:app --app-dir /opt/ia --host 0.0.0.0 --port 8000 ;;
  jupyter)
    exec jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --ServerApp.root_dir=/lab \
      --IdentityProvider.token="${JUPYTER_TOKEN:-lab}" --ServerApp.default_url=/lab/tree/cuadernos ;;
  *)
    exec "$@" ;;
esac
