"""Ninja PNS — solutioning workflow API.

Substrait upload-mode contract:
  - listens on port 8000
  - GET /health is the readiness probe
  - all API routes live under /api
  - DATABASE_URL is OceanBase (MySQL wire) — asyncmy driver, %s placeholders
  - all DDL is in resources/db/migration/, never here

Identity comes from the platform's auth proxy (x-forwarded-email) once Google SSO
is enabled in the portal's Access tab. Authorisation is this module's job: `can()`
is the single source of truth and every mutating route checks it. Hiding a control
in the frontend is not a permission.
"""
import asyncio
import json
import logging
import smtplib
import re
import os
from contextlib import asynccontextmanager
from datetime import date, datetime
from email.message import EmailMessage
from urllib.parse import unquote, urlparse

import asyncmy
from asyncmy.cursors import DictCursor
from fastapi import Depends, FastAPI, File as FastFile, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel

_pool = None


def _dsn() -> dict:
    u = urlparse(os.environ["DATABASE_URL"])
    return {
        "host": u.hostname,
        "port": u.port or 2881,
        "user": unquote(u.username or ""),
        "password": unquote(u.password or ""),
        "db": (u.path or "/").lstrip("/"),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _pool
    if os.getenv("DATABASE_URL"):
        _pool = await asyncmy.create_pool(**_dsn(), autocommit=True)
    yield
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()


app = FastAPI(title="Ninja PNS — Solutioning", lifespan=lifespan)

# Set in the portal when SSO is off, so local dev and the first deploy still work.
DEV_USER = os.getenv("DEV_USER_EMAIL", "")


async def q(sql: str, args: tuple = (), one: bool = False):
    if _pool is None:
        return None if one else []
    async with _pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(sql, args)
        return await cur.fetchone() if one else await cur.fetchall()


async def execute(sql: str, args: tuple = ()) -> int:
    if _pool is None:
        raise HTTPException(503, "database not configured")
    async with _pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(sql, args)
        return cur.lastrowid


# ------------------------------------------------------------------ business rules
SERVICES = ["LTL", "B2BR", "B2C", "FTL on-call", "FTL monthly", "Sameday",
            "Fulfillment", "Complex Logistics"]

# Vendor cost is a haulage question. Only the FTL lines ever wait on a vendor quote,
# so the "waiting vendor cost" detour is offered for those and nothing else.
VENDOR_SERVICES = ("FTL on-call", "FTL monthly")

# Hypercare and Strategic are the two managed tiers in the ID book; both are
# solutioned by PNS and priced under manual review. Everything else is Non-Strategic.
ACCT_TYPES = ["Hypercare", "Strategic", "Non-Strategic"]
MANAGED_ACCTS = ("Hypercare", "Strategic")

# Sales CRM API keys are issued per person and inherit that person's permissions, so a
# sync run reads whatever its trigger can see. Until Ninja issues a service account, one
# named owner runs it. Override per environment rather than editing this default.
SYNC_OWNER_EMAIL = os.getenv("SYNC_OWNER_EMAIL", "baskoro.nugroho@ninjavan.co").lower()
LOSS_REASONS = ["pricing", "shipper", "solution", "ops", "no_vendor", "billing", "pns"]
AWAIT_STATUSES = ("Pending Sales", "Pending PNS", "Pending Vendor")
PENDING_STATUSES = ["Pending Sales", "Pending PNS", "Pending PNS Review",
                    "Pending Head Review", "Pending PSP Approval", "Pending Vendor"]
# Fields the intake keeps as free text but remembers: the dropdown would otherwise have
# to predict every commodity Ninja ever carries (a shipper turned up with medicine).
REMEMBERED_FIELDS = ["commodity", "product", "pallet", "destType", "truck", "freq"]


def route(acct: str, svc: str, rev: int) -> dict:
    """Who prices it, and whether PNS reviews afterwards (5A responsibility matrix).

    Service is tested before revenue on purpose: FTL monthly and Sameday go to PNS at
    *every* revenue band. Testing revenue first made that branch unreachable above
    30 Mio and quietly handed the two most complex products to Sales."""
    if acct in MANAGED_ACCTS:
        return {"resp": "PNS", "review": False}
    if svc in ("FTL monthly", "Sameday"):
        return {"resp": "PNS", "review": False}
    if rev >= 30_000_000:
        return {"resp": "Sales", "review": True}
    return {"resp": "Sales", "review": False}


# PNS ownership by service line. Two lines have named specialists; everything else
# rotates through the generalists. Baskoro is Head and is deliberately not in the pool —
# assigning the head his own queue is how oversight quietly turns into a caseload.
SERVICE_SPECIALIST = {
    "Complex Logistics": "adila.kestibawani@ninjavan.co",
    "Sameday":           "annisa.sophieamalia@ninjavan.co",
}
# Everything without a specialist goes to this pair by default, whichever of them is
# carrying less. Michael takes the overflow only once both are at the cap, so he stays
# free for whatever the pair cannot absorb rather than taking a third of everything.
PNS_DEFAULT_PAIR = ["m.ramdhani@ninjavan.co", "niko.yannova@ninjavan.co"]
PNS_OVERFLOW = "michael.quinnfarand@ninjavan.co"
PNS_WIP_CAP = 10          # tickets one person may hold at Pending PNS before overflow


async def pending_pns_load(names: list[str]) -> dict[str, int]:
    """How many tickets each named person is holding at Pending PNS right now."""
    if not names:
        return {}
    ph = ",".join(["%s"] * len(names))
    rows = await q(f"SELECT owner_name, COUNT(*) AS n FROM tickets "
                   f"WHERE owner_name IN ({ph}) AND status='Pending PNS' "
                   f"AND deleted_at IS NULL GROUP BY owner_name", tuple(names))
    load = {n: 0 for n in names}
    for r in rows:
        load[r["owner_name"]] = int(r["n"])
    return load


async def auto_assignee(service: str, seed: int) -> str | None:
    """The PNS member who should own a new ticket, or None to leave it for the head.

    A specialist takes their own line outright. Everything else goes to the lighter of
    the default pair, and only spills to the overflow owner once both are at the cap —
    so work is levelled rather than sprayed round-robin at whoever is next in line.

    Anyone not registered or not active is skipped. Assigning work to someone who cannot
    open the app is worse than leaving it unassigned, because it looks handled."""
    email = SERVICE_SPECIALIST.get(service)
    if email:
        row = await q("SELECT name FROM users WHERE email=%s AND active=1", (email,), one=True)
        if row:
            return row["name"]
        # Specialist away or unregistered — fall through rather than stranding the
        # ticket on a name nobody is watching.

    ph = ",".join(["%s"] * len(PNS_DEFAULT_PAIR))
    pair = await q(f"SELECT name FROM users WHERE email IN ({ph}) AND active=1 ORDER BY email",
                   tuple(PNS_DEFAULT_PAIR))
    names = [r["name"] for r in pair]
    if names:
        load = await pending_pns_load(names)
        # Ties break on name so the choice is stable for a retried request.
        lightest = min(names, key=lambda n: (load[n], n))
        if load[lightest] < PNS_WIP_CAP:
            return lightest

    over = await q("SELECT name FROM users WHERE email=%s AND active=1",
                   (PNS_OVERFLOW,), one=True)
    if over:
        return over["name"]
    # Both the pair and the overflow owner are unavailable: leave it for the head to
    # place by hand rather than pushing it onto someone already over the cap.
    return names[0] if names else None


def tier_of(rev: int) -> str:
    """5A revenue bands: =< 10 Mio, 10 < x < 30 Mio, >= 30 Mio."""
    if rev <= 10_000_000:
        return "low"
    return "mid" if rev < 30_000_000 else "high"


# The "Max. Discount / Min. Margin" row of each 5A Revenue & Customization table,
# by service then revenue band. Each entry is (kind, limit):
#   margin   — the priced margin must be at or above `limit` %
#   discount — the discount must be at or below `limit` %
#   standard — published rate card only, no deviation
#   manual   — no automatic ceiling; a person decides (routes to PSP)
# Sameday carries no bottom margin at all: the only self-serve lever is a 20% discount,
# and anything past that is a PSP call. B2C prices off the B2BR card, so it follows B2BR.
PRICING_GUARD = {
    "LTL":         {"low": ("margin", 20.0), "mid": ("margin", 5.0),  "high": ("margin", 5.0)},
    "B2BR":        {"low": ("margin", 20.0), "mid": ("margin", 10.0), "high": ("margin", 10.0)},
    "B2C":         {"low": ("margin", 20.0), "mid": ("margin", 10.0), "high": ("margin", 10.0)},
    # FTL on-call mirrors FTL monthly: same dedicated line, same vendor cost question,
    # so the same ceilings apply. (5A published "Standard rate" for on-call, which left
    # it with no floor to check at all.)
    "FTL on-call": {"low": ("margin", 15.0), "mid": ("margin", 10.0), "high": ("manual", None)},
    "FTL monthly": {"low": ("margin", 15.0), "mid": ("margin", 10.0), "high": ("manual", None)},
    "Sameday":     {"low": ("discount", 20.0), "mid": ("discount", 20.0), "high": ("discount", 20.0)},
    # New lines carried over from Sales CRM. 5A predates them and publishes no ceiling,
    # so every band is a decision until Commercial issues one.
    "Fulfillment":       {"low": ("manual", None), "mid": ("manual", None), "high": ("manual", None)},
    "Complex Logistics": {"low": ("manual", None), "mid": ("manual", None), "high": ("manual", None)},
}


# Sales CRM stage -> what it means here. Anything before the shipper accepts is still
# an open solutioning job, so it does not force our status; routing decides that.
# Future Opportunity is a loss for PNS purposes: the deal is not being solutioned now.
CLOSED_LOST_STAGES = ("Closed-Lost", "Closed Lost", "Future Opportunity", "Future Oppurtunity")
ACCEPTED_STAGES = ("Agreed to Ship", "Onboarding", "Ready to Ship", "Closed-Won", "Closed Won")


def stage_blocks_work(t: dict) -> str | None:
    """Sales CRM outranks us. If the opportunity is dead there, no PNS work proceeds.

    Sales owns the commercial reality: if the shipper walked away or the deal was parked
    as a future opportunity, solutioning it is wasted effort and a priced proposal would
    be misleading. Returns the reason to refuse, or None to allow."""
    stage = t.get("stage")
    if stage in CLOSED_LOST_STAGES:
        return (f"Sales CRM has this opportunity at '{stage}'. Reopen it there first — "
                f"Sales CRM leads on stage and this ticket follows it.")
    return None


def status_for_stage(stage: str | None, resp: str) -> str | None:
    """The PNS status a Sales CRM stage implies, or None to leave ours alone.

    Deliberately one-way and coarse. Sales CRM owns the commercial stage; this app owns
    the solutioning status. The only stages that override ours are the terminal ones —
    there is no point solutioning a deal the shipper has already declined."""
    if not stage:
        return None
    if stage in CLOSED_LOST_STAGES:
        return "Lost"
    if stage in ACCEPTED_STAGES:
        return "Proposal Accepted / Ready to Ship"
    return None          # New, Negotiation, Proposal Submitted, EKYC, Contract Sent…


def guard_for(acct: str, svc: str, rev: int) -> dict:
    """The pricing ceiling that applies to one ticket."""
    if acct in MANAGED_ACCTS:
        return {"kind": "manual", "limit": None,
                "why": f"{acct} account — priced under manual review"}
    kind, limit = PRICING_GUARD.get(svc, {}).get(tier_of(rev), ("manual", None))
    why = {
        "margin":   f"minimum margin {limit}%" if limit is not None else "",
        "discount": f"maximum discount {limit}%" if limit is not None else "",
        "standard": "published rate card only — no deviation",
        "manual":   "no published ceiling at this tier — needs a decision",
    }[kind]
    return {"kind": kind, "limit": limit, "why": why}


def guard_breached(g: dict, margin_pct: float | None, discount_pct: float | None) -> bool:
    """True when the attached price exceeds what the tier allows.

    An unstated figure is never treated as a breach — the pricer may be attaching a
    standard rate card with nothing to declare. The manual/standard tiers are handled
    by the caller, not here, because they need a decision rather than a comparison."""
    if g["kind"] == "margin" and margin_pct is not None:
        return margin_pct < g["limit"]
    if g["kind"] == "discount" and discount_pct is not None:
        return discount_pct > g["limit"]
    return False


def pending_for(resp: str) -> str:
    return "Pending Sales" if resp == "Sales" else "Pending PNS"


def needs_pns_review(t: dict) -> bool:
    """PNS only reviews what Sales priced — never its own work."""
    return bool(t.get("needs_review")) and t.get("resp") == "Sales"


def head_for(t: dict) -> str:
    """Below the bottom rate, the head of whichever team priced it acknowledges."""
    return "PNS" if t.get("resp") == "PNS" else "Commercial"


# ------------------------------------------------------------------ identity
class User(BaseModel):
    email: str
    name: str
    group: str
    level: str
    team: str | None = None
    sso: bool = False        # True when identity came from the proxy, not DEV_USER_EMAIL


ROLE_GROUPS = ["Commercial", "PNS", "PSP", "Legal", "CSO", "Admin"]
ROLE_LEVELS = ["staff", "head"]
TEAMS = ["Team1", "Team2"]


async def current_user(request: Request) -> User:
    # The proxy header is authoritative and unspoofable while SSO is on. DEV_USER is
    # only a local-dev fallback; it must be cleared in the portal once SSO is enabled.
    sso = request.headers.get("x-forwarded-email")
    email = sso or DEV_USER
    if not email:
        raise HTTPException(401, "not signed in")
    row = await q("SELECT email, name, role_group, role_level, team FROM users "
                  "WHERE email=%s AND active=1", (email,), one=True)
    if not row:
        # Authenticated by Google but nobody has granted a role yet.
        raise HTTPException(
            403, f"{email} has no role in this app — ask an administrator to register you "
                 f"under Administration / Users")
    return User(email=row["email"], name=row["name"], group=row["role_group"],
                level=row["role_level"], team=row["team"], sso=bool(sso))


# ------------------------------------------------------------------ permissions
def can(u: User, action: str, t: dict | None = None) -> bool:
    """Single source of truth. The frontend renders from /api/me/permissions;
    every mutating route below calls this again before touching data."""
    admin = u.group == "Admin"
    com_head = admin or (u.group == "Commercial" and u.level == "head")
    pns_head = admin or (u.group == "PNS" and u.level == "head")

    if action == "headAck":
        if admin:
            return True
        if t is None:
            return com_head or pns_head
        return pns_head if head_for(t) == "PNS" else com_head

    return {
        "createTicket":     u.group == "Commercial" or admin,
        "deleteTicket":     admin,
        "restoreTicket":    admin,
        "purgeTicket":      admin,
        # Assigning a PNS owner is the Head's call on ANY ticket. It used to be gated on
        # the ticket being PNS-priced, which left Sales-priced tickets unassignable even
        # though PNS still has to review them.
        "assign":           pns_head,
        "assignReviewer":   pns_head,
        "markReviewed":     u.group == "PNS" or admin,
        "editInput":        u.group == "Commercial" or admin,
        "editAcctOrRev":    com_head,
        "setAcct":          com_head,
        "setSales":         com_head,
        "reopen":           com_head,
        "pspDecide":        u.group == "PSP" or admin,
        "vendorToggle":     u.group == "PNS" or admin,
        "sendToPsp":        u.group in ("PNS", "Commercial") or admin,
        "acceptProposal":   u.group == "Commercial" or admin,
        "sendBackProposal": u.group in ("Commercial", "PNS") or admin,
        "seeMargin":        u.group in ("PNS", "PSP", "CSO") or admin,
        "capaRaise":        u.group == "Commercial" or admin,
        "capaClose":        u.group == "Commercial" or admin,
        "capaSubmit":       u.group == "PNS" or admin,
        # Registering people and setting roles: the PNS Admin and the PNS Head, as
        # agreed. Granting the Admin group itself is narrower — see grant_admin.
        "manageUsers":      pns_head,     # pns_head already includes Admin
        "grantAdmin":       admin,
        # Pulling from Sales CRM runs under a personal API key, so whoever triggers it
        # reads with that person's Sales CRM permissions. Until a service account exists
        # it stays with one named owner — otherwise the same sync returns different
        # results depending on who pressed the button.
        "syncSalesCrm":     u.email.lower() == SYNC_OWNER_EMAIL or admin,
    }.get(action, False)


def require(u: User, action: str, t: dict | None = None) -> None:
    if not can(u, action, t):
        raise HTTPException(403, f"{u.group} ({u.level}) may not {action}")


def attach_price(u: User, t: dict) -> bool:
    """Only the side that owes the price may attach it."""
    if u.group == "Admin":
        return True
    return u.group == "PNS" if t["resp"] == "PNS" else u.group == "Commercial"


# ------------------------------------------------------------------ email
# Google Workspace SMTP relay. Everything is optional: with SMTP_HOST unset the app
# behaves exactly as it did before, in-app notifications only.
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587") or 587)
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "").strip()
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Ninja PNS").strip()
APP_URL = os.getenv("APP_URL", "").strip().rstrip("/")

log = logging.getLogger("ninja-pns.email")


def email_configured() -> bool:
    return bool(SMTP_HOST and SMTP_FROM)


def _send_sync(recipients: list[str], subject: str, text: str, html: str) -> None:
    """Blocking SMTP. Always called through a worker thread."""
    msg = EmailMessage()
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM}>"
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
        s.ehlo()
        if s.has_extn("starttls"):
            s.starttls()
            s.ehlo()
        # The Workspace relay can authenticate by IP instead, in which case there are no
        # credentials to send.
        if SMTP_USER and SMTP_PASSWORD:
            s.login(SMTP_USER, SMTP_PASSWORD)
        s.send_message(msg)


def _render(body: str, ticket_ref: str | None) -> tuple[str, str]:
    link = f"{APP_URL}/?ticket={ticket_ref}" if (APP_URL and ticket_ref) else APP_URL
    esc = (body.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    text = body + (f"\n\nOpen it: {link}\n" if link else "\n")
    text += "\nYou are getting this because it needs you specifically. " \
            "Turn it off under What's new in the app."
    html = f"""<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#0f172a">
  <p style="margin:0 0 16px">{esc}</p>
  {f'<p style="margin:0 0 24px"><a href="{link}" style="background:#EE1B2C;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open the ticket</a></p>' if link else ''}
  <p style="margin:0;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;padding-top:12px">
    You are getting this because it needs you specifically. Broadcast updates stay in the
    app. Turn this off under <b>What&#39;s new</b>.
  </p>
</div>"""
    return text, html


async def email_people(names: list[str], subject: str, body: str,
                       ticket_ref: str | None = None) -> None:
    """Resolve display names to addresses and send, honouring the opt-out.

    Never raises and never blocks the request: a relay that is down, misconfigured or
    unreachable must not stop someone attaching a price."""
    if not email_configured() or not names:
        return
    marks = ",".join(["%s"] * len(names))
    rows = await q(f"SELECT email FROM users WHERE active=1 AND email_optout=0 "
                   f"AND name IN ({marks})", tuple(names))
    to = [r["email"] for r in rows]
    if not to:
        return
    subj = f"[{ticket_ref}] {subject}" if ticket_ref and not subject.startswith("[") else subject
    text, html = _render(body, ticket_ref)

    async def go():
        try:
            await asyncio.to_thread(_send_sync, to, subj[:200], text, html)
        except Exception as exc:                      # noqa: BLE001 - never propagate
            log.warning("email to %s failed: %s", ", ".join(to), exc)

    asyncio.create_task(go())


# ------------------------------------------------------------------ helpers
async def log_note(ticket_id: int, status: str, actor: str, note: str) -> None:
    """History without a status change. Edits and reassignments belong in the timeline,
    but they must not restart status_since — that is what the SLA counts."""
    await execute("INSERT INTO ticket_history (ticket_id, status, actor, note) "
                  "VALUES (%s,%s,%s,%s)", (ticket_id, status, actor, note or None))


async def log_status(ticket_id: int, status: str, actor: str, note: str = "") -> None:
    await log_note(ticket_id, status, actor, note)
    await execute("UPDATE tickets SET status=%s, status_since=NOW() WHERE id=%s",
                  (status, ticket_id))


async def notify(body: str, groups=(), roles=(), people=(), ticket_ref: str | None = None,
                 subject: str | None = None) -> None:
    """Record a notification, and email it if it names specific people.

    `people` is the "this is aimed at you" channel — assigned, tagged, sent back. Those
    become email. `groups` and `roles` are broadcast and stay in-app only, which is the
    whole reason the mailbox stays readable."""
    await execute(
        "INSERT INTO notifications (body, ticket_ref, to_groups, to_roles, to_people) "
        "VALUES (%s,%s,%s,%s,%s)",
        (body[:500], ticket_ref,
         ",".join(groups) or None, ",".join(roles) or None, ",".join(people) or None))
    if people:
        await email_people(list(people), subject or (ticket_ref or "Ninja PNS"), body,
                           ticket_ref)


async def audit(actor: str, action: str, entity: str, entity_id: str,
                field: str = None, old=None, new=None) -> None:
    await execute(
        "INSERT INTO audit_log (actor, action, entity, entity_id, field, old_value, new_value) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (actor, action, entity, str(entity_id), field,
         None if old is None else str(old)[:500],
         None if new is None else str(new)[:500]))


async def names_in(group: str, head_only: bool = False) -> list[str]:
    sql = "SELECT name FROM users WHERE active=1 AND role_group=%s"
    args: tuple = (group,)
    if head_only:
        sql += " AND role_level='head'"
    return [r["name"] for r in await q(sql, args)]


async def owed_by(t: dict, status: str) -> list[str]:
    """Who is this ticket now waiting on, by name.

    A pending status is a queue, and queues get watched by nobody in particular. Every
    "it is back with you" notification has to land on a person, so this always resolves
    to named people — falling back to the relevant head when the slot is empty, never to
    silence. An unassigned ticket sent back to PNS used to notify no one at all.
    """
    owner, reviewer, sales = t.get("owner_name"), t.get("reviewer_name"), t.get("sales_name")

    if status == "Pending PNS":
        return [owner] if owner else await names_in("PNS", head_only=True) or await names_in("PNS")
    if status == "Pending PNS Review":
        # The assigned reviewer owns a review; otherwise it is the ticket's PNS owner.
        who = reviewer or owner
        return [who] if who else await names_in("PNS", head_only=True) or await names_in("PNS")
    if status == "Pending Sales":
        return [sales] if sales else await names_in("Commercial", head_only=True)
    if status == "Pending Vendor":
        return [owner] if owner else await names_in("PNS", head_only=True)
    if status == "Pending PSP Approval":
        return await names_in("PSP")
    if status == "Pending Head Review":
        return await names_in(head_for(t), head_only=True) or await names_in("Admin")
    return []


async def tell_owed(t: dict, status: str, actor: str, body: str, subject: str,
                    ref: str) -> None:
    """Notify whoever now owes the ticket, minus the person who just acted."""
    people = [n for n in await owed_by(t, status) if n and n != actor]
    if people:
        await notify(body, people=sorted(set(people)), ticket_ref=ref, subject=subject)


async def get_ticket(ref: str) -> dict:
    t = await q("SELECT t.*, s.name AS shipper, s.acct_type FROM tickets t "
                "JOIN shippers s ON s.id=t.shipper_id "
                "WHERE t.ticket_ref=%s AND t.deleted_at IS NULL", (ref,), one=True)
    if not t:
        raise HTTPException(404, f"{ref} not found")
    return t


def sla_days_elapsed(t: dict) -> int:
    """Days in the current status. Prefer sla_days_db, which the query computes with
    the database's own clock — the app container and OceanBase disagree about the
    local timezone, so subtracting in Python here read as -1 for fresh tickets."""
    db = t.get("sla_days_db")
    if db is not None:
        return max(0, int(db))
    since = t.get("status_since")
    if not isinstance(since, datetime):
        return 0
    return max(0, (datetime.now() - since).days)


# ------------------------------------------------------------------ response models
class Health(BaseModel):
    status: str


# Bump on every deploy. Without it there is no way to tell from the outside whether a
# PREVIEW_LIVE run actually replaced the running backend.
BUILD = "2026-07-30.15"


class Me(BaseModel):
    email: str
    name: str
    group: str
    level: str
    team: str | None
    permissions: dict[str, bool]
    build: str = BUILD
    sso: bool = False
    # True only in the unsafe combination: SSO did not identify this request, so the
    # DEV_USER_EMAIL fallback did. The frontend shows a banner; clear the variable.
    dev_fallback: bool = False


class Ticket(BaseModel):
    ref: str
    shipper: str
    acct_type: str
    service: str
    revenue: int
    status: str
    priced_by: str
    needs_review: bool
    owner: str | None
    reviewer: str | None
    sales: str | None
    region: str | None
    submitted_on: str
    sla_elapsed: int
    sla_target: int
    margin: float | None = None   # omitted for roles without seeMargin
    price_file: str | None = None
    price_url: str | None = None
    open_questions: int = 0


class TicketList(BaseModel):
    tickets: list[Ticket]
    total: int


class Stats(BaseModel):
    ongoing: int
    won: int
    lost: int
    win_rate: int | None
    total_year: int


class Ok(BaseModel):
    ok: bool
    ref: str | None = None
    status: str | None = None


# ------------------------------------------------------------------ attachments
# Uploads are capped hard because the bytes travel to OceanBase in one packet. Images are
# downscaled in the browser first, so this ceiling is really about documents.
MAX_UPLOAD = 5 * 1024 * 1024

# Only these are ever rendered inline in a browser. SVG is deliberately absent: it can
# carry script, and serving one inline from our own origin would be stored XSS.
INLINE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

DOC_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",   # xlsx
    "application/vnd.ms-excel",                                            # xls
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
    "application/msword",
    "text/csv", "text/plain",
}
ALLOWED_TYPES = INLINE_TYPES | DOC_TYPES


class TicketFile(BaseModel):
    id: int
    kind: str
    filename: str
    content_type: str
    size_bytes: int
    caption: str | None
    is_image: bool
    uploaded_by: str
    at: str
    url: str          # relative; the frontend uses it directly in <img> and <a>


class FileList(BaseModel):
    files: list[TicketFile]


def shape_file(r: dict, base: str = "/api/files") -> TicketFile:
    return TicketFile(
        id=r["id"], kind=r["kind"], filename=r["filename"],
        content_type=r["content_type"], size_bytes=int(r["size_bytes"]),
        caption=r["caption"], is_image=r["content_type"] in INLINE_TYPES,
        uploaded_by=r["uploaded_name"], at=str(r["created_at"]),
        url=f"{base}/{r['id']}")


async def read_upload(file: UploadFile) -> tuple[bytes, str]:
    """Size and type checks, shared by ticket and CAPA uploads."""
    data = await file.read()
    if not data:
        raise HTTPException(400, "that file is empty")
    if len(data) > MAX_UPLOAD:
        raise HTTPException(
            413, f"{file.filename} is {len(data) // 1024 // 1024} MB — the limit is 5 MB. "
                 f"Photos are shrunk automatically; for a big document, attach a link instead.")
    ctype = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if ctype not in ALLOWED_TYPES:
        raise HTTPException(
            415, f"{ctype} is not an accepted file type. Images (JPEG, PNG, WebP, GIF), "
                 f"PDF, Word, Excel, CSV and plain text are.")
    return data, ctype


def file_response(r: dict) -> Response:
    """Anything not on the inline allowlist is forced to download, and nosniff stops the
    browser second-guessing the type we declare."""
    inline = r["content_type"] in INLINE_TYPES
    safe_name = r["filename"].replace('"', "").replace("\r", "").replace("\n", "")
    return Response(
        content=r["data"],
        media_type=r["content_type"],
        headers={
            "Content-Disposition": f'{"inline" if inline else "attachment"}; filename="{safe_name}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=3600",
        },
    )


# ------------------------------------------------------------------ routes
@app.get("/health", response_model=Health)
def health():
    return {"status": "ok"}


@app.get("/api/me", response_model=Me)
async def me(u: User = Depends(current_user)):
    actions = ["createTicket", "deleteTicket", "restoreTicket", "purgeTicket",
               "assign", "assignReviewer", "markReviewed", "editInput", "editAcctOrRev",
               "setAcct", "setSales", "reopen", "pspDecide", "vendorToggle", "sendToPsp",
               "acceptProposal", "sendBackProposal", "seeMargin", "capaRaise",
               "capaClose", "capaSubmit", "headAck", "manageUsers", "grantAdmin"]
    return Me(email=u.email, name=u.name, group=u.group, level=u.level, team=u.team,
              permissions={a: can(u, a) for a in actions},
              sso=u.sso, dev_fallback=not u.sso and bool(DEV_USER))


def shape(t: dict, u: User) -> Ticket:
    out = Ticket(
        ref=t["ticket_ref"], shipper=t["shipper"], acct_type=t["acct_type"],
        service=t["service_type"], revenue=int(t["potential_rev"]), status=t["status"],
        priced_by=t["resp"], needs_review=needs_pns_review(t),
        owner=t["owner_name"], reviewer=t["reviewer_name"], sales=t["sales_name"],
        region=t["region"], submitted_on=str(t["submitted_on"]),
        sla_elapsed=sla_days_elapsed(t), sla_target=int(t["sla_days"]),
        price_file=t.get("price_file"), price_url=t.get("price_url"),
        open_questions=int(t.get("open_q") or 0),
    )
    # Margin is restricted at the API, not by hiding a column in the UI.
    if can(u, "seeMargin") and t.get("margin_pct") is not None:
        out.margin = float(t["margin_pct"])
    return out


@app.get("/api/tickets", response_model=TicketList)
async def list_tickets(
    u: User = Depends(current_user),
    status: str | None = None,
    service: str | None = None,
    owner: str | None = None,
    sales: str | None = None,
    submitted_from: str | None = None,
    submitted_to: str | None = None,
    search: str | None = None,
    awaiting: bool = False,
    mine: bool = False,
):
    sql = ("SELECT t.*, s.name AS shipper, s.acct_type, p.margin_pct, p.price_file, p.price_url, "
           "(SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id=t.id "
           "AND c.is_question=1 AND c.resolved_at IS NULL) AS open_q, "
           "TIMESTAMPDIFF(DAY, t.status_since, NOW()) AS sla_days_db "
           "FROM tickets t JOIN shippers s ON s.id=t.shipper_id "
           "LEFT JOIN pricing p ON p.ticket_id=t.id "
           "WHERE t.deleted_at IS NULL")
    args: list = []

    # PSP reads the whole pipeline: judging a rate needs the context around it, and PSP
    # is pulled into cross-department discussion long after approving. Their Price
    # approvals queue still filters to what needs them, so the day-to-day view is
    # unchanged — this only makes tickets findable.
    #
    # Legal stays narrow on purpose: they act on signed deals, nothing earlier. Being
    # tagged in a discussion still reaches them, because /api/tickets/{ref} is unscoped —
    # they just cannot browse the pipeline.
    if u.group == "Legal":
        sql += " AND t.status=%s"; args.append("Proposal Accepted / Ready to Ship")

    # "Mine" means the tickets this person is answerable for, which differs by role:
    # a salesperson owns what they raised, a PNS member owns what they were assigned.
    # Matching on email rather than name — names get re-typed, addresses do not.
    if mine:
        if u.group == "PNS":
            sql += " AND t.owner_name=%s"; args.append(u.name)
        else:
            sql += " AND t.sales_email=%s"; args.append(u.email)

    if awaiting:
        sql += " AND t.status IN (%s,%s,%s)"; args += list(AWAIT_STATUSES)
        # Queue by who owes the price; a vendor wait is visible to both sides.
        if u.group == "PNS":
            sql += " AND (t.resp=%s OR t.status=%s)"; args += ["PNS", "Pending Vendor"]
        elif u.group == "Commercial":
            sql += " AND (t.resp=%s OR t.status=%s)"; args += ["Sales", "Pending Vendor"]

    if status:
        marks = ",".join(["%s"] * len(status.split(",")))
        sql += f" AND t.status IN ({marks})"; args += status.split(",")
    if service:
        marks = ",".join(["%s"] * len(service.split(",")))
        sql += f" AND t.service_type IN ({marks})"; args += service.split(",")
    if owner:
        sql += " AND t.owner_name=%s" if owner != "__unassigned__" else " AND t.owner_name IS NULL"
        if owner != "__unassigned__":
            args.append(owner)
    if sales:
        sql += " AND t.sales_name=%s"; args.append(sales)
    if submitted_from:
        sql += " AND t.submitted_on >= %s"; args.append(submitted_from)
    if submitted_to:
        sql += " AND t.submitted_on <= %s"; args.append(submitted_to)
    if search:
        sql += " AND (s.name LIKE %s OR t.ticket_ref LIKE %s)"
        args += [f"%{search}%", f"%{search}%"]

    sql += " ORDER BY t.submitted_on DESC LIMIT 500"
    rows = await q(sql, tuple(args))
    return {"tickets": [shape(r, u) for r in rows], "total": len(rows)}


@app.get("/api/stats", response_model=Stats)
async def stats(u: User = Depends(current_user)):
    rows = await q("SELECT status, outcome FROM tickets WHERE deleted_at IS NULL")
    ongoing = sum(1 for r in rows if str(r["status"]).startswith(("Pending", "Proposal Submitted")))
    won = sum(1 for r in rows if r["outcome"] == "accepted")
    lost = sum(1 for r in rows if r["outcome"] == "lost")
    decided = won + lost
    return {"ongoing": ongoing, "won": won, "lost": lost,
            "win_rate": round(won * 100 / decided) if decided else None,
            "total_year": len(rows)}


class NewTicket(BaseModel):
    shipper: str
    service: str
    revenue: int
    brief: str
    sales_email: str | None = None
    acct_type: str = "Non-Strategic"
    region: str = "GJ"
    payload: dict = {}


@app.get("/api/workload")
async def workload(u: User = Depends(current_user)):
    """Who is carrying what, and how fast it clears.

    Two questions in one call because they are only useful together: a big queue on a
    fast closer is not the same problem as a small queue on a stalled one.

    Lead time is measured from first assignment to the ticket leaving PNS hands, taken
    from ticket_history rather than the ticket row — status_since only remembers the
    latest move, so it cannot answer 'how long did this take'."""
    require(u, "assign")

    pns = await q(
        "SELECT u.name, "
        "  SUM(t.status='Pending PNS') AS pending_pns, "
        "  SUM(t.status IN ('Pending PNS','Pending PNS Review','Pending Vendor')) AS open_total, "
        "  SUM(t.outcome='accepted') AS won, "
        "  SUM(t.outcome IS NOT NULL) AS decided "
        "FROM users u LEFT JOIN tickets t "
        "  ON t.owner_name=u.name AND t.deleted_at IS NULL "
        "WHERE u.role_group='PNS' AND u.active=1 "
        "GROUP BY u.name ORDER BY pending_pns DESC, u.name")

    # Median would be the honest average here, but MySQL has no median and the volumes
    # are small enough that a mean plus the worst case tells the same story.
    lead = await q(
        "SELECT t.owner_name AS name, "
        "  ROUND(AVG(TIMESTAMPDIFF(DAY, first_seen.at, done.at)),1) AS avg_days, "
        "  MAX(TIMESTAMPDIFF(DAY, first_seen.at, done.at)) AS worst_days, "
        "  COUNT(*) AS finished "
        "FROM tickets t "
        "JOIN (SELECT ticket_id, MIN(at) AS at FROM ticket_history "
        "      WHERE status='Pending PNS' GROUP BY ticket_id) first_seen "
        "  ON first_seen.ticket_id=t.id "
        "JOIN (SELECT ticket_id, MIN(at) AS at FROM ticket_history "
        "      WHERE status IN ('Proposal Submitted','Pending PNS Review') GROUP BY ticket_id) done "
        "  ON done.ticket_id=t.id AND done.at >= first_seen.at "
        "WHERE t.deleted_at IS NULL AND t.owner_name IS NOT NULL "
        "GROUP BY t.owner_name")
    lead_by = {r["name"]: r for r in lead}

    team = []
    for r in pns:
        l = lead_by.get(r["name"], {})
        team.append({
            "name": r["name"],
            "pending_pns": int(r["pending_pns"] or 0),
            "open_total": int(r["open_total"] or 0),
            "at_cap": int(r["pending_pns"] or 0) >= PNS_WIP_CAP,
            "won": int(r["won"] or 0),
            "decided": int(r["decided"] or 0),
            "avg_days_to_clear": float(l["avg_days"]) if l.get("avg_days") is not None else None,
            "worst_days_to_clear": int(l["worst_days"]) if l.get("worst_days") is not None else None,
            "finished": int(l.get("finished") or 0),
        })

    # Salespeople ranked by how much they currently have sitting on PNS. This is the
    # demand side of the same picture — a spike here explains a queue over there.
    sales = await q(
        "SELECT t.sales_name AS name, t.sales_email AS email, COUNT(*) AS open_tickets, "
        "  SUM(t.status='Pending Sales') AS waiting_on_them, "
        "  ROUND(AVG(TIMESTAMPDIFF(DAY, t.status_since, NOW())),1) AS avg_age_days "
        "FROM tickets t WHERE t.deleted_at IS NULL AND t.outcome IS NULL "
        "  AND t.sales_name IS NOT NULL "
        "GROUP BY t.sales_name, t.sales_email "
        "ORDER BY open_tickets DESC LIMIT 20")

    return {
        "cap": PNS_WIP_CAP,
        "pns": team,
        "sales": [{"name": r["name"], "email": r["email"],
                   "open_tickets": int(r["open_tickets"] or 0),
                   "waiting_on_them": int(r["waiting_on_them"] or 0),
                   "avg_age_days": float(r["avg_age_days"]) if r["avg_age_days"] is not None else None}
                  for r in sales],
    }


@app.post("/api/tickets", status_code=201, response_model=Ok)
async def create_ticket(body: NewTicket, u: User = Depends(current_user)):
    require(u, "createTicket")
    if body.service not in SERVICES:
        raise HTTPException(400, f"service must be one of {SERVICES}")

    sh = await q("SELECT id, acct_type FROM shippers WHERE name=%s", (body.shipper,), one=True)
    if sh:
        shipper_id, acct = sh["id"], sh["acct_type"]
    else:
        shipper_id = await execute(
            "INSERT INTO shippers (name, acct_type, region) VALUES (%s,%s,%s)",
            (body.shipper, body.acct_type, body.region))
        acct = body.acct_type

    r = route(acct, body.service, body.revenue)
    status = pending_for(r["resp"])
    last = await q("SELECT MAX(id) AS n FROM tickets", one=True)
    ref = f"SOF-{1300 + int((last or {}).get('n') or 0)}"

    tid = await execute(
        "INSERT INTO tickets (ticket_ref, shipper_id, service_type, potential_rev, status, "
        "resp, needs_review, sales_email, sales_name, region, submitted_on) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (ref, shipper_id, body.service, body.revenue, status, r["resp"], int(r["review"]),
         body.sales_email or u.email, u.name, body.region, date.today()))

    # Only PNS-owned tickets get an owner here. A Sales-priced ticket has no PNS work
    # yet, and pre-assigning one would put it in someone's queue before it is theirs.
    owner = await auto_assignee(body.service, tid) if r["resp"] == "PNS" else None
    if owner:
        await execute("UPDATE tickets SET owner_name=%s WHERE id=%s", (owner, tid))

    payload = dict(body.payload or {}); payload["brief"] = body.brief
    await execute("INSERT INTO ticket_input (ticket_id, payload, updated_by) VALUES (%s,%s,%s)",
                  (tid, json.dumps(payload), u.email))
    await execute("INSERT INTO ticket_history (ticket_id, status, actor, note) VALUES (%s,%s,%s,%s)",
                  (tid, status, u.name, "submitted"))
    await notify(f"New ticket {ref} — {body.shipper} ({body.service}, Rp {body.revenue:,})"
                 f" raised by {u.name}" + (f", assigned to {owner}" if owner else ""),
                 roles=["PNS - Head"] if r["resp"] == "PNS" else [],
                 groups=[] if r["resp"] == "PNS" else ["Commercial"], ticket_ref=ref)
    await audit(u.email, "create", "ticket", ref)
    return {"ok": True, "ref": ref, "status": status}


class PriceIn(BaseModel):
    price_file: str                      # human label, e.g. "Rate card - Sinar Kencana v2"
    price_url: str | None = None         # link to the spreadsheet holding the actual price
    price_size: int | None = None
    margin_pct: float | None = None
    discount_pct: float | None = None    # the lever Sameday is capped on, not margin
    below_bottom: bool = False           # manual override — still honoured alongside the guard


def clean_url(raw: str | None) -> str | None:
    """Only http(s) links are stored. Anything else — javascript:, data: — would be
    rendered as an anchor for other users to click, so it is refused outright."""
    if raw is None:
        return None
    url = raw.strip()
    if not url:
        return None
    if len(url) > 1000:
        raise HTTPException(400, "that link is too long to store (1000 characters max)")
    scheme = urlparse(url).scheme.lower()
    if scheme not in ("http", "https"):
        raise HTTPException(400, "the price link must start with http:// or https://")
    return url


@app.post("/api/tickets/{ref}/price", response_model=Ok)
async def submit_price(ref: str, body: PriceIn, u: User = Depends(current_user)):
    t = await get_ticket(ref)
    blocked = stage_blocks_work(t)
    if blocked:
        raise HTTPException(409, blocked)
    if not attach_price(u, t):
        raise HTTPException(403, f"{t['resp']} owes the price on {ref}")
    url = clean_url(body.price_url)

    await execute(
        "INSERT INTO pricing (ticket_id, price_file, price_url, price_size, margin_pct, "
        "discount_pct, priced_by, priced_at) VALUES (%s,%s,%s,%s,%s,%s,%s,NOW()) "
        "ON DUPLICATE KEY UPDATE "
        "price_file=VALUES(price_file), price_url=VALUES(price_url), "
        "price_size=VALUES(price_size), margin_pct=VALUES(margin_pct), "
        "discount_pct=VALUES(discount_pct), priced_by=VALUES(priced_by), priced_at=NOW()",
        (t["id"], body.price_file, url, body.price_size, body.margin_pct,
         body.discount_pct, u.name))

    g = guard_for(t["acct_type"], t["service_type"], int(t["potential_rev"] or 0))
    breach = guard_breached(g, body.margin_pct, body.discount_pct)
    # "Standard rate" tiers allow no deviation at all, so any declared discount is one.
    if g["kind"] == "standard" and (body.discount_pct or 0) > 0:
        breach = True
    # A margin floor is a bottom-rate question and the pricing team's own head owns it.
    # Everything else the tier can't authorise — a managed account, a band with no
    # published ceiling, a Sameday discount past 20% — is a PSP decision.
    to_psp = g["kind"] == "manual" or (breach and g["kind"] in ("discount", "standard"))

    if to_psp:
        nxt, note = "Pending PSP Approval", g["why"]
        await execute("UPDATE tickets SET manual_review=1 WHERE id=%s", (t["id"],))
        await notify(f"{ref} — price attached by {u.name}; needs PSP approval ({g['why']})",
                     groups=["PSP"], ticket_ref=ref)
    elif breach or body.below_bottom:
        nxt, note = "Pending Head Review", g["why"] or "flagged below bottom rate"
        await execute("UPDATE tickets SET below_bottom=1 WHERE id=%s", (t["id"],))
        await notify(f"{ref} — price attached by {u.name} and flagged BELOW BOTTOM RATE"
                     f" ({g['why']})",
                     roles=[f"{head_for(t)} - Head"], ticket_ref=ref)
    elif needs_pns_review(t):
        nxt, note = "Pending PNS Review", ""
        await notify(f"{ref} — priced by Sales, needs PNS review",
                     roles=["PNS - Head"], groups=["PNS"], ticket_ref=ref)
    else:
        nxt, note = "Proposal Submitted", ""
        await notify(f"{ref} — {t['shipper']}: proposal is ready",
                     groups=["Commercial"], ticket_ref=ref)

    await log_status(t["id"], nxt, u.name, note)
    await audit(u.email, "price", "ticket", ref, "price_file", None, body.price_file)
    return {"ok": True, "ref": ref, "status": nxt}


class StatusIn(BaseModel):
    status: str
    reason: str | None = None
    loss_reason: str | None = None


@app.post("/api/tickets/{ref}/status", response_model=Ok)
async def change_status(ref: str, body: StatusIn, u: User = Depends(current_user)):
    t = await get_ticket(ref)
    nxt = body.status
    is_lost = nxt == "Lost"

    if is_lost:
        require(u, "acceptProposal")           # Sales owns the shipper outcome
        if body.loss_reason not in LOSS_REASONS:
            raise HTTPException(400, f"loss_reason must be one of {LOSS_REASONS}")
    elif nxt == "Proposal Accepted / Ready to Ship":
        require(u, "acceptProposal")
    else:
        require(u, "sendBackProposal")
        # A send-back needs a reason; marking Lost carries its own.
        if not body.reason:
            raise HTTPException(400, f"a reason is required to send {ref} back to {nxt}")
        # Only the FTL lines ever wait on a vendor quote — the rest are priced off
        # Ninja's own network, so there is no vendor to wait for.
        if nxt == "Pending Vendor" and t["service_type"] not in VENDOR_SERVICES:
            raise HTTPException(
                400, f"{t['service_type']} is not priced through a vendor — "
                     f"only {' and '.join(VENDOR_SERVICES)} can wait on vendor cost")
        if nxt == "Pending PNS":
            await execute("UPDATE tickets SET resp='PNS' WHERE id=%s", (t["id"],))
        elif nxt == "Pending Sales":
            await execute("UPDATE tickets SET resp='Sales' WHERE id=%s", (t["id"],))

    if is_lost:
        await execute("UPDATE tickets SET outcome='lost', loss_reason=%s WHERE id=%s",
                      (body.loss_reason, t["id"]))
    elif nxt == "Proposal Accepted / Ready to Ship":
        await execute("UPDATE tickets SET outcome='accepted' WHERE id=%s", (t["id"],))
        await notify(f"{ref} — {t['shipper']} ACCEPTED. Contract needed.",
                     groups=["Legal", "PNS", "Commercial"], ticket_ref=ref)

    else:
        # A send-back told nobody at all before this: the ticket just reappeared in a
        # queue. resp has already been rewritten above, so pass the new value through.
        await tell_owed({**t, "resp": "PNS" if nxt.startswith("Pending PNS") else "Sales"},
                        nxt, u.name,
                        f"{ref} — {t['shipper']} was sent back to {nxt} by {u.name}: {body.reason}",
                        f"Sent back to you — {t['shipper']}", ref)

    await log_status(t["id"], nxt, u.name, body.reason or body.loss_reason or "")
    await audit(u.email, "status", "ticket", ref, "status", t["status"], nxt)
    return {"ok": True, "ref": ref, "status": nxt}


class AssignIn(BaseModel):
    """Either or both. Pass an empty string to clear one."""
    owner: str | None = None
    reviewer: str | None = None


@app.post("/api/tickets/{ref}/assign", response_model=Ok)
async def assign(ref: str, body: AssignIn, u: User = Depends(current_user)):
    t = await get_ticket(ref)
    if body.owner is None and body.reviewer is None:
        raise HTTPException(400, "pass an owner, a reviewer, or both")

    notes = []
    if body.owner is not None:
        require(u, "assign", t)
        owner = body.owner.strip() or None
        await execute("UPDATE tickets SET owner_name=%s WHERE id=%s", (owner, t["id"]))
        await audit(u.email, "assign", "ticket", ref, "owner", t["owner_name"], owner)
        if owner:
            notes.append(f"assigned to {owner}")
            await notify(f"{ref} — {t['shipper']} assigned to you by {u.name}",
                         people=[owner], ticket_ref=ref)
        else:
            notes.append("owner cleared")

    if body.reviewer is not None:
        require(u, "assignReviewer", t)
        reviewer = body.reviewer.strip() or None
        await execute("UPDATE tickets SET reviewer_name=%s WHERE id=%s", (reviewer, t["id"]))
        await audit(u.email, "assign", "ticket", ref, "reviewer", t["reviewer_name"], reviewer)
        if reviewer:
            notes.append(f"{reviewer} will review the price")
            await notify(f"{ref} — {t['shipper']}: you were asked to review the price",
                         people=[reviewer], ticket_ref=ref)
        else:
            notes.append("reviewer cleared")

    await log_note(t["id"], t["status"], u.name, "; ".join(notes))
    return {"ok": True, "ref": ref, "status": t["status"]}


class InputPatch(BaseModel):
    """Correcting a ticket after submission. Commercial and Admin may edit the intake;
    account type and potential revenue additionally need editAcctOrRev, because both
    change who owes the price."""
    payload: dict | None = None
    service: str | None = None
    revenue: int | None = None
    acct_type: str | None = None


@app.patch("/api/tickets/{ref}/input", response_model=Ok)
async def edit_input(ref: str, body: InputPatch, u: User = Depends(current_user)):
    require(u, "editInput")
    t = await get_ticket(ref)

    service = body.service or t["service_type"]
    if service not in SERVICES:
        raise HTTPException(400, f"service must be one of {SERVICES}")
    revenue = t["potential_rev"] if body.revenue is None else int(body.revenue)
    if revenue < 0:
        raise HTTPException(400, "potential revenue cannot be negative")
    acct = body.acct_type or t["acct_type"]
    if acct not in ACCT_TYPES:
        raise HTTPException(400, f"account type must be one of {ACCT_TYPES}")

    routing_changed = (acct != t["acct_type"] or int(revenue) != int(t["potential_rev"]))
    if routing_changed:
        require(u, "editAcctOrRev")

    changes = []
    if body.payload is not None:
        row = await q("SELECT payload FROM ticket_input WHERE ticket_id=%s", (t["id"],), one=True)
        current = {}
        if row and row["payload"]:
            current = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"])
        merged = {**current, **body.payload}
        if row:
            await execute("UPDATE ticket_input SET payload=%s, updated_by=%s WHERE ticket_id=%s",
                          (json.dumps(merged), u.email, t["id"]))
        else:
            await execute("INSERT INTO ticket_input (ticket_id, payload, updated_by) "
                          "VALUES (%s,%s,%s)", (t["id"], json.dumps(merged), u.email))
        edited = [k for k, v in body.payload.items() if current.get(k) != v]
        if edited:
            changes.append("intake fields: " + ", ".join(sorted(edited)[:8]))

    if service != t["service_type"]:
        changes.append(f"service {t['service_type']} to {service}")
    if int(revenue) != int(t["potential_rev"]):
        changes.append(f"revenue Rp {int(t['potential_rev']):,} to Rp {int(revenue):,}")
    if acct != t["acct_type"]:
        changes.append(f"account type {t['acct_type']} to {acct}")
        await execute("UPDATE shippers SET acct_type=%s, status_changed_by=%s, "
                      "status_changed_at=NOW() WHERE id=%s", (acct, u.name, t["shipper_id"]))

    if not changes:
        return {"ok": True, "ref": ref, "status": t["status"]}

    # Re-run the routing rule on the corrected facts. Status is deliberately left alone:
    # a correction should not yank the ticket out of the queue it is sitting in.
    r = route(acct, service, int(revenue))
    if service != t["service_type"] or routing_changed:
        await execute("UPDATE tickets SET service_type=%s, potential_rev=%s, resp=%s, "
                      "needs_review=%s WHERE id=%s",
                      (service, int(revenue), r["resp"], int(r["review"]), t["id"]))
        if r["resp"] != t["resp"] or bool(r["review"]) != bool(t["needs_review"]):
            changes.append(f"now priced by {r['resp']}"
                           + (", PNS review required" if r["review"] else ""))

    note = f"edited by {u.name} — " + "; ".join(changes)
    await log_note(t["id"], t["status"], u.name, note[:500])
    await audit(u.email, "edit", "ticket", ref, "input", None, "; ".join(changes)[:500])
    await notify(f"{ref} — {t['shipper']}: {note}",
                 groups=["PNS", "Commercial"], ticket_ref=ref)
    return {"ok": True, "ref": ref, "status": t["status"]}


class SalesIn(BaseModel):
    name: str


@app.post("/api/tickets/{ref}/sales", response_model=Ok)
async def change_sales(ref: str, body: SalesIn, u: User = Depends(current_user)):
    """Hand the ticket to a different salesperson. Commercial Head only."""
    require(u, "setSales")
    t = await get_ticket(ref)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "pick a salesperson")
    if name == (t["sales_name"] or ""):
        return {"ok": True, "ref": ref, "status": t["status"]}

    row = await q("SELECT email FROM users WHERE name=%s AND active=1", (name,), one=True)
    await execute("UPDATE tickets SET sales_name=%s, sales_email=%s WHERE id=%s",
                  (name, (row or {}).get("email"), t["id"]))
    await log_note(t["id"], t["status"], u.name,
                   f"sales PIC changed from {t['sales_name'] or 'unassigned'} to {name}")
    await notify(f"{ref} — {t['shipper']} reassigned to you by {u.name}",
                 people=[name], ticket_ref=ref)
    await audit(u.email, "reassign", "ticket", ref, "sales", t["sales_name"], name)
    return {"ok": True, "ref": ref, "status": t["status"]}


class ReopenIn(BaseModel):
    status: str


@app.post("/api/tickets/{ref}/reopen", response_model=Ok)
async def reopen(ref: str, body: ReopenIn, u: User = Depends(current_user)):
    """Put a lost or cancelled deal back into the pipeline. Commercial Head only."""
    require(u, "reopen")
    t = await get_ticket(ref)
    if t["status"] not in ("Lost", "Cancel"):
        raise HTTPException(400, f"{ref} is {t['status']} — only Lost or Cancel can be reopened")
    if body.status not in PENDING_STATUSES:
        raise HTTPException(400, f"reopen into one of {PENDING_STATUSES}")

    resp = "PNS" if body.status in ("Pending PNS", "Pending PNS Review") else "Sales"
    await execute("UPDATE tickets SET outcome=NULL, loss_reason=NULL, resp=%s WHERE id=%s",
                  (resp, t["id"]))
    await log_status(t["id"], body.status, u.name, "reopened by Commercial Head")
    await notify(f"{ref} — {t['shipper']} reopened as {body.status} by {u.name}",
                 groups=["PNS", "Commercial"], ticket_ref=ref)
    await audit(u.email, "reopen", "ticket", ref, "status", t["status"], body.status)
    return {"ok": True, "ref": ref, "status": body.status}


@app.post("/api/tickets/{ref}/head-ack", response_model=Ok)
async def head_ack(ref: str, u: User = Depends(current_user)):
    t = await get_ticket(ref)
    require(u, "headAck", t)   # the head of the team that priced it — not the other one
    nxt = "Pending PNS Review" if needs_pns_review(t) else "Proposal Submitted"
    await log_status(t["id"], nxt, u.name, "below bottom rate acknowledged")
    await execute("INSERT INTO approvals (ticket_id, kind, decision, actor, actor_role) "
                  "VALUES (%s,'head_ack','approved',%s,%s)", (t["id"], u.name, u.group))
    return {"ok": True, "ref": ref, "status": nxt}


class SignoffIn(BaseModel):
    done: bool
    note: str | None = None


@app.post("/api/tickets/{ref}/exec-signoff", response_model=Ok)
async def exec_signoff(ref: str, body: SignoffIn, u: User = Depends(current_user)):
    """Record that Alex (CSalesO) and Dhinesh (COO) have signed off the solution.

    The approval itself happens over email for now — this only records that it
    happened, so the charter can state it and the audit trail is not a gap. Managed
    accounts only; nothing else needs an executive sign-off."""
    t = await get_ticket(ref)
    if t["acct_type"] not in MANAGED_ACCTS:
        raise HTTPException(400, f"{ref} is {t['acct_type']} — executive sign-off applies "
                                 f"to {' and '.join(MANAGED_ACCTS)} accounts only")
    require(u, "markReviewed")
    await execute("UPDATE tickets SET exec_signoff=%s, exec_signoff_by=%s, "
                  "exec_signoff_at=%s WHERE id=%s",
                  (int(body.done), u.name if body.done else None,
                   datetime.now() if body.done else None, t["id"]))
    await log_note(t["id"], t["status"], u.name,
                   ("executive sign-off recorded" if body.done
                    else "executive sign-off withdrawn")
                   + (f" — {body.note}" if body.note else ""))
    await audit(u.email, "exec_signoff", "ticket", ref, "exec_signoff",
                str(t.get("exec_signoff")), str(int(body.done)))
    return {"ok": True, "ref": ref, "status": t["status"]}


@app.get("/api/tickets/{ref}/signoff-draft")
async def signoff_draft(ref: str, u: User = Depends(current_user)):
    """A ready-to-send draft for the sign-off email PNS currently writes by hand.

    Returned as text for the author to copy, edit and send from their own mailbox —
    the app does not send it. An approval this senior should leave the building from a
    person's own address, and PNS routinely adds context no template can guess."""
    t = await get_ticket(ref)
    if t["acct_type"] not in MANAGED_ACCTS:
        raise HTTPException(400, f"{ref} is {t['acct_type']} — no executive sign-off needed")
    row = await q("SELECT payload FROM ticket_input WHERE ticket_id=%s", (t["id"],), one=True)
    p = {}
    if row and row["payload"]:
        p = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"])
    pr = await q("SELECT price_url, margin_pct, discount_pct FROM pricing WHERE ticket_id=%s",
                 (t["id"],), one=True) or {}

    def line(label, value):
        return f"{label}: {value}" if value not in (None, "", "-") else None

    body = [
        f"Subject: Solution sign-off — {t['shipper']} ({t['service_type']}) — {ref}",
        "",
        "Hi Alex, Dhinesh,",
        "",
        f"Requesting your sign-off on the solution below. {t['shipper']} is a "
        f"{t['acct_type']} account.",
        "",
        *filter(None, [
            line("Ticket", ref),
            line("Shipper", t["shipper"]),
            line("Account type", t["acct_type"]),
            line("Service", t["service_type"]),
            line("Potential revenue", f"Rp {int(t['potential_rev'] or 0):,}"),
            line("Pickup", p.get("pickup")),
            line("Destination", p.get("dest")),
            line("Volume", p.get("volume")),
            line("Frequency", p.get("freq")),
            line("Target go-live", p.get("golive")),
            line("Margin", f"{pr.get('margin_pct')}%" if pr.get("margin_pct") is not None else None),
            line("Discount", f"{pr.get('discount_pct')}%" if pr.get("discount_pct") is not None else None),
            line("Pricing sheet", pr.get("price_url")),
        ]),
        "",
        "Summary of the requirement:",
        (p.get("brief") or "(add the brief here)").strip(),
        "",
        "Please reply to confirm and I will record the sign-off against the ticket.",
        "",
        f"Thanks,\n{u.name}",
    ]
    return {"ref": ref, "to": ["Alex (CSalesO)", "Dhinesh (COO)"],
            "subject": f"Solution sign-off — {t['shipper']} ({t['service_type']}) — {ref}",
            "body": "\n".join(body)}


class PspIn(BaseModel):
    approve: bool
    note: str | None = None


@app.post("/api/tickets/{ref}/psp", response_model=Ok)
async def psp_decide(ref: str, body: PspIn, u: User = Depends(current_user)):
    require(u, "pspDecide")
    t = await get_ticket(ref)
    if body.approve:
        nxt = "Proposal Submitted"
    else:
        if not body.note:
            raise HTTPException(400, "a note is required to reject a price")
        nxt = pending_for(t["resp"])
    await log_status(t["id"], nxt, "PSP", body.note or "price approved")
    await execute("INSERT INTO approvals (ticket_id, kind, decision, actor, actor_role, note) "
                  "VALUES (%s,'psp',%s,%s,'PSP',%s)",
                  (t["id"], "approved" if body.approve else "rejected", u.name, body.note))
    await notify(f"{ref} — PSP {'approved' if body.approve else 'rejected'} the price"
                 f"{': ' + body.note if body.note else ''}",
                 groups=[t["resp"] == "PNS" and "PNS" or "Commercial"], ticket_ref=ref)
    if not body.approve:
        # A rejection puts the ticket back on whoever priced it — same rule as a send-back.
        await tell_owed(t, nxt, u.name,
                        f"{ref} — {t['shipper']}: PSP rejected the price. {body.note}",
                        f"Price rejected — {t['shipper']}", ref)
    return {"ok": True, "ref": ref, "status": nxt}


@app.delete("/api/tickets/{ref}", response_model=Ok)
async def soft_delete(ref: str, u: User = Depends(current_user)):
    require(u, "deleteTicket")   # PNS Admin only
    t = await get_ticket(ref)
    await execute("UPDATE tickets SET deleted_at=NOW(), deleted_by=%s WHERE id=%s",
                  (u.name, t["id"]))
    await audit(u.email, "delete", "ticket", ref)
    return {"ok": True, "ref": ref}


@app.post("/api/tickets/{ref}/restore", response_model=Ok)
async def restore(ref: str, u: User = Depends(current_user)):
    require(u, "restoreTicket")
    await execute("UPDATE tickets SET deleted_at=NULL, deleted_by=NULL WHERE ticket_ref=%s", (ref,))
    await audit(u.email, "restore", "ticket", ref)
    await notify(f"{ref} was restored by {u.name}", groups=["PNS", "Commercial"], ticket_ref=ref)
    return {"ok": True, "ref": ref}


@app.delete("/api/tickets/{ref}/purge", response_model=Ok)
async def purge(ref: str, u: User = Depends(current_user)):
    """Erase a ticket from the recycle bin for good, with its history, intake and pricing
    (the foreign keys cascade). Admin only, and only from the bin — there is deliberately
    no way to hard-delete a live ticket in one step."""
    require(u, "purgeTicket")
    t = await q("SELECT id, deleted_at FROM tickets WHERE ticket_ref=%s", (ref,), one=True)
    if not t:
        raise HTTPException(404, f"{ref} not found")
    if not t["deleted_at"]:
        raise HTTPException(400, f"{ref} is still live — move it to the recycle bin first")
    await execute("DELETE FROM tickets WHERE id=%s", (t["id"],))
    await audit(u.email, "purge", "ticket", ref)
    return {"ok": True, "ref": ref}


class Options(BaseModel):
    remembered: dict[str, list[str]]
    sales: list[str]
    shippers: list[str]
    loss_reasons: list[str]
    pending_statuses: list[str]


@app.get("/api/options", response_model=Options)
async def options(u: User = Depends(current_user)):
    """Values the intake form suggests. `remembered` is built from what people have
    actually typed on past tickets, so a one-off commodity becomes a suggestion for
    everyone next time instead of being lost."""
    seeds = {
        "commodity": ["FMCG", "Plastic", "Electronics", "Textile", "Chemical",
                      "Pharmaceutical / medicine", "Automotive parts", "Food & beverage"],
        "pallet": ["Non palletized", "Palletized", "Wooden case"],
        "destType": ["GT", "MT", "Factory", "DC", "Port", "Warehouse"],
        "truck": ["BV", "CDE", "CDEL", "CDD", "CDDL", "FUSO", "WB"],
        "product": [],
        "freq": [],
    }
    found: dict[str, set[str]] = {k: set() for k in REMEMBERED_FIELDS}
    for row in await q("SELECT payload FROM ticket_input"):
        p = row["payload"]
        if not p:
            continue
        p = p if isinstance(p, dict) else json.loads(p)
        for k in REMEMBERED_FIELDS:
            v = str(p.get(k) or "").strip()
            if v and len(v) <= 80:
                found[k].add(v)

    remembered = {
        k: sorted(found[k] | set(seeds.get(k, [])), key=str.casefold)
        for k in REMEMBERED_FIELDS
    }
    sales = [r["name"] for r in await q(
        "SELECT name FROM users WHERE active=1 AND role_group IN ('Commercial','Admin') "
        "ORDER BY role_level DESC, name")]
    shippers = [r["name"] for r in await q("SELECT name FROM shippers ORDER BY name")]
    return {"remembered": remembered, "sales": sales, "shippers": shippers,
            "loss_reasons": LOSS_REASONS, "pending_statuses": PENDING_STATUSES}


class HistoryEntry(BaseModel):
    status: str
    actor: str
    note: str | None
    at: str


class TicketDetail(BaseModel):
    ticket: Ticket
    input: dict
    input_cleared: bool
    history: list[HistoryEntry]
    price_file: str | None
    price_url: str | None = None
    open_questions: int = 0
    cost: float | None = None        # restricted
    margin: float | None = None      # restricted
    bottom_margin: float | None = None
    rate_card: str | None = None


RATE_CARDS = {
    "LTL": "Published LTL Rates — 1 December 2025 (Commercial Head + PNS only)",
    "B2BR": "[ID] Ninja Xpress 2025 Rate Card — B2BR",
    "B2C": "[ID] Ninja Xpress 2025 Rate Card — B2BR (B2C prices off this card)",
    "FTL on-call": "[ID] Ninja Xpress 2026 Rate Card FTL",
    "FTL monthly": "FTL monthly — PNS costing (no published card)",
    "Sameday": "Sameday calculator",
}


@app.get("/api/tickets/deleted", response_model=TicketList)
async def list_deleted(u: User = Depends(current_user)):
    """The recycle bin. Admin only — deleted tickets keep their history."""
    require(u, "restoreTicket")
    rows = await q(
        "SELECT t.*, s.name AS shipper, s.acct_type, p.margin_pct, p.price_file, p.price_url, "
           "(SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id=t.id "
           "AND c.is_question=1 AND c.resolved_at IS NULL) AS open_q, "
        "TIMESTAMPDIFF(DAY, t.status_since, NOW()) AS sla_days_db "
        "FROM tickets t JOIN shippers s ON s.id=t.shipper_id "
        "LEFT JOIN pricing p ON p.ticket_id=t.id "
        "WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC")
    return {"tickets": [shape(r, u) for r in rows], "total": len(rows)}


@app.get("/api/tickets/{ref}", response_model=TicketDetail)
async def ticket_detail(ref: str, u: User = Depends(current_user)):
    """Everything one ticket knows about itself, filtered by what the caller may see."""
    t = await q("SELECT t.*, s.name AS shipper, s.acct_type, p.margin_pct, p.cost, "
                "p.price_file, p.price_url, TIMESTAMPDIFF(DAY, t.status_since, NOW()) AS sla_days_db, "
                "(SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id=t.id "
                "AND c.is_question=1 AND c.resolved_at IS NULL) AS open_q "
                "FROM tickets t JOIN shippers s ON s.id=t.shipper_id "
                "LEFT JOIN pricing p ON p.ticket_id=t.id "
                "WHERE t.ticket_ref=%s AND t.deleted_at IS NULL", (ref,), one=True)
    if not t:
        raise HTTPException(404, f"{ref} not found")

    inp = await q("SELECT payload, cleared_at FROM ticket_input WHERE ticket_id=%s",
                  (t["id"],), one=True)
    payload = {}
    if inp and inp["payload"]:
        payload = inp["payload"] if isinstance(inp["payload"], dict) else json.loads(inp["payload"])

    hist = await q("SELECT status, actor, note, at FROM ticket_history "
                   "WHERE ticket_id=%s ORDER BY at DESC, id DESC", (t["id"],))

    out = TicketDetail(
        ticket=shape(t, u),
        input=payload,
        input_cleared=bool(inp and inp["cleared_at"]),
        history=[HistoryEntry(status=h["status"], actor=h["actor"],
                              note=h["note"], at=str(h["at"])) for h in hist],
        price_file=t.get("price_file"), price_url=t.get("price_url"),
        open_questions=int(t.get("open_q") or 0),
        rate_card=RATE_CARDS.get(t["service_type"]),
    )
    # Cost and margin never leave the server for roles without seeMargin.
    if can(u, "seeMargin"):
        out.cost = float(t["cost"]) if t.get("cost") is not None else None
        out.margin = float(t["margin_pct"]) if t.get("margin_pct") is not None else None
        out.bottom_margin = BOTTOM_MARGIN.get(t["service_type"])
    return out


# ------------------------------------------------------------------ CAPA
class Capa(BaseModel):
    ref: str
    shipper: str
    services: list[str]
    issue: str
    status: str
    assignee: str | None
    proposal: str | None
    raised_by: str
    submitted_on: str
    link_url: str | None = None
    file_count: int = 0


class CapaList(BaseModel):
    capa: list[Capa]


@app.get("/api/capa", response_model=CapaList)
async def list_capa(u: User = Depends(current_user), status: str | None = None):
    sql = ("SELECT c.*, (SELECT COUNT(*) FROM capa_files f WHERE f.capa_id=c.id) AS n_files "
           "FROM capa c")
    args: tuple = ()
    if status:
        sql += " WHERE c.status=%s"; args = (status,)
    sql += " ORDER BY c.submitted_on DESC"
    rows = await q(sql, args)
    return {"capa": [Capa(ref=r["capa_ref"], shipper=r["shipper_name"],
                          services=str(r["services"]).split(","), issue=r["issue"],
                          status=r["status"], assignee=r["assignee"],
                          proposal=r["proposal"], raised_by=r["raised_by"],
                          submitted_on=str(r["submitted_on"]),
                          link_url=r.get("link_url"),
                          file_count=int(r.get("n_files") or 0)) for r in rows]}


class NewCapa(BaseModel):
    shipper: str
    services: list[str]
    issue: str
    trid_samples: str | None = None
    link_url: str | None = None


@app.post("/api/capa", status_code=201, response_model=Ok)
async def raise_capa(body: NewCapa, u: User = Depends(current_user)):
    require(u, "capaRaise")
    if not body.services:
        raise HTTPException(400, "at least one service type is required")
    last = await q("SELECT MAX(id) AS n FROM capa", one=True)
    ref = f"CAPA-{43 + int((last or {}).get('n') or 0):03d}"
    await execute(
        "INSERT INTO capa (capa_ref, shipper_name, services, issue, trid_samples, "
        "link_url, raised_by, raised_by_email, submitted_on) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (ref, body.shipper, ",".join(body.services), body.issue, body.trid_samples,
         clean_url(body.link_url), u.name, u.email, date.today()))
    await notify(f"New CAPA {ref} — {body.shipper} raised by {u.name}",
                 groups=["PNS"], roles=["PNS - Head"])
    return {"ok": True, "ref": ref}


async def get_capa(ref: str) -> dict:
    c = await q("SELECT * FROM capa WHERE capa_ref=%s", (ref,), one=True)
    if not c:
        raise HTTPException(404, f"{ref} not found")
    return c


@app.get("/api/capa/{ref}/files", response_model=FileList)
async def list_capa_files(ref: str, u: User = Depends(current_user)):
    c = await get_capa(ref)
    rows = await q("SELECT id, kind, filename, content_type, size_bytes, caption, "
                   "uploaded_name, created_at FROM capa_files WHERE capa_id=%s "
                   "ORDER BY kind, created_at", (c["id"],))
    return {"files": [shape_file(r, "/api/capa-files") for r in rows]}


@app.post("/api/capa/{ref}/files", status_code=201, response_model=Ok)
async def upload_capa_file(
    ref: str,
    file: UploadFile = FastFile(...),
    kind: str = Form("evidence"),
    caption: str | None = Form(None),
    u: User = Depends(current_user),
):
    """Evidence for a corrective action — a photo of the damage, a screenshot, a report.
    Open to every group, same reasoning as ticket attachments."""
    c = await get_capa(ref)
    if kind not in ("evidence", "document"):
        raise HTTPException(400, "kind must be evidence or document")
    data, ctype = await read_upload(file)

    await execute(
        "INSERT INTO capa_files (capa_id, kind, filename, content_type, size_bytes, "
        "caption, data, uploaded_email, uploaded_name) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (c["id"], kind, (file.filename or "attachment")[:255], ctype, len(data),
         (caption or None), data, u.email, u.name))

    people = {n for n in (c["assignee"], c["raised_by"]) if n} - {u.name}
    if people:
        await notify(f"{u.name} attached {file.filename} to {ref} — {c['shipper_name']}",
                     people=sorted(people))
    await audit(u.email, "upload", "capa", ref, "file", None, file.filename)
    return {"ok": True, "ref": ref, "status": f"{file.filename} attached"}


@app.get("/api/capa-files/{fid}")
async def get_capa_file(fid: int, u: User = Depends(current_user)):
    r = await q("SELECT filename, content_type, data FROM capa_files WHERE id=%s",
                (fid,), one=True)
    if not r:
        raise HTTPException(404, "no such file")
    return file_response(r)


@app.delete("/api/capa-files/{fid}", response_model=Ok)
async def delete_capa_file(fid: int, u: User = Depends(current_user)):
    r = await q("SELECT f.id, f.filename, f.uploaded_email, c.capa_ref FROM capa_files f "
                "JOIN capa c ON c.id=f.capa_id WHERE f.id=%s", (fid,), one=True)
    if not r:
        raise HTTPException(404, "no such file")
    if r["uploaded_email"] != u.email and u.group != "Admin":
        raise HTTPException(403, "only the person who uploaded it, or an Admin, can remove it")
    await execute("DELETE FROM capa_files WHERE id=%s", (fid,))
    await audit(u.email, "delete", "capa", r["capa_ref"], "file", r["filename"], None)
    return {"ok": True, "ref": r["capa_ref"]}


class CapaProposal(BaseModel):
    assignee: str
    proposal: str
    link_url: str | None = None


@app.post("/api/capa/{ref}/submit", response_model=Ok)
async def submit_capa(ref: str, body: CapaProposal, u: User = Depends(current_user)):
    require(u, "capaSubmit")
    if not body.proposal.strip():
        raise HTTPException(400, "describe the proposal before submitting")
    link = clean_url(body.link_url)
    if link:
        await execute("UPDATE capa SET link_url=%s WHERE capa_ref=%s", (link, ref))
    await execute("UPDATE capa SET assignee=%s, proposal=%s, status='Submitted' "
                  "WHERE capa_ref=%s", (body.assignee, body.proposal, ref))
    await notify(f"{ref} — PNS submitted a CAPA proposal", groups=["Commercial"])
    return {"ok": True, "ref": ref, "status": "Submitted"}


@app.post("/api/capa/{ref}/close", response_model=Ok)
async def close_capa(ref: str, u: User = Depends(current_user)):
    require(u, "capaClose")
    await execute("UPDATE capa SET status='CAPA Closed', closed_by=%s, closed_at=NOW() "
                  "WHERE capa_ref=%s", (u.name, ref))
    await notify(f"{ref} — CAPA closed by {u.name}", groups=["PNS"])
    return {"ok": True, "ref": ref, "status": "CAPA Closed"}


# ------------------------------------------------------------------ users & roles
# Registering a person here is what lets them past the "no role assigned" wall. SSO
# proves who they are; this table decides what they may do.
class UserRow(BaseModel):
    email: str
    name: str
    group: str
    level: str
    team: str | None
    active: bool
    created_at: str
    is_self: bool = False


class UserList(BaseModel):
    users: list[UserRow]
    groups: list[str]
    levels: list[str]
    teams: list[str]


class NameList(BaseModel):
    names: list[str]


class NewUser(BaseModel):
    email: str
    name: str
    group: str
    level: str = "staff"
    team: str | None = None


class UserPatch(BaseModel):
    name: str | None = None
    group: str | None = None
    level: str | None = None
    team: str | None = None
    active: bool | None = None


def clean_user_fields(group: str | None, level: str | None, team: str | None):
    """Validate the role triple and normalise team, which only Commercial carries."""
    if group is not None and group not in ROLE_GROUPS:
        raise HTTPException(400, f"group must be one of {ROLE_GROUPS}")
    if level is not None and level not in ROLE_LEVELS:
        raise HTTPException(400, f"level must be one of {ROLE_LEVELS}")
    if team not in (None, "", *TEAMS):
        raise HTTPException(400, f"team must be one of {TEAMS}")
    if group != "Commercial":
        return None                      # team is a Commercial-only concept
    if not team:
        raise HTTPException(400, "Commercial users need a team: Team1 (GJ/WJ) or Team2 (EJ/CJ)")
    return team


async def active_admin_count() -> int:
    row = await q("SELECT COUNT(*) AS n FROM users WHERE role_group='Admin' AND active=1",
                  one=True)
    return int((row or {}).get("n") or 0)


def shape_user(r: dict, u: User) -> UserRow:
    return UserRow(email=r["email"], name=r["name"], group=r["role_group"],
                   level=r["role_level"], team=r["team"], active=bool(r["active"]),
                   created_at=str(r["created_at"])[:10], is_self=r["email"] == u.email)


@app.get("/api/users", response_model=UserList)
async def list_users(u: User = Depends(current_user)):
    """Everyone with access to the app, for the Administration screen."""
    require(u, "manageUsers")
    rows = await q("SELECT email, name, role_group, role_level, team, active, created_at "
                   "FROM users ORDER BY active DESC, role_group, role_level DESC, name")
    return {"users": [shape_user(r, u) for r in rows],
            "groups": ROLE_GROUPS, "levels": ROLE_LEVELS, "teams": TEAMS}


@app.get("/api/users/assignable", response_model=NameList)
async def assignable_users(u: User = Depends(current_user)):
    """Names that can own a ticket or a CAPA: active PNS members, plus Admin accounts
    (Admin is a superset of PNS and does solutioning work too). Any signed-in user may
    read this — the assignee dropdowns need it, and a staff list is not sensitive."""
    rows = await q("SELECT name FROM users WHERE active=1 "
                   "AND role_group IN ('PNS','Admin') ORDER BY role_level DESC, name")
    return {"names": [r["name"] for r in rows]}


class DirEntry(BaseModel):
    email: str
    name: str
    group: str


class Directory(BaseModel):
    people: list[DirEntry]


@app.get("/api/users/directory", response_model=Directory)
async def directory(u: User = Depends(current_user)):
    """Everyone you can tag in a ticket discussion. Readable by any signed-in user —
    tagging by email is the point, and a colleague list is not sensitive internally.
    Roles are not exposed beyond the group label."""
    rows = await q("SELECT email, name, role_group FROM users WHERE active=1 "
                   "ORDER BY role_group, name")
    return {"people": [DirEntry(email=r["email"], name=r["name"], group=r["role_group"])
                       for r in rows]}


@app.post("/api/users", status_code=201, response_model=Ok)
async def register_user(body: NewUser, u: User = Depends(current_user)):
    require(u, "manageUsers")
    email = body.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(400, "that does not look like an email address")
    if not body.name.strip():
        raise HTTPException(400, "name is required")
    if body.group == "Admin":
        require(u, "grantAdmin")
    team = clean_user_fields(body.group, body.level, body.team)

    if await q("SELECT email FROM users WHERE email=%s", (email,), one=True):
        raise HTTPException(409, f"{email} is already registered — edit that row instead")

    await execute("INSERT INTO users (email, name, role_group, role_level, team, active) "
                  "VALUES (%s,%s,%s,%s,%s,1)",
                  (email, body.name.strip(), body.group, body.level, team))
    await audit(u.email, "register", "user", email, "role",
                None, f"{body.group}/{body.level}")
    await notify(f"{body.name.strip()} was given {body.group} access by {u.name}",
                 groups=["PNS"], roles=["PNS - Head"])
    return {"ok": True, "ref": email}


@app.patch("/api/users/{email}", response_model=Ok)
async def update_user(email: str, body: UserPatch, u: User = Depends(current_user)):
    require(u, "manageUsers")
    email = email.strip().lower()
    row = await q("SELECT email, name, role_group, role_level, team, active FROM users "
                  "WHERE email=%s", (email,), one=True)
    if not row:
        raise HTTPException(404, f"{email} is not registered")

    group = body.group or row["role_group"]
    level = body.level or row["role_level"]
    active = row["active"] if body.active is None else int(body.active)

    # Minting or removing an Admin is Admin-only, whichever direction it goes.
    if "Admin" in (group, row["role_group"]) and group != row["role_group"]:
        require(u, "grantAdmin")

    # Self-lockout guards. Renaming yourself is fine; stripping your own powers is not,
    # because there may be nobody left who can put them back.
    if email == u.email:
        if group != row["role_group"] or level != row["role_level"]:
            raise HTTPException(400, "you cannot change your own role — ask another administrator")
        if not active:
            raise HTTPException(400, "you cannot deactivate your own account")

    # Never let the last active Admin disappear.
    losing_admin = row["role_group"] == "Admin" and row["active"] and (
        group != "Admin" or not active)
    if losing_admin and await active_admin_count() <= 1:
        raise HTTPException(400, "this is the only active Admin — promote someone else first")

    team = clean_user_fields(group, level, row["team"] if body.team is None else body.team)
    name = (body.name or row["name"]).strip()
    if not name:
        raise HTTPException(400, "name cannot be empty")

    await execute("UPDATE users SET name=%s, role_group=%s, role_level=%s, team=%s, "
                  "active=%s WHERE email=%s",
                  (name, group, level, team, active, email))
    await audit(u.email, "update", "user", email, "role",
                f"{row['role_group']}/{row['role_level']}/active={row['active']}",
                f"{group}/{level}/active={active}")
    return {"ok": True, "ref": email}


@app.delete("/api/users/{email}", response_model=Ok)
async def deactivate_user(email: str, u: User = Depends(current_user)):
    """Revoke access. Deliberately not a row delete — ticket and CAPA history record
    people by name, and a hard delete would orphan that."""
    require(u, "manageUsers")
    email = email.strip().lower()
    row = await q("SELECT email, role_group, active FROM users WHERE email=%s",
                  (email,), one=True)
    if not row:
        raise HTTPException(404, f"{email} is not registered")
    if email == u.email:
        raise HTTPException(400, "you cannot deactivate your own account")
    if row["role_group"] == "Admin":
        require(u, "grantAdmin")
        if row["active"] and await active_admin_count() <= 1:
            raise HTTPException(400, "this is the only active Admin — promote someone else first")

    await execute("UPDATE users SET active=0 WHERE email=%s", (email,))
    await audit(u.email, "deactivate", "user", email, "active", "1", "0")
    return {"ok": True, "ref": email}


@app.get("/api/tickets/{ref}/files", response_model=FileList)
async def list_files(ref: str, u: User = Depends(current_user)):
    """Metadata only — the bytes come from /api/files/{id} so lists stay small."""
    t = await get_ticket(ref)
    rows = await q("SELECT id, kind, filename, content_type, size_bytes, caption, "
                   "uploaded_name, created_at FROM ticket_files WHERE ticket_id=%s "
                   "ORDER BY kind, created_at", (t["id"],))
    return {"files": [shape_file(r) for r in rows]}


@app.post("/api/tickets/{ref}/files", status_code=201, response_model=Ok)
async def upload_file(
    ref: str,
    file: UploadFile = FastFile(...),
    kind: str = Form("document"),
    caption: str | None = Form(None),
    u: User = Depends(current_user),
):
    """Attach a photo of the goods or a supporting document.

    Open to every group. Commercial supplies the cargo photos with the intake, but PNS
    attaches solution diagrams and survey shots, and Legal attaches contract drafts —
    restricting this to one team would just push the rest back into email."""
    t = await get_ticket(ref)
    if kind not in ("goods_photo", "document"):
        raise HTTPException(400, "kind must be goods_photo or document")

    data, ctype = await read_upload(file)

    fid = await execute(
        "INSERT INTO ticket_files (ticket_id, kind, filename, content_type, size_bytes, "
        "caption, data, uploaded_email, uploaded_name) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (t["id"], kind, (file.filename or "attachment")[:255], ctype, len(data),
         (caption or None), data, u.email, u.name))

    label = "photo of the goods" if kind == "goods_photo" else "document"
    people = {n for n in (t["owner_name"], t["sales_name"]) if n}
    people.discard(u.name)
    if people:
        await notify(f"{u.name} attached a {label} to {ref} — {t['shipper']}: {file.filename}",
                     people=sorted(people), ticket_ref=ref)
    await audit(u.email, "upload", "ticket", ref, "file", None, file.filename)
    return {"ok": True, "ref": ref, "status": f"{file.filename} attached"}


@app.get("/api/files/{fid}")
async def get_file(fid: int, u: User = Depends(current_user)):
    """Serve one attachment. Anything not on the inline allowlist is forced to download,
    and nosniff stops the browser second-guessing the type we declare."""
    r = await q("SELECT filename, content_type, data FROM ticket_files WHERE id=%s",
                (fid,), one=True)
    if not r:
        raise HTTPException(404, "no such file")
    return file_response(r)


@app.delete("/api/files/{fid}", response_model=Ok)
async def delete_file(fid: int, u: User = Depends(current_user)):
    """The person who uploaded it, or an Admin."""
    r = await q("SELECT f.id, f.filename, f.uploaded_email, t.ticket_ref FROM ticket_files f "
                "JOIN tickets t ON t.id=f.ticket_id WHERE f.id=%s", (fid,), one=True)
    if not r:
        raise HTTPException(404, "no such file")
    if r["uploaded_email"] != u.email and u.group != "Admin":
        raise HTTPException(403, "only the person who uploaded it, or an Admin, can remove it")
    await execute("DELETE FROM ticket_files WHERE id=%s", (fid,))
    await audit(u.email, "delete", "ticket", r["ticket_ref"], "file", r["filename"], None)
    return {"ok": True, "ref": r["ticket_ref"]}


# ------------------------------------------------------------------ questions
# Every group can read and post. The permission model deliberately has no say here:
# a discussion nobody can join is how the clarifications ended up in WhatsApp.
MENTION_RE = re.compile(r"@([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})")


class Comment(BaseModel):
    id: int
    author: str
    author_email: str
    group: str
    body: str
    is_question: bool
    mentions: list[str]
    resolved_by: str | None
    resolved_at: str | None
    at: str
    is_mine: bool = False


class CommentList(BaseModel):
    comments: list[Comment]
    open_questions: int


class NewComment(BaseModel):
    body: str
    is_question: bool = False
    mentions: list[str] = []      # emails; @name@domain in the body is picked up too


def shape_comment(r: dict, u: User) -> Comment:
    return Comment(
        id=r["id"], author=r["author_name"], author_email=r["author_email"],
        group=r["author_group"], body=r["body"], is_question=bool(r["is_question"]),
        mentions=[m for m in (r["mentions"] or "").split(",") if m],
        resolved_by=r["resolved_by"],
        resolved_at=str(r["resolved_at"]) if r["resolved_at"] else None,
        at=str(r["created_at"]), is_mine=r["author_email"] == u.email)


@app.get("/api/tickets/{ref}/comments", response_model=CommentList)
async def list_comments(ref: str, u: User = Depends(current_user)):
    t = await get_ticket(ref)
    rows = await q("SELECT * FROM ticket_comments WHERE ticket_id=%s "
                   "ORDER BY created_at, id", (t["id"],))
    return {"comments": [shape_comment(r, u) for r in rows],
            "open_questions": sum(1 for r in rows
                                  if r["is_question"] and not r["resolved_at"])}


@app.post("/api/tickets/{ref}/comments", status_code=201, response_model=Ok)
async def add_comment(ref: str, body: NewComment, u: User = Depends(current_user)):
    t = await get_ticket(ref)
    text = body.body.strip()
    if not text:
        raise HTTPException(400, "write something first")
    if len(text) > 4000:
        raise HTTPException(400, "that is too long for one message (4000 characters max)")

    # Tag by email, from the picker or typed inline. Only real active accounts resolve,
    # and the response says who was actually tagged — a typo must not look like it worked.
    wanted = {e.strip().lower() for e in body.mentions if e.strip()}
    wanted |= {m.lower() for m in MENTION_RE.findall(text)}
    tagged: list[dict] = []
    if wanted:
        marks = ",".join(["%s"] * len(wanted))
        tagged = await q(f"SELECT email, name FROM users WHERE active=1 "
                         f"AND LOWER(email) IN ({marks})", tuple(wanted))

    cid = await execute(
        "INSERT INTO ticket_comments (ticket_id, author_email, author_name, author_group, "
        "body, is_question, mentions) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (t["id"], u.email, u.name, u.group, text, int(body.is_question),
         ",".join(r["email"] for r in tagged) or None))

    # Whoever was tagged, plus the two people accountable for the ticket. A question
    # that only its author can see is not a question.
    people = {r["name"] for r in tagged}
    people |= {n for n in (t["owner_name"], t["sales_name"]) if n}
    people.discard(u.name)
    kind = "asked a question on" if body.is_question else "commented on"
    if people:
        await notify(f"{u.name} {kind} {ref} — {t['shipper']}: {text[:180]}",
                     people=sorted(people), ticket_ref=ref)

    found = {r["email"].lower() for r in tagged}
    unknown = sorted(e for e in wanted if e not in found)
    parts = []
    if tagged:
        parts.append("tagged " + ", ".join(sorted(r["name"] for r in tagged)))
    if unknown:
        parts.append("not registered, nobody notified: " + ", ".join(unknown))
    return {"ok": True, "ref": ref, "status": " · ".join(parts) or None}


@app.post("/api/comments/{cid}/resolve", response_model=Ok)
async def resolve_comment(cid: int, u: User = Depends(current_user)):
    """Close a question once it has been answered. The person who asked it decides, or a
    head/Admin can close one that has gone stale."""
    r = await q("SELECT c.*, t.ticket_ref FROM ticket_comments c "
                "JOIN tickets t ON t.id=c.ticket_id WHERE c.id=%s", (cid,), one=True)
    if not r:
        raise HTTPException(404, "no such comment")
    if not r["is_question"]:
        raise HTTPException(400, "only questions can be marked answered")
    pns_head = u.group == "Admin" or (u.group == "PNS" and u.level == "head")
    com_head = u.group == "Admin" or (u.group == "Commercial" and u.level == "head")
    if r["author_email"] != u.email and not (pns_head or com_head):
        raise HTTPException(403, "only the person who asked, or a head, can close a question")
    if r["resolved_at"]:
        return {"ok": True, "ref": r["ticket_ref"]}

    await execute("UPDATE ticket_comments SET resolved_at=NOW(), resolved_by=%s WHERE id=%s",
                  (u.name, cid))
    return {"ok": True, "ref": r["ticket_ref"], "status": "answered"}


# ------------------------------------------------------------------ notifications
class Note(BaseModel):
    id: int
    body: str
    ticket_ref: str | None
    at: str
    unread: bool


class NoteList(BaseModel):
    notes: list[Note]
    unread: int


@app.get("/api/notifications", response_model=NoteList)
async def notifications(u: User = Depends(current_user)):
    role_label = f"{u.group} - {'Head' if u.level == 'head' else 'Solution'}"
    rows = await q(
        "SELECT n.*, r.read_at FROM notifications n "
        "LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_email=%s "
        "ORDER BY n.created_at DESC LIMIT 60", (u.email,))
    out = []
    for r in rows:
        groups = (r["to_groups"] or "").split(",")
        roles = (r["to_roles"] or "").split(",")
        people = (r["to_people"] or "").split(",")
        if u.group == "Admin" or u.group in groups or role_label in roles or u.name in people:
            out.append(Note(id=r["id"], body=r["body"], ticket_ref=r["ticket_ref"],
                            at=str(r["created_at"]), unread=r["read_at"] is None))
    return {"notes": out, "unread": sum(1 for n in out if n.unread)}


class Prefs(BaseModel):
    email_optout: bool
    email_configured: bool
    email_from: str | None = None


@app.get("/api/me/preferences", response_model=Prefs)
async def get_prefs(u: User = Depends(current_user)):
    r = await q("SELECT email_optout FROM users WHERE email=%s", (u.email,), one=True)
    return {"email_optout": bool((r or {}).get("email_optout")),
            "email_configured": email_configured(),
            "email_from": SMTP_FROM or None}


class PrefsIn(BaseModel):
    email_optout: bool


@app.post("/api/me/preferences", response_model=Ok)
async def set_prefs(body: PrefsIn, u: User = Depends(current_user)):
    await execute("UPDATE users SET email_optout=%s WHERE email=%s",
                  (int(body.email_optout), u.email))
    return {"ok": True, "status": "email off" if body.email_optout else "email on"}


class EmailCheck(BaseModel):
    configured: bool
    host: str | None
    port: int | None
    sender: str | None
    reachable: bool
    detail: str
    sent_to: str | None = None


@app.post("/api/diagnostics/email", response_model=EmailCheck)
async def check_email(send: bool = False, u: User = Depends(current_user)):
    """Can this pod actually reach the relay? Nothing in the platform contract says
    whether outbound SMTP is allowed, so the only way to find out is to try it. Admin
    only, and with send=true it posts one real message to the caller."""
    require(u, "manageUsers")
    if not email_configured():
        return {"configured": False, "host": SMTP_HOST or None, "port": SMTP_PORT,
                "sender": SMTP_FROM or None, "reachable": False,
                "detail": "SMTP_HOST and SMTP_FROM are not both set in the portal, so the "
                          "app is running in-app-only. Fill them in under Settings."}

    def probe() -> str:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
            s.ehlo()
            tls = s.has_extn("starttls")
            if tls:
                s.starttls()
                s.ehlo()
            if SMTP_USER and SMTP_PASSWORD:
                s.login(SMTP_USER, SMTP_PASSWORD)
                return f"connected, STARTTLS {'yes' if tls else 'no'}, authenticated as {SMTP_USER}"
            return f"connected, STARTTLS {'yes' if tls else 'no'}, no credentials sent (IP-authenticated relay)"

    try:
        detail = await asyncio.to_thread(probe)
    except Exception as exc:                          # noqa: BLE001 - report, never raise
        return {"configured": True, "host": SMTP_HOST, "port": SMTP_PORT,
                "sender": SMTP_FROM, "reachable": False,
                "detail": f"{type(exc).__name__}: {exc}"}

    sent_to = None
    if send:
        text, html = _render(
            f"Test message from Ninja PNS, sent by {u.name}. If this arrived, personal "
            f"notifications will reach people.", None)
        try:
            await asyncio.to_thread(_send_sync, [u.email], "Ninja PNS — email test",
                                    text, html)
            sent_to = u.email
        except Exception as exc:                      # noqa: BLE001
            return {"configured": True, "host": SMTP_HOST, "port": SMTP_PORT,
                    "sender": SMTP_FROM, "reachable": True,
                    "detail": f"connected, but sending failed — {type(exc).__name__}: {exc}"}

    return {"configured": True, "host": SMTP_HOST, "port": SMTP_PORT, "sender": SMTP_FROM,
            "reachable": True, "detail": detail, "sent_to": sent_to}


@app.post("/api/notifications/read", response_model=Ok)
async def mark_read(u: User = Depends(current_user)):
    await execute(
        "INSERT IGNORE INTO notification_reads (notification_id, user_email) "
        "SELECT id, %s FROM notifications", (u.email,))
    return {"ok": True}
