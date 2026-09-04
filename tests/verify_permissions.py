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
if fails:
    print("FAILURES:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("ALL PERMISSION WIRING CHECKS PASSED")
