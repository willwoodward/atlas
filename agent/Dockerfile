FROM python:3.12-slim

# git and ssh are the agent's own tools, not the sandbox's: this container owns
# every remote interaction (clone, commit, push, PR) so the sandbox never needs
# credentials. See workspace.py.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]
