# Capa de IA del laboratorio: una sola imagen para dos servicios del compose
#   ia       API REST para Node-RED (uvicorn, puerto 8000)
#   jupyter  JupyterLab con los cuadernos de la serie 4 (puerto 8888)
# Los dos comparten /lab (datos, modelos, cuadernos) mediante un volumen.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    LABIA_DIR=/lab PYTHONPATH=/opt/ia

COPY requirements.txt requirements-jupyter.txt /tmp/
RUN pip install -r /tmp/requirements.txt -r /tmp/requirements-jupyter.txt

RUN useradd --uid 1000 --create-home lab \
    && mkdir -p /lab/datos /lab/modelos /lab/continuo /lab/cuadernos \
    && chown -R lab:lab /lab

COPY labia /opt/ia/labia
COPY servicio /opt/ia/servicio
COPY cuadernos /opt/ia/cuadernos
COPY --chmod=755 entrypoint.sh /opt/ia/entrypoint.sh

USER lab
WORKDIR /lab
EXPOSE 8000 8888
ENTRYPOINT ["/opt/ia/entrypoint.sh"]
CMD ["servicio"]
