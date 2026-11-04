"""Go Live: Upcoming and Live (Michael, 2026-11-04), executed on operational_worklist:

  * a submitted launch whose date has arrived is Live;
  * a submitted launch whose date is still coming is Upcoming;
  * a won deal whose form is not submitted, but which has a go-live date in its draft
    or charter, is Upcoming too -- flagged as not submitted;
  * a launch with no date at all is not on Go Live;
  * an ops account does not see a launch whose form is not submitted.
"""
import sys, types, asyncio, os, json
from datetime import date, datetime, timedelta
stub = types.ModuleType("asyncmy"); stub.cursors = types.SimpleNamespace(DictCursor=object)
sys.modules["asyncmy"] = stub; sys.modules["asyncmy.cursors"] = stub.cursors
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
import main as m

ok = 0
def check(name, cond):
    global ok
    assert cond, name
    ok += 1

today = m.ob_now().date()
d = lambda n: str(today + timedelta(days=n))
def row(id_, ref, submitted, released=None, draft=None, charter=None):
    return dict(id=id_, ticket_ref=ref, opportunity_id=str(id_), opportunity_name=ref, service_type="LTL",
                sales_name="S", sales_email="s@x", owner_name=None, request_type="solutioning", must_win=0,
                acct_type="Standard", shipper="PT", charter_golive=charter,
                payload=json.dumps(draft or {}), released_payload=json.dumps(released or {}),
                revision=1, submitted_at=datetime.now() if submitted else None,
                actual_golive=None, qc_accepted_at=None, handover_at=None)
ROWS = [
    row(1, "LIVE", True, released={"planned_golive": d(-3), "pickup_at": d(-3)}),
    row(2, "SOON", True, released={"planned_golive": d(4), "pickup_at": d(4)}),
    row(3, "NOTIN", False, draft={"planned_golive": d(6)}),
    row(4, "CHARTER", False, charter=d(9)),
    row(5, "NODATE", False),
]
async def ob_rows(): return ROWS
async def q(sql, args=(), one=False): return None if one else []
m.ob_rows, m.q = ob_rows, q

admin = m.User(email="a@x", name="A", group="Admin", level="head")
got = {r["ref"]: r for r in asyncio.run(m.operational_worklist("golive", admin))["rows"]}
check("a launch whose date has arrived is Live", got["LIVE"]["already_live"] is True)
check("a submitted launch still coming is Upcoming", got["SOON"]["already_live"] is False
      and got["SOON"]["days_to_golive"] == 4)
check("a won deal not submitted, dated in its draft, is Upcoming and flagged",
      got["NOTIN"]["already_live"] is False and got["NOTIN"]["submitted"] is False
      and got["NOTIN"]["planned_golive"] == d(6))
check("...or dated in its charter", got["CHARTER"]["planned_golive"] == d(9))
check("a launch with no date at all is not on Go Live", "NODATE" not in got)

four = m.User(email="f@x", name="F", group="4W", level="staff")
seen = {r["ref"] for r in asyncio.run(m.operational_worklist("golive", four))["rows"]}
check("an ops account sees only submitted launches", seen == {"LIVE", "SOON"})
print(f"go live tabs: {ok} checks OK")
