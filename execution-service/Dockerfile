# execution-service/Dockerfile
#
# Sandboxed Python execution environment for DataChat.
#
# Security measures:
#   - Non-root user (runner)
#   - Headless matplotlib (MPLBACKEND=Agg)
#   - Network isolation handled by Docker Compose (internal network)
#   - Memory + PID limits handled by Docker Compose deploy config
#   - Execution timeout handled by signal.alarm in executor.py

FROM python:3.11-slim

# Create non-root user
RUN useradd -m -s /bin/bash runner

WORKDIR /app

# Install Python dependencies (cached layer — only rebuilds on requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Create mount points for session data
# /uploads is bind-mounted from the host at runtime
RUN mkdir -p /uploads && chown runner:runner /uploads

# Switch to non-root user
USER runner

# Headless matplotlib — no GUI, render to buffer only
ENV MPLBACKEND=Agg
# Unbuffered Python output — ensures print() shows up in logs immediately
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
