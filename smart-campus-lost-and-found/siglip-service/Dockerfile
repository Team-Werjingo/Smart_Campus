FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/model-cache

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.6.0
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .

EXPOSE 8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
