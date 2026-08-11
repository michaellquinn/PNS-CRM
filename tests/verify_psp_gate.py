"""Check the PSP entry gate out of the real main.py.

Rule (Baskoro, 2026-08-10): PSP only receives tickets carrying an exception from Alex.
Strategic and Hypercare carry it by being managed. Anything else needs the PNS Head to
have set psp_allowed after Alex granted it verbatim in a meeting.
"""
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
import ast, sys

SRC = os.path.join(_REPO, "backend", "main.py")
tree = ast.parse(open(SRC, encoding='utf-8').read())

WANT_FN = {'may_go_to_psp', 'proposal_or_signoff', 'guard_for', 'guard_breached',
           'tier_of', 'needs_pns_review'}
WANT_VAR = {'MANAGED_ACCTS', 'PRICING_GUARD'}
keep = [n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in WANT_FN)
        or (isinstance(n, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id in WANT_VAR for t in n.targets))]
ns = {}
exec(compile(ast.fix_missing_locations(ast.Module(body=keep, type_ignores=[])),
             '<psp>', 'exec'), ns)
may = ns['may_go_to_psp']

fails = []

print("=== may_go_to_psp")
cases = [
    ({"acct_type": "Strategic", "psp_allowed": 0}, True, "Strategic carries the exception"),
    ({"acct_type": "Hypercare", "psp_allowed": 0}, True, "Hypercare carries the exception"),
    ({"acct_type": "Non-Strategic", "psp_allowed": 0}, False, "plain Non-Strategic cannot"),
    ({"acct_type": "Non-Strategic", "psp_allowed": 1}, True, "PNS Head opened it on Alex's grant"),
    ({"acct_type": "Non-Strategic"}, False, "missing flag is not an exception"),
]
for t, exp, why in cases:
    got = may(t)
    ok = got == exp
    if not ok:
        fails.append(why)
    print("   %-14s allowed=%-3s -> %-6s %-44s %s"
          % (t["acct_type"], t.get("psp_allowed"), got, why, "" if ok else "<-- MISMATCH"))

# The routing consequence: a guard that WOULD send to PSP must fall back to the Sales
# Head when the ticket carries no exception. This mirrors submit_price.
print("\n=== routing consequence (mirrors submit_price)")


def route_price(t, margin=None, discount=None):
    """Mirrors submit_price. Note the gate is NOT consulted here: these paths are PSP's
    by rule. The gate governs the discretionary routes (ask_psp, head_ack)."""
    g = ns['guard_for'](t["acct_type"], t["service_type"], t["potential_rev"])
    breach = ns['guard_breached'](g, margin, discount)
    if g["kind"] == "standard" and (discount or 0) > 0:
        breach = True
    to_psp = g["kind"] == "manual" or (breach and g["kind"] in ("discount", "standard"))
    if to_psp:
        return "Pending Review - PSP"
    if breach:
        return "Pending Review - Head Sales"
    return "clear"


rcases = [
    ({"acct_type": "Non-Strategic", "service_type": "Sameday", "potential_rev": 5_000_000,
      "psp_allowed": 0}, None, 25.0, "Pending Review - PSP",
     "Sameday over 20% discount: PSP by rule, no exception needed"),
    ({"acct_type": "Non-Strategic", "service_type": "FTL monthly",
      "potential_rev": 50_000_000, "psp_allowed": 0}, None, None, "Pending Review - PSP",
     "FTL >=30 Mio manual band: PSP by rule"),
    ({"acct_type": "Non-Strategic", "service_type": "FTL on-call",
      "potential_rev": 50_000_000, "psp_allowed": 0}, None, None, "Pending Review - PSP",
     "FTL on-call >=30 Mio: PSP by rule, mirrors monthly"),
    ({"acct_type": "Strategic", "service_type": "LTL", "potential_rev": 5_000_000,
      "psp_allowed": 0}, 30.0, None, "Pending Review - PSP",
     "Strategic is manual review and always reaches PSP"),
    ({"acct_type": "Non-Strategic", "service_type": "LTL", "potential_rev": 5_000_000,
      "psp_allowed": 0}, 19.0, None, "Pending Review - Head Sales",
     "plain margin breach stays with the Sales Head"),
    ({"acct_type": "Non-Strategic", "service_type": "B2BR", "potential_rev": 20_000_000,
      "psp_allowed": 0}, 9.0, None, "Pending Review - Head Sales",
     "B2BR margin breach: Sales Head, not PSP"),
    ({"acct_type": "Non-Strategic", "service_type": "Sameday", "potential_rev": 5_000_000,
      "psp_allowed": 0}, None, 20.0, "clear",
     "Sameday at exactly 20%: nobody"),
    ({"acct_type": "Non-Strategic", "service_type": "LTL", "potential_rev": 5_000_000,
      "psp_allowed": 0}, 25.0, None, "clear",
     "inside the ceiling: nobody"),
]
for t, m, d, exp, why in rcases:
    got = route_price(t, m, d)
    ok = got == exp
    if not ok:
        fails.append(why)
    print("   %-58s -> %-22s %s" % (why[:58], got, "" if ok else "<-- MISMATCH exp=" + exp))

print()
if fails:
    print("FAILURES:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("ALL PSP GATE CHECKS PASSED")
