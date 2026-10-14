FROM python:3.11-alpine

# Prevent Python from writing bytecode and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first for efficient Docker layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY src/ /app/src/

WORKDIR /app/src

EXPOSE 3000

CMD ["gunicorn", "--workers", "4", "--threads", "4", "--timeout", "600", "--bind", "0.0.0.0:3000", "app:app"]
