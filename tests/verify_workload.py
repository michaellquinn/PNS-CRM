"""The Workload view includes every person who can do PNS work, including Admin.

Admin is deliberately a superset of PNS in permissions and in the assignee list. The
workload SQL once filtered on literal role_group='PNS', which made Quinn assignable to a
ticket but absent from the screen used to judge capacity. This executes the real
workload function with a fake database and also pins the user-facing short name without
renaming the canonical account or its ticket ownership records.
"""
import ast
import asyncio
import os


HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SRC = os.path.join(REPO, "backend", "main.py")
tree = ast.parse(open(SRC, encoding="utf-8").read())

WANT_VAR = {"PNS_WIP_CAP", "WORKLOAD_DISPLAY_NAMES"}
keep = [
    n for n in tree.body
    if (isinstance(n, ast.AsyncFunctionDef) and n.name == "workload")
    or (isinstance(n, ast.Assign) and any(
        isinstance(t, ast.Name) and t.id in WANT_VAR for t in n.targets))
]
fn = next(n for n in keep if isinstance(n, ast.AsyncFunctionDef))
fn.decorator_list = []
fn.returns = None
fn.args.defaults = []
for arg in fn.args.args:
    arg.annotation = None

seen_sql = []


async def q(sql, args=(), one=False):
    seen_sql.append(sql)
    if "FROM users u LEFT JOIN tickets t" in sql:
        return [{
            "email": "michael.quinnfarand@ninjavan.co",
            "name": "Michael Quinnfarand",
            "pending_pns": 2,
            "open_total": 3,
            "won": 4,
            "decided": 5,
        }]
    if "JOIN (SELECT ticket_id, MIN(at) AS at FROM ticket_history" in sql:
        return [{
            "name": "Michael Quinnfarand",
            "avg_days": 1.5,
            "worst_days": 3,
            "finished": 2,
        }]
    return []


def require(user, permission):
    assert permission == "seeWorkload"


def can(user, permission):
    assert permission == "manageUsers"
    return True


ns = {"q": q, "require": require, "can": can, "User": object}
exec(compile(ast.fix_missing_locations(ast.Module(body=keep, type_ignores=[])),
             "<workload>", "exec"), ns)
result = asyncio.run(ns["workload"](object()))

staff_sql = next(s for s in seen_sql if "FROM users u LEFT JOIN tickets t" in s)
assert "u.role_group IN ('PNS','Admin')" in staff_sql, \
    "Workload must include Admin because Admin accounts also do PNS work"
assert "SELECT u.email, u.name" in staff_sql, \
    "The display alias must be keyed by stable email, not an editable name"

assert len(result["pns"]) == 1
row = result["pns"][0]
assert row["name"] == "Quinn", row
assert row["pending_pns"] == 2 and row["open_total"] == 3, row
assert row["avg_days_to_clear"] == 1.5 and row["finished"] == 2, row

print("verify_workload.py      Admin included; Quinn alias keeps canonical ownership")
