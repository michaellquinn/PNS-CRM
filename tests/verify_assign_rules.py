"""Auto-assignment rules edited on the Workload page (Michael, 2026-10-07).

  * only the Head of PNS and Admin may change them; PNS staff may read them;
  * only active PNS (or Admin) users can be named, and the default pool cannot be empty;
  * saving writes settings rows and NOTHING else -- no ticket is touched, so work that
    already has a PNS PIC keeps it. New tickets follow the new rule.
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

head = m.User(email="h@x", name="Head", group="PNS", level="head")
staff = m.User(email="s@x", name="Staff", group="PNS", level="staff")
admin = m.User(email="a@x", name="Admin", group="Admin", level="head")
check("the Head of PNS may edit", m.can(head, "editAssignRules"))
check("Admin may edit", m.can(admin, "editAssignRules"))
check("PNS staff may not", not m.can(staff, "editAssignRules"))
check("PNS staff may read (Workload)", m.can(staff, "seeWorkload"))
check("Sales may not", not m.can(m.User(email="c@x", name="C", group="Commercial", level="head"), "editAssignRules"))

writes, saved = [], {}
ACTIVE = ["niko.yannova@ninjavan.co", "annisa.sophieamalia@ninjavan.co", "a@x"]
async def q(sql, args=(), one=False):
    if "FROM users WHERE active=1 AND role_group IN" in sql:
        return [{"email": e} for e in ACTIVE]
    if "FROM app_settings" in sql:
        return [{"name": k, "value": v} for k, v in saved.items()]
    return None if one else []
async def execute(sql, args=()):
    writes.append(sql)
    if sql.startswith("INSERT INTO app_settings"):
        saved[args[0]] = args[1]
    return 1
async def noop(*a, **k): pass
m.q, m.execute, m.audit = q, execute, noop

def rules(**kw):
    base = dict(default=["niko.yannova@ninjavan.co"], services={"Sameday": ["annisa.sophieamalia@ninjavan.co"]},
                complex_new=["a@x"], complex_live=["niko.yannova@ninjavan.co"], cap=8)
    base.update(kw); return m.AssignRules(**base)
def refused(coro, code):
    try:
        asyncio.run(coro)
    except m.HTTPException as e:
        return e.status_code == code
    return False

check("staff cannot save", refused(m.set_assign_rules(rules(), staff), 403))
check("an inactive or unknown person is refused",
      refused(m.set_assign_rules(rules(default=["m.ramdhani@ninjavan.co"]), head), 400))
check("an empty default pool is refused", refused(m.set_assign_rules(rules(default=[]), head), 400))
check("a silly cap is refused", refused(m.set_assign_rules(rules(cap=0), head), 400))
check("an unknown service is refused",
      refused(m.set_assign_rules(rules(services={"Teleport": ["a@x"]}), head), 400))

writes.clear()
asyncio.run(m.set_assign_rules(rules(), head))
check("the rules are saved", saved.get("assign.default") == "niko.yannova@ninjavan.co"
      and saved.get("assign.cap") == "8")
check("a service with nobody is saved as an explicit blank", saved.get("assign.service.LTL") == "")
check("no ticket is touched by a save", not any("tickets" in s for s in writes))
got = asyncio.run(m.assign_rules())
check("and they read back", got["default"] == ["niko.yannova@ninjavan.co"] and got["cap"] == 8
      and got["services"].get("Sameday") == ["annisa.sophieamalia@ninjavan.co"]
      and "LTL" not in got["services"])
print(f"assign rules: {ok} checks OK")
