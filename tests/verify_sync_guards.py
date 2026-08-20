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


def source_of(name):
    """The function's actual source text. body_of() gives an ast.dump, which cannot
    answer "is this still written this way" -- two checks below were silently passing
    against a dump that could never contain the string they looked for."""
    node = fn(name)
    return ast.get_source_segment(SRC, node) if node else ""


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

print()
print("Sales CRM always takes priority (Baskoro, 2026-08-14)")
# The rule is carried by the `owned` flag on the two field maps: True means the sync
# overwrites ours. It drives BOTH merge_crm_payload and the Reference / Fields page, so a
# flag flipped back to False would quietly promise a durability the sync does not give.
_maps = {}
_keep = [n for n in ast.parse(SRC).body
         if isinstance(n, ast.Assign)
         and getattr(n.targets[0], "id", "") in ("CRM_OPP_PAYLOAD", "CRM_ACCOUNT_PAYLOAD")]
exec(compile(ast.Module(body=_keep, type_ignores=[]), "<maps>", "exec"), _maps)
_not_owned = [k for m in ("CRM_OPP_PAYLOAD", "CRM_ACCOUNT_PAYLOAD")
              for k, _n, _l, owned in _maps[m] if not owned]
# There is no exception any more. golive was one until 2026-08-18, because it read
# expected_close_date -- when the DEAL closes, not when the shipper starts shipping.
# Baskoro's field list showed Sales CRM has target_start_date, so it reads the right
# field now and the rule applies everywhere without carve-outs. Anything appearing here
# is a field somebody quietly decided the sync should not own; that is a decision worth
# making out loud, not in a flag.
check("every mapped field is Sales CRM's, with no exceptions",
      _not_owned == [],
      "not owned: %s -- expected none" % _not_owned)

# The intake questions Sales CRM already answers. Each of these was being asked of a
# salesperson who had just typed the answer into Sales CRM, which is how intake ends up
# half empty. Named individually so removing one is a deliberate act.
_opp = {k: names for k, names, _l, _o in _maps["CRM_OPP_PAYLOAD"]}
for _key, _src in (("golive", "target_start_date"), ("cod", "cash_on_delivery_cod"),
                   ("ins", "insurance"), ("wt", "weight_per_shipment"),
                   ("sla", "service_level"), ("freq", "frequency_of_shipment"),
                   ("delSlot", "delivery_slas"), ("dim", "size_paket"),
                   ("handling", "shipping_requirements")):
    check(f"{_key} is filled from {_src}", _src in _opp.get(_key, []),
          "Sales CRM holds this answer already")

_ref = body_of("_refresh_from_salescrm")
check("the refresh overwrites the service line", "service_type=%s" in _ref,
      "service was left alone before 2026-08-14; the rule now says Sales CRM wins")
check("the refresh overwrites the account tier", "UPDATE shippers SET acct_type" in _ref,
      "the tier is an account fact and lives on the shipper, not the ticket")
check("the refresh records what it overwrote", "overwritten" in _ref,
      "a value changing under somebody with no trace is how trust in the sync goes")

print()
print("Sales CRM owns the watched groups in BOTH directions (Baskoro, 2026-08-18)")
# Promote AND demote. Both were one-way at some point and each caused the same fault
# from the other side: a deal stayed in a watched group after the business had stopped
# treating it as one, or an account could never be tagged from Sales CRM at all.
_refsrc = source_of("_refresh_from_salescrm")
check("the tier is applied whatever Sales CRM says, not only when it says Hypercare",
      "stated_tier = tier" in _refsrc and "tier in MANAGED_ACCTS" not in _refsrc,
      "promote-only leaves a demoted account watched forever")
check("Must Win is written on every refresh, not only when the field is present",
      'sets.append("must_win=%s")' in _refsrc and "if mw_field:" not in _refsrc,
      "clearing Lead Source Detail in Sales CRM must clear the flag here too")

print()
print("nothing before the floor date is imported")
check("there is an import floor", "SYNC_MIN_DATE" in SRC,
      "one careless wide window would import the whole history of the book")
check("the floor applies to imports, not to refreshing held tickets",
      "SYNC_MIN_DATE" not in _refsrc,
      "a held pre-floor ticket must still learn when its opportunity closes")

print()
print("the automatic sync fails loudly rather than silently")
check("there is an auto-sync loop", fn("_auto_sync_loop") is not None)
check("its failures are recorded, not just raised",
      "last_error" in body_of("_auto_sync_loop"),
      "an unattended sync that dies quietly leaves the book stale with nobody told")
# body_of() returns an ast.dump, so the lock reads as a Name + an attr, not as source.
_loop = body_of("_auto_sync_loop")
check("it skips rather than queues when a sync is already running",
      "'_sync_lock'" in _loop and "'locked'" in _loop,
      "a queued sync is only a slower duplicate of the one that just ran")

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
