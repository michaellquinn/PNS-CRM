"""Regenerate openapi.json at the repo root from the running app's own route table.

WHY THIS EXISTS
    openapi.json ships inside every deploy and becomes the app's published API
    description on the platform - it is what other builders see in Substrait's API
    Library, and it takes precedence over anything harvested from the running app. A
    stale one publishes wrong endpoints to everybody.

    It went stale exactly the way hand-maintained files do: on 2026-09-02 it documented
    41 paths and 52 operations while main.py registered 82 routes. Thirty operations -
    the whole Import queue, settings, sync queue, comment threads and bulk-delete
    surface - were missing, and the deploy script had been printing a staleness warning
    on every run for over a week. Writing it by hand is what made that possible, so it
    is generated now.

HOW
    FastAPI already knows every route, its parameters, its request body and its
    response_model. Asking the app is both complete and correct by construction, where
    a hand-written file is neither for long.

    The one thing added on top: FastAPI derives a summary from the FUNCTION NAME
    ("List Queue"), which restates the path rather than saying what the endpoint does.
    This app's handlers all open with a one-line docstring that IS the summary, so that
    first line is promoted and the generated name kept only where there is no docstring.

RUNNING IT
    Needs the backend's own dependencies, which this repo does not vendor:

        python -m venv .venv-spec
        .venv-spec/Scripts/python -m pip install "fastapi>=0.115" \\
            "python-multipart>=0.0.9" "httpx>=0.27"
        .venv-spec/Scripts/python tools/gen_openapi.py

    asyncmy (the OceanBase driver) is stubbed rather than installed: it is only touched
    by lifespan(), which never runs here, and it is the one dependency that needs a
    compiler. Nothing else about the app is faked.

    Re-run it whenever routes or response models change, and commit the result with
    them - the deploy warns when this file is older than backend/, which is the
    backstop, not the plan.
"""
import json
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
_OUT = os.path.join(_REPO, "openapi.json")

sys.path.insert(0, os.path.join(_REPO, "backend"))

# Stub the driver. Import-time main.py only needs the NAMES; the pool is built inside
# lifespan(), which an import never triggers.
_stub = types.ModuleType("asyncmy")
_stub.create_pool = None


class _DictCursor:  # noqa: D401 - placeholder, never instantiated here
    pass


_stub.cursors = types.SimpleNamespace(DictCursor=_DictCursor)
sys.modules.setdefault("asyncmy", _stub)
sys.modules.setdefault("asyncmy.cursors", _stub.cursors)

try:
    import main  # noqa: E402
except ImportError as e:  # pragma: no cover - operator error, not a code path
    sys.exit("could not import backend/main.py: %s\n"
             "Install the backend deps first - see this file's docstring." % e)


def first_line(text):
    """The docstring's opening line, which in this codebase is always the summary."""
    for line in (text or "").splitlines():
        line = line.strip()
        if line:
            return line
    return ""


spec = main.app.openapi()

# Promote each handler's own one-line docstring over FastAPI's function-name guess.
promoted = 0
for path, item in spec.get("paths", {}).items():
    for method, op in item.items():
        if method.lower() not in ("get", "post", "put", "patch", "delete"):
            continue
        summary = first_line(op.get("description"))
        if summary and summary != op.get("summary"):
            op["summary"] = summary
            promoted += 1

# Version the spec by the app's own build marker, so a published description can be
# traced to the deploy that produced it.
spec.setdefault("info", {})["version"] = main.BUILD
spec["info"]["description"] = (
    "Ninja PNS - solutioning and pricing workflow for Ninja Xpress Indonesia. "
    "Every route below requires a signed-in session: identity arrives from the "
    "platform's auth proxy as an X-Forwarded-Email header the browser cannot set, and "
    "the app resolves a role from it. GET /health is the only unauthenticated route. "
    "Generated from the app's own route table by tools/gen_openapi.py - do not hand-edit."
)

paths = spec.get("paths", {})
ops = sum(1 for p in paths.values() for m in p
          if m.lower() in ("get", "post", "put", "patch", "delete"))

with open(_OUT, "w", encoding="utf-8") as fh:
    json.dump(spec, fh, indent=2, ensure_ascii=False, sort_keys=True)
    fh.write("\n")

size_kb = os.path.getsize(_OUT) / 1024
print("wrote %s" % os.path.relpath(_OUT, _REPO))
print("  paths:      %d" % len(paths))
print("  operations: %d" % ops)
print("  schemas:    %d" % len(spec.get("components", {}).get("schemas", {})))
print("  summaries promoted from docstrings: %d" % promoted)
print("  version:    %s" % spec["info"]["version"])
print("  size:       %.1f KB" % size_kb)
