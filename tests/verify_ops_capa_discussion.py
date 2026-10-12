"""CAPA for the ops teams and the Onboarding discussion (Michael, 2026-10-12).

  * the ops boundary lets CAPA through and still keeps tickets, comments and users out;
  * the Onboarding thread returns that thread only, and only once Sales have submitted
    when the reader is an ops account;
  * a post lands in the "onboarding" thread and tells the other teams on the launch and
    the deal's people -- not the poster's own team;
  * Visitor and Finance read but do not post;
  * a new numbered thread is still numbered right when the Onboarding thread exists.
"""
import sys, types, asyncio, os
stub = types.ModuleType("asyncmy"); stub.cursors = types.SimpleNamespace(DictCursor=object)
sys.modules["asyncmy"] = stub; sys.modules["asyncmy.cursors"] = stub.cursors
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
import main as m

ok = 0
def check(name, cond):
    global ok
    assert cond, name
    ok += 1

src = open(m.__file__, encoding="utf-8").read()
check("CAPA passes the ops boundary",
      '"/api/notifications", "/api/capa"))' in src)

T = dict(id=5, ticket_ref="SOF-5", shipper="PT D", opportunity_name="PT D - LTL", acct_type="Standard",
         must_win=0, service_type="LTL", owner_name="Niko", sales_name="Dandy", sales_email="d@x")
state = {"submitted": None, "sql": [], "inserted": None, "notes": []}
async def get_ticket(ref): return dict(T)
async def q(sql, args=(), one=False):
    state["sql"].append((sql, args))
    if "FROM onboarding_intake" in sql:
        return {"submitted_at": state["submitted"]}
    if "FROM ticket_comments WHERE ticket_id=%s AND thread_key=%s" in sql:
        return []
    if "DISTINCT owner_group" in sql:
        return [{"owner_group": "4W"}, {"owner_group": "Sort"}]
    if "DISTINCT thread_key" in sql:
        return [{"thread_key": "onboarding"}, {"thread_key": "t2"}]
    return None if one else []
async def execute(sql, args=()):
    if sql.startswith("INSERT INTO ticket_comments"):
        state["inserted"] = args
    return 1
async def notify(body, groups=(), people=(), **k): state["notes"].append((tuple(groups), tuple(people), k))
async def ticket_people(t): return ["Niko", "Dandy"]
async def noop(*a, **k): pass
m.get_ticket, m.q, m.execute, m.notify, m.ticket_people, m.audit = get_ticket, q, execute, notify, ticket_people, noop

four = m.User(email="abdul@x", name="Abdul", group="4W", level="head")
visitor = m.User(email="v@x", name="V", group="Visitor", level="staff")
sales = m.User(email="d@x", name="Dandy", group="Commercial", level="staff")
def refused(coro, code):
    try:
        asyncio.run(coro)
    except m.HTTPException as e:
        return e.status_code == code
    return False

check("ops cannot read before Sales submit", refused(m.onboarding_discussion("SOF-5", four), 403))
check("ops cannot post before Sales submit",
      refused(m.onboarding_discuss("SOF-5", m.OnboardingPost(body="hi"), four), 403))
state["submitted"] = "2026-10-12 10:00"
asyncio.run(m.onboarding_discussion("SOF-5", four))
check("it reads the onboarding thread only",
      any("thread_key=%s" in s and a[-1] == "onboarding" for s, a in state["sql"]))
check("Visitor does not post", refused(m.onboarding_discuss("SOF-5", m.OnboardingPost(body="x"), visitor), 403))
check("an empty post is refused", refused(m.onboarding_discuss("SOF-5", m.OnboardingPost(body="  "), four), 400))
asyncio.run(m.onboarding_discuss("SOF-5", m.OnboardingPost(body="Truck ready 08:00"), four))
ins = state["inserted"]
check("posted into the Onboarding thread", ins[1] == "onboarding" and ins[2] == "Onboarding" and ins[5] == "4W")
groups, people, k = state["notes"][-1]
check("tells the other teams, not the poster's own", groups == ("Sort",))
check("and the deal's people, in the app only", set(people) == {"Niko", "Dandy"} and k.get("email") is False)
check("the notice opens the Onboarding thread", k.get("thread_key") == "onboarding")
state["notes"].clear()
asyncio.run(m.onboarding_discuss("SOF-5", m.OnboardingPost(body="Updated PIC"), sales))
groups, people, _ = state["notes"][-1]
check("a Sales post tells every team on the launch", groups == ("4W", "Sort") and "Dandy" not in people)

# numbering a new thread next to the fixed Onboarding thread
asyncio.run(m.add_comment("SOF-5", m.NewComment(body="New point", new_thread_title="Rates"), sales))
check("a new thread is t3, not a crash on 'onboarding'", state["inserted"][2] == "t3")
print(f"ops CAPA + onboarding discussion: {ok} checks OK")
