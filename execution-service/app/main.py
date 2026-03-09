# execution-service/app/main.py
#
# FastAPI application for the code execution service.
#
# Endpoints:
#   POST /execute   — run Python code in a session's namespace
#   GET  /health    — liveness check (also cleans up stale sessions)

from fastapi import FastAPI
from pydantic import BaseModel

from .session_mgr import get_session_globals, cleanup_stale_sessions
from .executor import execute_code

app = FastAPI(title="DataChat Execution Service")


# ─── Request / Response Models ────────────────────────────────────────────────

class ExecuteRequest(BaseModel):
    session_id: str
    code: str


class ExecuteResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    plot_filenames: list[str]


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/execute", response_model=ExecuteResponse)
async def execute(req: ExecuteRequest):
    """Execute Python code in the session's persistent namespace."""
    session_globals = get_session_globals(req.session_id)
    result = execute_code(req.code, session_globals)
    return result


@app.get("/health")
async def health():
    """Liveness probe. Also opportunistically cleans up idle sessions."""
    removed = cleanup_stale_sessions()
    return {"status": "ok", "stale_sessions_removed": removed}
