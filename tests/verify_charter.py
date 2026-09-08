"""Exercise the charter renderer and the approval gate out of the real main.py."""
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
import ast, sys, re

SRC = os.path.join(_REPO, "backend", "main.py")
tree = ast.parse(open(SRC, encoding='utf-8').read())

# big_group is pulled in because proposal_or_signoff now asks it whether the deal
# is watched — Must Win reaches C-level too, so the tier alone no longer answers it.
WANT_FN = {'render_charter', '_charter_value', 'proposal_or_signoff', 'head_for',
           'big_group',
           'needs_pns_review'}
WANT_VAR = {'CHARTER_SECTIONS', 'CHARTER_HOURS', '_CS', 'MANAGED_ACCTS'}
keep = [n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in WANT_FN)
        or (isinstance(n, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id in WANT_VAR for t in n.targets))]
ns = {}
exec(compile(ast.fix_missing_locations(ast.Module(body=keep, type_ignores=[])),
             '<charter>', 'exec'), ns)

fails = []

# ---------------------------------------------------------------- approval gate
# The gate that RECORDS a sign-off must accept everything the routing SENDS to it.
# Michael, 2026-08-26: SOF-4001332 was a Must Win deal on a Standard account. It was
# routed to Pending Review - C-level by proposal_or_signoff (which asks big_group) and
# then refused by exec_signoff (which asked acct_type against MANAGED_ACCTS, the rule
# Baskoro replaced on 2026-08-13). Routed there by one rule, refused there by another:
# no way forward, no way back, and the error blamed the account tier.
print("=== the sign-off gate accepts everything routed to it")
_src = open(os.path.join(_REPO, "backend", "main.py"), encoding="utf-8").read()
_ep = _src[_src.index("async def exec_signoff"):]
_ep = _ep[:_ep.index("await audit(")]
_fails = []
if "big_group(t)" not in _ep:
    _fails.append("exec_signoff does not gate on big_group()")
# The EXPRESSION, not the word: the docstring explains why the old test was replaced,
# so a bare search for "MANAGED_ACCTS" matches the explanation and fails on a fixed file.
if 'acct_type"] not in MANAGED_ACCTS' in _ep:
    _fails.append("exec_signoff still tests acct_type against MANAGED_ACCTS, which is "
                  "narrower than what proposal_or_signoff routes to it")
for _t in ({"acct_type": "Hypercare", "must_win": 0, "exec_signoff": 0},
           {"acct_type": "Strategic", "must_win": 0, "exec_signoff": 0},
           {"acct_type": "Standard", "must_win": 1, "exec_signoff": 0}):
    if ns["proposal_or_signoff"](_t) == "Pending Review - C-level" and not ns["big_group"](_t):
        _fails.append(f"{_t} is routed to C-level but the gate would refuse it")
for _f in _fails:
    print("  FAIL " + _f)
if not _fails:
    print("  ok   every watched group routed to C-level is accepted there")
    print("  ok   the gate no longer uses the narrower MANAGED_ACCTS test")
else:
    sys.exit(1)

print("=== proposal_or_signoff")
gate_cases = [
    ({"acct_type": "Strategic", "exec_signoff": 0}, "Pending Review - C-level"),
    ({"acct_type": "Hypercare", "exec_signoff": 0}, "Pending Review - C-level"),
    ({"acct_type": "Strategic", "exec_signoff": 1}, "Proposal Submitted"),
    ({"acct_type": "Hypercare", "exec_signoff": 1}, "Proposal Submitted"),
    ({"acct_type": "Non-Strategic", "exec_signoff": 0}, "Proposal Submitted"),
]
for t, exp in gate_cases:
    got = ns['proposal_or_signoff'](t)
    ok = got == exp
    if not ok:
        fails.append("gate %s signed=%s -> %s (want %s)"
                     % (t["acct_type"], t["exec_signoff"], got, exp))
    print("   %-16s signed=%s -> %-22s %s"
          % (t["acct_type"], t["exec_signoff"], got, "" if ok else "<-- MISMATCH"))

# head_for() was checked here: which Head acknowledges a below-floor price. Both it and
# the gate it served were retired on 2026-08-14 -- the Head of Sales accepts the
# commercial concession in Sales CRM. Nothing replaced it, so there is nothing to assert;
# verify_review_level pins the chains that no longer contain it.

# ---------------------------------------------------------------- charter render
print("\n=== render_charter")
t = {"ticket_ref": "SOF-1001302", "shipper": "PT Paskomnas <Niaga> & Utama",
     "acct_type": "Strategic", "service_type": "Sameday", "potential_rev": 10000000,
     "region": "GJ", "status": "Proposal Submitted", "submitted_on": "2026-08-04",
     "sales_name": "Sandrina", "owner_name": "Annisa"}
inp = {"brief": "line one\nline two", "pickup": "Cianjur", "pickWait": "",
       "delWait": "1", "volume": "6000", "sla": "Custom", "cod": "No"}
html, text = ns['render_charter'](t, inp, [("Pricing", "Sameday calculator")])

checks = [
    ("escapes HTML in shipper name", "&lt;Niaga&gt;" in html and "<Niaga>" not in html),
    ("escapes ampersand", "&amp; Utama" in html),
    ("newline becomes <br>", "line one<br>line two" in html),
    ("blank waiting time reads None", "None" in text and re.search(r"Pickup waiting time\s*:\s*None", text)),
    ("1 hour is singular", re.search(r"Delivery waiting time\s*:\s*1 hour\b", text) is not None),
    ("revenue formatted id-ID", "Rp 10.000.000" in text),
    ("extras appended", "Sameday calculator" in html and "Sameday calculator" in text),
    ("empty field shows em dash in html", "&mdash;" in html),
    ("all three sections present", all(s in text for s, _ in
                                       [(x[0].upper(), None) for x in ns['CHARTER_SECTIONS']])),
    ("NO cost anywhere", "cost" not in text.lower().replace("no cost or margin", "")),
    ("NO margin anywhere", "margin" not in text.lower().replace("no cost or margin", "")),
]
for desc, ok in checks:
    if not ok:
        fails.append("charter: " + desc)
    print("   %-42s %s" % (desc, "ok" if ok else "<-- FAILED"))

print("\n--- sample plain text (first 18 lines) ---")
for line in text.splitlines()[:18]:
    print("   " + line)

print()
# ------------------------------------------------- the brief belongs to Sales
# FIELD_RULES has always said so: brief is ("Sales", "asked", "It is the first thing PNS
# reads"). The import contradicted it, writing "Imported from Sales CRM opportunity
# 907113, PT Hermed - ..." into the field - which is not a brief, it is a restatement of
# the ticket's own header, and worse it read as DONE. A field with something in it does
# not look like a field somebody still owes, so nobody ever wrote the real one.
#
# Michael, 2026-09-07: leave it empty so it reads as outstanding.
#
# Checked over the AST at the CALL SITE, because the value being absent is the whole
# point - there is no function to call and assert on. The three import NOTEs that used
# to ride along on the brief moved to ticket_history, and that move is checked too: they
# are real warnings (routed at Rp 0, provisional service line, imported over the floor)
# and dropping them silently would be worse than the bug this fixed.
print()
print("the import leaves the brief for Sales to write")

_imp = next((n for n in ast.walk(tree)
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
             and n.name == "_import_opportunity"), None)
if _imp is None:
    fails.append("_import_opportunity not found - this guard is checking nothing")
    print("  FAIL _import_opportunity not found")
else:
    _keys = [k.value for n in ast.walk(_imp) if isinstance(n, ast.Dict)
             for k in n.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)]
    _writes_brief = "brief" in _keys
    print(("  FAIL " if _writes_brief else "  ok   ")
          + "the import does not write a brief")
    if _writes_brief:
        fails.append("_import_opportunity writes 'brief' - FIELD_RULES says that field "
                     "is Sales' to fill, and pre-filling it makes it look already done")

    # The notes must still land somewhere. ticket_history is where they went.
    _src_imp = ast.get_source_segment(open(SRC, encoding="utf-8").read(), _imp) or ""
    for _n in ("rev_note", "ftl_note", "floor_note"):
        _kept = _n in _src_imp
        print(("  ok   " if _kept else "  FAIL ") + f"{_n} is still recorded somewhere")
        if not _kept:
            fails.append(f"{_n} is no longer written anywhere - it warns about a real "
                         f"condition and cannot just be dropped")
    _in_history = "ticket_history" in _src_imp
    print(("  ok   " if _in_history else "  FAIL ")
          + "the import notes are written to ticket_history")
    if not _in_history:
        fails.append("the import notes are not going to ticket_history")

if fails:
    print("FAILURES:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("ALL CHARTER + GATE CHECKS PASSED")
