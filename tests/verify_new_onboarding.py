"""New onboarding: a launch raised straight into onboarding (Michael, 2026-10-05).

Not every deal needs solutioning, but every launch needs onboarding. Executed:

  * only Sales/AM and Admin may raise one -- not PNS, not Sales Planning;
  * the Sales CRM opportunity id is required, and must exist in Sales CRM;
  * an opportunity that already has a ticket is refused with that ticket's number;
  * the five charter answers are required and checked against the form's options;
  * the ticket is onboarding-only, Ready to Ship, priced by nobody, and its charter
    answers are stored where the onboarding form reads them;
  * it stays out of solutioning lists and counts, and the sync follows Sales CRM only
    to Lost or Cancel for it.
"""
import sys, types, asyncio, os, json
stub = types.ModuleType("asyncmy"); stub.cursors = types.SimpleNamespace(DictCursor=object)
sys.modules["asyncmy"] = stub; sys.modules["asyncmy.cursors"] = stub.cursors
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
import main as m

ok = 0
def check(name, cond):
    global ok
    assert cond, name
    ok += 1

U = lambda g, lvl="staff": m.User(email=f"{g.lower()}@x", name=g, group=g, level=lvl)
for g in ("Commercial", "AM", "Admin"):
    check(f"{g} may raise a new onboarding", m.can(U(g), "createOnboarding"))
for g in ("PNS", "Sales Planning", "QC", "4W", "Ops", "PSP"):
    check(f"{g} may not", not m.can(U(g), "createOnboarding"))

# ---- a fake database and Sales CRM
writes, held = [], {}
async def q(sql, args=(), one=False):
    if "FROM tickets WHERE opportunity_id" in sql:
        return held.get(args[0])
    if "MAX(id)" in sql:
        return {"n": 41}
    if "FROM shippers" in sql:
        return None
    if "FROM sales_regions" in sql:
        return {"region": "EJ"} if args[0] == "Dandy" else None
    return None if one else []
async def execute(sql, args=()):
    writes.append((sql, args)); return 77
async def noop(*a, **k): pass
m.q, m.execute, m.audit, m.log_status = q, execute, noop, noop
m.SALESCRM_API_KEY = "test"
OPP = {"id": 555, "name": "PT Contoh - B2BR", "stage": "Onboarding", "owner_name": "Dandy",
       "account_id": 9, "account_name": "PT Contoh", "total_potential_revenue_mth": "20000000"}
class FakeCrm:
    def __init__(self, client): pass
    async def records(self, obj, **p):
        return {"items": [OPP]} if str(p.get("id")) == "555" else {"items": []}
    async def account(self, aid): return {"id": aid, "name": "PT Contoh"}
    async def tier_for(self, a): return "Standard"
m.SalesCrm = FakeCrm

def body(**kw):
    base = dict(opportunity_id="555", service="B2BR", product_type="Dry goods",
                delivery_mode="Door to Door", mps="No", rdo="Yes", pickup_frequency="Daily")
    base.update(kw); return m.NewOnboardingIn(**base)
def refused(coro, code):
    try:
        asyncio.run(coro)
    except m.HTTPException as e:
        return e.status_code == code
    return False

sales = U("Commercial")
check("PNS is refused", refused(m.new_onboarding(body(), U("PNS")), 403))
check("no opportunity id is refused", refused(m.new_onboarding(body(opportunity_id=""), sales), 400))
check("a blank charter answer is refused", refused(m.new_onboarding(body(mps=""), sales), 400))
check("an invalid shipment mode is refused",
      refused(m.new_onboarding(body(delivery_mode="Door to Moon"), sales), 400))
check("an unknown service is refused", refused(m.new_onboarding(body(service="Teleport"), sales), 400))
check("an id Sales CRM does not know is refused",
      refused(m.new_onboarding(body(opportunity_id="999"), sales), 404))
held["555"] = {"ticket_ref": "SOF-8001400", "deleted_at": None}
check("an opportunity that already has a ticket is refused",
      refused(m.new_onboarding(body(), sales), 409))
held.clear()

out = asyncio.run(m.new_onboarding(body(), sales))
check("it returns the new ref", out["ref"] == "SOF-1341")
ins = next(a for s, a in writes if s.startswith("INSERT INTO tickets"))
sql = next(s for s, a in writes if s.startswith("INSERT INTO tickets"))
check("marked onboarding only", "'onboarding'" in sql)
check("lands Ready to Ship", "Proposal Accepted / Ready to Ship" in ins)
check("priced by nobody: no review", "'Sales',0" in sql)
check("Sales PIC is the Sales CRM owner", "Dandy" in ins)
check("whoever raised it may fill it in", "commercial@x" in ins)
check("region follows the Sales PIC", "EJ" in ins)
payload = json.loads(next(a for s, a in writes if s.startswith("INSERT INTO ticket_input"))[1])
check("charter answers stored where onboarding reads them",
      payload.get("shipMode") == "Door to Door" and payload.get("commodity") == "Dry goods"
      and payload.get("mps") == "No" and payload.get("rdo") == "Yes" and payload.get("freq") == "Daily")

# ---- kept out of solutioning, and the sync guard
src = open(m.__file__, encoding="utf-8").read()
check("solutioning lists exclude it (unless searching)", "sql += \" AND t.request_type<>'onboarding'\"" in src)
check("the dashboard counts exclude it", "AND request_type<>'onboarding'\")" in src)
check("Sales Planning excludes it", "\"AND t.request_type<>'onboarding' \"" in src)
check("the sync only follows Lost or Cancel for it",
      'if t.get("request_type") == "onboarding" and wants not in ("Lost", "Cancel"):' in src)
check("Go live from Solutioning leaves it to New onboarding",
      'if view == "onboarding" and direct:' in src)
check("submitting one tells Ops, QC and PNS", 'groups=["Ops", "QC", "PNS"]' in src)
print(f"new onboarding: {ok} checks OK")
