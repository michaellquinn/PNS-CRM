"""An expired Sales CRM key says so (Michael, 2026-11-06), executed with a fake Sales
CRM that answers 401:

  * a read raises the plain "rejected the API key" message and marks the key rejected;
  * New onboarding passes that message through instead of "could not be read";
  * a good answer clears the mark;
  * a sync run that hit the rejection fails, rather than reporting ok with nothing done.
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

class Resp:
    def __init__(self, code, body=None): self.status_code, self._b, self.headers = code, body or {}, {}
    def json(self): return self._b
    def raise_for_status(self):
        if self.status_code >= 400: raise RuntimeError(f"HTTP {self.status_code}")
class Client:
    def __init__(self, code): self.code = code
    async def get(self, url, params=None): return Resp(self.code, {"items": []})

def raised(coro):
    try:
        asyncio.run(coro)
    except m.HTTPException as e:
        return e
    return None

e = raised(m.SalesCrm(Client(401)).records("Opportunity", id="909251"))
check("a 401 raises the plain key message", e and e.detail == m.CRM_KEY_REJECTED)
check("...and marks the key rejected", m._CRM_KEY["rejected"] is True)
asyncio.run(m.SalesCrm(Client(200)).records("Opportunity", id="1"))
check("a good answer clears the mark", m._CRM_KEY["rejected"] is False)

# New onboarding, with Sales CRM refusing the key
class FakeCrm(m.SalesCrm):
    def __init__(self, client): super().__init__(Client(401))
m.SalesCrm = FakeCrm
m.SALESCRM_API_KEY = "expired"
async def q(sql, args=(), one=False): return None if one else []
m.q = q
sales = m.User(email="d@x", name="Dandy", group="Commercial", level="staff")
body = m.NewOnboardingIn(opportunity_id="909251", service="B2BR", product_type="Skincare",
                         delivery_mode="Door to Door", mps="Yes", rdo="Yes", pickup_frequency="5x a week")
e = raised(m.new_onboarding(body, sales))
check("New onboarding says the key was rejected, not 'could not be read'",
      e and e.detail == m.CRM_KEY_REJECTED)

src = open(m.__file__, encoding="utf-8").read()
check("a sync run that hit the rejection fails out loud",
      'if _CRM_KEY["rejected"]:\n        raise HTTPException(502, CRM_KEY_REJECTED)' in src)
print(f"crm key: {ok} checks OK")
