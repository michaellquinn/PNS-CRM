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

# ---------------------------------------------------------------- head_for
print("\n=== head_for (margin breach always Sales Head)")
for resp in ("PNS", "Sales"):
    got = ns['head_for']({"resp": resp})
    ok = got == "Commercial"
    if not ok:
        fails.append("head_for(resp=%s) -> %s" % (resp, got))
    print("   priced by %-6s -> %-12s %s" % (resp, got, "" if ok else "<-- MISMATCH"))

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
if fails:
    print("FAILURES:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("ALL CHARTER + GATE CHECKS PASSED")
