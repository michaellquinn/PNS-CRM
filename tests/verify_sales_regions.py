"""Sales regions: a deal's region follows its salesperson (Michael, 2026-10-02).

Sales CRM sends no region, so the import stamped every deal GJ and a salesperson's deals
split across regions (Dandy in GJ and EJ). Executed rather than read:

  * the suggestion ignores GJ when the person has deals anywhere else, because GJ was the
    import's default and not anybody's choice;
  * saving a region stores it and moves EVERY one of that person's deals;
  * only an Admin (manageUsers) may set it, and only to a real region;
  * the import and New request take the salesperson's region when one is set.
"""
import sys, types, asyncio, os, re
stub = types.ModuleType("asyncmy"); stub.cursors = types.SimpleNamespace(DictCursor=object)
sys.modules["asyncmy"] = stub; sys.modules["asyncmy.cursors"] = stub.cursors
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
import main as m

ok = 0
def check(name, cond):
    global ok
    assert cond, name
    ok += 1

# ---- the suggestion
check("Dandy: GJ 1 + EJ 1 suggests EJ", m.suggest_region({"GJ": 1, "EJ": 1}) == "EJ")
check("only GJ stays GJ", m.suggest_region({"GJ": 12}) == "GJ")
check("the bigger non-GJ region wins", m.suggest_region({"GJ": 5, "EJ": 3, "CJ": 1}) == "EJ")
check("no deals suggests GJ", m.suggest_region({}) == "GJ")
check("an unknown region is ignored", m.suggest_region({"-": 4, "WJ": 1}) == "WJ")

# ---- saving
writes, store = [], {}
async def execute(sql, args=()):
    writes.append((sql, args))
    if sql.startswith("INSERT INTO sales_regions"):
        store[args[0]] = args[1]
    return 1
async def q(sql, args=(), one=False):
    if "FROM sales_regions WHERE" in sql:
        return {"region": store[args[0]]} if args[0] in store else None
    return None if one else []
async def audit(*a, **k): pass
m.execute, m.q, m.audit = execute, q, audit
admin = m.User(email="boss@x", name="Boss", group="Admin", level="head")
sales = m.User(email="ari@x", name="Ari", group="Commercial", level="staff")

def refused(coro, code):
    try:
        asyncio.run(coro)
    except m.HTTPException as e:
        return e.status_code == code
    return False

asyncio.run(m.set_sales_region(m.SalesRegionIn(name="Dandy Pradipto Wicaksono", region="EJ"), admin))
check("the region is stored", store.get("Dandy Pradipto Wicaksono") == "EJ")
check("every one of their deals moves", any(
    s.startswith("UPDATE tickets SET region=%s WHERE sales_name=%s")
    and a == ("EJ", "Dandy Pradipto Wicaksono") for s, a in writes))
check("Sales cannot set it", refused(
    m.set_sales_region(m.SalesRegionIn(name="X", region="EJ"), sales), 403))
check("only a real region", refused(
    m.set_sales_region(m.SalesRegionIn(name="X", region="Bali"), admin), 400))
check("the lookup reads it back", asyncio.run(m.sales_region_for("Dandy Pradipto Wicaksono")) == "EJ")
check("no name, no region", asyncio.run(m.sales_region_for("")) is None)

# ---- every path that writes a ticket's region uses it
src = open(m.__file__, encoding="utf-8").read()
check("the import uses the salesperson's region",
      'await sales_region_for(plan["sales_name"]) or "GJ"' in src)
check("New request uses the creator's region",
      "await sales_region_for(u.name) or body.region" in src)
check("the sync follows the PIC", 'sales_region_for(o.get("owner_name") or t.get("sales_name"))' in src)
check("a handover here follows the new PIC", "region=COALESCE(%s, region)" in src)
check("the import no longer hard-codes GJ alone", not re.search(r'plan\["sales_name"\], "GJ"', src))
print(f"sales regions: {ok} checks OK")
