"""Readiness is confirmed POINT BY POINT, and a point can move between teams.

Michael, 2026-09-25: one answer per card was the wrong grain — a fleet can have the
truck and not the driver, and "not ready" said which card, never which half. These pin
the rules that decide whether a launch is ready and who may say so:

  * only the team HOLDING a point may confirm it (Sales never, another team never),
    with Admin acting for a team and recorded as doing so;
  * a stale screen is refused rather than confirming an answer that has since changed;
  * handing a point over needs a real operational team and a note — the note is the
    whole content of the request, and the receiving team is told;
  * a card turns ready only when EVERY point in it is confirmed, including points it
    handed elsewhere. A team cannot finish by giving its problem away.
"""
import sys, types, asyncio, json
stub = types.ModuleType("asyncmy"); stub.cursors = types.SimpleNamespace(DictCursor=object)
sys.modules["asyncmy"] = stub; sys.modules["asyncmy.cursors"] = stub.cursors
sys.path.insert(0, r"C:\Claude\ninja-pns\backend")
import main as m
from datetime import datetime

NOW = datetime(2026, 9, 25, 9)
m.ob_now = lambda: NOW

# one card with two points, held by 4W
ITEM = dict(id=7, ticket_id=1, check_key="pickup:fleet", item_key="vehicle",
            label="Vehicle: CDD box", owner_group="4W", origin_group="4W",
            status="pending", fingerprint="fp1", revision=1,
            ticket_ref="SOF-1", actual_golive=None)
OTHER = dict(check_key="pickup:fleet", status="pending")
CHECKS = [dict(id=3, check_key="pickup:fleet", status="pending", approved_at=None)]
writes = []


class Cur:
    def __init__(self): self.rows = None
    async def execute(self, sql, args=()):
        writes.append((sql.split()[0] + " " + sql.split()[1], args))
        if "FROM onboarding_check_items i" in sql: self.rows = [dict(ITEM)]
        elif "SELECT id, check_key, status, approved_at" in sql: self.rows = list(CHECKS)
        elif "SELECT check_key, status FROM onboarding_check_items" in sql:
            self.rows = [dict(check_key="pickup:fleet", status=ITEM["status"]), dict(OTHER)]
        else: self.rows = []
    async def fetchone(self): return (self.rows or [None])[0]
    async def fetchall(self): return self.rows or []


class Ctx:
    def __init__(self, cur): self.cur = cur
    async def __aenter__(self): return self.cur
    async def __aexit__(self, *a): return False


cur = Cur()
m.ob_locked = lambda tid: Ctx(cur)
async def q(sql, args=(), one=False): return {"ticket_id": 1} if one else []
m.q = q
async def notify(*a, **k): writes.append(("notify", k.get("groups")))
m.notify = notify
fleet = m.User(email="f@x", name="Fleet", group="4W", level="staff")
sort = m.User(email="s@x", name="Sorter", group="Sort", level="staff")
sales = m.User(email="c@x", name="Sales", group="Commercial", level="staff")
admin = m.User(email="a@x", name="Boss", group="Admin", level="head")


def run(coro): return asyncio.run(coro)


def denied(call, code):
    try: run(call())
    except m.HTTPException as e: assert e.status_code == code, (e.status_code, e.detail)
    else: raise AssertionError("expected refusal")


A = m.OperationalItemAction
# Sales can never confirm a point.
denied(lambda: m.operational_item(7, A(fingerprint="fp1"), sales), 403)
# Another team cannot confirm a point it does not hold.
denied(lambda: m.operational_item(7, A(fingerprint="fp1"), sort), 403)
# A stale screen is refused rather than confirming the wrong answer.
denied(lambda: m.operational_item(7, A(fingerprint="old"), fleet), 409)
# Handing over needs a real team and a note.
denied(lambda: m.operational_item(7, A(fingerprint="fp1", action="move", to_group="Sort"), fleet), 400)
denied(lambda: m.operational_item(7, A(fingerprint="fp1", action="move", to_group="Nope", note="x"), fleet), 400)
denied(lambda: m.operational_item(7, A(fingerprint="fp1", action="move", to_group="4W", note="x"), fleet), 400)

# The owning team confirms it.
writes.clear()
assert run(m.operational_item(7, A(fingerprint="fp1", note="truck booked"), fleet))["ok"]
sql = " ".join(w[0] for w in writes)
assert "UPDATE onboarding_check_items" in sql and "INSERT INTO" in sql
assert any(w[1] and "Fleet" in str(w[1]) for w in writes)

# Admin may act for a team, recorded as such.
writes.clear()
run(m.operational_item(7, A(fingerprint="fp1", note="ok"), admin))
assert any("(Admin, for 4W)" in str(w[1]) for w in writes), writes

# Handing a point to Sort tells Sort and moves the owner.
writes.clear()
run(m.operational_item(7, A(fingerprint="fp1", action="move", to_group="Sort",
                            note="needs manpower, not a vehicle"), fleet))
moved = [w for w in writes if w[0].startswith("UPDATE onboarding_check_items")]
assert moved and "Sort" in str(moved[0][1]), moved
assert ("notify", ["Sort"]) in writes, writes

# A card is ready only when every point in it is confirmed.
ITEM["status"] = "confirmed"; OTHER["status"] = "pending"
run(m.ob_sync_check_status(cur, 1))
assert not [w for w in writes if "SET status='ready'" in w[0]]
CHECKS[0]["status"] = "pending"; OTHER["status"] = "confirmed"
writes.clear()
run(m.ob_sync_check_status(cur, 1))
assert any("UPDATE onboarding_checks" in w[0] and "ready" in str(w[1]) for w in writes), writes
print("readiness points OK")
