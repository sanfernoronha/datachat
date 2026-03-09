# execution-service/app/session_mgr.py
#
# Manages per-session Python namespaces.
#
# Each session gets its own globals dict so variables persist across
# multiple code executions — just like cells in a Jupyter notebook.
# Common imports (pandas, numpy) are pre-seeded so the LLM doesn't
# need to repeat them every time.

import time
from typing import Any

# session_id → { "globals": dict, "last_used": float }
_sessions: dict[str, dict[str, Any]] = {}

# Sessions idle for longer than this are cleaned up
SESSION_TTL_SECONDS = 3600  # 1 hour


def get_session_globals(session_id: str) -> dict:
    """
    Return the globals dict for a session, creating one if it doesn't exist.
    Pre-seeds common imports and DATA_DIR / OUTPUT_DIR paths.
    """
    if session_id not in _sessions:
        g: dict[str, Any] = {"__builtins__": __builtins__}

        # Pre-seed common data science imports
        exec(
            "import pandas as pd\n"
            "import numpy as np\n"
            "import matplotlib\n"
            "import matplotlib.pyplot as plt\n"
            "import plotly.express as px\n"
            "import plotly.graph_objects as go\n",
            g,
        )

        # Set session-specific file paths
        # The /uploads directory is bind-mounted from the host
        g["DATA_DIR"] = f"/uploads/{session_id}/data"
        g["OUTPUT_DIR"] = f"/uploads/{session_id}/output"

        # Plot filename counter (incremented by executor to avoid collisions)
        g["__plot_counter__"] = 0

        # Ensure output directory exists
        import os
        os.makedirs(g["OUTPUT_DIR"], exist_ok=True)

        _sessions[session_id] = {"globals": g, "last_used": time.time()}

    _sessions[session_id]["last_used"] = time.time()
    return _sessions[session_id]["globals"]


def cleanup_stale_sessions() -> int:
    """Remove sessions that haven't been used within SESSION_TTL_SECONDS. Returns count removed."""
    now = time.time()
    stale = [sid for sid, s in _sessions.items() if now - s["last_used"] > SESSION_TTL_SECONDS]
    for sid in stale:
        del _sessions[sid]
    return len(stale)
