"""View as: an Admin previews the app as a person or a role — and changes nothing.

Michael, 2026-09-28: to check one by one what each team faces. The rules that make it
safe, executed rather than read:

  * the X-View-As header is honoured ONLY for a real Admin, identified by SSO. From
    anyone else it is ignored, so nobody can use it to borrow rights;
  * while it is on, EVERY write is refused. Otherwise an Admin click would confirm a
    point, move a ticket or send a notification under another person's name;
  * it names a registered, active person or a real role; anything else is refused.
"""
import sys, types, asyncio
stub = types.ModuleType("asyncmy"); stub.cursors = types.SimpleNamespace(DictCursor=object)
sys.modules["asyncmy"] = stub; sys.modules["asyncmy.cursors"] = stub.cursors
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
import main as m
USERS = {"boss@x": dict(email="boss@x", name="Boss", role_group="Admin", role_level="head", team=None),
         "ari@x": dict(email="ari@x", name="Ari", role_group="Commercial", role_level="staff", team="Team1")}
async def q(sql, args=(), one=False): return USERS.get(args[0])
m.q = q
class Req:
    def __init__(self, method, who, view=None):
        self.method = method; self.headers = {"x-forwarded-email": who}
        if view: self.headers["x-view-as"] = view
def run(c): return asyncio.run(c)
def refused(c, code):
    try: run(c)
    except m.HTTPException as e: assert e.status_code == code, (e.status_code, e.detail); return
    raise AssertionError("expected refusal")
u = run(m.current_user(Req("GET", "boss@x", "ari@x")))
assert u.group == "Commercial" and u.name == "Ari" and u.view_as_by == "boss@x"
u = run(m.current_user(Req("GET", "boss@x", "group:CL")))
assert u.group == "CL" and u.level == "staff" and u.view_as_by == "boss@x"
u = run(m.current_user(Req("GET", "boss@x", "group:Commercial:head")))
assert u.level == "head"
refused(m.current_user(Req("POST", "boss@x", "ari@x")), 403)       # read-only
refused(m.current_user(Req("GET", "boss@x", "group:Nope")), 400)
refused(m.current_user(Req("GET", "boss@x", "ghost@x")), 400)
u = run(m.current_user(Req("GET", "ari@x", "boss@x")))              # non-admin: ignored
assert u.group == "Commercial" and u.view_as_by is None
u = run(m.current_user(Req("POST", "ari@x", "group:Admin")))        # non-admin cannot escalate
assert u.group == "Commercial"
u = run(m.current_user(Req("POST", "boss@x")))                      # no header: normal admin
assert u.group == "Admin" and u.view_as_by is None
print("view as OK")
