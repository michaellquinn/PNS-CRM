"""Execute the business-rules block out of the real main.py and check it against 5A."""
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
import ast, sys

SRC = os.path.join(_REPO, "backend", "main.py")
src = open(SRC, encoding='utf-8').read()

tree = ast.parse(src)
WANT_FN = {'route', 'tier_of', 'guard_for', 'guard_breached'}
WANT_VAR = {'SERVICES', 'ACCT_TYPES', 'MANAGED_ACCTS', 'PRICING_GUARD'}
keep = []
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in WANT_FN:
        keep.append(node)
    elif isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id in WANT_VAR:
                keep.append(node)
mod = ast.Module(body=keep, type_ignores=[])
ns = {}
exec(compile(ast.fix_missing_locations(mod), '<rules>', 'exec'), ns)
route, guard_for, guard_breached = ns['route'], ns['guard_for'], ns['guard_breached']
print("extracted:", sorted(k for k in ns if not k.startswith('__')))

# ---------------------------------------------------------------- 5A routing truth
S = ['FTL on-call', 'FTL monthly', 'LTL', 'B2BR', 'Sameday']
fails = []
for acct in ('Hypercare', 'Strategic', 'Non-Strategic'):
    for band, rev in (('<30', 10_000_000), ('>=30', 50_000_000)):
        for s in S:
            if acct in ('Hypercare', 'Strategic'):
                exp = ('PNS', False)
            elif s in ('FTL monthly', 'Sameday'):
                exp = ('PNS', False)
            elif band == '>=30':
                exp = ('Sales', True)
            else:
                exp = ('Sales', False)
            r = route(acct, s, rev)
            got = (r['resp'], r['review'])
            if got != exp:
                fails.append('ROUTE %s/%s/%s exp=%s got=%s' % (acct, band, s, exp, got))
print("routing cells checked:", 3 * 2 * 5, "| failures:", len(fails))

# ---------------------------------------------------------------- 5A guard truth
GUARD_TRUTH = {
    ('LTL', 'low'): ('margin', 20.0), ('LTL', 'mid'): ('margin', 5.0), ('LTL', 'high'): ('margin', 5.0),
    ('B2BR', 'low'): ('margin', 20.0), ('B2BR', 'mid'): ('margin', 10.0), ('B2BR', 'high'): ('margin', 10.0),
    ('B2C', 'low'): ('margin', 20.0), ('B2C', 'mid'): ('margin', 10.0), ('B2C', 'high'): ('margin', 10.0),
    # DELIBERATE DEVIATION FROM 5A (Baskoro, 2026-08-07): 5A publishes "Standard rate"
    # for FTL on-call, which leaves no floor to check. On-call now mirrors FTL monthly.
    ('FTL on-call', 'low'): ('margin', 15.0), ('FTL on-call', 'mid'): ('margin', 10.0),
    ('FTL on-call', 'high'): ('manual', None),
    ('FTL monthly', 'low'): ('margin', 15.0), ('FTL monthly', 'mid'): ('margin', 10.0),
    ('FTL monthly', 'high'): ('manual', None),
    ('Sameday', 'low'): ('discount', 20.0), ('Sameday', 'mid'): ('discount', 20.0),
    ('Sameday', 'high'): ('discount', 20.0),
}
REV = {'low': 5_000_000, 'mid': 20_000_000, 'high': 50_000_000}
for (svc, tier), exp in GUARD_TRUTH.items():
    g = guard_for('Non-Strategic', svc, REV[tier])
    if (g['kind'], g['limit']) != exp:
        fails.append('GUARD %s/%s exp=%s got=%s' % (svc, tier, exp, (g['kind'], g['limit'])))
for acct in ('Hypercare', 'Strategic'):
    for svc in S:
        g = guard_for(acct, svc, 5_000_000)
        if g['kind'] != 'manual':
            fails.append('GUARD %s/%s should be manual, got %s' % (acct, svc, g['kind']))
print("guard cells checked:", len(GUARD_TRUTH) + 10, "| cumulative failures:", len(fails))

# ---------------------------------------------------------------- breach behaviour
cases = [
    ('LTL', 5_000_000, 19.0, None, True,  'LTL <=10Mio at 19% margin breaches the 20% floor'),
    ('LTL', 5_000_000, 21.0, None, False, 'LTL <=10Mio at 21% margin is fine'),
    ('LTL', 20_000_000, 6.0, None, False, 'LTL mid at 6% margin is fine (floor drops to 5%)'),
    ('B2BR', 20_000_000, 9.0, None, True, 'B2BR mid at 9% margin breaches the 10% floor'),
    ('Sameday', 5_000_000, None, 25.0, True,  'Sameday at 25% discount breaches the 20% cap'),
    ('Sameday', 5_000_000, None, 20.0, False, 'Sameday at exactly 20% is allowed'),
    ('Sameday', 50_000_000, None, 5.0, False, 'Sameday high band still capped on discount only'),
    ('FTL monthly', 5_000_000, 14.0, None, True, 'FTL monthly <=10Mio at 14% breaches 15%'),
    ('LTL', 5_000_000, None, None, False, 'nothing declared is never a breach'),
]
for svc, rev, m, d, exp, why in cases:
    g = guard_for('Non-Strategic', svc, rev)
    got = guard_breached(g, m, d)
    if got != exp:
        fails.append('BREACH %s: exp=%s got=%s' % (why, exp, got))
print("breach cases checked:", len(cases), "| cumulative failures:", len(fails))

print()
if fails:
    print("FAILURES:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("ALL CHECKS PASSED")
