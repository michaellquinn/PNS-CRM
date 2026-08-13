"""Who reviews a Sales-built price, executed out of the real main.py.

Two jobs share the word "review" and used to share one status, which is exactly the
confusion this pins down:

  head  Hypercare, Strategic, Must Win -> "Pending Review - Head PNS". The Head of PNS's
        own oversight of the groups the business watches.
  pns   anything else Sales priced at or above 30 Mio -> "Pending PNS". Ordinary PNS
        work, assigned like any other job, with the Head nowhere near it.
  None  everything else goes straight to the shipper.

The rule moved twice in two days (revenue-only, then group-only, then this split), so it
is worth a suite of its own: each move silently changed who was on the hook for the
highest-volume band.
"""
import os, ast, sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
src = open(os.path.join(_REPO, "backend", "main.py"), encoding="utf-8").read()

WANT_FN = {"big_group", "review_level", "needs_pns_review", "approval_chain",
           "next_gate", "proposal_or_signoff"}
WANT_VAR = {"MANAGED_ACCTS", "CHAIN_WATCHED_BELOW", "CHAIN_WATCHED_CLEAN"}
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
             "<review>", "exec"), ns)
review_level, big_group, needs = ns["review_level"], ns["big_group"], ns["needs_pns_review"]
approval_chain, next_gate = ns["approval_chain"], ns["next_gate"]

T = lambda acct="Standard", mw=0, resp="Sales", rev=0: {
    "acct_type": acct, "must_win": mw, "resp": resp, "needs_review": rev}

CASES = [
    # The three watched groups are the Head's, whatever the revenue.
    ("Hypercare, Sales-priced, small",      T("Hypercare"),                    "head"),
    ("Strategic, Sales-priced, small",      T("Strategic"),                    "head"),
    ("Must Win on a Standard account",      T("Standard", mw=1),               "head"),
    ("Must Win on a Hypercare account",     T("Hypercare", mw=1),              "head"),
    # Group beats revenue: a must-win 30 Mio deal is still the Head's, not ordinary work.
    ("Must Win AND >= 30 Mio",              T("Standard", mw=1, rev=1),        "head"),
    # The high-value Standard band is checked, but by an ordinary PNS member.
    ("Standard >= 30 Mio",                  T("Standard", rev=1),              "pns"),
    # Below the band, nothing is reviewed at all.
    ("Standard < 30 Mio",                   T("Standard"),                     None),
    # The three watched groups reach the Head WHOEVER priced them, PNS included. A Head
    # reviewing the team's work is oversight, not self-review, and the Head finalising
    # the solution is the whole point of the step (Baskoro, 2026-08-13) — it has to
    # happen before PSP, the Sales Head or C-level are asked to sign anything.
    # Before this, a Hypercare deal priced by PNS went price -> PSP -> C-level with the
    # Head never in the path.
    ("PNS priced a Hypercare deal",         T("Hypercare", resp="PNS"),        "head"),
    ("PNS priced a Must Win deal",          T("Standard", mw=1, resp="PNS"),   "head"),
    # Outside those groups PNS still does not re-check its own routine work.
    ("PNS priced a >= 30 Mio deal",         T("Standard", resp="PNS", rev=1),  None),
]

fails = []
for name, t, want in CASES:
    got = review_level(t)
    if got != want:
        fails.append(f"{name}: review_level -> {got!r}, expected {want!r}")
    # needs_pns_review must stay the exact union of the two levels; a drift here would
    # let a ticket claim it needs no review while review_level still routes it somewhere.
    if needs(t) != (want is not None):
        fails.append(f"{name}: needs_pns_review -> {needs(t)}, expected {want is not None}")

# big_group names the group, and the account tier outranks the per-deal flag so a
# Hypercare must-win deal is reported once, as Hypercare, not as two things.
for acct, mw, want in [("Hypercare", 0, "Hypercare"), ("Strategic", 0, "Strategic"),
                       ("Standard", 1, "Must Win"), ("Standard", 0, None),
                       ("Hypercare", 1, "Hypercare")]:
    got = big_group(T(acct, mw=mw))
    if got != want:
        fails.append(f"big_group({acct}, must_win={mw}) -> {got!r}, expected {want!r}")

if fails:
    print("verify_review_level.py FAILED")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print(f"verify_review_level.py  {len(CASES)} review cases + 5 group cases PASSED")


# ---------------------------------------------------------------- approval chains
# The exact order Baskoro set out on 2026-08-13. Written as whole sequences rather than
# per-step assertions: the bug this guards against is a gate quietly dropping out of the
# middle, which a step-by-step test would pass right through.
S = lambda x: x.replace("Pending Review - ", "").replace("Pending ", "")
CHAINS = [
    ("Hypercare below floor", {"acct_type": "Hypercare", "must_win": 0, "exec_signoff": 0}, True,
     ["PSP", "Head PSP", "Head PNS", "Head Sales", "C-level"]),
    ("Strategic below floor", {"acct_type": "Strategic", "must_win": 0, "exec_signoff": 0}, True,
     ["PSP", "Head PSP", "Head PNS", "Head Sales", "C-level"]),
    # Must Win rides the same chain but is not an executive matter: C-level is the
    # account's business, and this account is Standard.
    ("Must Win below floor", {"acct_type": "Standard", "must_win": 1, "exec_signoff": 0}, True,
     ["PSP", "Head PSP", "Head PNS", "Head Sales"]),
    ("Hypercare clean", {"acct_type": "Hypercare", "must_win": 0, "exec_signoff": 0}, False,
     ["Head PNS", "Head Sales", "C-level"]),
    ("Must Win clean", {"acct_type": "Standard", "must_win": 1, "exec_signoff": 0}, False,
     ["Head PNS", "Head Sales"]),
    ("Standard >= 30 Mio", {"acct_type": "Standard", "must_win": 0, "needs_review": 1}, False,
     ["PNS"]),
    ("Standard < 30 Mio", {"acct_type": "Standard", "must_win": 0, "needs_review": 0}, False,
     ["Head Sales"]),
]
chain_fails = []
for name, t, below, want in CHAINS:
    got = [S(x) for x in approval_chain(t, below)]
    if got != want:
        chain_fails.append(f"{name}: {' -> '.join(got)}  != expected  {' -> '.join(want)}")
    # Walking the chain must end at the proposal, never loop or stall.
    cur, seen = approval_chain(t, below)[0], []
    for _ in range(10):
        seen.append(cur)
        nxt = next_gate({**t, "below_bottom": int(below)}, cur)
        if nxt == "Proposal Submitted":
            break
        if nxt in seen:
            chain_fails.append(f"{name}: loops at {nxt}")
            break
        cur = nxt
    else:
        chain_fails.append(f"{name}: never reaches Proposal Submitted")

if chain_fails:
    print("verify_review_level.py FAILED — approval chain:")
    for c in chain_fails:
        print("  -", c)
    sys.exit(1)
print(f"verify_review_level.py  {len(CHAINS)} approval chains PASSED")
