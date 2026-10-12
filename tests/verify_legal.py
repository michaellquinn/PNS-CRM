"""Legal, and the contract terms on the charter (Michael, 2026-10-12).

  * Legal is a role that changes nothing, sees the price, and reads Proposal Accepted only;
  * the access boundary lets Legal read tickets, files and the discussion and post a
    comment -- nothing else -- and only on a ticket at Proposal Accepted;
  * Legal hears about accepted deals on any ticket;
  * the five insurance options and the follow-up fields agree between the backend and
    the screens, and only the rows that apply reach the charter;
  * Sales CRM's insurance value no longer overwrites the choice made in the app.
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

legal = m.User(email="l@x", name="Lia", group="Legal", level="staff")
check("Legal is a role", "Legal" in m.ROLE_GROUPS)
check("Legal sees the price", m.can(legal, "seePrice"))
check("Legal is Legal-only", m.can(legal, "legalOnly"))
for a in ("createTicket", "editInput", "acceptProposal", "sendBackProposal", "assign", "deleteTicket"):
    check(f"Legal cannot {a}", not m.can(legal, a))
check("Legal does not see cost or margin", not m.can(legal, "seeMargin"))

# ---- the boundary
w = m._legal_write_ok
check("reads are fine", w("GET", "/api/tickets/SOF-1"))
check("a comment is fine", w("POST", "/api/tickets/SOF-1/comments"))
check("editing its own comment is fine", w("PATCH", "/api/comments/12"))
check("marking notifications read is fine", w("POST", "/api/notifications/read"))
for method, path in [("POST", "/api/tickets/SOF-1/status"), ("PATCH", "/api/tickets/SOF-1/input"),
                     ("POST", "/api/tickets/SOF-1/files"), ("POST", "/api/tickets/SOF-1/price"),
                     ("POST", "/api/tickets")]:
    check(f"{method} {path} is refused", not w(method, path))
check("paths outside its list are refused", not "/api/stats".startswith(m._LEGAL_PATHS)
      and not "/api/onboarding-v2".startswith(m._LEGAL_PATHS) and not "/api/capa".startswith(m._LEGAL_PATHS))

STATUS = {"SOF-1": "Proposal Accepted / Ready to Ship", "SOF-2": "Pending PNS"}
async def q(sql, args=(), one=False):
    if "FROM tickets WHERE ticket_ref" in sql:
        return {"status": STATUS[args[0]]} if args[0] in STATUS else None
    if "FROM ticket_files f" in sql:
        return {"status": "Pending PNS"}
    if "FROM ticket_comments c" in sql:
        return {"status": "Proposal Accepted / Ready to Ship"}
    return None if one else []
m.q = q
st = lambda p: asyncio.run(m._legal_ticket_status(p))
check("an accepted ticket reads as accepted", st("/api/tickets/SOF-1/comments") == m.LEGAL_STATUS)
check("a ticket still being priced is not", st("/api/tickets/SOF-2") == "Pending PNS")
check("a file is scoped by its ticket", st("/api/files/7") == "Pending PNS")
check("a comment is scoped by its ticket", st("/api/comments/3") == m.LEGAL_STATUS)
check("the list itself carries no ticket", st("/api/tickets") == "")
check("an unknown ticket is refused", st("/api/tickets/SOF-404") is None)

src = open(m.__file__, encoding="utf-8").read()
check("the ticket list is forced to Proposal Accepted for Legal",
      'if u.group == LEGAL_GROUP:\n        sql += " AND t.status=%s"; args.append(LEGAL_STATUS)' in src)
check("Legal hears notices to its group on any ticket",
      "(u.group in OPERATIONAL_GROUPS or u.group == LEGAL_GROUP)" in src)
check("the sync tells Legal when a deal is accepted", "if wants == LEGAL_STATUS:" in src)

# ---- the charter terms
check("five insurance options", len(m.INSURANCE_OPTIONS) == 5)
api_js = open(os.path.join(os.path.dirname(m.__file__), "..", "frontend", "src", "api.js"), encoding="utf-8").read()
for name in ("INS_STANDARD", "INS_NOFEE_CUSTOM", "INS_PCT", "INS_CUSTOM", "INS_BLENDED"):
    js = re.search(rf'export const {name} = "([^"]+)";', api_js).group(1)
    check(f"{name} is spelled the same on both sides", js == getattr(m, name))
ap = m.charter_field_applies
check("parcel value for 0.25%", ap("insParcelValue", {"ins": m.INS_PCT}))
check("parcel value for blended", ap("insParcelValue", {"ins": m.INS_BLENDED}))
check("no parcel value for standard liability", not ap("insParcelValue", {"ins": m.INS_STANDARD}))
check("rate and max liability for the custom rate",
      ap("insRate", {"ins": m.INS_CUSTOM}) and ap("insMaxLiability", {"ins": m.INS_CUSTOM}))
check("max liability, no rate, for no-fee custom",
      ap("insMaxLiability", {"ins": m.INS_NOFEE_CUSTOM}) and not ap("insRate", {"ins": m.INS_NOFEE_CUSTOM}))
check("RDO terms only with RDO", ap("rdoFee", {"rdo": "Yes"}) and not ap("rdoSla", {"rdo": "No"}))
check("custom RDO SLA only when Custom", ap("rdoSlaCustom", {"rdo": "Yes", "rdoSla": "Custom"})
      and not ap("rdoSlaCustom", {"rdo": "Yes", "rdoSla": m.RDO_SLA_DEFAULT}))
check("TKBM fee with either TKBM", ap("tkbmFee", {"tkbmD": "Yes"}) and not ap("tkbmFee", {}))
check("RTS fee always", ap("rtsFee", {}))
labels = {k for _, f in m.CHARTER_SECTIONS for k, _ in f}
check("every new term is on the charter", {"rtsFee", "rdoFee", "rdoSla", "rdoSlaCustom", "tkbmFee",
      "insParcelValue", "insRate", "insMaxLiability"} <= labels)
check("every new term has a field rule", all(k in m.FIELD_RULES for k in ("rtsFee", "rdoFee", "rdoSla",
      "rdoSlaCustom", "tkbmFee", "insParcelValue", "insRate", "insMaxLiability")))
check("Sales CRM no longer writes the charter's Insurance",
      not any(k == "ins" for k, *_ in m.CRM_OPP_PAYLOAD) and any(k == "crmInsurance" for k, *_ in m.CRM_OPP_PAYLOAD))
print(f"legal: {ok} checks OK")
