"""SSM manages onboarding (Michael, 2026-11-04).

  * SSM is a role; it may fill in and submit any launch's onboarding form, raise New
    onboarding, confirm / hand over / reopen points for any team, and raise a CAPA;
  * it sees the sell price, never cost or margin, and holds no solutioning right;
  * acting for a team is recorded as "<name> (SSM, for 4W)";
  * a notice addressed to SSM reaches SSM on any ticket, and every onboarding notice
    is addressed to SSM;
  * the menu shows Planning, Ops Onboarding and CAPA only.
"""
import sys, types, asyncio, os
stub = types.ModuleType("asyncmy"); stub.cursors = types.SimpleNamespace(DictCursor=object)
sys.modules["asyncmy"] = stub; sys.modules["asyncmy.cursors"] = stub.cursors
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
import main as m

ok = 0
def check(name, cond):
    global ok
    assert cond, name
    ok += 1

ssm = m.User(email="s@x", name="Sari", group="SSM", level="staff")
check("SSM is a role", "SSM" in m.ROLE_GROUPS)
deal = {"sales_name": "Dandy Pradipto Wicaksono", "sales_email": "d@x"}
check("SSM edits any launch's onboarding, not only its own", m.can(ssm, "editOnboarding", deal))
check("SSM confirms readiness points", m.can(ssm, "confirmOperational"))
check("SSM raises New onboarding", m.can(ssm, "createOnboarding"))
check("SSM raises a CAPA", m.can(ssm, "capaRaise"))
check("SSM sees the sell price", m.can(ssm, "seePrice"))
check("SSM never sees cost or margin", not m.can(ssm, "seeMargin"))
for a in ("createTicket", "editInput", "sendBackProposal", "acceptProposal", "assign",
          "deleteTicket", "manageUsers", "capaClose"):
    check(f"SSM cannot {a}", not m.can(ssm, a))
check("SSM is not an ops-only account (it reads Planning)", not m.can(ssm, "operationalOnly"))
check("acting for a team says SSM", m.ob_actor(ssm, {"owner_group": "4W"}) == "Sari (SSM, for 4W)")
check("Admin's record is unchanged",
      m.ob_actor(m.User(email="b@x", name="Boss", group="Admin", level="head"), {"owner_group": "4W"})
      == "Boss (Admin, for 4W)")

# a notice addressed to SSM reaches SSM on a ticket it does not own
NOTES = [dict(id=1, body="SSM: summary", ticket_ref="SOF-1", thread_key=None, to_groups="SSM",
              to_roles=None, to_people=None, created_at="2026-11-04", read_at=None),
         dict(id=2, body="4W only", ticket_ref="SOF-1", thread_key=None, to_groups="4W",
              to_roles=None, to_people=None, created_at="2026-11-04", read_at=None)]
async def q(sql, args=(), one=False):
    if "SELECT ticket_ref FROM tickets" in sql:
        return []
    if "FROM notifications n" in sql:
        return NOTES
    return None if one else []
m.q = q
got = asyncio.run(m.notifications(ssm))
check("SSM sees its own notices on any ticket, and not other teams'", [n.id for n in got["notes"]] == [1])

src = open(m.__file__, encoding="utf-8").read()
check("the go-live escalation reaches SSM", 'groups=["Ops", SSM_GROUP]' in src)
check("each submit or change sends SSM a summary of every team", "groups=[SSM_GROUP], ticket_ref=ref)" in src)
check("New onboarding launches reach SSM", 'groups=["Ops", "QC", "PNS", SSM_GROUP]' in src)
check("handovers reach SSM", "groups=[body.to_group.strip(), SSM_GROUP]" in src)
check("reopens reach SSM", 'groups=[it["owner_group"], SSM_GROUP]' in src)
check("Onboarding discussion posts reach SSM, and never the poster's own team",
      "| {SSM_GROUP}) - {u.group})" in src)
app = open(os.path.join(ROOT, "frontend", "src", "App.jsx"), encoding="utf-8").read()
check("SSM's menu is Planning, Ops Onboarding and CAPA",
      'const SSM_SECTIONS = ["Planning", "Ops Onboarding", "CAPA"];' in app
      and 'if (me.group === "SSM" && !SSM_SECTIONS.includes(group)) return null;' in app)
print(f"ssm: {ok} checks OK")
