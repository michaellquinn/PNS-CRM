"""The sync's guards, checked against the source of main.py.

Every check here exists because the thing it checks was built and then not wired up,
which is this repo's most expensive failure mode — the code looks present, the feature
looks shipped, and nothing happens.

  ignore list      V24 created salescrm_ignored AND wired the manageIgnored permission
                   on 2026-08-13. Nothing ever read the table, so "Test Ninja Biz - 1"
                   arrived on every import for a fortnight and was dismissed by hand
                   every time.
  revenue gate     change_status() refuses to enter a working status without potential
                   revenue, but _import_opportunity() wrote pending_for(resp) regardless
                   — so the sync walked past the app's own rule and left tickets sitting
                   in a status the rules say they may not be in.
  one field map    the import read fifteen Sales CRM fields and the refresh re-read two
                   of them, so anything Sales filled in after a deal was imported stayed
                   blank here forever. Both must walk merge_crm_payload().

These are structural checks on the AST, not behaviour tests: there is no database here.
That is the right level — each bug was a missing call, not a wrong answer.
"""
import ast
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
SRC = open(os.path.join(_REPO, "backend", "main.py"), encoding="utf-8").read()
TREE = ast.parse(SRC)

fails = []


def check(label, ok, hint=""):
    if not ok:
        fails.append(label + (" — " + hint if hint else ""))
    print(("  ok   " if ok else "  FAIL ") + label)


def fn(name):
    for node in ast.walk(TREE):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    return None


def body_of(name):
    node = fn(name)
    return ast.dump(node) if node else ""


def calls_in(name):
    """Names this function calls. ast.dump renders a call as Call(func=Name(id='x')),
    so a substring search for "x(" finds nothing — ask the tree instead."""
    node = fn(name)
    if not node:
        return set()
    out = set()
    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            f = n.func
            if isinstance(f, ast.Name):
                out.add(f.id)
            elif isinstance(f, ast.Attribute):
                out.add(f.attr)
    return out


def strings_in(name):
    node = fn(name)
    if not node:
        return []
    return [n.value for n in ast.walk(node)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)]


print("the ignore list is actually consulted")
sync = fn("sync_salescrm")
check("sync_salescrm exists", sync is not None)
sync_src = body_of("sync_salescrm")
check("the sync SELECTs from salescrm_ignored",
      any("salescrm_ignored" in s for s in strings_in("sync_salescrm")),
      "the table is never read, so the list does nothing")
# The skip has to happen before the already-imported branch, otherwise an ignored id
# that slipped through once keeps being refreshed forever.
check("an ignored id is skipped in the scan loop", "'ignored'" in sync_src or
      "id='ignored'" in sync_src)
check("the skip states its reason",
      any("on the ignore list" in s for s in strings_in("sync_salescrm")),
      "a silent skip is indistinguishable from a lost deal")
# Fetching the account for a row we are about to throw away is a wasted round trip
# inside a 25-second budget.
check("ignored ids are not warmed for their account", "ignored" in body_of("sync_salescrm"))

print("\nthe CRUD behind it")
for name in ("list_ignored", "add_ignored", "remove_ignored"):
    check(f"{name} exists", fn(name) is not None)
check("adding requires a reason",
      any("say why" in s.lower() for s in strings_in("add_ignored")),
      "an entry with no recorded why is indistinguishable from a misclick")
check("the list is admin-gated",
      "manageIgnored" in strings_in("list_ignored"),
      "this makes deals stop appearing; it is not an ordinary screen")

print("\nan import with no revenue does not walk past the revenue gate")
imp = strings_in("_import_opportunity")
check("_import_opportunity can land a ticket in Open", "Open" in imp,
      "revenue-0 imports go straight into a status change_status() would refuse")
check("the status is conditional on revenue",
      "plan['revenue']" in SRC.split("def _import_opportunity")[1].split("def ")[0]
      or 'plan["revenue"]' in SRC.split("def _import_opportunity")[1].split("def ")[0])

print("\nimport and refresh walk the SAME field map")
for name in ("_import_opportunity", "_refresh_from_salescrm"):
    check(f"{name} calls merge_crm_payload", "merge_crm_payload" in calls_in(name),
          "a field imported once then never refreshed goes stale silently")
check("the refresh can fill a blank potential revenue",
      "filled_rev" in body_of("_refresh_from_salescrm"),
      "Sales filling revenue in later was never picked up")
check("the refresh re-derives routing when it fills revenue",
      "route" in calls_in("_refresh_from_salescrm"),
      "who prices it was decided on the missing number")

print("\nunmapped fields are reported rather than assumed")
check("crm_unmapped exists", fn("crm_unmapped") is not None)
check("the sync counts unmapped fields", "crm_unmapped" in calls_in("sync_salescrm"),
      "'are we syncing everything?' has to be answerable from the data")

print()
if fails:
    print("FAILED %d check(s):" % len(fails))
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("ALL SYNC GUARD CHECKS PASSED")
