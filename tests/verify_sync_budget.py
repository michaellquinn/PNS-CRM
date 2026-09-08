"""Every concurrent fan-out in the sweep is bounded from INSIDE, checked over the AST.

THE INCIDENT (Michael, 2026-09-08)
    Three opportunities — 907174, 904840, 907124 — sat "pending" in the Import queue for
    a day. The auto-sync ran every five minutes, reported last_ok true, and recorded
    created 0, refreshed 0, skipped 0, errors 0 on every single run. Pressing Dry run in
    the UI returned a bare 502 after 30s and rendered no panel at all, so "Run for real"
    never unlocked. Fetching one of the same ids directly, with ids=["907174"], returned
    a complete, correct record in 0.1s. There was nothing wrong with the data.

    sync_salescrm has a wall-clock budget, SYNC_BUDGET_S, and it was tested in all the
    obvious places: between batches, between records, around the backfill pages. What it
    was never tested inside was the held-ticket refresh, which is ONE await:

        got = await asyncio.gather(*(one(i) for i in ids))   # ids: up to 400

    A gather is not interruptible from the outside. Whatever the deadline said, that line
    ran to completion. At SYNC_CONCURRENCY 24 it was ~17 sequential rounds and fit inside
    the budget, so nobody noticed. Lowering the concurrency to 8 on 2026-09-07 — the fix
    for Sales CRM answering 429, and a correct fix — turned it into ~50 rounds and took
    it past the deadline. The processing loop below it checks the deadline on its FIRST
    iteration, so from that day on it broke immediately and processed NOTHING: not the
    held tickets, and not the three queued opportunities that had been fetched
    successfully seconds earlier and were sitting at the front of the batch list.

    The last queue entries that ever imported resolved at 2026-09-07 11:55:59. The
    concurrency change landed at 14:30 the same day.

WHY A TEST, AND WHY THIS SHAPE
    Nothing was broken in isolation. The budget was right, the concurrency was right, the
    deadline checks that existed were right, and every unit of it passed review. The bug
    lived in the RELATIONSHIP between a tunable and an unbounded await, and it was
    introduced by changing a number in a different file's worth of reasoning. That is not
    a mistake a reader catches twice, and it produced no error, no exception and no log
    line — the sweep reported success while doing nothing, for twenty-four hours.

    So the invariant is pinned structurally rather than behaviourally: EVERY asyncio
    gather in the sweep must fan out over a coroutine that tests the clock itself.
    Checked over the AST because that is the form the bug takes — a new fan-out added
    later would be written exactly the way the broken one was.

THE RESERVE
    A budget that only bounds fetching is not a budget. The run has to have time left to
    USE what it fetched, or it spends 25 seconds gathering records and then throws all of
    them away — which is literally what happened. Fetching stops at
    deadline - SYNC_FETCH_RESERVE_S; the reserve is what makes the difference between a
    truncated run and a wasted one.

EXPLICIT REQUESTS
    A queued id is somebody typing an opportunity number on purpose. Discovery is the
    sweep guessing. When the budget runs short those must not compete on equal terms, so
    explicit batches sort first and are never truncated — the last check here pins that,
    because it is the property that actually gets the three tickets in.
"""
import ast
import io
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
_SRC_PATH = os.path.join(_REPO, "backend", "main.py")
src = io.open(_SRC_PATH, encoding="utf-8").read()
tree = ast.parse(src)

fails = []


def check(label, ok, hint=""):
    if not ok:
        fails.append(label + (" - " + hint if hint else ""))
    print(("  ok   " if ok else "  FAIL ") + label)


def find_def(name, root=None):
    for n in ast.walk(root or tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name:
            return n
    return None


def tests_the_clock(fn):
    """True if this coroutine reads time.monotonic() itself.

    Reading the clock is the only way a task inside a gather can decline to run: the
    gather cannot be cancelled from outside, and a semaphore bounds how many run at
    once, never how long they take in total.
    """
    for n in ast.walk(fn):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "monotonic"):
            return True
    return False


def gathers_in(fn):
    """(call_node, [helper names it fans out over]) for each asyncio.gather in fn."""
    out = []
    for n in ast.walk(fn):
        if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "gather"):
            continue
        names = {c.id for c in ast.walk(n) if isinstance(c, ast.Name)}
        out.append((n, sorted(names)))
    return out


# Fan-outs that are deliberately NOT clock-bounded, each with the reason. Keeping this
# list explicit is the point: adding to it is a decision someone has to write down.
EXEMPT = {
    # Opportunities named by id — on a run's `ids`, or on the Import queue. Capped at 200
    # by the caller and in practice a handful. These are the whole reason the sweep runs
    # at all when the queue is governing; bounding them by the clock would reintroduce
    # exactly the failure this suite exists for, where the thing a person explicitly
    # asked for is the thing that gets dropped.
    "by_id": "explicit request, capped at 200 by the caller",
    "queued_by_id": "explicit request, capped at 200 by the caller",
}

sync = find_def("sync_salescrm")
check("sync_salescrm exists", sync is not None)
if sync is None:
    sys.exit(1)

print("every fan-out in the sweep is bounded from inside")
seen_helpers = []
for call, names in gathers_in(sync):
    helpers = [n for n in names if find_def(n, sync) is not None]
    check(f"main.py:{call.lineno} gather fans out over a named coroutine",
          bool(helpers), "cannot tell what this gathers over")
    for h in helpers:
        seen_helpers.append(h)
        fn = find_def(h, sync)
        if h in EXEMPT:
            check(f"{h}() is exempt: {EXEMPT[h]}", True)
            continue
        check(f"{h}() tests the clock itself (main.py:{call.lineno})",
              tests_the_clock(fn),
              "a gather runs to completion however long it takes - the bound has to be "
              "INSIDE the coroutine, not around the await")

check("the sweep still has fan-outs to check", len(seen_helpers) >= 3,
      f"found {len(seen_helpers)} - if the sweep was restructured, so must this suite be")

# ------------------------------------------------------------------ warm_accounts
# Not nested inside sync_salescrm, but called by it once per run and up to
# SYNC_REFRESH_MAX accounts wide - one round trip each, and on its own enough to spend
# the entire budget.
print()
print("warm_accounts can be bounded by its caller")
warm = find_def("warm_accounts")
check("warm_accounts exists", warm is not None)
if warm:
    args = [a.arg for a in warm.args.args] + [a.arg for a in warm.args.kwonlyargs]
    check("it takes a deadline", "deadline" in args,
          "the held-ticket warm is the second-largest fan-out in the run")
    check("and honours it inside the fan-out", tests_the_clock(warm),
          "a deadline the coroutine never reads bounds nothing")

# ------------------------------------------------------------------ the reserve
print()
print("the budget reserves time to USE what was fetched")
consts = {}
for n in tree.body:
    if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name):
        for lit in ast.walk(n):
            if isinstance(lit, ast.Constant) and isinstance(lit.value, str) \
                    and lit.value.isdigit():
                consts.setdefault(n.targets[0].id, int(lit.value))
budget = consts.get("SYNC_BUDGET_S")
reserve = consts.get("SYNC_FETCH_RESERVE_S")
check("SYNC_FETCH_RESERVE_S exists", reserve is not None,
      "without it, fetching may use the whole budget and leave nothing to process")
check("SYNC_BUDGET_S exists", budget is not None)
if budget and reserve:
    check("the reserve is real", reserve > 0)
    check("the reserve leaves most of the budget for fetching",
          reserve < budget / 2, f"reserve {reserve}s of a {budget}s budget")
check("fetch_deadline is derived from it",
      "deadline - SYNC_FETCH_RESERVE_S" in src,
      "the reserve has to be subtracted somewhere or it is decoration")

# ------------------------------------------------------------------ explicit first
print()
print("an explicitly requested opportunity is never the one dropped")
seg = ast.get_source_segment(src, sync) or ""
check("batches are sorted explicit-first", "batches.sort(" in seg,
      "queued ids sat behind 400 refreshed tickets and the loop broke before them")
check("the batch loop distinguishes explicit from discovery",
      "explicit" in seg and 'startswith(("queued ", "id "))' in seg,
      "without this the deadline truncates a person's typed-in id")
check("the truncation branch continues rather than breaks",
      "truncated = True\n                    # `continue`, not `break`" in seg
      or ("not explicit and time.monotonic() > deadline" in seg
          and seg.count("break") <= seg.count("continue") + 4),
      "breaking skips every batch behind it, explicit ones included")

# ------------------------------------------------------------------ the rotation
# The other way the same tickets end up never refreshed. The budget fix made a run
# process only part of what it fetched, and the rotation was not built for that: it
# skipped rotating whenever the pool fit under SYNC_REFRESH_MAX (37 held tickets do),
# and advanced the cursor by ids FETCHED rather than tickets REFRESHED. Either one puts
# a stable tail of the sorted pool permanently out of reach — which is precisely the
# bug the cursor was introduced to fix in the first place, arrived at from a new angle.
print()
print("the refresh rotation reaches every ticket, not just the ones that fit")
check("the rotation is unconditional",
      "if len(pool) > SYNC_REFRESH_MAX:" not in seg,
      "a pool that fits is not a pool that finishes - 23 of 37 got processed and the "
      "same 14 were skipped every run")
check("the cursor advances by tickets refreshed, not ids fetched",
      "len(refreshed)) % refresh_pool" in seg,
      "advancing by SYNC_REFRESH_MAX skips everything fetched and not processed")
check("a run that rotated nothing leaves the cursor alone",
      "if refresh_start is not None and refresh_pool:" in seg,
      "an ids-only run must not move a rotation it never took part in")

# ------------------------------------------------------------------ visibility
print()
print("a run that was cut off does not look like a run with nothing to do")
check("truncated is reported in counts", '"truncated": truncated' in seg,
      "auto-sync records `counts` and nothing else - ten all-zero sweeps reported "
      "last_ok true while the processing loop broke on its first iteration")

print()
if fails:
    print("FAILED %d check(s):" % len(fails))
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("ALL SYNC BUDGET CHECKS PASSED")
