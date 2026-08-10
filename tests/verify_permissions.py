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

print()
if fails:
    print("FAILURES:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("ALL PERMISSION WIRING CHECKS PASSED")
