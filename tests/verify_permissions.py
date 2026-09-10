"""Catch permissions that exist in can() but are never sent to the frontend.

A permission missing from the /api/me actions list is not a 403. It arrives as
undefined, the nav entry or button silently never renders, and the feature looks like it
was never built. This shipped once: syncSalesCrm, allowPsp and pspOverride were all live
in the backend and invisible in the UI.

Also checks the reverse direction: the frontend must not gate on a permission name the
backend never sends.
"""
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
import ast, glob, io, os, re, sys

BACK = os.path.join(_REPO, "backend", "main.py")
FRONT = os.path.join(_REPO, "frontend", "src")

src = io.open(BACK, encoding='utf-8').read()
tree = ast.parse(src)

# 1. names can() knows: the dict literal keys, plus any handled before it
can_fn = next(n for n in tree.body
              if isinstance(n, ast.FunctionDef) and n.name == 'can')
declared = set()
for node in ast.walk(can_fn):
    if isinstance(node, ast.Dict):
        for k in node.keys:
            if isinstance(k, ast.Constant) and isinstance(k.value, str):
                declared.add(k.value)
    # `if action == "headAck":` style early handling
    if isinstance(node, ast.Compare) and isinstance(node.left, ast.Name) \
            and node.left.id == 'action':
        for c in node.comparators:
            if isinstance(c, ast.Constant) and isinstance(c.value, str):
                declared.add(c.value)

# 2. names /api/me actually sends
me_fn = next(n for n in tree.body
             if isinstance(n, ast.AsyncFunctionDef) and n.name == 'me')
sent = set()
for node in ast.walk(me_fn):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        sent.add(node.value)
sent &= declared | {s for s in sent if s in declared}

# 3. names the frontend gates on
used = set()
for path in glob.glob(os.path.join(FRONT, '**', '*.js*'), recursive=True):
    text = io.open(path, encoding='utf-8', errors='replace').read()
    used |= set(re.findall(r'permissions\.([A-Za-z_][A-Za-z0-9_]*)', text))
    used |= set(re.findall(r'permissions\[["\']([A-Za-z_][A-Za-z0-9_]*)["\']\]', text))

print("declared in can():      %d" % len(declared))
print("sent by /api/me:        %d" % len(sent))
print("gated on by frontend:   %d" % len(used))

fails = []

missing_from_me = sorted(d for d in declared if d not in sent)
if missing_from_me:
    fails.append("in can() but NOT sent by /api/me (feature would be invisible): "
                 + ", ".join(missing_from_me))

unknown_to_backend = sorted(u for u in used if u not in declared)
if unknown_to_backend:
    fails.append("frontend gates on names the backend never declares: "
                 + ", ".join(unknown_to_backend))

not_sent_but_used = sorted(u for u in used if u in declared and u not in sent)
if not_sent_but_used:
    fails.append("frontend gates on these but /api/me does not send them: "
                 + ", ".join(not_sent_but_used))

print("\nfrontend gates on:", ", ".join(sorted(used)))

# ---------------------------------------------------- who may work the import queue
# The queue is self-service or it is not (Michael, 2026-09-02). Two permissions decide
# that, and they are easy to drift apart because they read almost the same:
#
#   queueSync          put an opportunity id INTO the queue
#   manageImportQueue  the SCREEN, the list behind it, and removing a row
#
# Between 2026-08-28 and 2026-09-02 the second was Admin while the first was not, so
# Commercial could queue a deal and then had no way to see whether it imported. The
# outcome per row - imported and which ticket, skipped and why, failed and the error -
# lives only on that screen. Anyone who can put something in must be able to see what
# became of it, so these two must name the SAME audience.
#
# Writing the settings stays separate and narrower: editSyncSettings decides what the
# sync imports for everybody, and that is Admin's alone.
#
# can() is EXECUTED here rather than read, because the bug this guards against is a
# difference in two boolean expressions, which no amount of source-matching catches.


class _Defaulting(dict):
    """Module constants can() closes over, defaulted so it runs without importing the
    whole app (main.py opens DB pools and reads env at import time)."""

    def __missing__(self, k):
        return ""


_ns = _Defaulting(os=os, PNS_PILOT=True)
for _n in tree.body:
    if isinstance(_n, ast.Assign) and len(_n.targets) == 1 \
            and isinstance(_n.targets[0], ast.Name):
        try:
            _ns.setdefault(_n.targets[0].id, ast.literal_eval(_n.value))
        except Exception:
            pass

_fn = ast.parse(src).body
_fn = next(n for n in _fn if isinstance(n, ast.FunctionDef) and n.name == "can")
_fn.returns = None
for _a in _fn.args.args:
    _a.annotation = None
exec(compile(ast.fix_missing_locations(ast.Module(body=[_fn], type_ignores=[])),
             "<can>", "exec"), _ns)
_can = _ns["can"]


class _U:
    def __init__(self, group, level="staff"):
        self.group, self.level, self.team = group, level, None
        self.email, self.name = "x@y", "X"


print()
print("the import queue is self-service: queueing and reading its outcome agree")
for _g in ["Commercial", "PNS", "Sales Planning", "Admin", "PSP", "Ops",
           "Finance", "Visitor", "Legal", "CSO"]:
    _u = _U(_g)
    _q, _m = _can(_u, "queueSync"), _can(_u, "manageImportQueue")
    _ok = _q == _m
    print(("  ok   " if _ok else "  FAIL ")
          + "%-16s queueSync=%-5s manageImportQueue=%s" % (_g, _q, _m))
    if not _ok:
        fails.append("%s has queueSync=%s but manageImportQueue=%s - whoever may queue "
                     "a deal must be able to read what became of it" % (_g, _q, _m))

print()
print("what the sync imports stays Admin's")
for _g in ("Commercial", "PNS", "Sales Planning"):
    if _can(_U(_g), "editSyncSettings"):
        fails.append("%s can editSyncSettings - what the sync imports is Admin's" % _g)
        print("  FAIL %-16s may edit sync settings" % _g)
    else:
        print("  ok   %-16s cannot edit sync settings" % _g)
if not _can(_U("Admin"), "editSyncSettings"):
    fails.append("Admin cannot editSyncSettings - nobody can reach the controls")
    print("  FAIL Admin cannot edit sync settings")
else:
    print("  ok   Admin may edit sync settings")

print()
print("only PNS may choose to send a ticket to PSP")
for _g, _want in (("PNS", True), ("Commercial", False), ("Admin", True), ("PSP", False)):
    _got = _can(_U(_g), "sendToPsp")
    _ok = _got == _want
    print(("  ok   " if _ok else "  FAIL ")
          + "%-16s sendToPsp=%s" % (_g, _got))
    if not _ok:
        fails.append("%s has sendToPsp=%s, expected %s" % (_g, _got, _want))

# ---------------------------------------------------------------- AM tracks Commercial
# Michael, 2026-09-10: AMs hold the shipper relationship and do the same job as Sales
# inside this app, so the two groups carry the same rights.
#
# This is the check that matters, and it is deliberately a COMPARISON rather than a list
# of expected answers. The failure mode is not that AM is wrong today -- it is that six
# weeks from now somebody grants a new right to "Commercial" at one call site and the two
# groups quietly diverge, with nothing anywhere saying which screens an AM lost. Comparing
# every action means a new permission is covered the day it is written, without anyone
# remembering to come back here.
#
# The LEVEL gates are the stated exception: editAcctOrRev and closing somebody else's
# question are com_head, and reassigning another person's Sales PIC is com_mgr. Those are
# about who leads Sales, which an AM head is not, so they are expected to differ and are
# listed here rather than silently skipped.
print()
print("AM carries the same rights as Commercial, action for action")
# editAcctOrRev is the one action gated purely on being the Sales HEAD, so it is the one
# AM is expected to differ on. setSales is NOT in here: with no ticket in hand it answers
# "render the control" for every selling group at every level, staff included, and the
# real restriction only appears once a ticket is passed -- checked separately below.
LEVEL_ONLY = {"editAcctOrRev"}
# The action names this compares. Listed rather than harvested because can() builds its
# map inline and there is no handle on the keys without executing it for every action --
# which is what this loop does anyway. A new action missing from this list is covered the
# moment somebody adds it here, and the cost of forgetting is one uncompared permission,
# not a false pass on the ones that are listed.
_actions = ["createTicket", "editInput", "reopen", "acceptProposal",
            "sendBackProposal", "capaRaise", "capaSubmit", "queueSync",
            "manageImportQueue", "startOnboarding", "editOnboardingIds",
            "confirmGolive", "seePrice", "seeMargin", "assign", "markReviewed",
            "sendToPsp", "pspDecide", "vendorToggle", "manageUsers",
            "editAcctOrRev", "setSales", "raiseRequirement", "bulkDelete"]

for _lvl in ("staff", "head"):
    for _a in sorted(set(_actions)):
        _c = _can(_U("Commercial", _lvl), _a)
        _m = _can(_U("AM", _lvl), _a)
        if _a in LEVEL_ONLY:
            continue
        _ok = _c == _m
        print(("  ok   " if _ok else "  FAIL ")
              + "%-20s %-6s Commercial=%-5s AM=%s" % (_a, _lvl, _c, _m))
        if not _ok:
            fails.append("%s at level %s: Commercial=%s but AM=%s - a right reached one "
                         "selling group and not the other" % (_a, _lvl, _c, _m))

print()
print("and the level gates stay Sales' alone, which is the stated exception")
for _a in sorted(LEVEL_ONLY):
    _m = _can(_U("AM", "head"), _a)
    print(("  ok   " if not _m else "  FAIL ") + "%-20s AM head=%s" % (_a, _m))
    if _m:
        fails.append("AM head has %s - that is com_head, about who leads Sales" % _a)

# setSales WITH a ticket in hand, which is where the tiers actually separate. Somebody
# else's deal: only a Sales Manager or Head may move it. Their own: anyone selling may
# hand it away, which is the leave-and-handover case and not a route to taking a
# colleague's deal.
_theirs = {"sales_email": "someone.else@ninjavan.co"}
_mine = {"sales_email": "x@y"}
print()
print("reassigning the Sales PIC: somebody else's deal is the Sales tiers' alone")
for _g, _lvl, _t, _want, _why in [
        ("Commercial", "head", _theirs, True, "the Sales Head may move any deal"),
        ("Commercial", "manager", _theirs, True, "so may a Sales Manager"),
        ("Commercial", "staff", _theirs, False, "a salesperson may not take a colleague's"),
        ("AM", "head", _theirs, False, "an AM head is not the Sales Head"),
        ("AM", "staff", _theirs, False, "nor is an AM"),
        ("Commercial", "staff", _mine, True, "but anyone may hand away their own"),
        ("AM", "staff", _mine, True, "AMs included"),
]:
    _got = _can(_U(_g, _lvl), "setSales", _t)
    _ok = _got == _want
    print(("  ok   " if _ok else "  FAIL ")
          + "%-11s %-8s %-18s setSales=%-5s  %s"
          % (_g, _lvl, "their own" if _t is _mine else "somebody else's", _got, _why))
    if not _ok:
        fails.append("setSales %s/%s on %s = %s, expected %s"
                     % (_g, _lvl, "own" if _t is _mine else "other", _got, _want))

print()
if fails:
    print("FAILURES:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("ALL PERMISSION WIRING CHECKS PASSED")
