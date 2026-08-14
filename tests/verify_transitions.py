"""The status transition table, executed out of the real main.py.

Baskoro asked on 2026-08-14 whether there was a clear trigger for every status move.
There was one for each, but it lived across nine endpoints, and POST /status accepted
whatever string a client sent — so a typo or an older build's vocabulary wrote a status
the running code cannot act on, straight onto the ticket. That is the orphaned-status
mess V20/V21 had to clean up by hand.

TRANSITIONS is now the one map, MANUAL_MOVES is derived from it, and change_status()
validates against MANUAL_MOVES. This suite pins the derivation, because the two things
that would silently break it are subtle:

  * a "*" row must not re-grant a move out of a decided status (Lost, Cancel, accepted),
    or a client could walk a closed deal sideways instead of going through /reopen;
  * every path a real button uses must still be in the table, or the button starts
    returning 409 and the feature looks broken rather than blocked.
"""
import os, ast, sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
src = open(os.path.join(_REPO, "backend", "main.py"), encoding="utf-8").read()

# Everything from the top of the module down to MANUAL_MOVES: the table is built by a
# module-level loop, so it is executed rather than re-implemented here.
WANT_VAR = {"NO_CRM_STATUS", "ALL_STATUSES", "TRANSITIONS", "REVIEW_STATUSES",
            "MANUAL_MOVES", "KNOWN_STATUSES", "PENDING_STATUSES"}
keep = []
for node in ast.parse(src).body:
    if isinstance(node, ast.FunctionDef) and node.name == "_sources":
        keep.append(node)
    elif isinstance(node, (ast.Assign, ast.AnnAssign)):
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if any(isinstance(t, ast.Name) and t.id in WANT_VAR for t in targets):
            keep.append(node)
    elif isinstance(node, ast.For):
        # The two loops that build and then prune MANUAL_MOVES.
        keep.append(node)
ns = {}
exec(compile(ast.fix_missing_locations(ast.Module(body=keep, type_ignores=[])),
             "<transitions>", "exec"), ns)

ALL = ns["ALL_STATUSES"]
MOVES = ns["MANUAL_MOVES"]
TRANS = ns["TRANSITIONS"]
KNOWN = ns["KNOWN_STATUSES"]

fails = []


def check(label, ok):
    if not ok:
        fails.append(label)
    print(("  ok   " if ok else "  FAIL ") + label)


print("statuses")
# V22 added these two and the hand-maintained KNOWN_STATUSES never learned about them,
# so /api/diagnostics/orphaned-status reported every ticket in either one as
# unrecognised. A diagnostic that cries wolf gets ignored.
check("Open is a known status", "Open" in KNOWN)
check("Pending CRM ID is a known status", ns["NO_CRM_STATUS"] in KNOWN)
check("KNOWN_STATUSES is exactly ALL_STATUSES", list(KNOWN) == list(ALL))
check("no duplicates in ALL_STATUSES", len(set(ALL)) == len(ALL))

print("\nevery row lands somewhere real")
for frm, to, why, who, via in TRANS:
    if via == "POST /status":
        check(f"{frm} -> {to} names a real status", to in ALL)
    check(f"{frm} -> {to} states a trigger", bool(why and who))

print("\ndecided statuses cannot be walked sideways")
# "*" means every open status. If it leaked into the terminal ones, a client could move
# a Lost deal straight back into the pipeline without /reopen and its rules.
for done in ("Lost", "Cancel", "Proposal Accepted / Ready to Ship"):
    check(f"nothing can be chosen from {done}", done not in MOVES)

print("\nthe paths real buttons use")
CASES = [
    # Open: "Start work on this", and "Need info from Sales".
    ("Open", "Pending PNS", True),
    ("Open", "Pending Sales", True),
    # The vendor detour, both ways.
    ("Pending PNS", "Pending Vendor", True),
    ("Pending Vendor", "Pending PNS", True),
    ("Pending Vendor", "Pending Sales", True),
    # Escalate to PSP, from the pricing queue and from mid-review. Gated further by
    # may_go_to_psp(); this only asks whether the transition exists at all.
    ("Pending PNS", "Pending Review - PSP", True),
    ("Pending Review - Head PNS", "Pending Review - PSP", True),
    # A reviewer sending it back for rework, from any gate.
    ("Pending Review - C-level", "Pending PNS", True),
    ("Pending Review - Head Sales", "Pending Sales", True),
    ("Pending Review - Head PSP", "Pending PNS", True),
    # Sales recording the outcome.
    ("Proposal Submitted", "Proposal Accepted / Ready to Ship", True),
    ("Proposal Submitted", "Pending PNS", True),
    # Lost and Cancel are reachable from anywhere still open.
    ("Pending Sales", "Lost", True),
    ("Pending CRM ID", "Cancel", True),
    ("Pending Review - PSP", "Lost", True),

    # And what must NOT be choosable. Each of these is a gate somebody would otherwise
    # be able to skip by naming the status instead of doing the thing.
    ("Open", "Proposal Submitted", False),
    ("Open", "Proposal Accepted / Ready to Ship", False),
    ("Pending PNS", "Pending Review - Head PNS", False),   # earned by attaching a price
    ("Pending PNS", "Pending Review - C-level", False),    # skips every gate before it
    ("Pending Review - Head PNS", "Proposal Submitted", False),  # that is /pns-final
    ("Pending Review - PSP", "Pending Review - Head PSP", False),  # that is /psp
    ("Pending CRM ID", "Open", False),                     # that is /crm-id
    ("Pending CRM ID", "Pending PNS", False),
]
for frm, to, want in CASES:
    got = to in MOVES.get(frm, set())
    check(f"{frm} -> {to} is {'allowed' if want else 'refused'}", got == want)

print()
if fails:
    print("FAILED %d check(s): %s" % (len(fails), "; ".join(fails[:5])))
    sys.exit(1)
print("ALL STATUS TRANSITION CHECKS PASSED")
