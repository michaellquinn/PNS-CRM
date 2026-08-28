"""The Sales CRM service line mapping, executed out of the real main.py.

Michael, 2026-08-26: the service line is a COMBINATION of NV Product Line and Service
Level, not one field. "Restock" alone does not say whether a deal is B2BR, Same Day or
Next Day, and the same level means different things under different product lines.

Worth its own suite because everything downstream keys off the answer: who prices it,
which 5A ceiling applies, whether PNS reviews, who it is assigned to, whether it can wait
on a vendor. A wrong service line is not a cosmetic error, it is a deal priced against
the wrong ceiling by the wrong team.

The two failure modes this pins:

  * a spelling drift. The sheet writes "Last Mile – Parcel" with an EN DASH where the old
    map had a hyphen. Matching literally, that stops importing a whole product line and
    says nothing except one line in the sync report.
  * a service in SERVICES with no pricing ceiling. guard_for() falls through to
    ("manual", None), which is a real band and looks deliberate, so a forgotten entry
    reads as "no published ceiling" rather than as a mistake.
"""
import ast
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
src = open(os.path.join(_REPO, "backend", "main.py"), encoding="utf-8").read()

WANT_FN = {"_norm_line", "_norm_level", "service_line_for", "route", "guard_for",
           "tier_of"}
WANT_VAR = {"SERVICE_LINE_MAP", "PRODUCT_LINE_DEFAULT", "PRODUCT_SKIP", "FTL_IN_NAME",
            "FTL_UNSPECIFIED", "FTL_VARIANT_UNKNOWN", "_LINE_LEVEL", "_LINE_ONLY",
            "_SKIP_N", "SERVICES", "PRICING_GUARD", "VENDOR_SERVICES", "MANAGED_ACCTS"}
keep = []
for node in ast.parse(src).body:
    if isinstance(node, ast.FunctionDef) and node.name in WANT_FN:
        keep.append(node)
    elif isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id in WANT_VAR:
                keep.append(node)
ns = {"re": re}
exec(compile(ast.fix_missing_locations(ast.Module(body=keep, type_ignores=[])),
             "<service-line>", "exec"), ns)
service_line_for = ns["service_line_for"]

fails = []


def check(label, ok, hint=""):
    if not ok:
        fails.append(label + (" — " + hint if hint else ""))
    print(("  ok   " if ok else "  FAIL ") + label)


# ---------------------------------------------------- the table Michael supplied
print("NV Product Line + Service Level -> PNS service line")
EN = "–"          # the dash the sheet actually uses
TABLE = [
    ("Restock", "Standard", "B2BR"),
    ("Restock", "Same Day", "Sameday"),
    ("Restock", "Next Day", "Next Day"),
    ("LTL", "Standard", "LTL"),
    ("Fulfillment", "-", "Fulfillment"),
    ("Complex Logistics", "-", "Complex Logistics"),
    (f"Last Mile {EN} Parcel", "Standard", "B2BR"),
    (f"Last Mile {EN} Parcel", "Same Day", "Sameday"),
    (f"Last Mile {EN} Document", "Standard", "B2BR"),
    (f"Last Mile {EN} Document", "Same Day", "Sameday"),
    (f"Last Mile {EN} Cargo", "Standard", "B2BR"),
]
for line, level, want in TABLE:
    got, _why = service_line_for(line, level, "PT Ordinary Shipper")
    check(f"{line} / {level} -> {want}", got == want, f"got {got!r}")

# The same rows written the ways a hand-edited picklist actually writes them.
print("\nspelling drift does not change the answer")
for line, level, want in [
    ("Last Mile - Parcel", "Standard", "B2BR"),      # hyphen, not en dash
    ("last mile-parcel", "standard", "B2BR"),        # lower case, no padding
    ("  Restock  ", " Same Day ", "Sameday"),        # stray whitespace
    ("Restock", "SameDay", "Sameday"),               # level with the space closed up
]:
    got, _ = service_line_for(line, level, "PT Ordinary Shipper")
    check(f"{line!r} / {level!r} -> {want}", got == want, f"got {got!r}")

# ---------------------------------------------------- the FTL shipper-name rule
print("\nFTL is read off the shipper name, and beats the product line")
FTL = ns["FTL_UNSPECIFIED"]
for name, want in [
    ("PT. LF Services Indonesia (Maersk OCF) - Electrolux - FTL - Jabo - (B2BR)", FTL),
    ("Tanamera Coffee Indonesia - FTL (B2BR)", FTL),
    ("PT Something FTL-Jakarta", FTL),
    # Not FTL: the rule is a whole word, so a word merely CONTAINING those letters is
    # left alone. Without the word boundary "SHIFTLESS" becomes a truck deal.
    ("PT SHIFTLESS Logistics", "B2BR"),
    ("PT Softly Ltd", "B2BR"),
    ("PT Paskomnas Niaga Utama - Sameday (B2BR)", "B2BR"),
]:
    got, _ = service_line_for("Restock", "Standard", name)
    check(f"{name[:44]:44} -> {got}", got == want, f"expected {want}")

got, why = service_line_for("Restock", "Standard", "PT A - FTL - B")
check("an FTL shipper name is flagged as provisional", bool(why))
check("a plain product-line hit is NOT flagged",
      not service_line_for("LTL", "Standard", "PT A")[1])

# ---------------------------------------------------- fallbacks and refusals
print("\nmissing or unknown levels fall back, unknown lines refuse")
got, why = service_line_for("Restock", "", "PT A")
check("no service level falls back to the line's standard reading", got == "B2BR")
check("...and says so on the ticket", bool(why))
got, why = service_line_for("Restock", "Weekend", "PT A")
check("an unpublished combination falls back rather than refusing", got == "B2BR")
check("...and says so too", bool(why))
got, _ = service_line_for("Trucking", "-", "PT A")
check("Trucking is the provisional FTL line, not a guessed variant", got == FTL,
      f"got {got!r}")
for line in ("Cold Chain", "Cross-border", "Air-freight", "Wingsuit Delivery", ""):
    got, _ = service_line_for(line, "-", "PT Ordinary Shipper")
    check(f"{line or '(blank)'} is refused rather than guessed", got is None,
          f"got {got!r}")

# ---------------------------------------------------- everything downstream agrees
print("\nevery service the mapping can produce is known to the rules")
produced = set(ns["SERVICE_LINE_MAP"].values()) | set(ns["PRODUCT_LINE_DEFAULT"].values())
produced.add(FTL)
for svc in sorted(produced):
    check(f"{svc} is in SERVICES", svc in ns["SERVICES"])
    check(f"{svc} has a pricing ceiling at every band",
          svc in ns["PRICING_GUARD"] and set(ns["PRICING_GUARD"][svc]) == {"low", "mid", "high"},
          "guard_for() would answer ('manual', None) and look deliberate")

# The provisional line must be handled everywhere the real ones are, or a deal waiting to
# be resolved quietly behaves differently from the thing it will become.
print("\nthe provisional FTL line behaves like the lines it resolves into")
check("FTL can wait on a vendor quote, like both real FTL lines",
      FTL in ns["VENDOR_SERVICES"])
check("FTL carries the same ceilings as FTL on-call",
      ns["PRICING_GUARD"][FTL] == ns["PRICING_GUARD"]["FTL on-call"])
route = ns["route"]
check("FTL routes to PNS, who is the one who resolves it",
      route("Standard", FTL, 5_000_000)["resp"] == "PNS")

# ---------------------------------------------------- scope beats the shipper name
# The FTL name rule used to be the FIRST thing service_line_for did, which made the
# out-of-scope list unreachable for any deal whose name contained "FTL" - the name rule
# returned a service, so the import never saw the None that triggers the skip. That is
# how SOF-5001324, a Ninja Cold deal named "... - FTL On Call (Ninja Cold)", arrived as
# an ordinary truck ticket. Cross-border and air freight had the identical hole.
#
# Checked as OUTCOMES rather than by reading the source, so the guard survives the
# function being rewritten: for every skipped line, no name gets a service out of it.
print()
print("an out-of-scope product line is refused whatever the shipper is called")
_SKIP_N = ns["_SKIP_N"]
NAMES = [
    "PT Nawasena Asri Pertiwi - FTL On Call (Ninja Cold)",
    "PT Anything - FTL",
    "FTL Logistics Indonesia",
    "PT Ordinary Shipper",
]
for raw in ns["PRODUCT_SKIP"]:
    for nm in NAMES:
        for lvl in ("Standard", "Same Day", ""):
            got, _ = service_line_for(raw, lvl, nm)
            check(f"{raw} / {lvl or '(no level)'} / {nm[:30]:30} -> refused",
                  got is None, f"got {got!r} - the skip list is being bypassed")
    check(f"{raw} still carries a stated reason for the sync report",
          bool(_SKIP_N.get(ns["_norm_line"](raw))))

# The other half of the same rule: the name rule must still fire for every line that is
# NOT out of scope, or fixing the hole would have quietly disabled FTL detection.
print()
print("...and the FTL name rule still fires on every in-scope line")
for line, lvl in [("Restock", "Standard"), ("LTL", "Standard"),
                  ("Last Mile - Parcel", "Same Day"), ("Trucking", ""), ("", "")]:
    got, why = service_line_for(line, lvl, "PT Anything - FTL - Jabo")
    check(f"{line or '(blank)'} / {lvl or '(none)'} -> FTL", got == FTL, f"got {got!r}")
    check(f"{line or '(blank)'} says the line is provisional", bool(why))

print()
if fails:
    print("FAILED %d check(s):" % len(fails))
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("ALL SERVICE LINE CHECKS PASSED")
