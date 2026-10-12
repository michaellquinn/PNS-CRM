"""The ops teams' notifications (Michael, 2026-10-12).

Notices were addressed to the ops teams and none of them could be read. Executed:

  * an ops account sees a notice addressed to ITS team, on any ticket, and nothing
    addressed to anyone else; a commercial account is filtered exactly as before;
  * the access boundary lets ops accounts reach /api/notifications and nothing more;
  * the launch label names the launch with its tags;
  * the go-live reminder goes to each team with open points, once per go-live date,
    and not when the go-live is further away.
"""
import sys, types, asyncio, os, json
stub = types.ModuleType("asyncmy"); stub.cursors = types.SimpleNamespace(DictCursor=object)
sys.modules["asyncmy"] = stub; sys.modules["asyncmy.cursors"] = stub.cursors
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
import main as m
from datetime import date, timedelta

ok = 0
def check(name, cond):
    global ok
    assert cond, name
    ok += 1

# ---- the label
check("label with tags", m.ob_launch_label({"opportunity_name": "PT A - B2BR", "acct_type": "Hypercare",
      "must_win": 1, "service_type": "LTL"}) == "PT A - B2BR (Hypercare · Must Win · LTL)")
check("Standard carries no tier tag", m.ob_launch_label({"opportunity_name": "PT B", "acct_type": "Standard",
      "must_win": 0, "service_type": "Sameday"}) == "PT B (Sameday)")

# ---- who sees what
NOTES = [
    dict(id=1, body="4W: confirm", ticket_ref="SOF-1", thread_key=None, to_groups="4W", to_roles=None, to_people=None, created_at="2026-10-12", read_at=None),
    dict(id=2, body="PNS only", ticket_ref="SOF-1", thread_key=None, to_groups="PNS", to_roles=None, to_people=None, created_at="2026-10-12", read_at=None),
    dict(id=3, body="Sort: confirm", ticket_ref="SOF-1", thread_key=None, to_groups="Sort", to_roles=None, to_people=None, created_at="2026-10-12", read_at=None),
    dict(id=4, body="Sales on someone else's deal", ticket_ref="SOF-9", thread_key=None, to_groups="Commercial", to_roles=None, to_people=None, created_at="2026-10-12", read_at=None),
]
async def q(sql, args=(), one=False):
    if "SELECT ticket_ref FROM tickets" in sql:
        return []                                # nobody here owns SOF-1 or SOF-9
    if "FROM notifications n" in sql:
        return NOTES
    return None if one else []
m.q = q
four = m.User(email="abdul@x", name="Abdul", group="4W", level="head")
sales = m.User(email="s@x", name="S", group="Commercial", level="staff")
got = asyncio.run(m.notifications(four))
check("4W sees its own team's notice on a ticket it does not own", [n.id for n in got["notes"]] == [1])
got = asyncio.run(m.notifications(sales))
check("Commercial is unchanged: a group notice on a deal not theirs stays hidden", got["notes"] == [])

src = open(m.__file__, encoding="utf-8").read()
check("ops accounts may reach /api/notifications",
      '"/api/onboarding-v2", "/api/operational-master", "/api/notifications"' in src)
check("ops accounts have the Bell", "onOpen={me.permissions.operationalOnly ? (ref) => open(ref, \"__onboarding__\") : open}"
      in open(os.path.join(os.path.dirname(m.__file__), "..", "frontend", "src", "App.jsx"), encoding="utf-8").read())

# ---- the reminder
sent, already = [], set()
def rows_for(days):
    async def rows():
        return [dict(id=7, ticket_ref="SOF-7", opportunity_name="PT C - LTL", shipper="PT C",
                     service_type="LTL", acct_type="Strategic", must_win=0,
                     submitted_at="2026-10-10", actual_golive=None,
                     released_payload=json.dumps({"planned_golive": str(date.today() + timedelta(days=days)),
                                                  "pickup_at": str(date.today() + timedelta(days=days)),
                                                  "pickup_time": "10-12"}))]
    return rows
async def q2(sql, args=(), one=False):
    if "FROM onboarding_check_items" in sql:
        return [{"owner_group": "4W", "n": 3}, {"owner_group": "Sort", "n": 1}]
    if "FROM notifications WHERE ticket_ref" in sql:
        return {"x": 1} if (args[0], args[1]) in already else None
    return None if one else []
async def notify(body, groups=(), **k):
    sent.append((groups[0], body)); already.add(("SOF-7", groups[0]))
m.q, m.notify = q2, notify
m.ob_rows = rows_for(1)
n = asyncio.run(m.ob_send_reminders())
check("a reminder per team with open points", n == 2 and {g for g, _ in sent} == {"4W", "Sort"})
check("it says how many and when", any("4W still has 3 points open" in b and "tomorrow" in b
                                       and "PT C - LTL (Strategic · LTL)" in b for _, b in sent))
check("once only", asyncio.run(m.ob_send_reminders()) == 0)
sent.clear(); already.clear()
m.ob_rows = rows_for(5)
check("not while the go-live is further away", asyncio.run(m.ob_send_reminders()) == 0)
# ---- D-2: Sales are reminded, never blocked (2026-10-12)
check("submit-by is two days before go-live", m.ob_submit_by("2026-10-20") == "2026-10-18")
check("the draft's go-live wins over the charter's",
      m.ob_target_golive({"payload": json.dumps({"planned_golive": "2026-10-20"}), "charter_golive": "2026-10-25"}) == "2026-10-20")
check("the charter's go-live when the draft has none",
      m.ob_target_golive({"payload": None, "charter_golive": "2026-10-25"}) == "2026-10-25")
told = []
async def notify_people(body, groups=(), people=(), **k):
    told.append((tuple(people), body, k)); already.add(("SOF-8", "sales"))
async def q3(sql, args=(), one=False):
    if "FROM notifications WHERE ticket_ref" in sql:
        return {"x": 1} if ("SOF-8", "sales") in already else None
    return None if one else []
async def people_of(t): return ["Dandy", "Niko"]
def draft_row(days):
    async def rows():
        return [dict(id=8, ticket_ref="SOF-8", opportunity_name="PT E - B2BR", shipper="PT E",
                     service_type="B2BR", acct_type="Standard", must_win=0, submitted_at=None,
                     actual_golive=None, released_payload=None, payload=None,
                     charter_golive=str(date.today() + timedelta(days=days)),
                     owner_name="Niko", sales_name="Dandy", sales_email="d@x")]
    return rows
already.clear()
m.q, m.notify, m.ticket_people = q3, notify_people, people_of
m.ob_rows = draft_row(1)
check("Sales are reminded when go-live is tomorrow and nothing is submitted",
      asyncio.run(m.ob_send_reminders()) == 1 and told[0][0] == ("Dandy", "Niko"))
check("in the app only", told[0][2].get("email") is False and "not submitted yet" in told[0][1])
check("once per go-live date", asyncio.run(m.ob_send_reminders()) == 0)
already.clear(); told.clear()
m.ob_rows = draft_row(6)
check("not a week out", asyncio.run(m.ob_send_reminders()) == 0)
src = open(m.__file__, encoding="utf-8").read()
check("the D-1 cut-off is unchanged and nothing new blocks a submit",
      src.count("Sales requirements must be submitted by D-1 20:00 WIB") == 1
      and "OB_SUBMIT_DAYS_BEFORE" not in src.split("def ob_validate")[1].split("def ob_readiness_points")[0])
print(f"ops notifications: {ok} checks OK")
