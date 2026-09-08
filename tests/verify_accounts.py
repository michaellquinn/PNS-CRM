"""Pin the Accounts screen's display-only name grouping and tag precedence.

Sales CRM can create several Account records for one commercial shipper, with a deal,
service and region appended to each name. The Accounts screen must collapse those cards
without changing the original account ids, tiers or ticket routing.
"""
import ast
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, "backend", "main.py")
source = open(MAIN, encoding="utf-8").read()
tree = ast.parse(source)


def function(name):
    node = next((n for n in tree.body if isinstance(n, (ast.FunctionDef,
                                                         ast.AsyncFunctionDef))
                 and n.name == name), None)
    if node is None:
        raise AssertionError(f"backend/main.py has no {name}()")
    return node


ns = {"re": re}
for name in ("shipper_base_name", "shipper_name_key", "account_rollup_group"):
    exec(compile(ast.Module(body=[function(name)], type_ignores=[]), MAIN, "exec"), ns)

base = ns["shipper_base_name"]
key = ns["shipper_name_key"]
rollup = ns["account_rollup_group"]
fails = []


def same(left, right, label):
    if key(left) != key(right):
        fails.append(f"{label}: {key(left)!r} != {key(right)!r}")


same(
    "PT. LF Services Indonesia (Maersk OCF) - Electrolux - FTL - Jabo - (B2BR)",
    "PT LF Service Indonesia (Maersk OCF) - Puma - Sameday - REG - (B2BR)",
    "LF Services opportunities must share one account card",
)
same("PT Hermed - FTL (B2BR)", "PT. Hermed - Emaklon - FTL (B2BR)",
     "Hermed opportunities must share one account card")

if base("PT. LF Services Indonesia (Maersk OCF) - Puma - Sameday") != \
        "PT. LF Services Indonesia (Maersk OCF)":
    fails.append("the displayed name did not stop at the spaced CRM suffix dash")
if base("PT A-B Indonesia - FTL") != "PT A-B Indonesia":
    fails.append("a dash inside a legal name was mistaken for the CRM suffix delimiter")
if key("PT Sinar Jaya") == key("PT Sinar Jaya Logistics"):
    fails.append("the deterministic key became fuzzy and merged merely similar shippers")

cases = [
    ([{"acct_type": "Standard", "must_win": False}], None),
    ([{"acct_type": "Standard", "must_win": True}], "Must Win"),
    ([{"acct_type": "Standard", "must_win": True},
      {"acct_type": "Strategic", "must_win": False}], "Strategic"),
    ([{"acct_type": "Strategic", "must_win": True},
      {"acct_type": "Hypercare", "must_win": False}], "Hypercare"),
]
for rows, want in cases:
    got = rollup(rows)
    if got != want:
        fails.append(f"roll-up tag for {rows!r}: got {got!r}, want {want!r}")

# This is intentionally a view. Pin the wiring and the absence of writes in the endpoint,
# so a later refactor cannot turn a card merge into a tier/routing mutation.
account_node = function("accounts")
account_src = ast.get_source_segment(source, account_node) or ""
for required in ("shipper_name_key(r[\"shipper\"])", "account_rollup_group(rs)",
                 "source_accounts=sources"):
    if required not in account_src:
        fails.append(f"accounts() is not wired to {required}")
if "await execute(" in account_src or "UPDATE " in account_src or "INSERT " in account_src:
    fails.append("accounts() writes business data; name grouping must remain display-only")

if fails:
    for fail in fails:
        print("FAIL:", fail)
    sys.exit(1)

print("verify_accounts.py      base-name grouping; strongest tag; display-only")
