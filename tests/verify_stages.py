"""What a Sales CRM stage does to a PNS ticket, executed out of the real main.py.

Michael, 2026-08-31: "Future Opportunity" was being read as a loss, and it is not one.
Closed-Lost means the shipper walked away; Future Opportunity means ask again next
quarter. They shared one list.

That was not a labelling problem, it was a data-loss problem, and it is the reason this
suite exists. Reading a park as a loss set our status to Lost — and _refresh_from_salescrm
skips any ticket sitting in Lost, Cancel or accepted, on the sound reasoning that a
decided ticket keeps its recorded outcome. Terminal is therefore a door the sync cannot
reopen. So when Sales revived the opportunity, nothing brought the ticket back: it stayed
Lost through Negotiation, Proposal Submitted and Agreed to Ship alike, invisible to
everyone, because nobody reads the Lost list looking for live work.

The three things pinned here, each of which failed silently before:

  * a parked stage must decide NOTHING about our status, so the ticket survives the park;
  * a real loss must still be terminal, or "Lost" stops meaning anything;
  * every stage test must compare NORMALISED. The picklist is hand-edited - the misspelt
    "Future Oppurtunity" in the list is the proof - and three of the four tests compared
    raw, so a trailing space silently changed what a stage did. The raw/normalised split
    is checked structurally, over the AST, because that is the form the bug took.
"""
import ast
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
_SRC_PATH = os.path.join(_REPO, "backend", "main.py")
src = open(_SRC_PATH, encoding="utf-8").read()

WANT_FN = {"_norm_stage", "status_for_stage", "stage_blocks_work"}
WANT_VAR = {"CLOSED_LOST_STAGES", "PARKED_STAGES", "ACCEPTED_STAGES", "SUBMITTED_STAGES",
            "_LOST_N", "_PARKED_N", "_ACCEPTED_N", "_SUBMITTED_N"}
keep = []
for node in ast.parse(src).body:
    if isinstance(node, ast.FunctionDef) and node.name in WANT_FN:
        keep.append(node)
    elif isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id in WANT_VAR:
                keep.append(node)
ns = {}
exec(compile(ast.fix_missing_locations(ast.Module(body=keep, type_ignores=[])),
             "<stages>", "exec"), ns)

status_for_stage = ns["status_for_stage"]
stage_blocks_work = ns["stage_blocks_work"]
norm = ns["_norm_stage"]
LOST, PARKED = ns["CLOSED_LOST_STAGES"], ns["PARKED_STAGES"]
ACCEPTED, SUBMITTED = ns["ACCEPTED_STAGES"], ns["SUBMITTED_STAGES"]

# The statuses _refresh_from_salescrm refuses to move a ticket out of. Mirrored from the
# guard there; the last check in this file proves it is still what the source says.
FROZEN = ("Lost", "Cancel", "Proposal Accepted / Ready to Ship")

fails = []


def check(label, ok, hint=""):
    if not ok:
        fails.append(label + (" - " + hint if hint else ""))
    print(("  ok   " if ok else "  FAIL ") + label)


# ------------------------------------------------------- parked is not a loss
print("a parked stage decides nothing about our status")
for stage in PARKED:
    got = status_for_stage(stage, "PNS")
    check(f"{stage} leaves our status alone", got is None, f"wants {got!r}")
    check(f"{stage} is not in the lost list", norm(stage) not in ns["_LOST_N"])
    check(f"{stage} still blocks a price going out", bool(stage_blocks_work({"stage": stage})))

print()
print("a real loss is still a loss")
for stage in LOST:
    check(f"{stage} -> Lost", status_for_stage(stage, "PNS") == "Lost")
    check(f"{stage} blocks a price going out", bool(stage_blocks_work({"stage": stage})))

check("the two lists share nothing",
      not (set(map(norm, LOST)) & set(map(norm, PARKED))),
      "a stage cannot be both parked and lost")

# ------------------------------------------------------- the round trip
# The whole point. Replays _refresh_from_salescrm's guard, not just the mapping, because
# the mapping alone never showed the bug - Lost was reachable, it was just never leavable.
print()
print("a deal parked mid-solutioning survives being revived")
status = "Pending PNS"
journey = ["Negotiation", "Future Opportunity", "Negotiation",
           "Proposal Submitted", "Agreed to Ship"]
for stage in journey:
    wants = status_for_stage(stage, "PNS")
    if wants and status != wants and status not in FROZEN:
        status = wants
    if stage in PARKED:
        check("parked: the ticket keeps its place in the queue", status == "Pending PNS",
              f"became {status!r}")
check("revived: it ends where Sales ended, not at Lost",
      status == "Proposal Accepted / Ready to Ship", f"ended at {status!r}")

# ------------------------------------------------------- normalisation
print()
print("the picklist is hand-edited, so every stage test normalises")


def variants(stage):
    """The ways a hand-edited picklist actually writes one stage."""
    return [stage, stage.lower(), stage.upper(), stage + " ", " " + stage,
            stage.replace(" ", "  ")]


for group in (LOST, PARKED, ACCEPTED, SUBMITTED):
    for stage in group:
        want_status = status_for_stage(stage, "PNS")
        want_block = bool(stage_blocks_work({"stage": stage}))
        for v in variants(stage):
            check(f"{v!r} maps like {stage!r}",
                  status_for_stage(v, "PNS") == want_status,
                  f"got {status_for_stage(v, 'PNS')!r}, wanted {want_status!r}")
            check(f"{v!r} blocks like {stage!r}",
                  bool(stage_blocks_work({"stage": v})) == want_block)

print()
print("an ordinary mid-funnel stage is left alone and stays workable")
for stage in ("New", "Negotiation", "EKYC Approval", "Contract Sent", "", None):
    check(f"{stage!r} implies nothing", status_for_stage(stage, "PNS") is None)
    check(f"{stage!r} does not block work", stage_blocks_work({"stage": stage}) is None)

# ------------------------------------------------------- structural: no raw compares
# Checked over the AST rather than by grepping, because the bug was a MEMBERSHIP TEST
# against the raw tuple. Set comprehensions that build the normalised sets, and
# list(...) calls that render the reference screen, are not Compare nodes, so they do not
# trip this. Written this way after two earlier guards in this repo matched their own
# explanatory comments and passed on the broken file.
print()
print("no stage test compares against the raw tuples")
RAW = {"CLOSED_LOST_STAGES", "PARKED_STAGES", "ACCEPTED_STAGES", "SUBMITTED_STAGES"}
raw_compares = []
tree = ast.parse(src)
for node in ast.walk(tree):
    if not isinstance(node, ast.Compare):
        continue
    for op, comp in zip(node.ops, node.comparators):
        if isinstance(op, (ast.In, ast.NotIn)) and isinstance(comp, ast.Name) \
                and comp.id in RAW:
            raw_compares.append((comp.id, node.lineno))
for name, line in raw_compares:
    check(f"main.py:{line} compares against raw {name}", False,
          "use the normalised set - a trailing space is not a different stage")
check("every membership test uses a normalised set", not raw_compares,
      f"{len(raw_compares)} raw comparison(s)")

# And the frozen list this suite reasons about must still be the one the sync applies.
print()
print("the terminal list this suite assumes is the one the sync enforces")
_refresh = [n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name == "_refresh_from_salescrm"]
check("_refresh_from_salescrm exists", bool(_refresh))
if _refresh:
    body = ast.get_source_segment(src, _refresh[0]) or ""
    for s in FROZEN:
        check(f"{s!r} is still a status the sync will not move a ticket out of",
              f'"{s}"' in body,
              "if this changed, the round-trip check above is reasoning about the "
              "wrong guard")

print()
if fails:
    print("FAILED %d check(s):" % len(fails))
    for f in fails[:10]:
        print("  - " + f)
    sys.exit(1)
print("ALL STAGE CHECKS PASSED")
