"""My requests and the new Cancel options (Michael, 2026-10-21).

  * My requests matches the Sales PIC by NAME as well as email -- synced deals carry no
    email -- and includes what the person owns in PNS;
  * Cancel is a move the transition map allows from every open status, including
    Pending solution's and Proposal Submitted, and it needs a reason;
  * the screens offer Cancel on Pending solution and Cancel / Future opportunity on
    Proposal submitted.
"""
import sys, types, os
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

src = open(m.__file__, encoding="utf-8").read()
check("Sales are matched by name or email, and as PNS owner",
      'sql += " AND (t.sales_email=%s OR t.sales_name=%s OR t.owner_name=%s)"' in src)
check("PNS members also see what they raised",
      'sql += " AND (t.owner_name=%s OR t.sales_email=%s)"' in src)
for frm in list(m.AWAIT_STATUSES) + ["Proposal Submitted"]:
    check(f"{frm} -> Cancel is allowed", "Cancel" in m.MANUAL_MOVES.get(frm, set()))
check("Cancel needs a reason", "say why {ref} is being cancelled" in src)

fe = lambda p: open(os.path.join(ROOT, "frontend", "src", p), encoding="utf-8").read()
q, meet, mine = fe("screens/Queues.jsx"), fe("screens/Meetings.jsx"), fe("screens/Mine.jsx")
check("Pending solution rows carry Cancel request", "<CancelTicket t={t}" in meet)
check("Proposal submitted offers Cancel", '<option value="Cancel:cancel">Cancel</option>' in q)
check("...and Future opportunity", '<option value="Cancel:future">Future opportunity</option>' in q)
check("Future opportunity says so in the reason", "Future opportunity — ${reason.trim()}" in q)
check("My requests has its views", all(v in mine for v in ('"open"', '"won"', '"lost"', '"cancelled"', '"all"')))
check("...and a Stage picker", "Every stage" in mine)
# ---- names (2026-10-21): the sync translates Sales CRM's second names, and a rename
# in Users & roles carries over to the person's tickets.
check("Ari on a Sales CRM deal is Bayu", m.crm_owner({"owner_name": "Ari"}) == "Bayu Bakhriansyah Bachruddin")
check("Kelvin is Kelvin Sitinjak", m.crm_owner({"owner_name": "Kelvin"}) == "Kelvin Sitinjak")
check("everyone else passes through", m.crm_owner({"owner_name": "Dandy Pradipto Wicaksono"}) == "Dandy Pradipto Wicaksono")
check("no owner stays no owner", m.crm_owner({}) is None)
check("the import and the refresh both translate",
      '"sales_name": crm_owner(o),' in src and 'o.get("name"), crm_owner(o)]' in src)
check("a rename carries over to tickets",
      'UPDATE tickets SET sales_name=%s WHERE sales_name=%s", (name, row["name"])' in src
      and 'UPDATE tickets SET owner_name=%s WHERE owner_name=%s", (name, row["name"])' in src)
mig = open(os.path.join(ROOT, "backend", "resources", "db", "migration", "V39__sales_name_aliases.sql"), encoding="utf-8").read()
check("V39 corrects the tickets already carrying the old names",
      all(x in mig for x in ("'Sandrina Oktiana' WHERE sales_name = 'Sandrina'",
                             "'Bayu Bakhriansyah Bachruddin' WHERE sales_name = 'Ari'",
                             "'Kelvin Sitinjak' WHERE sales_name = 'Kelvin'")))
# ---- FTL retired (2026-10-22): the sync never moves a ticket onto or off a truck line,
# V40 moves the provisional tickets to FTL monthly, and the header is Solutioning CRM.
check("the refresh leaves FTL on-call / monthly alone",
      'if t["service_type"] in FTL_LINES:\n        crm_service = None' in src)
check("the refresh keeps the 'Sales CRM says FTL' mark current",
      'payload["_crmFtl"] = "Yes" if crm_says_ftl else ""' in src)
check("an FTL deal only takes FTL on-call or FTL monthly",
      "and body.service not in FTL_LINES:" in src)
check("the holding FTL line can stay while other fields are edited",
      "if service not in SERVICES and service != t[\"service_type\"]:" in src)
check("the screen offers only the two lines for an FTL deal",
      'const lineOptions = (t, i) => (i?._crmFtl === "Yes" || t.service === "FTL") ? FTL_LINES : SERVICES;'
      in fe("screens/TicketDetail.jsx"))
check("an inactive person in the rules can be taken out",
      "(inactive) ✕" in fe("screens/Workload.jsx") and '"inactive": [{"email": e' in src)
check("a server error does not tell people to ask for access",
      "HTTP 5" in fe("App.jsx") and "The app is restarting" in fe("App.jsx"))
v40 = open(os.path.join(ROOT, "backend", "resources", "db", "migration",
                        "V40__retire_provisional_ftl.sql"), encoding="utf-8").read()
check("V40 moves the provisional tickets to FTL monthly with a history note",
      "UPDATE tickets SET service_type = 'FTL monthly' WHERE service_type = 'FTL'" in v40
      and "INSERT INTO ticket_history" in v40
      and v40.index("INSERT INTO ticket_history") < v40.index("UPDATE tickets"))
app = fe("App.jsx")
check("the header says Solutioning CRM with the ninja",
      "Solutioning CRM" in app and 'src="/ninja.png"' in app and "Ninja PNS" not in app)
check("the ninja image ships with the site",
      os.path.getsize(os.path.join(ROOT, "frontend", "public", "ninja.png")) > 1000)
print(f"my requests + cancel: {ok} checks OK")
