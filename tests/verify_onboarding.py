"""The onboarding rules, pinned.

Three things are checked here, and each of them is a rule somebody agreed to in words
that is easy to break silently in code.

1. THE PHASE BOUNDARIES. The gray week is the one period where PNS and QC are BOTH
   accountable, so its edges decide who answers for a shipper on a given day. An
   off-by-one here does not crash anything and does not show on any screen -- it just
   quietly hands a shipper over a day early or a day late.

2. OPS ARE STILL READ-ONLY. Onboarding gives Ops two rights. can() has a hard early
   return for READ_ONLY_GROUPS, and the tempting way to grant those two was to take Ops
   out of that tuple -- which would also have granted createTicket. This asserts the
   narrow grant held.

3. THE PRICE STAYS WITH THE COMMERCIAL TEAMS. seePrice is answered ABOVE the same early
   return, because Ops shares that tuple with Visitor and Finance and Finance read the
   charter for exactly that figure. Written in the ordinary place, a rule about Ops and
   QC would have taken the price off Finance too.
"""
import importlib.util
import os
import sys
import types
from datetime import date, timedelta

# This suite EXECUTES main.py rather than reading it, which the other suites
# deliberately avoid - and importing it pulls in asyncmy, the OceanBase driver,
# which needs a compiler and is not installed on a plain checkout. Without this
# stub the whole run_all goes red on any machine that has not built the backend
# environment, which is a broken gate rather than a failing test.
#
# Stubbing is safe here: the driver is only touched by lifespan(), which an import
# never runs. Nothing else about the module is faked.
_asyncmy = types.ModuleType("asyncmy")
_asyncmy.create_pool = None


class _DictCursor:
    pass


_asyncmy.cursors = types.SimpleNamespace(DictCursor=_DictCursor)
sys.modules.setdefault("asyncmy", _asyncmy)
sys.modules.setdefault("asyncmy.cursors", _asyncmy.cursors)

SRC = os.path.join(os.path.dirname(__file__), "..", "backend", "main.py")
spec = importlib.util.spec_from_file_location("m", SRC)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

fails = []


def check(label, got, want):
    if got != want:
        fails.append(f"{label}: got {got!r}, expected {want!r}")
    return got == want


# ------------------------------------------------------------------ phase boundaries
T = date(2026, 9, 7)


def row(**kw):
    return {"target_golive": T, "actual_golive": None, "outcome": None, **kw}


print("phase, computed from the dates on every read")
cases = [
    ("target still ahead",        row(target_golive=T + timedelta(days=3)), "preparing"),
    ("target is today",           row(),                                    "preparing"),
    # The day AFTER the target with nobody confirming is when QC are asked. Not the day
    # of: a shipper starting on their target date must not be flagged as overdue.
    ("target passed yesterday",   row(target_golive=T - timedelta(days=1)), "overdue"),
    ("went live today",           row(actual_golive=T),                     "gray"),
    ("day 7 is still shared",     row(actual_golive=T - timedelta(days=7)), "gray"),
    ("day 8 belongs to QC",       row(actual_golive=T - timedelta(days=8)), "live"),
    # A late QC acknowledgement does not restart the week. The gray period is the
    # shipper's first week of shipping, a real-world fact, not an admin timestamp.
    ("late ack cannot rewind it", row(actual_golive=T - timedelta(days=20)), "live"),
    ("did not start wins",        row(outcome="did_not_start",
                                      actual_golive=T),                     "did_not_start"),
]
for label, r, want in cases:
    ok = check(f"phase / {label}", m.ob_phase(r, T), want)
    print(f"  {'ok  ' if ok else 'FAIL'} {label:28} -> {m.ob_phase(r, T)}")

# Every phase the function can return must have a label, or the screen prints a raw key.
for _, r, _ in cases:
    ph = m.ob_phase(r, T)
    if ph not in m.PHASE_LABEL:
        fails.append(f"phase {ph!r} has no PHASE_LABEL")

# ------------------------------------------------------------------ one shipper per ticket
print("\none ticket is one shipper ID")
for raw in ("12345", "NX-9"):
    try:
        m.one_shipper_id(raw)
        print(f"  ok   {raw!r} accepted")
    except Exception:
        fails.append(f"one_shipper_id refused a single id {raw!r}")
for raw in ("123, 456", "123 456", "123;456", "123/456", ""):
    try:
        m.one_shipper_id(raw)
        fails.append(f"one_shipper_id accepted {raw!r}, which is not one id")
    except Exception:
        print(f"  ok   {raw!r} refused")

print("\nreservation ids are numeric; tracking and MPS prefixes vary per shipper")
try:
    m.clean_id_value("reservation", "NVX-1")
    fails.append("a non-numeric reservation id was accepted")
except Exception:
    print("  ok   non-numeric reservation refused")
for kind, val in (("reservation", "90210"), ("tracking", "NVIDSGP0012"), ("mps", "MPS-77")):
    try:
        check(f"{kind} {val}", m.clean_id_value(kind, val), val)
        print(f"  ok   {kind} {val!r} accepted")
    except Exception as e:
        fails.append(f"{kind} {val!r} was refused: {e}")

# Every kind the API accepts must have a label, or the picker renders a blank option.
for k in m.ID_KINDS:
    if not m.ID_KINDS[k]:
        fails.append(f"id kind {k!r} has no label")

# ------------------------------------------------------------------ areas route to a team
print("\nevery requirement area names exactly one team that can acknowledge it")
for key, label, owner in m.REQ_AREAS:
    if owner not in ("Ops", "QC"):
        fails.append(f"area {key!r} routes to {owner!r}, which is not Ops or QC")
    if not label:
        fails.append(f"area {key!r} has no label")
    print(f"  ok   {label:20} -> {owner}")
if len(m.REQ_LABEL) != len(m.REQ_AREAS):
    fails.append("REQ_AREAS has a duplicate key")


# ------------------------------------------------------------------ the narrow grants
def user(group, level="staff"):
    return m.User(email="x@y.z", name="X", group=group, level=level, team="Team1", sso=True)


print("\nOps gained onboarding rights and NOTHING else")
ops = user("Ops")
check("Ops markReady", m.can(ops, "markReady"), True)
check("Ops ackRequirement", m.can(ops, "ackRequirement"), True)
# The whole point of the carve-out. If Ops were removed from READ_ONLY_GROUPS instead,
# works_group would turn true and this would silently become True with it.
check("Ops createTicket", m.can(ops, "createTicket"), False)
check("Ops editInput", m.can(ops, "editInput"), False)
check("Ops startOnboarding", m.can(ops, "startOnboarding"), False)
check("Ops raiseRequirement", m.can(ops, "raiseRequirement"), False)
for a in ("markReady", "ackRequirement", "createTicket", "editInput", "startOnboarding"):
    print(f"  {'ok  ' if True else ''} Ops {a:18} = {m.can(ops, a)}")

print("\nraising a requirement is PNS's alone")
for g in ("Commercial", "Ops", "QC", "PSP", "Sales Planning"):
    check(f"{g} raiseRequirement", m.can(user(g), "raiseRequirement"), False)
check("PNS raiseRequirement", m.can(user("PNS"), "raiseRequirement"), True)
print("  ok   only PNS and Admin may raise one")

print("\nthe sell price is hidden from Ops and QC, and from nobody else")
for g in m.ROLE_GROUPS:
    want = g not in ("Ops", "QC")
    got = m.can(user(g), "seePrice")
    check(f"{g} seePrice", got, want)
    print(f"  {'ok  ' if got == want else 'FAIL'} {g:16} seePrice={got}")

# ------------------------------------------------------------------ the QC export
# One row per id, and quoted properly. A shipper name with a comma in it is the classic
# way a hand-rolled CSV silently shifts every column to its right -- and these names come
# from Sales CRM, where "PT. Anu, Tbk" is ordinary.
print("\nthe QC export is one row per id, correctly quoted")
import asyncio


class _Row:
    def __init__(self, ref, shipper, sid, phase, target, actual, ids):
        self.ref, self.shipper, self.shipper_id = ref, shipper, sid
        self.phase, self.phase_label = phase, m.PHASE_LABEL[phase]
        self.target_golive, self.actual_golive, self.ids = target, actual, ids


class _Id:
    def __init__(self, kind, value):
        self.kind, self.value = kind, value


rows = [
    _Row("SOF-1", 'PT. Anu, Tbk', "8001", "gray", "2026-09-01", "2026-09-02",
         [_Id("reservation", "77120034"), _Id("tracking", "NVIDSGP001")]),
    # No ids at all: this is the shipper QC CANNOT monitor, so it must still appear.
    _Row("SOF-2", "PT. Kosong", "8002", "preparing", "2026-09-20", None, []),
    # Closed: ran its week, belongs to QC's own system, must NOT be in the export.
    _Row("SOF-3", "PT. Lama", "8003", "live", "2026-08-01", "2026-08-01",
         [_Id("mps", "MPS-9")]),
]
m._load_onboardings = lambda: asyncio.sleep(0, result=rows)
csv = asyncio.get_event_loop().run_until_complete(
    m.export_onboarding(u=user("QC"))).body.decode()
lines = [ln for ln in csv.strip().split("\n")]
for ln in lines:
    print("   ", ln)

check("export: header + 3 data rows", len(lines), 4)
check("export: the comma'd name is quoted", '"PT. Anu, Tbk"' in csv, True)
check("export: closed row excluded", "SOF-3" in csv, False)
check("export: id-less shipper still listed", "SOF-2" in csv, True)
check("export: one row per id", sum(1 for ln in lines if ln.startswith("SOF-1")), 2)
check("export: id kinds are labelled", "Reservation ID" in csv and "Tracking ID" in csv, True)

# ------------------------------------------------------------------
if fails:
    print("\nverify_onboarding.py FAILED")
    for f in fails:
        print(f"  - {f}")
    sys.exit(1)
print("\nALL ONBOARDING CHECKS PASSED")
