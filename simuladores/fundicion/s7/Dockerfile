# PLC Siemens S7 simulado de la Fundición (S7comm, puerto 102)
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
COPY requirements.txt /tmp/
RUN pip install -r /tmp/requirements.txt
COPY plc_s7.py /app/plc_s7.py
WORKDIR /app
EXPOSE 102
CMD ["python", "plc_s7.py"]
