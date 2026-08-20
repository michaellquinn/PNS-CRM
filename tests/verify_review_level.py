"""Who reviews a Sales-built price, executed out of the real main.py.

Two jobs share the word "review" and used to share one status, which is exactly the
confusion this pins down:

  head  Hypercare, Strategic, Must Win -> "Pending Review - Head PNS". The Head of PNS's
        own oversight of the groups the business watches.
  pns   anything else Sales priced at or above 30 Mio -> "Pending Review - PNS". Ordinary PNS
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
           "next_gate", "proposal_or_signoff", "status_for_stage", "_norm_stage"}
WANT_VAR = {"MANAGED_ACCTS", "CHAIN_WATCHED_BELOW", "CHAIN_WATCHED_CLEAN",
            "CLOSED_LOST_STAGES", "ACCEPTED_STAGES", "SUBMITTED_STAGES",
            "_LOST_N", "_ACCEPTED_N", "_SUBMITTED_N"}
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
status_for_stage = ns["status_for_stage"]

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
# Only the "Pending " prefix is stripped, so "Review - PNS" and "PNS" stay different
# strings. Collapsing both to "PNS" is what let the old chain pass this test either way:
# a Standard deal's gate could silently be the pricing queue OR the review gate and the
# expectation read the same.
S = lambda x: x.replace("Pending ", "")
CHAINS = [
    ("Hypercare below floor", {"acct_type": "Hypercare", "must_win": 0, "exec_signoff": 0}, True,
     ["Review - PSP", "Review - Head PSP", "Review - Head PNS", "Review - C-level"]),
    ("Strategic below floor", {"acct_type": "Strategic", "must_win": 0, "exec_signoff": 0}, True,
     ["Review - PSP", "Review - Head PSP", "Review - Head PNS", "Review - C-level"]),
    # Must Win ends at C-level like the other two: a deal the business has declared it
    # must win is one the executives want to see, whatever the account tier says.
    ("Must Win below floor", {"acct_type": "Standard", "must_win": 1, "exec_signoff": 0}, True,
     ["Review - PSP", "Review - Head PSP", "Review - Head PNS", "Review - C-level"]),
    ("Hypercare clean", {"acct_type": "Hypercare", "must_win": 0, "exec_signoff": 0}, False,
     ["Review - Head PNS", "Review - C-level"]),
    ("Must Win clean", {"acct_type": "Standard", "must_win": 1, "exec_signoff": 0}, False,
     ["Review - Head PNS", "Review - C-level"]),
    # PNS's own review is the one gate. Both rows matter: the second is the Tanamera case
    # (FTL on-call at or above 30 Mio, a band with no published ceiling, so manual_review
    # is set). It used to skip the review entirely and land in PSP, so the assertion is
    # that a manual band changes NOTHING about who checks it first.
    ("Standard >= 30 Mio", {"acct_type": "Standard", "must_win": 0, "needs_review": 1}, False,
     ["Review - PNS"]),
    ("Standard >= 30 Mio, manual band", {"acct_type": "Standard", "must_win": 0, "needs_review": 1}, True,
     ["Review - PNS"]),
    # The Head of Sales gate was retired on 2026-08-14 -- they approve in Sales CRM. A
    # Standard deal under 30 Mio now has NOTHING left to clear here, so its chain is
    # empty and the proposal goes straight out. An empty chain is the assertion, not an
    # oversight: if a gate ever reappears here it should fail this line loudly.
    ("Standard < 30 Mio", {"acct_type": "Standard", "must_win": 0, "needs_review": 0}, False,
     []),
]
chain_fails = []
for name, t, below, want in CHAINS:
    got = [S(x) for x in approval_chain(t, below)]
    if got != want:
        chain_fails.append(f"{name}: {' -> '.join(got)}  != expected  {' -> '.join(want)}")
    # Walking the chain must end at the proposal, never loop or stall. An empty chain
    # is already at the end -- next_gate() answers Proposal Submitted from anywhere.
    chain = approval_chain(t, below)
    if not chain:
        if next_gate({**t, "below_bottom": int(below)}, None) != "Proposal Submitted":
            chain_fails.append(f"{name}: empty chain must go straight to the proposal")
        continue
    cur, seen = chain[0], []
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


# ------------------------------------------------------- Sales CRM stage -> our status
# Sales CRM owns the commercial stage and this app owns the solutioning status, so only a
# few stages cross that line. The list is worth pinning because it moved on 2026-08-18:
# Proposal Submitted became the one NON-terminal stage that overrides ours, on the
# argument that ACCEPTED_STAGES had always done exactly that and the inconsistency was
# the bug. Anything mid-funnel must still leave our status alone — a ticket must not jump
# to Proposal Submitted because Sales moved the deal to Negotiation.
STAGES = [
    ("Closed-Lost",        "Lost"),
    ("Future Opportunity", "Lost"),
    ("Agreed to Ship",     "Proposal Accepted / Ready to Ship"),
    ("Closed-Won",         "Proposal Accepted / Ready to Ship"),
    ("Proposal Submitted", "Proposal Submitted"),
    # Matching is normalised, so casing and stray whitespace are not different stages.
    # The picklist is hand-edited -- these lists already carry "Closed Lost" beside
    # "Closed-Lost" and the misspelt "Future Oppurtunity" because of it.
    ("Proposal submitted", "Proposal Submitted"),
    ("  PROPOSAL   SUBMITTED  ", "Proposal Submitted"),
    ("closed-lost", "Lost"),
    ("agreed to ship", "Proposal Accepted / Ready to Ship"),
    # Mid-funnel: ours wins.
    ("Negotiation",        None),
    ("New",                None),
    ("EKYC",               None),
    ("Contract Sent",      None),
    (None,                 None),
]
stage_fails = []
for stage, want in STAGES:
    got = status_for_stage(stage, "Sales")
    if got != want:
        stage_fails.append(f"stage {stage!r} -> {got!r}, expected {want!r}")
# The three stage lists must not overlap: a stage in two of them would make the answer
# depend on the order of the ifs rather than on the rule.
for a, b in (("CLOSED_LOST_STAGES", "ACCEPTED_STAGES"),
             ("CLOSED_LOST_STAGES", "SUBMITTED_STAGES"),
             ("ACCEPTED_STAGES", "SUBMITTED_STAGES")):
    both = set(ns[a]) & set(ns[b])
    if both:
        stage_fails.append(f"{a} and {b} both claim {sorted(both)}")

if stage_fails:
    print("verify_review_level.py FAILED — Sales CRM stage mapping:")
    for f in stage_fails:
        print("  -", f)
    sys.exit(1)
print(f"verify_review_level.py  {len(STAGES)} stage mappings PASSED")
