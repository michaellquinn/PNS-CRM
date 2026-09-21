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
from datetime import datetime, timedelta


HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SRC = os.path.join(REPO, "backend", "main.py")
tree = ast.parse(open(SRC, encoding="utf-8").read())

WANT_VAR = {"PNS_WIP_CAP", "WORKLOAD_DISPLAY_NAMES", "PNS_LOAD_STATUSES", "AWAIT_STATUSES", "PNS_LOAD_SQL", "REQUIREMENT_STATUS",
            "PNS_CLOCK_STATUSES", "PNS_DONE_STATUSES"}
keep = [
    n for n in tree.body
    if (isinstance(n, ast.AsyncFunctionDef) and n.name == "workload")
    or (isinstance(n, ast.FunctionDef) and n.name in ("working_seconds", "pns_clear_days"))
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
    if "FROM ticket_history h" in sql:
        o = "Michael Quinnfarand"
        return [
            # Mon 09:00 -> Tue 09:00 in Pending PNS = 1.0 working day
            {"ticket_id": 1, "status": "Pending PNS", "at": datetime(2026, 9, 14, 9), "owner_name": o},
            {"ticket_id": 1, "status": "Proposal Submitted", "at": datetime(2026, 9, 15, 9), "owner_name": o},
            # Fri 09:00 PNS, Fri 21:00 waiting on Sales (paused), Mon 09:00 back, Mon 21:00 done
            # = 0.5 + 0.5 = 1.0; the weekend and the Sales wait do not count
            {"ticket_id": 2, "status": "Pending PNS", "at": datetime(2026, 9, 11, 9), "owner_name": o},
            {"ticket_id": 2, "status": "Pending Sales", "at": datetime(2026, 9, 11, 21), "owner_name": o},
            {"ticket_id": 2, "status": "Pending PNS", "at": datetime(2026, 9, 14, 9), "owner_name": o},
            {"ticket_id": 2, "status": "Pending Review - Head PNS", "at": datetime(2026, 9, 14, 21), "owner_name": o},
            # never finished: not counted
            {"ticket_id": 3, "status": "Pending PNS", "at": datetime(2026, 9, 14, 9), "owner_name": o},
        ]
    return []


def require(user, permission):
    assert permission == "seeWorkload"


def can(user, permission):
    assert permission == "manageUsers"
    return True


ns = {"q": q, "require": require, "can": can, "User": object,
      "datetime": datetime, "timedelta": timedelta}
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
assert row["avg_days_to_clear"] == 1.0 and row["finished"] == 2, row
assert row["worst_days_to_clear"] == 1.0, row
# Load is pricing plus PNS review; decided leaves cancelled deals out (2026-09-21).
assert "t.resp='PNS'" in staff_sql and "'Open'" in staff_sql and "Pending Review - PNS" in staff_sql, \
    "Pending PNS must match the Pricing - PNS queue (Open, Pending Vendor included) plus PNS review"
assert "Pending Requirement" in staff_sql, "a ticket waiting on requirements stays on the PIC's count"
assert "SUM(t.outcome IN ('accepted','lost')) AS decided" in staff_sql

print("verify_workload.py      Admin included; Quinn alias keeps canonical ownership")
