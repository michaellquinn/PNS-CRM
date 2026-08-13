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
SRC = os.path.join(_REPO, "backend", "main.py")
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
