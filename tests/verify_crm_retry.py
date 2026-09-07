"""How the Sales CRM client answers a throttle, executed out of the real main.py.

Michael queued opportunity 907113 on 2026-09-04 and it failed: account 1419431 "could
not be read". The account was fine. Sales CRM had answered 429 - too many requests -
and the client treated that temporary answer as a permanent one: raise_for_status()
turned it into an exception, warm_accounts() cached the miss, and the ticket was marked
failed for good. A second ask a moment later would have worked.

Twenty-four concurrent account reads is what provoked it. Sales CRM has no bulk-by-id
endpoint, so a page of opportunities means one request per account, and the sweep fired
them in a burst.

Two rules pinned here, because getting either backwards is silent:

  * a TEMPORARY refusal is retried - 429 and 503. Not retrying them loses tickets that
    nothing is wrong with, which is the bug this suite exists for.
  * everything else is NOT retried. A 404 will not become a 200 by asking again, and
    retrying a real error only delays reporting it and burns the sweep's time budget.

Also pinned: the retry is BOUNDED. An unbounded one is worse than none - SYNC_BUDGET_S
exists because a sweep that overruns hits the ingress timeout and returns a bare 502,
so one throttled account must not be able to eat the whole run.

Executed rather than read: this is control flow over HTTP status codes, and no amount of
source-matching shows whether the loop actually stops.
"""
import ast
import asyncio
import io
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
src = io.open(os.path.join(_REPO, "backend", "main.py"), encoding="utf-8").read()

WANT_FN = {"_retry_after"}
WANT_CLS = {"SalesCrm"}
WANT_VAR = {"_CRM_TRIES", "_CRM_MAX_WAIT", "SALESCRM_BASE", "SYNC_CONCURRENCY"}

keep = []
for node in ast.parse(src).body:
    if isinstance(node, ast.FunctionDef) and node.name in WANT_FN:
        keep.append(node)
    elif isinstance(node, ast.ClassDef) and node.name in WANT_CLS:
        keep.append(node)
    elif isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id in WANT_VAR:
                keep.append(node)


class _HTTPException(Exception):
    """Stands in for fastapi's, so this suite needs no web framework installed."""

    def __init__(self, status, detail=""):
        super().__init__(detail)
        self.status_code, self.detail = status, detail


ns = {"asyncio": asyncio, "os": os, "HTTPException": _HTTPException,
      "SALESCRM_BASE": "https://example.invalid/api/v1"}
exec(compile(ast.fix_missing_locations(ast.Module(body=keep, type_ignores=[])),
             "<crm>", "exec"), ns)

SalesCrm = ns["SalesCrm"]
TRIES = ns["_CRM_TRIES"]
MAX_WAIT = ns["_CRM_MAX_WAIT"]

fails = []


def check(label, ok, hint=""):
    if not ok:
        fails.append(label + (" - " + hint if hint else ""))
    print(("  ok   " if ok else "  FAIL ") + label)


class Resp:
    def __init__(self, code, body=None, retry_after=None):
        self.status_code = code
        self._body = body if body is not None else {"items": []}
        self.headers = {"Retry-After": retry_after} if retry_after else {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("HTTP %d" % self.status_code)

    def json(self):
        return self._body


class Client:
    """Hands back a scripted sequence and counts how many times it was asked."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = 0

    async def get(self, url, params=None):
        self.calls += 1
        return self.script[min(self.calls - 1, len(self.script) - 1)]


async def call(script):
    """Returns (ok, calls, seconds)."""
    c = Client(script)
    loop = asyncio.get_event_loop()
    t0 = loop.time()
    try:
        await SalesCrm(c).records("Account", id="1419431")
        ok = True
    except Exception:
        ok = False
    return ok, c.calls, loop.time() - t0


async def main():
    print("a temporary refusal is retried")
    ok, calls, _ = await call([Resp(429), Resp(200)])
    check("429 then 200 succeeds", ok and calls == 2, f"ok={ok} calls={calls}")
    ok, calls, _ = await call([Resp(429), Resp(429), Resp(200)])
    check("429, 429 then 200 succeeds", ok and calls == 3, f"ok={ok} calls={calls}")
    ok, calls, _ = await call([Resp(503), Resp(200)])
    check("503 is retried too", ok and calls == 2, f"ok={ok} calls={calls}")

    print()
    print("a permanent refusal is NOT retried")
    for code in (404, 400, 500):
        ok, calls, _ = await call([Resp(code)])
        check(f"{code} fails on the first call", (not ok) and calls == 1,
              f"ok={ok} calls={calls} - retrying this only delays the report")

    print()
    print("the retry is bounded, so one bad account cannot eat the sweep")
    ok, calls, secs = await call([Resp(429)])
    check(f"gives up after {TRIES} attempts", (not ok) and calls == TRIES,
          f"calls={calls}")
    check("and does so quickly", secs < TRIES * MAX_WAIT + 1, f"took {secs:.1f}s")

    print()
    print("the server's own Retry-After wins over our guess, but is still capped")
    ok, calls, secs = await call([Resp(429, retry_after="1"), Resp(200)])
    check("Retry-After: 1 is honoured", ok and 0.9 <= secs < 2.0, f"took {secs:.2f}s")
    ok, calls, secs = await call([Resp(429, retry_after="600"), Resp(200)])
    check("Retry-After: 600 is capped, not obeyed", ok and secs <= MAX_WAIT + 1,
          f"took {secs:.1f}s - an uncapped header would stall the whole sweep")
    ok, calls, secs = await call([Resp(429, retry_after="junk"), Resp(200)])
    check("an unparseable Retry-After falls back", ok and secs < MAX_WAIT + 1,
          f"took {secs:.1f}s")

    print()
    print("a first-time success costs nothing")
    ok, calls, secs = await call([Resp(200)])
    check("200 returns immediately", ok and calls == 1 and secs < 0.2,
          f"calls={calls} secs={secs:.2f}")


asyncio.run(main())

print()
print("concurrency is polite enough not to provoke the throttle")
check("SYNC_CONCURRENCY is 12 or fewer", ns["SYNC_CONCURRENCY"] <= 12,
      f"{ns['SYNC_CONCURRENCY']} at once is what produced the 429 in the first place")

print()
if fails:
    print("FAILED %d check(s):" % len(fails))
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("ALL SALES CRM RETRY CHECKS PASSED")
