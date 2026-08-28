"""Every name main.py calls at module level actually exists.

Written because `_crm_date` shipped to production called-but-never-defined: an edit
spliced out the region that held its definition while leaving both call sites intact.
`python -m py_compile` is happy with that — a missing global is a NameError at run time,
not a syntax error — and no suite touched the sync, so the first thing that noticed was
Baskoro's morning sync failing with "name '_crm_date' is not defined".

This walks the AST and checks every function/attribute call and bare name load against
everything main.py defines or imports, plus builtins. It is deliberately conservative:
it only reports a name it is confident is unresolvable, because a false alarm here would
train people to ignore the suite.
"""
import os, ast, sys, builtins

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
# Overridable so the suite can be pointed at a fixture to prove it still bites.
SRC = os.environ.get("VERIFY_NAMES_SRC") or os.path.join(_REPO, "backend", "main.py")
tree = ast.parse(open(SRC, encoding="utf-8").read())

defined = set(dir(builtins))

# Everything main.py brings into module scope: imports, defs, classes, assignments.
for node in ast.walk(tree):
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        for a in node.names:
            defined.add((a.asname or a.name).split(".")[0])
    elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        defined.add(node.name)
        # Parameters and locals of that function are in scope inside it.
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for arg in ([*node.args.args, *node.args.kwonlyargs,
                         *node.args.posonlyargs]):
                defined.add(arg.arg)
            if node.args.vararg:
                defined.add(node.args.vararg.arg)
            if node.args.kwarg:
                defined.add(node.args.kwarg.arg)
    elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
        defined.add(node.id)
    elif isinstance(node, ast.ExceptHandler) and node.name:
        defined.add(node.name)
    elif isinstance(node, (ast.comprehension,)):
        for n in ast.walk(node.target):
            if isinstance(n, ast.Name):
                defined.add(n.id)
    elif isinstance(node, ast.Global):
        defined.update(node.names)
    elif isinstance(node, (ast.With, ast.AsyncWith)):
        for item in node.items:
            if item.optional_vars:
                for n in ast.walk(item.optional_vars):
                    if isinstance(n, ast.Name):
                        defined.add(n.id)
    elif isinstance(node, ast.Lambda):
        for arg in node.args.args:
            defined.add(arg.arg)

# Every name the module reads. Attribute access (os.getenv) resolves through the base
# name, which the import loop above already collected.
used = {}
for node in ast.walk(tree):
    if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
        used.setdefault(node.id, node.lineno)

missing = sorted((n, l) for n, l in used.items() if n not in defined)

if missing:
    print("verify_names.py FAILED — called but never defined:")
    for name, line in missing:
        print(f"  - {name!r} used at main.py:{line}")
    sys.exit(1)
print(f"verify_names.py         {len(used)} module names all resolve")

# ---------------------------------------------------------------- SQL placeholders
# A second, cheap structural check in the same suite: every literal "IN (%s,%s,...)"
# in main.py, counted against nothing. The awaiting-price endpoint 500'd in production
# because "Open" was added to a 4-tuple while the SQL still had three placeholders —
# the arity is invisible at the call site and neither py_compile nor any rule suite can
# see it. Hand-written runs of %s inside IN(...) are now simply banned: build them from
# the sequence with ",".join(["%s"] * len(xs)) so they cannot disagree.
import re as _re

_sql_lit = _re.compile(r'IN \((%s(?:\s*,\s*%s)+)\)')
_offenders = []
for _i, _line in enumerate(open(SRC, encoding="utf-8"), 1):
    if _sql_lit.search(_line):
        _offenders.append((_i, _line.strip()[:88]))

if _offenders:
    print("verify_names.py FAILED — hand-counted SQL placeholders (build them from the list):")
    for _ln, _txt in _offenders:
        print(f"  - main.py:{_ln}  {_txt}")
    sys.exit(1)
print("verify_names.py         no hand-counted IN(...) placeholder runs")

# ------------------------------------------------- locals read before they are bound
# The sibling of the `_crm_date` bug above, and it cost a week of stale data before
# anyone saw it. In `_refresh_from_salescrm`, `changed.append(...)` sat nine lines ABOVE
# `changed = []`. Python decides a name is local to the WHOLE function the moment it is
# assigned anywhere in it, so that append raised UnboundLocalError — but only on the
# tickets that took the branch, so it looked intermittent. Nothing caught it, so the
# five-minute auto-sync died a quarter of the way through every single run and every
# ticket behind the offender silently stopped being refreshed.
#
# py_compile is happy (valid syntax) and the module-scope check above is happy (the name
# IS assigned in the function). Only ORDER catches it.
#
# Deliberately conservative — a false alarm here trains people to ignore the suite. A
# name is reported only when EVERY binding of it in the function is below EVERY read,
# and never when the read sits in a loop, an `except`/`finally`, or a nested scope,
# where "before" is not a straight line through the source.
def _scope_bindings_and_loads(fn):
    """(bindings, loads) by name for one function, nested scopes excluded."""
    binds, loads, skip = {}, {}, set()
    for child in ast.walk(fn):
        # Comprehensions are their own scope in Python 3, and a multi-line one reads its
        # target above the `for` that binds it — ordinary, not a bug.
        if child is not fn and isinstance(
                child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef,
                        ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            for sub in ast.walk(child):
                skip.add(id(sub))
    # Reads inside a loop, an except handler or a finally block are not ordered against
    # the rest of the body in any way this check can reason about.
    unordered = set()
    for child in ast.walk(fn):
        if isinstance(child, (ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler)):
            for sub in ast.walk(child):
                unordered.add(id(sub))
        elif isinstance(child, ast.Try):
            for blk in child.finalbody:
                for sub in ast.walk(blk):
                    unordered.add(id(sub))
    for child in ast.walk(fn):
        if id(child) in skip or not isinstance(child, ast.Name):
            continue
        if isinstance(child.ctx, (ast.Store, ast.Del)):
            binds.setdefault(child.id, []).append(child.lineno)
        elif isinstance(child.ctx, ast.Load) and id(child) not in unordered:
            loads.setdefault(child.id, []).append(child.lineno)
    # Non-Name bindings that still make the name local.
    for child in ast.walk(fn):
        if id(child) in skip:
            continue
        if isinstance(child, ast.ExceptHandler) and child.name:
            binds.setdefault(child.name, []).append(child.lineno)
        elif isinstance(child, (ast.Import, ast.ImportFrom)):
            for a in child.names:
                binds.setdefault((a.asname or a.name).split(".")[0], []).append(child.lineno)
        elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) \
                and child is not fn:
            binds.setdefault(child.name, []).append(child.lineno)
    return binds, loads


_early = []
for _fn in ast.walk(tree):
    if not isinstance(_fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
        continue
    _safe = {a.arg for a in [*_fn.args.args, *_fn.args.kwonlyargs, *_fn.args.posonlyargs]}
    if _fn.args.vararg:
        _safe.add(_fn.args.vararg.arg)
    if _fn.args.kwarg:
        _safe.add(_fn.args.kwarg.arg)
    for _n in ast.walk(_fn):
        if isinstance(_n, (ast.Global, ast.Nonlocal)):
            _safe.update(_n.names)
    _binds, _loads = _scope_bindings_and_loads(_fn)
    for _name, _blines in _binds.items():
        if _name in _safe or _name not in _loads:
            continue
        if min(_loads[_name]) < min(_blines):
            _early.append((_fn.name, _name, min(_loads[_name]), min(_blines)))

if _early:
    print("verify_names.py FAILED — local read before it is assigned (UnboundLocalError):")
    for _f, _name, _read, _bound in _early:
        print(f"  - {_name!r} read at main.py:{_read} but first assigned at :{_bound}"
              f"  (in {_f}())")
    sys.exit(1)
print("verify_names.py         no locals read before assignment")
