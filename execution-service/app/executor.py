# execution-service/app/executor.py
#
# Core code execution engine.
#
# Runs arbitrary Python code inside a session's namespace, capturing:
#   - stdout (print output, df.describe(), etc.)
#   - stderr (tracebacks, warnings)
#   - exit_code (0 = success, 1 = exception, 124 = timeout)
#   - plot_filenames (plotly HTML + matplotlib PNG saved to OUTPUT_DIR)
#
# Security is handled at the Docker layer (non-root, no network, memory limit).
# This module adds a 30-second timeout via signal.alarm.

import io
import ast
import os
import signal
import traceback
from contextlib import redirect_stdout, redirect_stderr
from typing import Any

# Maximum execution time in seconds
EXECUTION_TIMEOUT = 30

# Maximum output length returned to the caller (prevents OOM from huge prints)
MAX_STDOUT_LENGTH = 50_000
MAX_STDERR_LENGTH = 10_000


def execute_code(code: str, session_globals: dict) -> dict[str, Any]:
    """
    Execute a code string in the given namespace.

    Returns:
        {
            "stdout": str,
            "stderr": str,
            "exit_code": int,           # 0=ok, 1=error, 124=timeout
            "plot_filenames": [str]     # filenames saved to OUTPUT_DIR
        }
    """
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    plot_filenames: list[str] = []
    exit_code = 0

    output_dir = session_globals.get("OUTPUT_DIR", "/uploads/output")
    os.makedirs(output_dir, exist_ok=True)

    # Patch plotly and matplotlib to save plots to disk instead of displaying
    _patch_plotly(session_globals, plot_filenames, output_dir)
    _patch_matplotlib(session_globals, plot_filenames, output_dir)

    # Set execution timeout (Unix only — fine in Docker Linux container)
    original_handler = signal.getsignal(signal.SIGALRM)

    def _timeout_handler(signum, frame):
        raise TimeoutError(f"Execution timed out after {EXECUTION_TIMEOUT}s")

    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(EXECUTION_TIMEOUT)

    try:
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            # Like Jupyter: if the last statement is an expression, print its repr
            tree = ast.parse(code)
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                # Compile everything except the last statement
                last_expr = tree.body.pop()
                if tree.body:
                    exec(compile(tree, "<code>", "exec"), session_globals)
                # Eval the last expression and print its repr (if not None)
                result = eval(
                    compile(ast.Expression(last_expr.value), "<code>", "eval"),
                    session_globals,
                )
                if result is not None:
                    stdout_buf.write(_format_result(result) + "\n")
            else:
                exec(code, session_globals)
    except TimeoutError as e:
        exit_code = 124
        stderr_buf.write(str(e))
    except Exception:
        exit_code = 1
        stderr_buf.write(traceback.format_exc())
    finally:
        signal.alarm(0)  # Cancel timeout
        signal.signal(signal.SIGALRM, original_handler)

    # Capture any matplotlib figures that weren't explicitly shown
    _capture_pending_figures(session_globals, plot_filenames, output_dir)

    return {
        "stdout": stdout_buf.getvalue()[:MAX_STDOUT_LENGTH],
        "stderr": stderr_buf.getvalue()[:MAX_STDERR_LENGTH],
        "exit_code": exit_code,
        "plot_filenames": plot_filenames,
    }


def _format_result(result: Any) -> str:
    """Format an expression result for display. DataFrames/Series → HTML table."""
    try:
        import pandas as pd
        if isinstance(result, (pd.DataFrame, pd.Series)):
            html = result.to_html(max_rows=100, max_cols=50)
            return f"<!--DF-->{html}<!--/DF-->"
    except ImportError:
        pass
    return repr(result)


def _next_plot_filename(session_globals: dict, ext: str = "png") -> str:
    """Generate a unique plot filename using a session-level counter."""
    counter = session_globals.get("__plot_counter__", 0)
    filename = f"plot_{counter}.{ext}"
    session_globals["__plot_counter__"] = counter + 1
    return filename


def _save_figure(fig, output_dir: str, filename: str) -> None:
    """Save a matplotlib figure to disk as PNG."""
    filepath = os.path.join(output_dir, filename)
    fig.savefig(filepath, format="png", dpi=100, bbox_inches="tight")


def _patch_plotly(
    session_globals: dict, plot_filenames: list[str], output_dir: str
) -> None:
    """
    Replace plotly's fig.show() with a function that saves figures as
    interactive HTML files to disk.
    """
    try:
        import plotly.graph_objects as go
        import plotly.io as pio
    except ImportError:
        return

    # Prevent plotly from trying to open a browser
    pio.renderers.default = "json"

    _original_show = go.Figure.show

    def _capturing_show(self, *args, **kwargs):
        """Save the Plotly figure as an interactive HTML file and print a summary."""
        filename = _next_plot_filename(session_globals, ext="html")
        filepath = os.path.join(output_dir, filename)
        self.write_html(filepath, include_plotlyjs="cdn")
        plot_filenames.append(filename)
        # Print a summary so the LLM can reference this plot later
        print(_summarize_plotly_figure(self, filename))

    go.Figure.show = _capturing_show


def _patch_matplotlib(
    session_globals: dict, plot_filenames: list[str], output_dir: str
) -> None:
    """
    Replace plt.show() with a function that saves figures to disk
    and appends filenames to the plot_filenames list.
    """
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return

    def _capturing_show(*args, **kwargs):
        """Save all open figures to disk, then close them."""
        for fig_num in plt.get_fignums():
            fig = plt.figure(fig_num)
            filename = _next_plot_filename(session_globals)
            _save_figure(fig, output_dir, filename)
            plot_filenames.append(filename)
            plt.close(fig)

    session_globals["__capturing_show__"] = _capturing_show
    plt.show = _capturing_show


def _capture_pending_figures(
    session_globals: dict, plot_filenames: list[str], output_dir: str
) -> None:
    """
    After execution, save any matplotlib figures that the code created
    but didn't explicitly call plt.show() on.
    """
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return

    for fig_num in plt.get_fignums():
        fig = plt.figure(fig_num)
        filename = _next_plot_filename(session_globals)
        _save_figure(fig, output_dir, filename)
        plot_filenames.append(filename)
        plt.close(fig)


def _summarize_plotly_figure(fig, filename: str) -> str:
    """Extract a text summary of a Plotly figure for LLM context."""
    parts = [f"[Plot saved: {filename}]"]

    layout = fig.layout
    if layout.title and layout.title.text:
        parts.append(f"  Title: {layout.title.text}")
    if layout.xaxis and layout.xaxis.title and layout.xaxis.title.text:
        parts.append(f"  X-axis: {layout.xaxis.title.text}")
    if layout.yaxis and layout.yaxis.title and layout.yaxis.title.text:
        parts.append(f"  Y-axis: {layout.yaxis.title.text}")

    for i, trace in enumerate(fig.data):
        trace_type = trace.type or "unknown"
        name = trace.name or f"trace_{i}"
        info = f"  Trace {i}: {trace_type} ({name})"
        # Include actual data points (up to 30) so the LLM can analyze trends
        try:
            if hasattr(trace, "x") and trace.x is not None:
                x_vals = [v for v in trace.x if v is not None][:30]
                if x_vals:
                    formatted = [f"{v:.2f}" if isinstance(v, float) else str(v) for v in x_vals]
                    info += f"\n    x: [{', '.join(formatted)}]"
            if hasattr(trace, "y") and trace.y is not None:
                y_vals = [v for v in trace.y if v is not None][:30]
                if y_vals:
                    formatted = [f"{v:.2f}" if isinstance(v, float) else str(v) for v in y_vals]
                    info += f"\n    y: [{', '.join(formatted)}]"
        except Exception:
            pass
        parts.append(info)

    return "\n".join(parts)
