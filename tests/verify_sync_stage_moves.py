"""How the Sales CRM sync moves a ticket's status (Michael, 2026-11-04), executed on the
real _refresh_from_salescrm against a stubbed database:

  * Sarana: Sales CRM says Closed-Lost with a long loss reason -- the ticket moves to
    Lost, and the history note fits its column instead of failing the whole move;
  * Forester / Enseval: PNS sent a submitted deal back (Pending PNS, Pending Review)
    while Sales CRM still says Proposal Submitted / Negotiation -- the sync leaves it;
  * a deal ENTERING the submitted phase in Sales CRM still moves to Proposal Submitted.
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

writes = []
async def execute(sql, args=()):
    writes.append((sql, args))
    if sql.startswith("INSERT INTO ticket_history"):
        note = args[3]
        assert note is None or len(note) <= 500, f"note of {len(note)} chars would fail the column"
    return 1
async def noop(*a, **k): pass
async def people(t): return []
m.execute, m.notify, m.ticket_people = execute, noop, people


def run(status, stored_stage, crm_stage, **crm):
    writes.clear()
    T = dict(id=1, ticket_ref="SOF-1", status=status, resp="PNS", stage=stored_stage,
             potential_rev=15_000_000, service_type="LTL", must_win=0, request_type="solutioning",
             owner_name="Marcellina", sales_name="Deny Ardianto", sales_email=None, shipper="PT A",
             acct_type="Standard", price_file="p.xlsx", price_url=None, resp_override=None)
    async def q(sql, args=(), one=False):
        if "FROM tickets WHERE opportunity_id" in sql: return dict(T)
        if "SELECT payload FROM ticket_input" in sql: return {"payload": "{}"}
        return None if one else []
    m.q = q
    o = {"id": 1, "stage": crm_stage, "name": "PT A - LTL (B2BR)", "owner_name": "Deny Ardianto",
         "nv_product_line": "LTL", "service_level": "Standard", "total_potential_revenue_mth": "15000000", **crm}
    return asyncio.run(m._refresh_from_salescrm(o, {"name": "PT A - LTL (B2BR)"}, "Standard", frozenset()))


long_reason = "Shipper chose a competitor after a long negotiation. " * 20
r = run("Proposal Submitted", "Negotiation", "Closed-Lost", loss_reason="Price", detailed_lost_reason=long_reason)
check("Sarana: lost in Sales CRM moves to Lost, even with a long reason", r["moved"] == "Lost")
check("...and the status really is written", any("INSERT INTO ticket_history" in s and a[1] == "Lost" for s, a in writes))

r = run("Pending PNS", "Negotiation", "Negotiation")
check("Enseval: sent back to Pending PNS while Sales CRM stays at Negotiation -> stays", r["moved"] is None)
r = run("Pending PNS", "Proposal Submitted", "Proposal Submitted")
check("Forester: sent back while Sales CRM stays at Proposal Submitted -> stays", r["moved"] is None)
r = run("Pending Review - PNS", "Proposal Submitted", "Negotiation")
check("moving on within the submitted phase does not pull a send-back back", r["moved"] is None)
r = run("Pending PNS", "New", "Proposal Submitted")
check("a deal ENTERING the submitted phase still moves to Proposal Submitted", r["moved"] == "Proposal Submitted")
r = run("Pending PNS", "Negotiation", "Agreed to Ship")
check("an accepted stage still applies whatever came before", r["moved"] == "Proposal Accepted / Ready to Ship")
r = run("Pending PNS", "Negotiation", "Future Opportunity")
check("a parked stage still cancels", r["moved"] == "Cancel")
print(f"sync stage moves: {ok} checks OK")
