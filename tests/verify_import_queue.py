"""The Import queue must actually fetch what was queued, on every run.

Four opportunities sat "pending" for days without ever being fetched (Michael: 907113,
then 907174, 904840 and 907124). The queue looked like it was working - rows appeared,
they said pending, nothing was obviously broken - and nothing was ever going to happen
to them.

Two separate faults, one after the other, and the second is why this suite exists:

  1. `queue_only = body.queue_ids is not None`. Passing queued ids was the same act as
     switching discovery off, so the auto sweep only loaded the queue when
     sync.queue_only was on. It defaults to off.

  2. Fixing that was not enough, because the FETCH was still a branch of the window
     chain: `elif queue_only:`. So the ids were loaded and then never read. The first
     fix looked right and changed nothing, which is the failure mode worth guarding.

Both are structural - a queue with nothing in it behaves identically to a queue that is
never read, so this is checked over the AST rather than by outcome.
"""
import ast
import io
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
src = io.open(os.path.join(_REPO, "backend", "main.py"), encoding="utf-8").read()
tree = ast.parse(src)

fails = []


def check(label, ok, hint=""):
    if not ok:
        fails.append(label + (" - " + hint if hint else ""))
    print(("  ok   " if ok else "  FAIL ") + label)


print("the sweep loads the queue whether or not queue-only is on")

_auto = next((n for n in ast.walk(tree)
              if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
              and "auto" in n.name and "sync" in n.name), None)
_auto_src = ast.get_source_segment(src, _auto) if _auto else ""
_lines = [l for l in (_auto_src or "").split(chr(10)) if "pending_queue_ids()" in l]
check("the auto sweep asks for the pending queue", bool(_lines),
      "nothing populates queue_ids, so the queue is never read")

if _lines:
    # The call must not sit under an `if ... queue_only` guard.
    _all = (_auto_src or "").split(chr(10))
    _i = next(i for i, l in enumerate(_all) if "pending_queue_ids()" in l)
    _ind = len(_all[_i]) - len(_all[_i].lstrip())
    _guard = None
    for j in range(_i - 1, -1, -1):
        l = _all[j]
        if not l.strip() or l.strip().startswith("#"):
            continue
        k = len(l) - len(l.lstrip())
        if k < _ind and (l.strip().startswith("if ") or l.strip().startswith("elif ")):
            _guard = l.strip()
            break
    check("and does so unconditionally, not only in queue-only mode",
          _guard is None or "queue_only" not in _guard,
          f"guarded by {_guard!r} - queue_only is off by default, so the queue would "
          f"never be loaded")

print()
print("and it FETCHES them, rather than only loading the list")

_sync = next(n for n in ast.walk(tree)
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
             and n.name == "sync_salescrm")
_ssrc = ast.get_source_segment(src, _sync) or ""
_sl = _ssrc.split(chr(10))
_fetch = [i for i, l in enumerate(_sl) if "fresh_q = sorted" in l]
check("the queued ids are fetched by id somewhere", bool(_fetch),
      "loading the list and never reading it is what the second bug was")

if _fetch:
    _i = _fetch[0]
    _ind = len(_sl[_i]) - len(_sl[_i].lstrip())
    _guard = None
    for j in range(_i - 1, -1, -1):
        l = _sl[j]
        if not l.strip() or l.strip().startswith("#"):
            continue
        k = len(l) - len(l.lstrip())
        if k < _ind and (l.strip().startswith("if ") or l.strip().startswith("elif ")):
            _guard = l.strip()
            break
    check("the fetch is NOT gated on queue_only",
          _guard is not None and "queue_only" not in _guard,
          f"guarded by {_guard!r} - this is exactly the bug: the ids were loaded and "
          f"then never read, so the first fix looked right and changed nothing")
    check("it is guarded on there being something queued",
          _guard is not None and "queued" in _guard,
          f"guard is {_guard!r}")

print()
print("queue_only still means what it says: no discovery of its own")
check("queue_only zeroes the day window somewhere",
      any("elif queue_only:" in l for l in _sl),
      "with the fetch hoisted out, this branch is what stops the sweep also discovering")

print()
if fails:
    print("FAILED %d check(s):" % len(fails))
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("ALL IMPORT QUEUE CHECKS PASSED")
