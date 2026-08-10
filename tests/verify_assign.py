"""Exercise auto_assignee out of the real main.py against a stubbed database."""
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
import ast, asyncio, os, sys

SRC = os.path.join(_REPO, "backend", "main.py")
tree = ast.parse(open(SRC, encoding='utf-8').read())

WANT_FN = {'auto_assignee', 'pending_pns_load', 'shipper_is_live'}
WANT_VAR = {'SERVICE_SPECIALIST', 'PNS_DEFAULT_PAIR', 'PNS_WIP_CAP', 'AUTO_ASSIGN',
            'COMPLEX_LOGISTICS_NEW', 'COMPLEX_LOGISTICS_LIVE'}
keep = [n for n in tree.body
        if (isinstance(n, ast.AsyncFunctionDef) and n.name in WANT_FN)
        or (isinstance(n, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id in WANT_VAR for t in n.targets))]
ns = {'os': os}
exec(compile(ast.fix_missing_locations(ast.Module(body=keep, type_ignores=[])),
             '<assign>', 'exec'), ns)

NAME = {'adila.kestibawani@ninjavan.co': 'Adila Kestibawani',
        'annisa.sophieamalia@ninjavan.co': 'Annisa Sophie Amalia',
        'm.ramdhani@ninjavan.co': 'M. Ramdhani',
        'niko.yannova@ninjavan.co': 'Niko Yannova',
        'michael.quinnfarand@ninjavan.co': 'Michael Quinn Farand'}
ALL = set(NAME)


def make_q(active, load, live=False):
    async def q(sql, args=(), one=False):
        if 'FROM users WHERE email IN' in sql:
            return [{'name': NAME[e]} for e in args if e in active]
        if 'COUNT(*) AS n FROM tickets' in sql:
            return [{'owner_name': n, 'n': load.get(n, 0)} for n in args]
        if "outcome='accepted'" in sql:
            return {'n': 1} if live else None
        raise AssertionError('unexpected sql: ' + sql[:70])
    return q


# (description, service, active emails, load, shipper already live, expected)
cases = [
    # Complex Logistics splits on the account, not on load: winning a new account is a
    # different job from adding work to one already shipping.
    ("Complex Logs, NEW account -> Michael", "Complex Logistics", ALL, {}, False,
     "Michael Quinn Farand"),
    ("Complex Logs, account already live -> Adila", "Complex Logistics", ALL, {}, True,
     "Adila Kestibawani"),
    ("Complex Logs new, Michael at cap -> manual (does NOT fall to Adila)",
     "Complex Logistics", ALL, {"Michael Quinn Farand": 10}, False, None),
    ("Complex Logs live, Adila at cap -> manual", "Complex Logistics", ALL,
     {"Adila Kestibawani": 10}, True, None),
    ("Complex Logs new, Adila busy is irrelevant", "Complex Logistics", ALL,
     {"Adila Kestibawani": 10}, False, "Michael Quinn Farand"),

    ("Sameday -> Annisa, exclusively", "Sameday", ALL, {}, False, "Annisa Sophie Amalia"),
    ("Sameday on a live account is still Annisa", "Sameday", ALL, {}, True,
     "Annisa Sophie Amalia"),
    ("Sameday, Annisa at cap -> manual", "Sameday", ALL,
     {"Annisa Sophie Amalia": 10}, False, None),

    ("LTL -> lighter of the default pair", "LTL", ALL, {}, False, "M. Ramdhani"),
    ("LTL, Ramdhani busier -> Niko", "LTL", ALL,
     {"M. Ramdhani": 5, "Niko Yannova": 1}, False, "Niko Yannova"),
    ("LTL, BOTH at cap -> manual (no overflow)", "LTL", ALL,
     {"M. Ramdhani": 10, "Niko Yannova": 10}, False, None),
    ("LTL, both over cap -> manual", "LTL", ALL,
     {"M. Ramdhani": 14, "Niko Yannova": 11}, False, None),
    ("Michael is NOT a default-pair fallback for LTL", "LTL",
     ALL - {'m.ramdhani@ninjavan.co', 'niko.yannova@ninjavan.co'}, {}, False, None),
    ("Sameday specialist away -> falls back to pair", "Sameday",
     ALL - {'annisa.sophieamalia@ninjavan.co'}, {}, False, "M. Ramdhani"),
    ("Nobody registered -> manual", "LTL", set(), {}, False, None),
]

fails = []
print("%-62s %-22s %s" % ("CASE", "EXPECTED", "GOT"))
print("-" * 110)
for desc, svc, active, load, live, exp in cases:
    ns['q'] = make_q(active, load, live)
    got = asyncio.run(ns['auto_assignee'](svc, 0, 1))
    ok = got == exp
    if not ok:
        fails.append(desc)
    print("%-62s %-22s %-22s %s" % (desc[:62], exp, got, "" if ok else "<-- MISMATCH"))

# auto-assignment switched off entirely
ns['AUTO_ASSIGN'] = False
ns['q'] = make_q(ALL, {})
got = asyncio.run(ns['auto_assignee']("LTL", 0, 1))
ok = got is None
if not ok:
    fails.append("AUTO_ASSIGN=0 should leave every ticket unassigned")
print("%-62s %-22s %-22s %s" % ("AUTO_ASSIGN off -> manual", None, got,
                                "" if ok else "<-- MISMATCH"))

print("-" * 104)
print("cap =", ns['PNS_WIP_CAP'], "| cases:", len(cases) + 1, "| failures:", len(fails))
if fails:
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("ALL ASSIGNMENT CHECKS PASSED")
