"""Pin where the account tier is read from.

Sales CRM moved the Hypercare/Strategic tag from customer_success_manager to Account
Indicator (Michael, 2026-09-16). The tier routes the deal - who prices it, who reviews,
whether executives sign off - so reading the wrong field quietly re-routes every account.
Pins that the indicator decides when filled in, that the old field is only a fallback for
accounts not yet re-tagged, and that Must Win is NOT read from the account.
"""
import ast
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, "backend", "main.py")
source = open(MAIN, encoding="utf-8").read()
tree = ast.parse(source)

ns = {"re": re}
wanted = ("ACCOUNT_INDICATOR_FIELDS", "tier_from_csm", "account_indicator", "account_tier")
body = [n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in wanted)
        or (isinstance(n, ast.Assign) and any(getattr(t, "id", None) in wanted
                                               for t in n.targets))]
exec(compile(ast.Module(body=body, type_ignores=[]), MAIN, "exec"), ns)
tier = ns["account_tier"]
fails = []

cases = [
    ({"account_indicator": "Hypercare"}, "Hypercare", "indicator Hypercare"),
    ({"account_indicator": "strategic account"}, "Strategic", "indicator is case-blind"),
    ({"account_indicator": ["Strategic"]}, "Strategic", "multi-select list"),
    ({"accountIndicator": "Hypercare"}, "Hypercare", "camelCase spelling"),
    ({"account_indicator": "Strategic", "customer_success_manager": "Hypercare"},
     "Strategic", "indicator must beat the old field"),
    ({"account_indicator": "Regular", "customer_success_manager": "Hypercare"},
     None, "a filled non-tier indicator is an answer, not a blank"),
    ({"account_indicator": "", "customer_success_manager": "Hypercare"},
     "Hypercare", "blank indicator falls back to the old field"),
    ({"customer_success_manager": "0015g00000AbCdEfGH"}, None, "Salesforce id is no tier"),
    ({"account_indicator": "Must Win"}, None, "Must Win is per opportunity, not account"),
    ({}, None, "untagged account"),
    (None, None, "no account"),
]
for rec, want, label in cases:
    got = tier(rec)
    if got != want:
        fails.append(f"{label}: expected {want!r}, got {got!r}")

walk = ast.get_source_segment(source, next(
    n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "tier_for"))
if "account_tier(a)" not in walk:
    fails.append("tier_for() no longer reads the tier through account_tier()")

if fails:
    print("\n".join("FAIL " + f for f in fails))
    sys.exit(1)
print(f"account indicator: {len(cases)} cases OK")
