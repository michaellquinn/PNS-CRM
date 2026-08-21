"""Ninja PNS, solutioning workflow API.

Substrait upload-mode contract:
  - listens on port 8000
  - GET /health is the readiness probe
  - all API routes live under /api
  - DATABASE_URL is OceanBase (MySQL wire), asyncmy driver, %s placeholders
  - all DDL is in resources/db/migration/, never here

Identity comes from the platform's auth proxy (x-forwarded-email) once Google SSO
is enabled in the portal's Access tab. Authorisation is this module's job: `can()`
is the single source of truth and every mutating route checks it. Hiding a control
in the frontend is not a permission.
"""
import asyncio
import contextlib
import json
import logging
import smtplib
import re
import os
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
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
    task = asyncio.create_task(_auto_sync_loop()) if AUTO_SYNC_MINUTES else None
    yield
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()


app = FastAPI(title="Ninja PNS, Solutioning", lifespan=lifespan)

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

# Four tiers, on two different levels, which is the whole subtlety.
#
# Hypercare and Strategic describe an ACCOUNT and are inherited from the parent group in
# Sales CRM, so they sit on the shipper and apply to every deal that account brings.
# Must Win describes ONE OPPORTUNITY: the same account can have a must-win deal and five
# ordinary ones, so it lives on the ticket (tickets.must_win) and never on the shipper.
# Everything with no tag at all is Standard.
ACCT_TYPES = ["Hypercare", "Strategic", "Standard"]
MANAGED_ACCTS = ("Hypercare", "Strategic")


def big_group(t: dict) -> str | None:
    """Which of the three watched groups this ticket belongs to, or None for Standard.

    Account tier first, because it is the stronger claim: a Hypercare account's must-win
    deal is reported as Hypercare, not as two things at once."""
    acct = t.get("acct_type")
    if acct in MANAGED_ACCTS:
        return acct
    return "Must Win" if t.get("must_win") else None

# Sales CRM API keys are issued per person and inherit that person's permissions, so a
# sync run reads whatever its trigger can see. Until Ninja issues a service account, one
# named owner runs it. Override per environment rather than editing this default.
SYNC_OWNER_EMAIL = os.getenv("SYNC_OWNER_EMAIL", "baskoro.nugroho@ninjavan.co").lower()

# The services a pricer may hand-flag as below the published bottom rate. This is the
# manual escape hatch and is narrower than PRICING_GUARD below, which computes a ceiling
# for every service from the 5A tables. Both run: the guard catches a breach the pricer
# did not declare, the checkbox catches one the numbers do not show.
BOTTOM_MARGIN = {"LTL": 5.0, "B2BR": 10.0}
LOSS_REASONS = ["pricing", "shipper", "solution", "ops", "no_vendor", "billing", "pns",
                # Set by the Sales CRM sync when the opportunity is Closed-Lost there.
                "salescrm"]
# "Open" earns a place in the pricing queues: the work is ready to be done, it is just
# nobody's yet. Keeping it out would have hidden every unstarted ticket from the one
# screen people go to when they are looking for something to do.
AWAIT_STATUSES = ("Open", "Pending Sales", "Pending PNS", "Pending Vendor")
PENDING_STATUSES = ["Open", "Pending Sales", "Pending PNS", "Pending Review - PNS",
                    "Pending Review - Head PNS",
                    "Pending Review - PSP",
                    "Pending Review - Head PSP", "Pending Vendor",
                    "Pending Review - C-level"]
# Raised here with no Sales CRM opportunity behind it. Deliberately outside
# PENDING_STATUSES: it is not waiting on solutioning work, it is waiting on an id, and
# it must not be reopened into or sent back to.
NO_CRM_STATUS = "Pending CRM ID"
# Statuses that mean somebody is actually working the deal. Reaching any of them needs
# the facts the work depends on — today that is potential revenue, see change_status.
WORK_STATUSES = ("Pending Sales", "Pending PNS", "Pending Vendor",
                 "Pending Review - PNS", "Pending Review - Head PNS",
                 "Pending Review - PSP", "Pending Review - Head PSP",
                 "Pending Review - C-level")
# Fields the intake keeps as free text but remembers: the dropdown would otherwise have
# to predict every commodity Ninja ever carries (a shipper turned up with medicine).
REMEMBERED_FIELDS = ["commodity", "product", "pallet", "destType", "truck", "freq"]

# The payload key an admin's "who prices this" override rides in. Underscore-prefixed
# like _crm so nothing that walks the intake — the charter, the edit diff, the
# remembered-values list — reads it as a field somebody typed. In the payload rather than
# a column on purpose: two people deploy into this database from separate clones and
# migrations have collided three times, and this is a trial-period stopgap that should be
# cheap to delete. Defined here, above all three places that read it, so the JSON path and
# the key cannot drift apart.
RESP_OVERRIDE_KEY = "_pricedByOverride"
RESP_OVERRIDE_PATH = "$." + RESP_OVERRIDE_KEY

# Every status in the order a ticket meets them. The two terminal outcomes come last.
# "Pending Review - Head Sales" was removed on 2026-08-14 along with the gate itself.
# Checked first: zero tickets held it, so nothing needed migrating and the
# orphaned-status diagnostic stays at zero.
ALL_STATUSES = [NO_CRM_STATUS, "Open", "Pending Sales", "Pending PNS", "Pending Vendor",
                "Pending Review - PNS",
                "Pending Review - Head PNS", "Pending Review - PSP",
                "Pending Review - Head PSP",
                "Pending Review - C-level", "Proposal Submitted",
                "Proposal Accepted / Ready to Ship", "Lost", "Cancel"]

# ------------------------------------------------------------------ status transitions
#
# Every way a ticket may change status, in one place (Baskoro asked on 2026-08-14
# whether the triggers were written down anywhere; they were not — they were spread
# across nine endpoints and could only be reconstructed by reading all of them).
#
# `via` is the endpoint that performs the move, and it is what makes this enforceable:
# the rows marked "POST /status" are the ones a person names a destination for, so those
# are validated against this table in change_status(). Every other row is a move some
# endpoint derives for itself — a price landing, a signature, the sync — and naming a
# status by hand is not how those happen.
#
# "*" as a source means "from any status the ticket is still open in".
TRANSITIONS = [
    # from, to, trigger, who, via
    (None, NO_CRM_STATUS, "A request is raised here with no Sales CRM opportunity id",
     "anyone who works the pipeline", "POST /tickets"),
    (None, "Open", "A request is raised here carrying its Sales CRM id, or the sync "
     "imports an opportunity that has no potential revenue yet",
     "anyone who works the pipeline; the sync", "POST /tickets, sync"),
    (None, "Pending Sales", "The sync imports an opportunity the 5A matrix routes to Sales",
     "the sync", "sync"),
    (None, "Pending PNS", "The sync imports an opportunity the 5A matrix routes to PNS",
     "the sync", "sync"),

    (NO_CRM_STATUS, "Open", "The Sales CRM opportunity id is supplied",
     "anyone who may edit intake", "POST /tickets/{ref}/crm-id"),

    ("Open", "Pending PNS", "Somebody picks it up and PNS owes the price",
     "PNS, Sales or Admin", "POST /status"),
    ("Open", "Pending Sales", "Somebody picks it up and Sales owes the price, or the "
     "intake is incomplete and goes back to Sales",
     "PNS, Sales or Admin", "POST /status"),

    ("Pending Sales", "Pending PNS", "Sent back or handed over, with a reason",
     "PNS or Sales", "POST /status"),
    ("Pending PNS", "Pending Sales", "Sent back or handed over, with a reason",
     "PNS or Sales", "POST /status"),
    ("Pending PNS", "Pending Vendor", "FTL only — waiting on a haulage vendor's cost",
     "PNS", "POST /status"),
    ("Pending Sales", "Pending Vendor", "FTL only — waiting on a haulage vendor's cost",
     "PNS", "POST /status"),
    ("Pending Vendor", "Pending PNS", "The vendor cost came back", "PNS", "POST /status"),
    ("Pending Vendor", "Pending Sales", "The vendor cost came back", "PNS", "POST /status"),

    ("Pending PNS", "the next gate in the approval chain", "The price is attached",
     "whoever owes the price", "POST /tickets/{ref}/price"),
    ("Pending Sales", "the next gate in the approval chain", "The price is attached",
     "whoever owes the price", "POST /tickets/{ref}/price"),

    # Two PNS reviews, deliberately separate gates with separate screens and separate
    # endpoints (Michael, 2026-08-18). They answer different questions and are held by
    # different people: an ordinary member checks a Sales price on a big Standard deal,
    # the Head finalises a whole watched solution. Merging them put the Head's name on
    # routine checks and hid the routine ones inside the pricing queue.
    ("Pending Review - PNS", "the next gate in the approval chain",
     "A PNS member checks the price Sales built",
     "any PNS member", "POST /tickets/{ref}/pns-review"),
    ("Pending Review - Head PNS", "the next gate in the approval chain",
     "The Head of PNS finalises the solution and its pricing",
     "Head of PNS", "POST /tickets/{ref}/pns-final"),
    ("Pending Review - PSP", "the next gate, or back to the pricer on a rejection",
     "PSP rules on the margin", "PSP, or the Head of PNS as a recorded override",
     "POST /tickets/{ref}/psp"),
    ("Pending Review - Head PSP", "the next gate, or back to the pricer on a rejection",
     "The Head of PSP owns PSP's decision", "Head of PSP", "POST /tickets/{ref}/psp"),
    ("Pending Review - C-level", "Proposal Submitted",
     "Alex (CSO) and Dhinesh (COO) sign the solution off",
     "recorded by PNS or Sales", "POST /tickets/{ref}/exec-signoff"),

    ("Pending Review - PSP", "Proposal Submitted",
     "PSP cleared the margin and the pricer confirms the proposal goes out",
     "whoever owes the price", "POST /tickets/{ref}/submit-proposal"),

    # The discretionary route to PSP. Reaching PSP *by rule* (a manual-review band, a
    # Sameday discount past 20%) happens inside price-attach and never comes through
    # here. Both are gated on may_go_to_psp(): a managed account, or the PNS Head having
    # opened this one ticket on Alex's exception.
    ("Open", "Pending Review - PSP", "Escalated for a second opinion on the margin",
     "PNS or Sales, on a managed account or Alex's exception", "POST /status"),
    ("Pending PNS", "Pending Review - PSP", "Escalated for a second opinion on the margin",
     "PNS or Sales, on a managed account or Alex's exception", "POST /status"),
    ("Pending Sales", "Pending Review - PSP", "Escalated for a second opinion on the margin",
     "PNS or Sales, on a managed account or Alex's exception", "POST /status"),
    ("Pending Vendor", "Pending Review - PSP", "Escalated for a second opinion on the margin",
     "PNS or Sales, on a managed account or Alex's exception", "POST /status"),
    ("Pending Review - Head PNS", "Pending Review - PSP",
     "The Head of PNS sends it for a margin decision",
     "PNS or Sales, on a managed account or Alex's exception", "POST /status"),
    # The review's escalation: PNS read the price and there is no rate to price against.
    # This is the route that replaced the automatic one — a manual-review band used to
    # send the ticket to PSP at price-attach without PNS ever seeing it.
    ("Pending Review - PNS", "Pending Review - PSP",
     "The reviewer finds no rate to price against and sends it for a margin decision",
     "PNS or Sales, on a managed account or Alex's exception", "POST /status"),

    # A reviewer at any gate can put the ticket back on whoever owes the work. It needs
    # a reason, and it is how a review says "this is not finished" without rejecting it.
    ("any Pending Review status", "Pending PNS",
     "A reviewer sends it back to PNS, with a reason", "PNS or Sales", "POST /status"),
    ("any Pending Review status", "Pending Sales",
     "A reviewer sends it back to Sales, with a reason", "PNS or Sales", "POST /status"),
    ("Proposal Submitted", "Proposal Accepted / Ready to Ship",
     "The shipper accepts", "Sales", "POST /status"),
    ("Proposal Submitted", "Pending PNS", "Sent back for rework, with a reason",
     "PNS or Sales", "POST /status"),
    ("Proposal Submitted", "Pending Sales", "Sent back for rework, with a reason",
     "PNS or Sales", "POST /status"),

    ("*", "Lost", "Sales records the loss with a reason", "Sales", "POST /status"),
    ("*", "Cancel", "The request is withdrawn, or PNS drops it as not feasible — "
     "a reason is required either way and becomes the record of why it stopped",
     "Sales or PNS", "POST /status"),
    ("Lost", "any pending status", "Sales puts the deal back in the pipeline",
     "any Commercial user", "POST /tickets/{ref}/reopen"),
    ("Cancel", "any pending status", "Sales puts the deal back in the pipeline",
     "any Commercial user", "POST /tickets/{ref}/reopen"),

    ("*", "Lost", "Sales CRM moves the opportunity to Closed-Lost or Future Opportunity",
     "the sync — Sales CRM leads on stage", "sync"),
    ("*", "Proposal Accepted / Ready to Ship",
     "Sales CRM moves the opportunity to Agreed to Ship, Onboarding or Closed-Won",
     "the sync — Sales CRM leads on stage", "sync"),
]

# What a person may name as a destination on POST /status, derived from the table above
# rather than restated — the two cannot drift apart. Everything else moves status by
# doing the thing (attaching a price, signing off), not by choosing a status.
REVIEW_STATUSES = [s for s in ALL_STATUSES if s.startswith("Pending Review")]


def _sources(frm: str | None) -> list[str]:
    if frm == "*":
        return ALL_STATUSES
    if frm == "any Pending Review status":
        return REVIEW_STATUSES
    return [frm] if frm else []


MANUAL_MOVES: dict[str, set[str]] = {}
for _frm, _to, _why, _who, _via in TRANSITIONS:
    if _via != "POST /status" or _to not in ALL_STATUSES:
        continue
    for _src in _sources(_frm):
        if _src != _to:
            MANUAL_MOVES.setdefault(_src, set()).add(_to)
# Lost and Cancel are already decided; they come back through /reopen, which has its own
# rules, so "*" must not quietly re-grant a manual move out of them.
for _done in ("Lost", "Cancel", "Proposal Accepted / Ready to Ship"):
    MANUAL_MOVES.pop(_done, None)


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
# rotates through the generalists. Baskoro is Head and is deliberately not in the pool, 
# assigning the head his own queue is how oversight quietly turns into a caseload.
SERVICE_SPECIALIST = {
    # Sameday is Annisa's exclusively, from intake to published charter.
    "Sameday": ["annisa.sophieamalia@ninjavan.co"],
}

# Complex Logistics splits on whether the account is already live, not on load. Winning
# a brand new account is a different job from adding work to one already shipping, and
# the two sit with different people.
COMPLEX_LOGISTICS_NEW = "michael.quinnfarand@ninjavan.co"    # new account
COMPLEX_LOGISTICS_LIVE = "adila.kestibawani@ninjavan.co"     # account already shipping

# Auto-assignment can be switched off entirely, in which case every ticket arrives
# unassigned for the Head to place. The Head can always reassign either way.
AUTO_ASSIGN = os.getenv("AUTO_ASSIGN", "1").strip() not in ("0", "false", "False", "")
# Everything without a specialist goes to this pair by default, whichever of them is
# carrying less.
PNS_DEFAULT_PAIR = ["m.ramdhani@ninjavan.co", "niko.yannova@ninjavan.co"]
PNS_WIP_CAP = 10          # tickets one person may hold at Pending PNS before it stops

# Who checks a Sales-built price on a non-managed deal at or above 30 Mio.
#
# Baskoro's call (2026-08-11) was to delegate that band standing to one named reviewer,
# so the Head was not in the path of the most routine review there is. A
# PNS_REVIEW_DELEGATE setting and a review_delegate() lookup were written for it and
# never called by anything: submit_price() answers the same question with auto_assignee()
# — the lightest-loaded eligible PNS member, under the WIP cap — which is the same
# intent and does not go stale when one person is on leave. Both are removed rather than
# left sitting there looking live (Baskoro asked on 2026-08-14 whether the PNS reviewer
# was still a real thing; half of it was not).


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


async def shipper_is_live(shipper_id: int | None) -> bool:
    """Has this shipper ever had a deal accepted?

    "Already opened account" means shipping, not merely known to us. A shipper we have
    only ever lost or are still quoting is a new account for assignment purposes, so the
    test is an accepted outcome rather than the existence of a shippers row."""
    if not shipper_id:
        return False
    row = await q("SELECT 1 AS n FROM tickets WHERE shipper_id=%s AND outcome='accepted' "
                  "AND deleted_at IS NULL LIMIT 1", (shipper_id,), one=True)
    return bool(row)


async def auto_assignee(service: str, seed: int, shipper_id: int | None = None) -> str | None:
    """The PNS member who should own a new ticket, or None to leave it for the Head.

    Candidates are the named specialists for that service, or the default pair for
    everything else. The lightest-loaded candidate under the cap takes it.

    Once every candidate is at the cap the ticket is left **unassigned on purpose** and
    surfaces in the Head's queue. Auto-assigning past the cap would keep the queue
    looking tidy while quietly burying someone, an unassigned ticket is visible, an
    over-assigned one is not.

    Anyone not registered or not active is skipped: work parked on a name nobody is
    watching is worse than work with no name on it, because it looks handled."""
    if not AUTO_ASSIGN:
        return None

    if service == "Complex Logistics":
        live = await shipper_is_live(shipper_id)
        candidates = [COMPLEX_LOGISTICS_LIVE if live else COMPLEX_LOGISTICS_NEW]
    else:
        candidates = SERVICE_SPECIALIST.get(service) or PNS_DEFAULT_PAIR
    ph = ",".join(["%s"] * len(candidates))
    rows = await q(f"SELECT name FROM users WHERE email IN ({ph}) AND active=1",
                   tuple(candidates))
    names = [r["name"] for r in rows]
    if not names and service in SERVICE_SPECIALIST:
        # Specialists all away, fall back to the default pair rather than stranding it.
        ph = ",".join(["%s"] * len(PNS_DEFAULT_PAIR))
        rows = await q(f"SELECT name FROM users WHERE email IN ({ph}) AND active=1",
                       tuple(PNS_DEFAULT_PAIR))
        names = [r["name"] for r in rows]
    if not names:
        return None

    load = await pending_pns_load(names)
    # Ties break on name so a retried request makes the same choice.
    lightest = min(names, key=lambda n: (load[n], n))
    return lightest if load[lightest] < PNS_WIP_CAP else None


def tier_of(rev: int) -> str:
    """5A revenue bands: =< 10 Mio, 10 < x < 30 Mio, >= 30 Mio."""
    if rev <= 10_000_000:
        return "low"
    return "mid" if rev < 30_000_000 else "high"


# The "Max. Discount / Min. Margin" row of each 5A Revenue & Customization table,
# by service then revenue band. Each entry is (kind, limit):
#   margin , the priced margin must be at or above `limit` %
#   discount, the discount must be at or below `limit` %
#   standard, published rate card only, no deviation
#   manual , no automatic ceiling; a person decides (routes to PSP)
# Sameday carries no bottom margin at all: the only self-serve lever is a 20% discount,
# and anything past that is a PSP call. B2C prices off the B2BR card, so it follows B2BR.
PRICING_GUARD = {
    "LTL":         {"low": ("margin", 20.0), "mid": ("margin", 5.0), "high": ("margin", 5.0)},
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
# The one NON-terminal stage that follows ours (Michael, 2026-08-18). Every other
# mid-funnel stage describes what Sales is doing and leaves our status alone; this one
# asserts that a price has already reached the shipper, which is a fact about the world
# rather than a step in Sales' process. Holding the ticket at "Pending Review - PSP"
# after that does not un-send the proposal, it just makes our queues describe work that
# is already moot. Spelling variants included because the picklist has been edited.
SUBMITTED_STAGES = ("Proposal Submitted", "Proposal Sent", "Quotation Sent")


def _norm_stage(s: str | None) -> str:
    """A stage name reduced to what actually identifies it: case-folded, whitespace
    collapsed. Trailing spaces and a lower-case S are not different stages."""
    return " ".join(str(s or "").split()).lower()


_LOST_N = {_norm_stage(s) for s in CLOSED_LOST_STAGES}
_ACCEPTED_N = {_norm_stage(s) for s in ACCEPTED_STAGES}
_SUBMITTED_N = {_norm_stage(s) for s in SUBMITTED_STAGES}


def stage_blocks_work(t: dict) -> str | None:
    """Sales CRM outranks us. If the opportunity is dead there, no PNS work proceeds.

    Sales owns the commercial reality: if the shipper walked away or the deal was parked
    as a future opportunity, solutioning it is wasted effort and a priced proposal would
    be misleading. Returns the reason to refuse, or None to allow."""
    stage = t.get("stage")
    if stage in CLOSED_LOST_STAGES:
        return (f"Sales CRM has this opportunity at '{stage}'. Reopen it there first: "
                f"Sales CRM leads on stage and this ticket follows it.")
    return None


def status_for_stage(stage: str | None, resp: str) -> str | None:
    """The PNS status a Sales CRM stage implies, or None to leave ours alone.

    Deliberately one-way and coarse. Sales CRM owns the commercial stage; this app owns
    the solutioning status. The stages that override ours are the terminal ones — there
    is no point solutioning a deal the shipper has already declined — plus Proposal
    Submitted, which is not terminal but does say the price already left the building.

    That last one is Michael's call, 2026-08-18, and it makes the rule consistent rather
    than looser: ACCEPTED_STAGES has always overridden our status from any open state, so
    "the shipper accepted" was allowed to jump every gate while the weaker "the proposal
    went out" was not. Where a ticket was still in an approval gate, the sync records the
    gates it bypassed rather than moving it quietly — see _refresh_from_salescrm()."""
    if not stage:
        return None
    # Compared normalised — case-folded and inner whitespace collapsed. Sales CRM's
    # picklist is edited by hand and these lists already carry "Closed Lost" beside
    # "Closed-Lost" and the misspelt "Future Oppurtunity" to cope with it. An exact
    # match means a stage renamed to "Proposal submitted " silently stops being
    # recognised, and nothing anywhere says so — the ticket simply never moves.
    s = _norm_stage(stage)
    if s in _LOST_N:
        return "Lost"
    if s in _ACCEPTED_N:
        return "Proposal Accepted / Ready to Ship"
    if s in _SUBMITTED_N:
        return "Proposal Submitted"
    return None          # New, Negotiation, EKYC, Contract Sent...


def guard_for(acct: str, svc: str, rev: int) -> dict:
    """The pricing ceiling that applies to one ticket."""
    if acct in MANAGED_ACCTS:
        return {"kind": "manual", "limit": None,
                "why": f"{acct} account, priced under manual review"}
    kind, limit = PRICING_GUARD.get(svc, {}).get(tier_of(rev), ("manual", None))
    why = {
        "margin":   f"minimum margin {limit}%" if limit is not None else "",
        "discount": f"maximum discount {limit}%" if limit is not None else "",
        "standard": "published rate card only, no deviation",
        "manual":   "no published ceiling at this tier, needs a decision",
    }[kind]
    return {"kind": kind, "limit": limit, "why": why}


def guard_breached(g: dict, margin_pct: float | None, discount_pct: float | None) -> bool:
    """True when the attached price exceeds what the tier allows.

    An unstated figure is never treated as a breach, the pricer may be attaching a
    standard rate card with nothing to declare. The manual/standard tiers are handled
    by the caller, not here, because they need a decision rather than a comparison."""
    if g["kind"] == "margin" and margin_pct is not None:
        return margin_pct < g["limit"]
    if g["kind"] == "discount" and discount_pct is not None:
        return discount_pct > g["limit"]
    return False


def pending_for(resp: str) -> str:
    return "Pending Sales" if resp == "Sales" else "Pending PNS"


def review_level(t: dict) -> str | None:
    """Who reviews the priced solution: the PNS Head, an ordinary PNS member, or nobody.

      "head"  Hypercare, Strategic and Must Win — the three watched groups. The Head of
              PNS finalises the solution AND its pricing here, and this happens FIRST,
              before PSP, the Sales Head or C-level see it. That ordering is the point
              (Baskoro, 2026-08-13): the executives are being asked to sign a finished
              solution, so it has to be finished before they are asked.

              This fires whoever priced it, including PNS itself. A Head reviewing the
              team's work is oversight, not self-review — and previously a managed
              account priced by PNS went price -> PSP -> C-level with the Head never in
              the path at all, which is exactly the gap this closes.

      "pns"   Anything else Sales priced at or above Rp 30 Mio. A second pair of PNS eyes
              in "Pending Review - PNS", its own gate with its own screen, and the Head
              nowhere near it. It used to land in plain "Pending PNS", which meant the
              review was indistinguishable from ordinary pricing work in the queue and
              the only way to finish it was to attach a price over the top of Sales'.

      None    everything else — it goes straight out.
    """
    if big_group(t):
        return "head"
    if t.get("resp") != "Sales":
        return None                       # PNS does not re-check its own routine work
    return "pns" if t.get("needs_review") else None


# The approval chain, as Baskoro set it out on 2026-08-13. Written as one ordered list
# per case rather than scattered across the endpoints, because the previous version was
# spread over three functions and nobody could answer "what comes next" without reading
# all of them.
#
#   watched + below floor : PSP -> Head PSP -> Head PNS -> C-level
#   watched + clean price :                    Head PNS -> C-level
#   Standard >= 30 Mio    : PNS (an ordinary member checks it, then it goes out)
#   Standard <  30 Mio    : Head or Manager of Sales
#
# C-level applies only to Hypercare and Strategic — a Must Win deal on a Standard
# account is watched by PNS and Sales, not by Alex and Dhinesh.
# The Head of Sales is NOT in either chain (Baskoro, 2026-08-14): they approve in Sales
# CRM instead, which is where they already work. Keeping a gate here that nobody watches
# is worse than not having one -- a ticket would sit in a queue waiting on a person who
# was never going to open this app. Verified zero tickets were sitting at that status
# when it was removed, so nothing was stranded.
CHAIN_WATCHED_BELOW = ["Pending Review - PSP", "Pending Review - Head PSP",
                       "Pending Review - Head PNS"]
CHAIN_WATCHED_CLEAN = ["Pending Review - Head PNS"]


def approval_chain(t: dict, below_floor: bool) -> list[str]:
    """Every gate this ticket must pass, in order, from where it is now."""
    if big_group(t):
        chain = list(CHAIN_WATCHED_BELOW if below_floor else CHAIN_WATCHED_CLEAN)
        # All three watched groups end at C-level, Must Win included (Baskoro,
        # 2026-08-13). I had scoped this to Hypercare and Strategic on the reasoning
        # that executive sign-off is an account matter and Must Win is a deal flag —
        # overruled: a deal the business has declared it must win is exactly the kind
        # the executives want to see, whatever the account tier says.
        if not t.get("exec_signoff"):
            chain.append("Pending Review - C-level")
        return chain
    # Standard never reaches a floor question at all — see reject_below_floor(). With the
    # Head of Sales gate retired, a Standard deal under 30 Mio has nothing left to clear:
    # Sales priced it, Sales owns it, and the proposal goes straight out. An empty chain
    # means next_gate() answers "Proposal Submitted", which is the point.
    #
    # At or above 30 Mio the one gate is PNS's own review. PSP is deliberately NOT in
    # this chain: a band with no published ceiling used to route here automatically,
    # which skipped the review entirely (Michael, 2026-08-18 — a Tanamera FTL on-call
    # deal went straight to PSP with PNS never seeing it). Where the reviewer genuinely
    # needs PSP, they escalate from the review screen, which is the gated, recorded route
    # rather than an automatic one.
    return ["Pending Review - PNS"] if t.get("needs_review") else []


def next_gate(t: dict, current: str | None = None) -> str:
    """The gate after `current`, or "Proposal Submitted" when the chain is done."""
    chain = approval_chain(t, bool(t.get("below_bottom") or t.get("manual_review")))
    here = current if current is not None else t.get("status")
    if here in chain:
        i = chain.index(here)
        return chain[i + 1] if i + 1 < len(chain) else "Proposal Submitted"
    return chain[0] if chain else "Proposal Submitted"


def next_after_head_pns(t: dict) -> str:
    """Kept as a named step for readability; the chain decides."""
    return next_gate(t, "Pending Review - Head PNS")


def needs_pns_review(t: dict) -> bool:
    """Whether a Sales-built price is reviewed by PNS at all, at either level."""
    return review_level(t) is not None


# head_for() lived here and answered "which Head acknowledges a below-floor price". The
# answer is now "nobody, in this app" — the Head of Sales accepts the concession in Sales
# CRM (Baskoro, 2026-08-14) — so the function and its only gate are both gone.


def may_go_to_psp(t: dict) -> bool:
    """Whether a ticket may be *sent* to PSP by a person, as opposed to reaching it by rule.

    Some paths are PSP's by rule and do not consult this: a manual-review band, and a
    Sameday discount past 20%. This governs the discretionary routes instead, where
    someone chooses to involve PSP: the optional escalation, and a below-bottom margin
    the Sales Head has just acknowledged.

    There, PSP takes only what Alex (CSO) has granted an exception for. Strategic and
    Hypercare carry that exception by being managed; anything else needs the PNS Head to
    have recorded that Alex granted it verbatim. Otherwise a below-bottom LTL deal at
    8 Mio lands in PSP's queue, which is not what PSP is for."""
    return t.get("acct_type") in MANAGED_ACCTS or bool(t.get("psp_allowed"))


def proposal_or_signoff(t: dict) -> str:
    """Where a fully-approved ticket goes next.

    Hypercare and Strategic solutions need Alex (CSO) and Dhinesh (COO). That is the
    *last* gate, it runs after PSP and the Sales Head have cleared, never instead of
    them, so every other approval still has to happen first."""
    if big_group(t) and not t.get("exec_signoff"):
        return "Pending Review - C-level"
    return "Proposal Submitted"


# ------------------------------------------------------------------ identity
class User(BaseModel):
    email: str
    name: str
    group: str
    level: str
    team: str | None = None
    sso: bool = False        # True when identity came from the proxy, not DEV_USER_EMAIL


# Commercial is Sales. Visitor, Finance and Sales Planning are read-mostly audiences:
# they consume the charter and the pipeline rather than acting on tickets, so they get
# no mutating permission at all, see can() below.
#
# Legal folded into Visitor on 2026-08-11 (V17): the two were one role under two names,
# and choosing between them was a question with no consequence. Ops arrived at the same
# time — they receive the Kick-off, and without a group there was no list to send it to.
ROLE_GROUPS = ["Commercial", "PNS", "PSP", "Ops", "Finance", "Sales Planning",
               "CSO", "QC", "Visitor", "Admin"]
# Visitor, Finance and Ops look and never touch. Sales Planning is different: they
# correct what Sales submitted, so they get the intake edit and nothing else.
READ_ONLY_GROUPS = ("Visitor", "Finance", "Ops")
# "manager" exists for Commercial: a Sales Manager may reassign the Sales PIC, same as
# the Sales Head, and nothing else beyond staff. Other groups have no manager tier.
ROLE_LEVELS = ["staff", "manager", "head"]
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
            403, f"{email} has no role in this app. Ask an administrator to register you "
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
    # The Sales Manager tier: everything staff can do, plus reassigning the Sales PIC.
    com_mgr = com_head or (u.group == "Commercial" and u.level == "manager")
    # Anyone who works the pipeline rather than only reading it. Sales Planning is in:
    # they already correct intake, so raising one is no wider a right.
    works_group = u.group not in READ_ONLY_GROUPS

    # Read-mostly audiences never mutate. Stated once here rather than being spelled out
    # as an exclusion on every line below, where one omission would grant a right nobody
    # intended. They can still be tagged in a discussion and reply, that is a comment
    # endpoint, deliberately open to everyone, not a permission.
    if u.group in READ_ONLY_GROUPS:
        return False

    # headAck is retired. The Head of Sales accepts a below-floor concession in Sales
    # CRM now (Baskoro, 2026-08-14), so there is no gate here for them to hold, and the
    # PNS-Head-acts-in-their-place pilot clause went with it.

    return {
        # Raising a ticket by hand is open to everyone who works the pipeline, not just
        # Sales. Most tickets arrive from the Sales CRM sync; this is the escape hatch
        # for the ones that do not exist there yet, and gate-keeping it only means the
        # work happens in a chat instead. The raiser is recorded either way.
        "createTicket":     works_group,
        # Soft delete and restore are the PNS Head's call too — a mis-imported or
        # plainly wrong ticket should not need an Admin. Purge stays Admin only:
        # erasing history is a different act from parking a mistake in the bin.
        "deleteTicket":     pns_head,
        "restoreTicket":    pns_head,
        "purgeTicket":      admin,
        # Admin only, and deliberately narrower than editAcctOrRev beside it. Who prices
        # a deal is normally derived from the 5A matrix and nobody overrides it by hand;
        # this exists because the trial runs with Sales not yet on the platform, so PNS
        # is working tickets the matrix has already assigned to Sales (Michael,
        # 2026-08-18). It is a stopgap with a name, not a general capability.
        "setPricedBy":      admin,
        # Assignment is the PNS team's own, not only the Head's (Baskoro, 2026-08-14,
        # for the PNS-first rollout). Anybody in PNS may take a ticket, hand one over or
        # put one back — waiting for the Head to place every ticket is the kind of queue
        # nobody works. The Head keeps the oversight that matters: every move is written
        # to the audit log and the ticket history with a name on it.
        #
        # It applies to ANY ticket, not only PNS-priced ones: a Sales-priced ticket still
        # has a PNS reviewer, and gating on resp left those unassignable.
        "assign":           u.group == "PNS" or admin,
        # Seeing how loaded the team is, so "who should take this?" is answerable now
        # that anyone in PNS can take it. Deliberately NOT the same permission as
        # assign: this screen also carries per-person win counts and days-to-clear,
        # which is a performance comparison and stays the Head's — see workload().
        "seeWorkload":      u.group == "PNS" or admin,
        # assignReviewer is retired (Baskoro, 2026-08-14). The separate "PNS price
        # reviewer" slot asked a second question — who is checking this? — on top of the
        # one that matters, who owns this, and nothing a reader could see told them
        # apart. The PNS PIC is now the single assignment. A second opinion is asked for
        # in the discussion thread, where it is written down; PSP remains the formal
        # margin check.
        #
        # `tickets.reviewer_name` is deliberately left in the schema. Dropping it needs a
        # migration, two people deploy into this database from separate clones, and a
        # column nothing reads costs nothing — see the V15/V20 story in the handoff.
        # Nothing writes it any more, so the values there are frozen history.
        "markReviewed":     u.group == "PNS" or admin,
        # Sales Planning corrects submissions on Sales' behalf. PNS is here too because
        # during the Sales CRM rollout most intake arrives imported and incomplete, and
        # waiting for Sales to fill it in would stall the solutioning it exists to feed.
        "editInput":        u.group in ("Commercial", "Sales Planning", "PNS") or admin,
        # Potential revenue and account type are the two intake fields that RE-ROUTE the
        # ticket, so they were the Sales Head's alone. During the PNS-first pilot that is
        # backwards (Baskoro, 2026-08-14): Sales is not on the platform yet, a quarter of
        # imported opportunities arrive with revenue 0, and revenue 0 is the single thing
        # that stops a ticket moving at all. Leaving the fix with the one role that is not
        # using the app meant PNS could see exactly what was wrong and not correct it.
        #
        # So PNS gets both while PNS_PILOT is on, and loses them the day Sales starts
        # working its own queues — by then Sales is there to fix its own intake. Every
        # edit re-runs route() on the corrected facts and is written to the ticket
        # history with a name and the before/after, so a re-route is never silent.
        "editAcctOrRev":    com_head or (PNS_PILOT and u.group == "PNS"),
        # Handing a deal to another salesperson is the Sales Manager's and Head's call in
        # general — and the current PIC's own call on their own ticket (Baskoro,
        # 2026-08-14). Somebody going on leave, or who picked the deal up and found it
        # belongs to a colleague's account, should not need a manager to type the name.
        # They can only hand it away: once it is somebody else's, it is somebody else's,
        # so this is not a route to taking a colleague's deal.
        #
        # With no ticket in hand (the /api/me permission map) this answers for the
        # control being rendered at all, and the endpoint re-checks with the ticket.
        "setSales":         com_mgr or (u.group == "Commercial" and (
                                t is None
                                or (t.get("sales_email") or "").lower() == u.email.lower())),
        # Any salesperson may put a lost or cancelled deal back into the pipeline —
        # Sales owns the shipper relationship that reopening reflects. (Was Head only.)
        "reopen":           u.group == "Commercial" or admin,
        "pspDecide":        u.group == "PSP" or admin,
        # The second signature inside PSP. Staff form the opinion, the Head owns it.
        "pspHeadDecide":    admin or (u.group == "PSP" and u.level == "head"),
        # Standing delegation so an absent PSP cannot stall the pipeline. Used through
        # the same endpoint, recorded as an override, see psp_decide.
        "pspOverride":      pns_head,
        "vendorToggle":     u.group == "PNS" or admin,
        "sendToPsp":        u.group in ("PNS", "Commercial") or admin,
        "acceptProposal":   u.group == "Commercial" or admin,
        "sendBackProposal": u.group in ("Commercial", "PNS") or admin,
        "seeMargin":        u.group in ("PNS", "PSP", "CSO") or admin,
        # CAPA is the QC team's process. Commercial can still raise one, they hear the
        # complaint first, and PNS still writes the proposal, but QC decides when it is
        # actually closed, which is the part that makes it theirs.
        "capaRaise":        u.group in ("Commercial", "QC") or admin,
        "capaClose":        u.group == "QC" or admin,
        "capaSubmit":       u.group in ("PNS", "QC") or admin,
        # Registering people and setting roles: the PNS Admin and the PNS Head, as
        # agreed. Granting the Admin group itself is narrower, see grant_admin.
        "manageUsers":      pns_head,    # pns_head already includes Admin
        # The sync ignore list. Admin-only and deliberately out of the main nav: it
        # makes deals silently not appear, which is a thing to do rarely and on purpose.
        "manageIgnored":    admin,
        "grantAdmin":       admin,
        # Pulling from Sales CRM runs under a personal API key, so whoever triggers it
        # reads with that person's Sales CRM permissions. Until a service account exists
        # it stays with one named owner, otherwise the same sync returns different
        # results depending on who pressed the button.
        "syncSalesCrm":     u.email.lower() == SYNC_OWNER_EMAIL or admin,
        # PSP works one shared, unassigned queue. There is no PIC: naming one only
        # created a second question ("who has this?") on top of the one that matters
        # ("has it been decided?"), and any PSP member may decide any ticket anyway.
        # Kept declared so /api/me keeps sending it while the UI is retired.
        "pspAssign":        False,
        # Only the PNS Head may open a non-managed ticket to PSP, and only on an
        # exception Alex granted verbatim. See allow_psp.
        "allowPsp":         pns_head,
    }.get(action, False)


def require(u: User, action: str, t: dict | None = None) -> None:
    if not can(u, action, t):
        raise HTTPException(403, f"{u.group} ({u.level}) may not {action}")


# Pilot period: the whole tool runs inside PNS first, so PNS also works the Sales side
# — attaching Sales-owed prices, below-floor included. (It also used to cover the PNS
# Head acknowledging in the Sales Head's place; that gate is gone.) It additionally
# carries PNS's right to correct revenue and account type. Set PNS_PILOT=0 the day
# Sales starts working its own queues; every rule then snaps back without a deploy.
PNS_PILOT = os.getenv("PNS_PILOT", "1").strip().lower() not in ("0", "false", "")


def attach_price(u: User, t: dict) -> bool:
    """Only the side that owes the price may attach it (PNS covers both in the pilot)."""
    if u.group == "Admin":
        return True
    if u.group == "PNS":
        return PNS_PILOT or t["resp"] == "PNS"
    return u.group == "Commercial" and t["resp"] == "Sales"


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
    but they must not restart status_since, that is what the SLA counts."""
    await execute("INSERT INTO ticket_history (ticket_id, status, actor, note) "
                  "VALUES (%s,%s,%s,%s)", (ticket_id, status, actor, note or None))


async def log_status(ticket_id: int, status: str, actor: str, note: str = "") -> None:
    await log_note(ticket_id, status, actor, note)
    await execute("UPDATE tickets SET status=%s, status_since=NOW() WHERE id=%s",
                  (status, ticket_id))


async def notify(body: str, groups=(), roles=(), people=(), ticket_ref: str | None = None,
                 subject: str | None = None) -> None:
    """Record a notification, and email it if it names specific people.

    `people` is the "this is aimed at you" channel, assigned, tagged, sent back. Those
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
    to named people, falling back to the relevant head when the slot is empty, never to
    silence. An unassigned ticket sent back to PNS used to notify no one at all.
    """
    owner, sales = t.get("owner_name"), t.get("sales_name")

    if status == "Pending PNS":
        return [owner] if owner else await names_in("PNS", head_only=True) or await names_in("PNS")
    if status == "Pending Review - Head PNS":
        # The ticket's PNS PIC. This used to prefer a separately-assigned reviewer; that
        # slot was retired on 2026-08-14 and there is one assignment now.
        return [owner] if owner else await names_in("PNS", head_only=True) or await names_in("PNS")
    if status == "Pending Sales":
        return [sales] if sales else await names_in("Commercial", head_only=True)
    if status == "Pending Vendor":
        return [owner] if owner else await names_in("PNS", head_only=True)
    if status == "Pending Review - PSP":
        return await names_in("PSP")
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
    the database's own clock, the app container and OceanBase disagree about the
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
BUILD = "2026-08-21.62"


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
    sales: str | None
    region: str | None
    submitted_on: str
    sla_elapsed: int
    sla_target: int
    margin: float | None = None   # omitted for roles without seeMargin
    price_file: str | None = None
    price_url: str | None = None
    open_questions: int = 0
    psp_assignee: str | None = None
    psp_ready: bool = False   # PSP cleared it without needing PNS review, awaiting final submit
    psp_allowed: bool = False # non-managed ticket opened to PSP on Alex's exception
    psp_decision: str | None = None   # approved | rejected | None, PSP's latest decision, if any
    stage: str | None = None  # Sales CRM's commercial stage, reference only — NOT our status
    # The number a salesperson actually has in front of them. Blank on a ticket raised
    # by hand in this app, which is how you tell the two apart in a list.
    opportunity_id: str | None = None
    opportunity_name: str | None = None
    # When Sales CRM says the deal was raised, and when this app first saw it. Two
    # different facts: the gap between them is how long PNS was unaware of a live deal.
    first_synced_on: str | None = None
    # The onboarding facts, so the Onboarding screens can list them without a request
    # per ticket. Keys match the intake payload.
    input: dict = {}
    # Which Sales CRM records this ticket is tied to, and how to open them. Both levels
    # are shown because the tier comes from the account group while the deal (and Must
    # Win) comes from the opportunity — seeing only one of the two makes the tier look
    # arbitrary.
    must_win: bool = False
    # Why Sales CRM says the deal was lost, in its own words. Our own loss_reason stays
    # the seven-value enum; this is what the dashboard shows for a synced loss, because
    # "Closed in Sales CRM" is not a reason anybody can act on.
    crm_loss_reason: str | None = None
    group: str | None = None          # Hypercare | Strategic | Must Win | None
    account_id: str | None = None
    account_name: str | None = None
    parent_account_id: str | None = None
    opp_url: str | None = None
    account_url: str | None = None


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
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # xlsx
    "application/vnd.ms-excel",                                           # xls
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", # docx
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
            413, f"{file.filename} is {len(data) // 1024 // 1024} MB, the limit is 5 MB. "
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
    # Every action the frontend gates on must be listed here. A permission that exists in
    # can() but is missing from this list is not a 403: it arrives as undefined, the nav
    # entry or button silently never renders, and the feature looks like it was never
    # built. Add the name here in the same edit that adds it to can().
    actions = ["createTicket", "deleteTicket", "restoreTicket", "purgeTicket",
               "assign", "seeWorkload", "markReviewed", "editInput", "editAcctOrRev",
               # setAcct was declared here and in can() and checked by absolutely
               # nothing — the account tier is edited through editAcctOrRev like the
               # revenue beside it. Removed rather than left looking live.
               "setSales", "reopen", "pspDecide", "vendorToggle", "sendToPsp",
               "acceptProposal", "sendBackProposal", "seeMargin", "capaRaise",
               "capaClose", "capaSubmit", "manageUsers", "grantAdmin", "setPricedBy",
               "pspAssign", "pspOverride", "allowPsp", "syncSalesCrm",
               "pspHeadDecide", "manageIgnored"]
    return Me(email=u.email, name=u.name, group=u.group, level=u.level, team=u.team,
              permissions={a: can(u, a) for a in actions},
              sso=u.sso, dev_fallback=not u.sso and bool(DEV_USER))


def shape(t: dict, u: User) -> Ticket:
    out = Ticket(
        ref=t["ticket_ref"], shipper=t["shipper"], acct_type=t["acct_type"],
        service=t["service_type"], revenue=int(t["potential_rev"]), status=t["status"],
        priced_by=t["resp"], needs_review=needs_pns_review(t),
        owner=t["owner_name"], sales=t["sales_name"],
        region=t["region"], submitted_on=str(t["submitted_on"]),
        sla_elapsed=sla_days_elapsed(t), sla_target=int(t["sla_days"]),
        price_file=t.get("price_file"), price_url=t.get("price_url"),
        open_questions=int(t.get("open_q") or 0),
        psp_assignee=t.get("psp_assignee"), psp_ready=bool(t.get("psp_ready")),
        psp_allowed=bool(t.get("psp_allowed")),
        psp_decision=t.get("psp_decision"),
        stage=t.get("stage"),
        opportunity_id=(str(t["opportunity_id"]) if t.get("opportunity_id") else None),
        opportunity_name=t.get("opportunity_name"),
        first_synced_on=(str(t["first_synced_at"])[:10] if t.get("first_synced_at") else None),
        must_win=bool(t.get("must_win")),
        crm_loss_reason=((f"{t['ob_loss']} — {t['ob_loss_detail']}"
                          if t.get("ob_loss_detail") and t.get("ob_loss_detail") != "null"
                          else t["ob_loss"])
                         if t.get("ob_loss") and t.get("ob_loss") != "null" else None),
        group=big_group(t),
        account_id=(str(t["account_id"]) if t.get("account_id") else None),
        account_name=t.get("account_name"),
        parent_account_id=(str(t["parent_account_id"]) if t.get("parent_account_id") else None),
        opp_url=opp_link(t.get("opportunity_id")),
        account_url=account_link(t.get("account_id")),
        input={k: v for k, v in (
            ("golive", t.get("ob_golive")), ("shipperId", t.get("ob_shipper_id")),
            ("parentShipperId", t.get("ob_parent_id")), ("branchId", t.get("ob_branch_id")),
            ("rdo", t.get("ob_rdo")), ("rdoNotes", t.get("ob_rdo_notes")),
            ("rdoFiles", (str(t["ob_rdo_files"]) if t.get("ob_rdo_files") else None)),
        ) if v and v != "null"},
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
    stage: str | None = None,
    acct_type: str | None = None,
    must_win: bool = False,
    # Comma-separated, because the meeting screens pick several at once: a review is run
    # for a set of regions, not for one.
    region: str | None = None,
    # Opportunities Commercial has said carry RDO. It is an intake Yes/No, so this is a
    # JSON read rather than a column — see the RDO reference page.
    rdo: bool = False,
    owner: str | None = None,
    sales: str | None = None,
    sales_manager: str | None = None,   # email — everyone reporting to this manager
    sales_head: str | None = None,      # email — the whole line under this head
    submitted_from: str | None = None,
    submitted_to: str | None = None,
    search: str | None = None,
    awaiting: bool = False,
    mine: bool = False,
    psp_reviewed: bool = False,
    # Onboarding, which is a different job from solutioning and gets its own screens.
    #   onboarding=ready   won, but still missing a shipper ID or a go-live date
    #   onboarding=live    won and both filled in — Ops can act on it
    onboarding: str | None = None,
):
    sql = ("SELECT t.*, s.name AS shipper, s.acct_type, s.account_id, s.account_name, "
           "s.parent_account_id, p.margin_pct, p.price_file, p.price_url, "
           "(SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id=t.id "
           "AND c.is_question=1 AND c.resolved_at IS NULL) AS open_q, "
           "(SELECT a.decision FROM approvals a WHERE a.ticket_id=t.id AND a.kind='psp' "
           "ORDER BY a.decided_at DESC LIMIT 1) AS psp_decision, "
           "TIMESTAMPDIFF(DAY, t.status_since, NOW()) AS sla_days_db, "
           # The four onboarding facts, read straight out of the intake payload. They
           # travel on every row because the Onboarding screens are lists, and fetching
           # each ticket individually to find a go-live date would be a request per row.
           "JSON_UNQUOTE(JSON_EXTRACT(i.payload,'$.golive')) AS ob_golive, "
           "JSON_UNQUOTE(JSON_EXTRACT(i.payload,'$.shipperId')) AS ob_shipper_id, "
           "JSON_UNQUOTE(JSON_EXTRACT(i.payload,'$.parentShipperId')) AS ob_parent_id, "
           "JSON_UNQUOTE(JSON_EXTRACT(i.payload,'$.branchId')) AS ob_branch_id, "
           # RDO is a 5A customization lever, not an onboarding fact, but it rides along
           # here for the same reason the others do: the RDO reference page is a list,
           # and fetching each ticket individually to read one intake field would be a
           # request per row.
           "JSON_UNQUOTE(JSON_EXTRACT(i.payload,'$.rdo')) AS ob_rdo, "
           "JSON_UNQUOTE(JSON_EXTRACT(i.payload,'$.crmLossReason')) AS ob_loss, "
           "JSON_UNQUOTE(JSON_EXTRACT(i.payload,'$.crmLossDetail')) AS ob_loss_detail, "
           "JSON_UNQUOTE(JSON_EXTRACT(i.payload,'$.rdoNotes')) AS ob_rdo_notes, "
           "(SELECT COUNT(*) FROM ticket_files tf WHERE tf.ticket_id=t.id "
           " AND tf.kind='rdo_evidence') AS ob_rdo_files "
           "FROM tickets t JOIN shippers s ON s.id=t.shipper_id "
           "LEFT JOIN pricing p ON p.ticket_id=t.id "
           "LEFT JOIN ticket_input i ON i.ticket_id=t.id "
           "WHERE t.deleted_at IS NULL")
    args: list = []

    # The "Finished" PSP queue: every ticket PSP has ever decided on, regardless of where
    # it sits now, a ticket can be back in Pending Review - PSP for a fresh round and
    # still show up here with its prior outcome.
    if psp_reviewed:
        sql += (" AND EXISTS (SELECT 1 FROM approvals a WHERE a.ticket_id=t.id "
               "AND a.kind='psp')")

    # Everyone signed in may browse the whole pipeline — active, pending and closed.
    # Baskoro's call (2026-08-11): visibility is open to every role; what stays gated
    # is acting, which can() enforces per action. Margin remains behind seeMargin.
    # (Legal used to be narrowed to accepted deals only; that narrowing is overruled.)

    # "Mine" means the tickets this person is answerable for, which differs by role:
    # a salesperson owns what they raised, a PNS member owns what they were assigned.
    # Matching on email rather than name, names get re-typed, addresses do not.
    if mine:
        if u.group == "PNS":
            sql += " AND t.owner_name=%s"; args.append(u.name)
        else:
            sql += " AND t.sales_email=%s"; args.append(u.email)

    if awaiting:
        # Placeholders generated from the tuple, never hand-counted: adding "Open" to
        # AWAIT_STATUSES against three literal %s is what made this endpoint 500.
        marks = ",".join(["%s"] * len(AWAIT_STATUSES))
        sql += f" AND t.status IN ({marks})"; args += list(AWAIT_STATUSES)
        # Queue by who owes the price; a vendor wait is visible to both sides. During
        # the pilot PNS works the Sales side too, so their queue is left unscoped.
        if u.group == "PNS" and not PNS_PILOT:
            sql += " AND (t.resp=%s OR t.status=%s)"; args += ["PNS", "Pending Vendor"]
        elif u.group == "Commercial":
            sql += " AND (t.resp=%s OR t.status=%s)"; args += ["Sales", "Pending Vendor"]

    if status:
        marks = ",".join(["%s"] * len(status.split(",")))
        sql += f" AND t.status IN ({marks})"; args += status.split(",")
    if service:
        marks = ",".join(["%s"] * len(service.split(",")))
        sql += f" AND t.service_type IN ({marks})"; args += service.split(",")
    if stage:
        # Sales CRM's commercial stage, carried on imported tickets. "__none__" finds
        # the tickets that were raised here and never came from Sales CRM at all.
        if stage == "__none__":
            sql += " AND t.stage IS NULL"
        else:
            marks = ",".join(["%s"] * len(stage.split(",")))
            sql += f" AND t.stage IN ({marks})"; args += stage.split(",")
    if onboarding:
        # Onboarding starts where solutioning ends: an accepted proposal. What separates
        # "ready to onboard" from "handed over" is whether Sales has supplied the two
        # facts Ops cannot work without — the shipper ID and the go-live date. Both live
        # in the intake payload, so they are read with JSON_EXTRACT rather than columns.
        sql += " AND t.status=%s"; args.append("Proposal Accepted / Ready to Ship")
        have = ("(JSON_UNQUOTE(JSON_EXTRACT(i.payload,'$.shipperId')) NOT IN ('','null') "
                "AND JSON_UNQUOTE(JSON_EXTRACT(i.payload,'$.golive')) NOT IN ('','null') "
                "AND JSON_EXTRACT(i.payload,'$.shipperId') IS NOT NULL "
                "AND JSON_EXTRACT(i.payload,'$.golive') IS NOT NULL)")
        sql += f" AND {'' if onboarding == 'live' else 'NOT '}{have}"
    if must_win:
        sql += " AND t.must_win=1"
    if region:
        marks = ",".join(["%s"] * len(region.split(",")))
        sql += f" AND t.region IN ({marks})"; args += region.split(",")
    if rdo:
        # Written by the intake form as the string "Yes". Compared case-insensitively
        # because it has also been corrected by hand, and "yes" is the same answer.
        sql += " AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(i.payload,'$.rdo')))=%s"
        args.append("yes")
    if acct_type:
        # The tier (Strategic/Hypercare/Standard) — imported from the Sales CRM
        # account group's customer_success_manager field, correctable in-app.
        marks = ",".join(["%s"] * len(acct_type.split(",")))
        sql += f" AND s.acct_type IN ({marks})"; args += acct_type.split(",")
    if owner:
        sql += " AND t.owner_name=%s" if owner != "__unassigned__" else " AND t.owner_name IS NULL"
        if owner != "__unassigned__":
            args.append(owner)
    if sales:
        sql += " AND t.sales_name=%s"; args.append(sales)
    if sales_manager:
        # Everything owned by the people who report to this manager. Resolved through
        # the users table rather than stored on the ticket, so moving someone between
        # managers re-scopes their history too, which is what a manager expects.
        sql += (" AND t.sales_email IN (SELECT email FROM users "
                "WHERE manager_email=%s OR email=%s)")
        args += [sales_manager, sales_manager]
    if sales_head:
        sql += (" AND t.sales_email IN (SELECT email FROM users "
                "WHERE head_email=%s OR manager_email=%s OR email=%s)")
        args += [sales_head, sales_head, sales_head]
    if submitted_from:
        sql += " AND t.submitted_on >= %s"; args.append(submitted_from)
    if submitted_to:
        sql += " AND t.submitted_on <= %s"; args.append(submitted_to)
    if search:
        # With the Sales CRM sync live, the number a salesperson has in front of them is
        # the opportunity id, not our ticket ref, and searching it used to return nothing.
        sql += (" AND (s.name LIKE %s OR t.ticket_ref LIKE %s "
                "OR t.opportunity_id LIKE %s OR t.opportunity_name LIKE %s)")
        args += [f"%{search}%"] * 4

    sql += " ORDER BY t.submitted_on DESC LIMIT 500"
    rows = await q(sql, tuple(args))
    return {"tickets": [shape(r, u) for r in rows], "total": len(rows)}


class AccountRow(BaseModel):
    """One Sales CRM account and every ticket under it."""
    shipper_id: int
    shipper: str
    account_id: str | None
    account_url: str | None
    parent_account_id: str | None
    # The account GROUP. Hypercare and Strategic are inherited from it, so an account
    # whose parent is not linked is one whose tier nobody can explain from this screen.
    parent_account_url: str | None = None
    parent_account_name: str | None = None
    # Sibling shippers under the same parent, so a group reads as a group.
    siblings_in_group: int = 0
    acct_type: str
    region: str | None
    group: str | None            # Hypercare | Strategic | Must Win | None
    # Counted across the whole account, not per deal: this is the number somebody means
    # when they ask "how big is this shipper", and it is not on any single ticket.
    open_tickets: int
    total_revenue: int
    won: int
    lost: int
    services: list[str]
    owners: list[str]
    sales: list[str]
    last_activity: str | None
    tickets: list[Ticket]


class AccountList(BaseModel):
    accounts: list[AccountRow]
    total: int


@app.get("/api/accounts", response_model=AccountList)
async def accounts(u: User = Depends(current_user),
                   group: str | None = None,      # Hypercare | Strategic | Must Win
                   search: str | None = None,
                   open_only: bool = False):
    """Every ticket, grouped by the account it belongs to.

    A ticket is raised per opportunity and always will be — that is the level Sales CRM
    works at and the level a solution is actually built at. But nobody manages a shipper
    one opportunity at a time: the tier is an account fact, the relationship is an account
    fact, and a list of per-deal tickets makes one account with four live deals look like
    four unrelated shippers (and, at a glance, like duplicates). So the same tickets are
    also served grouped, and this is that view. Nothing is stored twice; the grouping is
    done here.

    An account is a `shippers` row — which carries the Sales CRM account_id when the deal
    came from the sync. Where one account has arrived under two names, both rows appear;
    /api/diagnostics/duplicates is what finds them."""
    rows = await q(
        "SELECT t.*, s.name AS shipper, s.acct_type, s.account_id, s.account_name, "
        "s.parent_account_id, p.margin_pct, p.price_file, p.price_url, "
        "(SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id=t.id "
        "AND c.is_question=1 AND c.resolved_at IS NULL) AS open_q, "
        "TIMESTAMPDIFF(DAY, t.status_since, NOW()) AS sla_days_db "
        "FROM tickets t JOIN shippers s ON s.id=t.shipper_id "
        "LEFT JOIN pricing p ON p.ticket_id=t.id "
        "WHERE t.deleted_at IS NULL ORDER BY t.submitted_on DESC")

    buckets: dict[int, list[dict]] = {}
    for r in rows:
        buckets.setdefault(int(r["shipper_id"]), []).append(r)

    # The account group. Sales CRM's parent account is an id on every child, and the
    # parent is usually itself a shipper we hold — so its name is already here and does
    # not need a Sales CRM call. Where it is not, the id is still a working link.
    parent_names: dict[str, str] = {}
    group_size: dict[str, int] = {}
    for r in rows:
        aid, pid = str(r.get("account_id") or ""), str(r.get("parent_account_id") or "")
        if aid:
            parent_names.setdefault(aid, r["shipper"])
        if pid:
            group_size.setdefault(pid, 0)
    seen_ship: set[tuple] = set()
    for r in rows:
        pid = str(r.get("parent_account_id") or "")
        key = (pid, int(r["shipper_id"]))
        if pid and key not in seen_ship:
            seen_ship.add(key)
            group_size[pid] = group_size.get(pid, 0) + 1

    out: list[AccountRow] = []
    for sid, rs in buckets.items():
        live = [r for r in rs if r["status"] not in ("Lost", "Cancel",
                                                     "Proposal Accepted / Ready to Ship")]
        if open_only and not live:
            continue
        head = rs[0]
        # The account's own group. Hypercare/Strategic sit on the account, so they apply
        # to all of it; Must Win sits on one deal, so an account counts as Must Win when
        # any live deal under it carries the tag.
        acct_group = (head["acct_type"] if head["acct_type"] in MANAGED_ACCTS
                      else ("Must Win" if any(r.get("must_win") for r in rs) else None))
        if group and acct_group != group:
            continue
        if search and search.lower() not in str(head["shipper"] or "").lower():
            continue
        out.append(AccountRow(
            shipper_id=sid, shipper=head["shipper"],
            account_id=(str(head["account_id"]) if head.get("account_id") else None),
            account_url=account_link(head.get("account_id")),
            parent_account_id=(str(head["parent_account_id"])
                               if head.get("parent_account_id") else None),
            parent_account_url=account_link(head.get("parent_account_id")),
            parent_account_name=parent_names.get(str(head.get("parent_account_id") or "")),
            siblings_in_group=max(0, group_size.get(
                str(head.get("parent_account_id") or ""), 0) - 1),
            acct_type=head["acct_type"], region=head.get("region"), group=acct_group,
            open_tickets=len(live),
            total_revenue=sum(int(r["potential_rev"] or 0) for r in live),
            won=sum(1 for r in rs if r.get("outcome") == "accepted"),
            lost=sum(1 for r in rs if r.get("outcome") == "lost"),
            services=sorted({r["service_type"] for r in rs if r["service_type"]}),
            owners=sorted({r["owner_name"] for r in rs if r.get("owner_name")}),
            sales=sorted({r["sales_name"] for r in rs if r.get("sales_name")}),
            last_activity=(max(str(r["submitted_on"]) for r in rs) if rs else None),
            tickets=[shape(r, u) for r in rs],
        ))

    # Busiest first: an account with four live deals is the one worth opening.
    out.sort(key=lambda a: (-a.open_tickets, -a.total_revenue, a.shipper))
    return {"accounts": out, "total": len(out)}


@app.get("/api/stats", response_model=Stats)
async def stats(u: User = Depends(current_user)):
    rows = await q("SELECT status, outcome FROM tickets WHERE deleted_at IS NULL")
    ongoing = sum(1 for r in rows if str(r["status"]).startswith(("Pending", "Proposal Submitted")))
    won = sum(1 for r in rows if r["outcome"] == "accepted")
    lost = sum(1 for r in rows if r["outcome"] == "lost")
    decided = won + lost
    return {"ongoing": ongoing, "won": won, "lost": lost,
            "win_rate": round(won * 100 / decided) if decided else None,
            # Named total_year but counts every ticket ever: the query has no date
            # filter. The dashboard labels it "all time" to match. Renaming the field
            # would break anything already reading it, so the name stays and the
            # meaning is stated here.
            "total_year": len(rows)}


class NewTicket(BaseModel):
    # Sales CRM is the system of record: the opportunity is raised there first, and this
    # is the number that ties the two together. Blank is allowed at creation but parks
    # the ticket in "Pending CRM ID" until somebody supplies it — see create_ticket.
    opportunity_id: str | None = None
    shipper: str
    service: str
    revenue: int
    brief: str
    sales_email: str | None = None
    acct_type: str = "Standard"
    region: str = "GJ"
    # Must Win is per-deal, so unlike acct_type it belongs on the request rather than on
    # the shipper. Sales CRM carries it as the Lead Source Detail value "Must Win" and a
    # later sync will overwrite whatever is set here, which is correct — Sales CRM is the
    # record. Setting it at intake is for the deal that is tagged in the meeting before
    # anybody edits the opportunity.
    must_win: bool = False
    payload: dict = {}


# ------------------------------------------------------------------ Sales CRM sync
SALESCRM_BASE = os.getenv("SALESCRM_BASE",
                          "https://api.ninjavan.co/global/salescrm/api/v1").rstrip("/")
SALESCRM_API_KEY = os.getenv("SALESCRM_API_KEY", "").strip()
SALESCRM_RECORD_TYPE = os.getenv("SALESCRM_RECORD_TYPE", "Indonesia").strip()
# Where a human opens an opportunity. The API base is not the web app, so this is its
# own setting: {id} is replaced with the opportunity id. Set SALESCRM_OPP_URL in the
# portal to whatever the browser actually shows when Sales open a deal — until then the
# link is not rendered at all, because a button that lands on a 404 is worse than none.
# Verified against the running Sales CRM on 2026-08-12 by opening the records: the web
# app is a different host from the API and routes as /nv/objects/{Object}/records/{id},
# where {id} is the same numeric id the API returns as Opportunity.id / Account.id.
SALESCRM_WEB = os.getenv("SALESCRM_WEB", "https://salescrm.ninjavan.co/nv").rstrip("/")
SALESCRM_OPP_URL = os.getenv(
    "SALESCRM_OPP_URL", f"{SALESCRM_WEB}/objects/Opportunity/records/{{id}}").strip()
SALESCRM_ACCOUNT_URL = os.getenv(
    "SALESCRM_ACCOUNT_URL", f"{SALESCRM_WEB}/objects/Account/records/{{id}}").strip()

# Must Win is not a field of its own — it is a VALUE of Lead Source Detail. Confirmed on
# 2026-08-12 by reading opportunity 906031 in Sales CRM: the Opportunity layout has no
# Must Win field anywhere in its 132 fields, but <input id="lead-source-detail"> carries
# the string "Must Win". The web app's element ids are the API's field names in kebab
# case (new-date -> new_date, lead-source-detail -> lead_source_detail), which is how the
# API key was derived without a describe endpoint.
#
# Read as an exact, case-insensitive match on the whole value rather than a substring:
# Lead Source Detail is free-ish text and "Must Win follow-up call" is a note about a
# must-win deal, not necessarily one. Extra spellings are tolerated because this is typed
# by salespeople, not chosen from a picklist.
MUSTWIN_FIELDS = ("lead_source_detail", "leadSourceDetail", "lead_source_detail__c")
MUSTWIN_TRUE = ("must win", "must-win", "mustwin")


def read_must_win(o: dict) -> tuple[bool, str | None]:
    """(is must win, which field said so). False with None when nothing matched."""
    for key in MUSTWIN_FIELDS:
        if key not in o:
            continue
        v = str(o.get(key) or "").strip().lower()
        if v in MUSTWIN_TRUE:
            return True, key
        if v:
            # The field is present and says something else, which is a real answer:
            # this deal is not must-win. Reported so the refresh may clear the flag.
            return False, key
    return False, None


# ------------------------------------------------------------------ field mapping
#
# Every Sales CRM field this app copies into the intake, in one table, walked by BOTH the
# first import and every later refresh. Before this, the import read fifteen fields and
# the refresh re-read two of them, so anything Sales filled in after a deal was imported
# — a volume, a destination, a close date — stayed blank here forever and the ticket was
# quietly less true every week.
#
# Each row is (payload key, Sales CRM field names in preference order, label, owned).
#
#   owned=True    Sales CRM's fact. A refresh overwrites ours, because a copy that
#                 disagrees with its source is worse than no copy.
#   owned=False   Sales CRM's starting point. A refresh fills it in only while ours is
#                 still blank — PNS corrects these here on purpose (Sales CRM has no
#                 idea what the real pickup window turned out to be) and an overwrite
#                 would undo the correction every morning.
#
# Field names Sales CRM does not send are simply absent, so listing a candidate costs
# nothing; `unmapped` in the sync result is what reports the fields it DOES send that
# nothing here reads yet, which is how this list grows on evidence instead of guesswork.
CRM_OPP_PAYLOAD = [
    ("volume",       ["expected_vol_mth", "total_potential_volume"],
     "Est. volume per month", True),
    ("dest",         ["delivery_areas", "delivery_area", "destination"],
     "Destination", True),
    ("pickup",       ["pickup_areas", "pickup_area", "pickup_address"],
     "Pickup address", True),
    ("pickSlot",     ["pickup_timing", "jadwal_pick_up"], "Pickup time slot", True),
    ("delSlot",      ["delivery_slas", "delivery_timing"], "Delivery time slot", True),
    ("freq",         ["frequency_of_shipment", "delivery_frequency", "shipment_frequency"],
     "Delivery frequency", True),
    # Was the one exception to "Sales CRM always wins", because `expected_close_date` is
    # when the DEAL closes and go-live is when the shipper starts shipping. Baskoro's
    # field list (2026-08-18) shows Sales CRM has **target_start_date**, which is the
    # field this should have been reading all along — so the exception is gone and the
    # rule applies here like everywhere else. expected_close_date is kept as a fallback
    # for opportunities raised before anyone filled the right one in.
    ("golive",       ["target_start_date", "expected_close_date"], "Go-live date", True),
    ("shipperPic",   ["contact_name", "primary_contact_name"], "Shipper PIC", True),
    ("shipperContact", ["contact_phone", "primary_contact_phone", "contact_mobile"],
     "Contact shipper PIC", True),
    ("notes",        ["description", "next_step"], "Notes", True),
    # Every one of these is a question the intake form ALREADY asks and Sales CRM already
    # holds the answer to (Baskoro's field list, 2026-08-18). Asking a salesperson to
    # retype what they typed in Sales CRM an hour ago is how intake ends up half empty.
    ("wt",           ["weight_per_shipment"], "Parcel weight (kg)", True),
    ("dim",          ["size_paket"], "Parcel dimension / size", True),
    ("sla",          ["service_level"], "SLA", True),
    ("cod",          ["cash_on_delivery_cod"], "COD", True),
    ("ins",          ["insurance"], "Insurance", True),
    ("handling",     ["shipping_requirements"], "Custom handling request", True),
    # Sales CRM's own numbers. Reported on alongside potential revenue, and both change
    # as a deal is negotiated, so these are re-read every time.
    ("committedRev", ["committed_revenue_mth"], "Committed revenue / month", True),
    ("sfCloseDate",  ["closed_won_date", "close_date"], "Sales CRM close date", True),
    ("crmLeadSource", ["lead_source"], "Lead source", True),
    ("crmLeadSourceDetail", ["lead_source_detail", "leadSourceDetail"],
     "Lead source detail", True),
    ("crmProbability", ["probability"], "Probability", True),
    ("sfid",         ["salesforce_opportunity_id"], "Legacy Salesforce id", True),

    # ---------------------------------------------------------------- reference only
    # Carried onto the ticket but not onto the intake form: these are facts PNS reads
    # while pricing rather than fields anybody fills in here. They show up under
    # "Carried from Sales CRM" on Reference / Fields and in the Sales CRM record panel.
    #
    # The pricing ones matter most — a discount and a credit term that Sales has already
    # promised the shipper are exactly the numbers a pricer needs before quoting, and
    # until now they were only visible by opening Sales CRM in another tab.
    ("crmDiscount",      ["shipper_discount_n"], "Shipper discount % (Sales CRM)", True),
    ("crmCreditTerms",   ["Credit_Terms_days_n"], "Credit terms, days", True),
    ("crmRateCard",      ["rate_card"], "Rate card named in Sales CRM", True),
    ("crmBillingWeight", ["billing_weight_logic"], "Billing weight logic", True),
    ("crmTotalWeightMth", ["total_weight_per_month"], "Total weight / month", True),
    ("crmDropOffPoints", ["No_of_Drop_off_Points"], "Drop-off points", True),
    ("crmRestockFreq",   ["Frequency_of_Restocks"], "Restock frequency", True),
    ("crmBulky",         ["bulky_potential"], "Bulky potential", True),
    ("crmBulkyRange",    ["bulky_weight_range"], "Bulky weight range", True),
    # COD and insurance economics. Both are levers with fees attached, and both were
    # yes/no questions here while Sales CRM held the actual numbers.
    ("crmCodFee",        ["COD_Fee_n"], "COD fee", True),
    ("crmCodMinFee",     ["cod_minimum_fee_n"], "COD minimum fee", True),
    ("crmInsuranceFee",  ["insurance_fee"], "Insurance fee %", True),
    ("crmInsuranceMin",  ["insurance_minimum_fee"], "Insurance minimum fee", True),
    ("crmMaxLiability",  ["Max_Insurance_Liability_n"], "Max insurance liability", True),
    # Why the deal was lost, in Sales CRM's own words. Our loss_reason stays our own
    # short enum — the sync sets it to "Closed in Sales CRM" — but the real reason is
    # worth carrying, because "salescrm" answers nothing in a win/loss review.
    ("crmLossReason",    ["loss_reason"], "Loss reason (Sales CRM)", True),
    ("crmLossDetail",    ["detailed_lost_reason"], "Detailed lost reason", True),
    ("crmCompetitor",    ["competitor"], "Competitor", True),
    # Onboarding and billing. Ops and Finance chase these by hand today.
    ("crmShipperEmail",  ["shipper_email"], "Shipper email", True),
    ("crmTaxId",         ["shipper_tax_id"], "Shipper tax ID", True),
    ("crmBankName",      ["bank_name"], "Bank name", True),
    ("crmBankAccount",   ["bank_account_number"], "Bank account number", True),
    ("crmBankOwner",     ["bank_account_owner"], "Bank account owner", True),
    ("crmCodReconAcct",  ["rekening_rekonsiliasi_cod"], "COD reconciliation account", True),
    ("crmEmailClaim",    ["email_claim"], "Claims email", True),
    ("crmEmailOnHold",   ["email_on_hold"], "On-hold email", True),
    ("crmEmailCodRecon", ["email_rekonsiliasi_cod"], "COD reconciliation email", True),
    # The four named contacts. Contact Lookups, so the value may arrive as an id rather
    # than a name — carried verbatim either way, and the raw record on the ticket shows
    # what actually came back.
    ("crmBillingPic",    ["billing_person_lookup"], "Billing PIC (Sales CRM)", True),
    ("crmLiaisonPic",    ["liaison_person_lookup"], "Liaison PIC (Sales CRM)", True),
    ("crmReturnsPic",    ["returns_person_lookup"], "Returns PIC (Sales CRM)", True),
    ("crmReservationPic", ["reservation_person_lookup"], "Reservation PIC (Sales CRM)", True),
    ("crmDataEntry",     ["data_entry"], "Data entry required", True),
    ("crmBreachClaim",   ["breach_claim"], "Breach claim", True),
]

CRM_ACCOUNT_PAYLOAD = [
    ("commodity",  ["industry"], "Commodity", True),
    ("shipperId",  ["global_id"], "Shipper ID", True),
    ("invAddr",    ["billing_address", "address"], "Invoicing address", True),
    ("crmAccountOwner", ["owner_name"], "Sales CRM account owner", True),
]

# Read straight into ticket columns rather than the payload, so they are listed here only
# to keep the "what does Sales CRM send that we ignore" report honest.
CRM_STRUCTURAL = {
    "id", "name", "stage", "parent_stage", "account_id", "account_name", "owner_name",
    "core_product", "nv_product_line", "total_potential_revenue_mth", "record_type_name",
    "new_date", "created_at", "created_date", "updated_at", "last_modified_date",
}


def _crm_pick(rec: dict, names: list[str]) -> str:
    """First non-empty value among `names`, as a string. Sales CRM returns a field as a
    bare value or as a one-item list depending on the field, hence _first()."""
    for n in names:
        v = _first(rec.get(n))
        s = str(v).strip() if v is not None else ""
        if s and s.lower() != "none":
            return s
    return ""


def crm_payload(o: dict, account: dict | None) -> dict[str, tuple[str, bool]]:
    """Everything Sales CRM has to say about this deal, as {payload key: (value, owned)}."""
    out: dict[str, tuple[str, bool]] = {}
    for key, names, _label, owned in CRM_OPP_PAYLOAD:
        v = _crm_pick(o, names)
        if v:
            out[key] = (v, owned)
    for key, names, _label, owned in CRM_ACCOUNT_PAYLOAD:
        v = _crm_pick(account or {}, names)
        if v:
            out[key] = (v, owned)
    return out


def merge_crm_payload(current: dict, o: dict, account: dict | None) -> dict:
    """Apply the mapping to an existing intake payload and return the merged result.

    Owned fields overwrite; the rest fill blanks only. `_crm` keeps the raw record so a
    field nobody mapped yet is still *here* and visible on the ticket, rather than being
    dropped on the floor and needing another sync run once somebody notices."""
    merged = dict(current)
    for key, (value, owned) in crm_payload(o, account).items():
        if owned or not str(merged.get(key) or "").strip():
            merged[key] = value
    snapshot = {k: _first(v) for k, v in (o or {}).items()
                if _first(v) not in (None, "", [], {})}
    if account:
        snapshot["account.name"] = account.get("name")
        snapshot["account.customer_success_manager"] = account.get("customer_success_manager")
    # Underscore-prefixed so nothing that walks the intake (the charter, the edit diff,
    # the remembered-values list) picks it up as a field somebody typed.
    merged["_crm"] = {k: str(v)[:500] for k, v in snapshot.items() if v not in (None, "")}
    return merged


def crm_unmapped(o: dict) -> set[str]:
    """Fields this record carries that nothing above reads. Reported by the sync so the
    map grows from what Sales CRM actually sends rather than from what we assumed."""
    mapped = set(CRM_STRUCTURAL) | set(MUSTWIN_FIELDS)
    for _k, names, _l, _owned in CRM_OPP_PAYLOAD:
        mapped |= set(names)
    return {k for k, v in (o or {}).items()
            if k not in mapped and _first(v) not in (None, "", [], {})}


def _crm_date(o: dict) -> str | None:
    """When Sales CRM says this opportunity was raised, as YYYY-MM-DD.

    new_date is the field Sales CRM populates on every opportunity and it equals the
    creation date, which is why the whole sync is built on it; created_date is the
    fallback for the rare record that lacks one. Returns None rather than guessing, so
    the caller keeps whatever date it already had instead of inventing today's.
    """
    for key in ("new_date", "created_date", "createdDate"):
        v = str(o.get(key) or "").strip()
        if len(v) >= 10 and v[4] == "-" and v[7] == "-":
            return v[:10]
    return None


def opp_link(opportunity_id: str | None) -> str | None:
    if not opportunity_id or not SALESCRM_OPP_URL:
        return None
    return SALESCRM_OPP_URL.replace("{id}", str(opportunity_id))


def account_link(account_id: str | None) -> str | None:
    if not account_id or not SALESCRM_ACCOUNT_URL:
        return None
    return SALESCRM_ACCOUNT_URL.replace("{id}", str(account_id))
# Wall-clock budget for one sync request. The ingress cuts a request at 30s with a bare
# 502, so this has to be comfortably under that: past the budget the sweep returns what
# it has and says so. Measured cost is ~1.1s for a page of 100 opportunities plus ~0.8s
# per account lookup, 93 distinct accounts on a typical page.
SYNC_BUDGET_S = int(os.getenv("SYNC_BUDGET_S", "25") or 25)
# Concurrent Sales CRM reads. At 16 a page of accounts resolves in about 5s instead of
# 73s sequentially, which is the difference between finishing and being cut off.
SYNC_CONCURRENCY = int(os.getenv("SYNC_CONCURRENCY", "24") or 24)
# Ceiling on how many existing tickets get re-read in one run. Fine while PNS holds
# hundreds; revisit if it ever holds thousands.
SYNC_REFRESH_MAX = int(os.getenv("SYNC_REFRESH_MAX", "400") or 400)

# Sales CRM product line -> our service line.
PRODUCT_MAP = {
    "LTL": "LTL",
    "Restock": "B2BR",
    "Parcel": "B2C",
    "Last Mile - Parcel": "B2C",
    "Fulfillment": "Fulfillment",
    "Complex Logistics": "Complex Logistics",
    "Complex Logs": "Complex Logistics",
    # Sales CRM has one Trucking value covering both FTL lines and cannot say which.
    # Imported anyway rather than held back, landing on on-call with a flag for Sales to
    # correct. Safe as a provisional label because the two lines now route identically
    # (both to PNS) and carry identical ceilings, so only the name is uncertain.
    "Trucking": "FTL on-call",
}
FTL_VARIANT_UNKNOWN = "Trucking"
# Deliberately not mapped. Cold chain and cross-border are out of scope for now.
# Trucking is different: Sales CRM has one value covering both FTL lines and they route
# differently, so guessing would put half of them on the wrong team. These are reported
# as skipped with a reason rather than silently dropped.
PRODUCT_SKIP = {
    "Cold Chain": "cold chain is not in scope yet",
    "Cold-chain": "cold chain is not in scope yet",
    "Cross-border": "cross-border is not in scope yet",
    "International": "cross-border is not in scope yet",
    "Air-freight": "air freight is not a PNS service line",
}

# One sync at a time per process. Ten people pressing the button should produce one
# sweep, not ten. The UNIQUE key on opportunity_id is what actually prevents duplicate
# tickets, this only stops the wasted work.
_sync_lock = asyncio.Lock()


def _first(v):
    """Sales CRM returns some fields as a list, some as a bare string, some as null."""
    if isinstance(v, list):
        return v[0] if v else None
    return v


def tier_from_csm(raw) -> str | None:
    """Read Hypercare/Strategic out of Account.customer_success_manager.

    The field is named for a person and is being used for three different things: the
    account tier, legacy Salesforce identifiers from before the in-house migration, and
    junk like '-'. Only the tier words count; a Salesforce id is not an unknown tier."""
    s = str(raw or "").strip()
    if not s or re.fullmatch(r"[0-9A-Za-z]{15,18}", s):
        return None
    if "Hypercare" in s:
        return "Hypercare"
    if "Strategic" in s:
        return "Strategic"
    return None


class SalesCrm:
    """Thin read-only client. Every call is a GET, this never writes to Sales CRM."""

    def __init__(self, client):
        self.c = client
        self._accounts: dict[str, dict] = {}

    async def records(self, obj: str, **params):
        r = await self.c.get(f"{SALESCRM_BASE}/objects/{obj}/records", params=params)
        if r.status_code == 401:
            raise HTTPException(502, "Sales CRM rejected the API key. It may have expired "
                                     "(keys last 30 days). Issue a new one and update "
                                     "SALESCRM_API_KEY.")
        r.raise_for_status()
        return r.json()

    async def account(self, aid) -> dict | None:
        aid = str(aid or "")
        if not aid:
            return None
        if aid not in self._accounts:
            d = await self.records("Account", id=aid)
            items = d.get("items") or []
            self._accounts[aid] = items[0] if items else {}
        return self._accounts[aid] or None

    async def warm_accounts(self, ids) -> None:
        """Fetch many accounts at once into the cache.

        Sales CRM has no bulk-by-id endpoint, so this is still one request per account,
        but run concurrently instead of one after another. Sequentially, a page of 100
        opportunities meant 100 round trips before the first ticket was even considered,
        which put the whole sync past the ingress timeout and returned a bare 502.

        Bounded by SYNC_CONCURRENCY: enough to collapse the wall-clock, low enough not to
        look like an attack to whatever sits in front of Sales CRM."""
        todo = [str(i) for i in ids if str(i or "") and str(i) not in self._accounts]
        if not todo:
            return
        sem = asyncio.Semaphore(SYNC_CONCURRENCY)

        async def one(aid: str):
            async with sem:
                try:
                    await self.account(aid)
                except Exception:
                    # A single unreadable account must not fail the sweep. The caller
                    # sees it as a missing account and reports that opportunity.
                    self._accounts.setdefault(aid, {})

        await asyncio.gather(*(one(a) for a in todo))

    async def tier_for(self, account: dict | None, max_depth: int = 4) -> str:
        """Walk up to the group to find the tier.

        22 of the 25 tagged accounts in Sales CRM are parents, so the tier normally
        lives on the group, but a child may carry its own, and that wins. The walk is
        depth-limited and cycle-guarded because real data contains an account that is
        its own parent, which would otherwise loop forever."""
        seen: set[str] = set()
        a = account
        depth = max_depth
        while a and depth > 0:
            t = tier_from_csm(a.get("customer_success_manager"))
            if t:
                return t
            pid = str(a.get("parent_account_id") or "")
            if not pid or pid == str(a.get("id") or "") or pid in seen:
                break          # missing, self-referencing or looping: treat as no parent
            seen.add(pid)
            a = await self.account(pid)
            depth -= 1
        return "Standard"


# ------------------------------------------------------------------ sync ignore list
class IgnoredRow(BaseModel):
    opportunity_id: str
    reason: str | None
    added_by: str
    added_at: str
    # Whether a ticket was already imported for it before it was ignored. Ignoring does
    # NOT delete anything — it only stops future imports — and not saying so is how
    # somebody concludes the list is broken.
    ticket_ref: str | None = None


class IgnoredList(BaseModel):
    ignored: list[IgnoredRow]


class IgnoreIn(BaseModel):
    opportunity_id: str
    reason: str | None = None


@app.get("/api/salescrm/ignored", response_model=IgnoredList)
async def list_ignored(u: User = Depends(current_user)):
    """Opportunities the sync should never import.

    Deliberately Admin-only and out of the main nav: it makes deals silently not appear,
    which is a thing to do rarely and on purpose."""
    require(u, "manageIgnored")
    rows = await q(
        "SELECT i.opportunity_id, i.reason, i.added_by, i.added_at, "
        "(SELECT t.ticket_ref FROM tickets t WHERE t.opportunity_id=i.opportunity_id "
        " AND t.deleted_at IS NULL LIMIT 1) AS ticket_ref "
        "FROM salescrm_ignored i ORDER BY i.added_at DESC")
    return {"ignored": [IgnoredRow(
        opportunity_id=str(r["opportunity_id"]), reason=r["reason"],
        added_by=r["added_by"], added_at=str(r["added_at"]),
        ticket_ref=r["ticket_ref"]) for r in rows]}


@app.post("/api/salescrm/ignored", status_code=201, response_model=Ok)
async def add_ignored(body: IgnoreIn, u: User = Depends(current_user)):
    require(u, "manageIgnored")
    oid = body.opportunity_id.strip()
    if not oid:
        raise HTTPException(400, "the Sales CRM opportunity id is required")
    # A reason is mandatory for the same purpose it is on the PSP exception: an entry
    # with no recorded why is indistinguishable, months later, from a misclick — and
    # this one makes a deal stop appearing.
    if not (body.reason or "").strip():
        raise HTTPException(400, "say why this opportunity should never be imported")
    await execute(
        "INSERT INTO salescrm_ignored (opportunity_id, reason, added_by) VALUES (%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE reason=VALUES(reason), added_by=VALUES(added_by)",
        (oid, body.reason.strip()[:255], u.name))
    await audit(u.email, "ignore", "salescrm", oid, "reason", None, body.reason.strip()[:255])
    return {"ok": True, "ref": oid, "status": "ignored"}


@app.delete("/api/salescrm/ignored/{oid}", response_model=Ok)
async def remove_ignored(oid: str, u: User = Depends(current_user)):
    require(u, "manageIgnored")
    n = await execute("DELETE FROM salescrm_ignored WHERE opportunity_id=%s", (oid,))
    await audit(u.email, "unignore", "salescrm", oid)
    return {"ok": bool(n), "ref": oid, "status": "will be imported again"}


class SyncIn(BaseModel):
    """Three modes, because "sync everything" is not one job.

    `days`      look for opportunities raised in the last N days. This is the routine
                run. `new_date` is an exact-match filter Sales CRM does support, and it
                is populated on every opportunity, so a day costs one small query instead
                of paging 72,000 records.
    `refresh`   re-read the opportunities behind tickets we already hold, by id. Bounded
                by how many tickets exist, not by the size of Sales CRM.
    `pages`     backfill by paging from the newest. Only for a first import; leave at 0.
    """
    days: int = 7
    refresh: bool = True
    pages: int = 0
    dry_run: bool = True
    # `ids`  import exactly these Sales CRM opportunity ids and nothing else. `id` is a
    #        filterable field, so this is one cheap call per id. Set it and every other
    #        mode is ignored: this run is only about the ids you named. Max 200.
    ids: list[str] = []
    # An explicit window, for backfilling history in chunks small enough to finish. Both
    # inclusive, YYYY-MM-DD. When set, `days` is ignored.
    since: str | None = None
    until: str | None = None
    # Restrict the run to the watched groups (Baskoro, 2026-08-18). Empty = everything,
    # which stays the default: this narrows a run, it does not change what the routine
    # sync does.
    #
    # Sales CRM has no field for any of these. Hypercare and Strategic are resolved by
    # walking the ACCOUNT group up to its parent, and Must Win is the Lead Source Detail
    # value on the opportunity — so the filter can only be applied after the account has
    # been fetched, not as a query parameter. That is why it lives here and not in the
    # request to Sales CRM.
    groups: list[str] = []


# ------------------------------------------------------------------ automatic sync
#
# Sales CRM has no webhooks, so the only way to stay current is to poll. Doing that by
# hand means the app is only as fresh as the last person who remembered to press the
# button, which on a Monday morning is not fresh at all.
#
# Baskoro asked for every 5 minutes (2026-08-14) and that is the default. Three things
# are worth knowing before changing it:
#
#   * The API key is issued per person and expires roughly every 30 days — the current
#     one around 2026-09-07. When it lapses this loop starts failing silently, which is
#     exactly why the last result is recorded and surfaced on the Sync screen rather than
#     only logged. A red banner there is the warning that the key needs reissuing.
#   * A run has a 25-second budget and re-reads up to 400 held opportunities. Five
#     minutes is comfortable for that; do not push it below the time a run actually takes.
#   * The sweep takes a lock, so a manual run and an automatic one cannot collide — the
#     loser skips this tick rather than queueing, because a queued sync is just a slower
#     duplicate of the one that already ran.
AUTO_SYNC_MINUTES = int(os.getenv("AUTO_SYNC_MINUTES", "5") or 0)
# The window each automatic run asks for. Deliberately wider than the interval: a run
# that only asked for today would miss an opportunity back-dated by a day, and asking for
# two days costs two cheap exact-match queries.
AUTO_SYNC_DAYS = int(os.getenv("AUTO_SYNC_DAYS", "2") or 2)

# Nothing raised in Sales CRM before this date is ever imported (Baskoro, 2026-08-18).
#
# The routine run already only asks for the last couple of days, so this is not about
# the normal case — it is the floor that holds when somebody back-dates an opportunity,
# runs a wide manual window, or uses the pages backfill. Without it, one careless
# "last 60 days" turns the board into the whole history of the book.
#
# It applies to IMPORTS ONLY. A ticket already held is still refreshed whatever its
# date, because that is how it learns its opportunity was closed or won in Sales CRM —
# stopping that would leave pre-August deals sitting open here forever with nobody told.
# Set empty to remove the floor entirely.
SYNC_MIN_DATE = os.getenv("SYNC_MIN_DATE", "2026-08-01").strip()

# What the last automatic run did, for the Sync screen. In memory on purpose: it is
# operational state about this process, not a fact about the business, and a restart
# genuinely does mean "no automatic run has happened yet".
_auto_sync = {"enabled": bool(AUTO_SYNC_MINUTES), "every_minutes": AUTO_SYNC_MINUTES,
              "last_at": None, "last_ok": None, "last_error": None,
              "last_counts": None, "runs": 0}


async def _auto_sync_loop() -> None:
    """Run the Sales CRM sweep on a timer, as the sync owner.

    Every failure is caught and recorded rather than raised: an exception here would kill
    the task and the app would go on serving happily with the sync silently dead, which
    is the failure mode this whole loop exists to prevent."""
    # A short delay before the first run so the pod is serving traffic and the migrations
    # have settled before anything reaches out to a third party.
    await asyncio.sleep(30)
    while True:
        try:
            if not SALESCRM_API_KEY:
                _auto_sync.update(last_at=str(datetime.now())[:19], last_ok=False,
                                  last_error="SALESCRM_API_KEY is not set")
            elif _sync_lock.locked():
                log.info("auto-sync: a sync is already running, skipping this tick")
            else:
                owner = User(email=SYNC_OWNER_EMAIL, name="Sales CRM sync",
                             group="Admin", level="head", team=None, sso=False)
                r = await sync_salescrm(
                    SyncIn(days=AUTO_SYNC_DAYS, refresh=True, dry_run=False), owner)
                _auto_sync.update(last_at=str(datetime.now())[:19], last_ok=True,
                                  last_error=None, last_counts=r.get("counts"),
                                  runs=_auto_sync["runs"] + 1)
                log.info("auto-sync: %s", r.get("counts"))
        except asyncio.CancelledError:
            raise
        except Exception as e:                      # noqa: BLE001 - see docstring
            _auto_sync.update(last_at=str(datetime.now())[:19], last_ok=False,
                              last_error=str(e)[:300])
            log.exception("auto-sync failed")
        await asyncio.sleep(AUTO_SYNC_MINUTES * 60)


@app.get("/api/sync/auto")
async def auto_sync_status(u: User = Depends(current_user)):
    """Whether the timer is on, and what it did last. Read by the Sync screen."""
    require(u, "syncSalesCrm")
    return _auto_sync


@app.post("/api/sync/salescrm")
async def sync_salescrm(body: SyncIn, u: User = Depends(current_user)):
    """Pull new Sales CRM opportunities and raise the matching solutioning tickets.

    Sales CRM has no webhooks, so this polls. It does not read the whole book: 72,000
    opportunities is 726 pages and no HTTP request survives that. Instead it asks for
    the days that could contain something new, and separately re-reads the handful of
    opportunities behind tickets we already hold.

    Default is a dry run: nothing is written until you ask for it."""
    require(u, "syncSalesCrm")
    if not SALESCRM_API_KEY:
        raise HTTPException(503, "SALESCRM_API_KEY is not set on this deployment")
    if _sync_lock.locked():
        raise HTTPException(409, "a sync is already running; wait for it to finish")

    import httpx
    created, refreshed, skipped, errors = [], [], [], []
    # Which key Sales CRM actually used for Must Win, so the guess list can be replaced
    # with the real field name instead of being carried forever.
    mustwin_fields: set[str] = set()
    # Fields Sales CRM sends that nothing here reads. Reported so the field map grows
    # from evidence: without this, "are we syncing everything we could?" can only be
    # answered by opening a record in Sales CRM and comparing by eye.
    unmapped: dict[str, int] = {}
    scanned = 0
    # Stop and report what we have rather than being cut off mid-sweep. The ingress
    # closes a long request with a bare 502 and no body, which tells whoever pressed the
    # button nothing at all. Partial results with a stated reason are far more useful.
    deadline = time.monotonic() + SYNC_BUDGET_S
    truncated = False

    async with _sync_lock:
        # Only these watched groups, when asked for. Validated rather than trusted: a
        # typo would otherwise silently filter everything out and read as "nothing new".
        wanted_groups = {g.strip() for g in body.groups if g and g.strip()}
        bad = wanted_groups - {"Hypercare", "Strategic", "Must Win"}
        if bad:
            raise HTTPException(400, f"unknown group(s): {', '.join(sorted(bad))}. "
                                     f"Choose from Hypercare, Strategic, Must Win.")

        known = {str(r["opportunity_id"]) for r in
                 await q("SELECT opportunity_id FROM tickets WHERE opportunity_id IS NOT NULL")}
        # When a run is scoped to the watched groups, the refresh half is scoped with it:
        # re-reading every held Standard ticket would make "Hypercare only" a lie about
        # what the run touched.
        if wanted_groups:
            marks = ",".join(["%s"] * len(MANAGED_ACCTS))
            held = await q(
                f"SELECT t.opportunity_id AS oid FROM tickets t "
                f"JOIN shippers s ON s.id=t.shipper_id "
                f"WHERE t.opportunity_id IS NOT NULL AND t.deleted_at IS NULL "
                f"AND (s.acct_type IN ({marks}) OR t.must_win=1)", tuple(MANAGED_ACCTS))
            in_scope = {str(r["oid"]) for r in held}
        # Names this app already knows. A salesperson Sales CRM names but we have never
        # registered gets flagged rather than silently written onto a ticket as its PIC.
        known_people = {r["name"] for r in await q("SELECT name FROM users WHERE active=1")}
        # The whitelist. V24 created the table and wired the permission, but nothing ever
        # read it, so "Test Ninja Biz - 1" arrived on every import and was ignored by hand
        # every time. An id here is skipped WITH ITS REASON and still appears in the run's
        # report — which is the whole difference between ignoring a deal and losing one.
        ignored = {str(r["opportunity_id"]): (r["reason"] or "no reason recorded")
                   for r in await q("SELECT opportunity_id, reason FROM salescrm_ignored")}

        # Per-request timeout well under the sweep's own budget, so one slow Sales CRM
        # call cannot consume the whole run and leave nothing to report.
        async with httpx.AsyncClient(
                timeout=12, headers={"X-API-Key": SALESCRM_API_KEY}) as client:
            crm = SalesCrm(client)
            caught_up = False
            batches: list[tuple[str, list[dict]]] = []

            # 0. Named opportunity ids. `id` is the one other filter this API accepts,
            #    so a list of ids is the cheapest and most precise call there is: one
            #    round trip each, no date window, nothing else swept in. This is how you
            #    rebuild a dashboard deliberately — start empty and pull in exactly the
            #    opportunities you want, rather than importing a range and deleting the
            #    rest afterwards.
            if body.ids:
                wanted_ids = [str(i).strip() for i in body.ids if str(i).strip()][:200]
                sem_ids = asyncio.Semaphore(SYNC_CONCURRENCY)

                async def by_id(oid: str):
                    async with sem_ids:
                        try:
                            d = await crm.records("Opportunity", id=oid)
                            items = d.get("items") or []
                            return oid, (items[0] if items else None)
                        except Exception as e:
                            return oid, e

                for oid, got in await asyncio.gather(*(by_id(i) for i in wanted_ids)):
                    if isinstance(got, Exception):
                        errors.append({"id": oid, "name": None,
                                       "error": f"could not be read: {str(got)[:120]}"})
                    elif got is None:
                        # Said out loud: a typo in an id would otherwise look exactly
                        # like an opportunity that exists but was filtered out.
                        skipped.append({"id": oid, "name": None,
                                        "why": "no opportunity with this id in Sales CRM"})
                    else:
                        batches.append((f"id {oid}", [got]))
                wanted = []          # an id run asks for nothing else

            # 1. Recent days. new_date is a plain date, it is populated on every
            #    opportunity, and exact match on it is one of the few filters this API
            #    accepts. A day is five or six opportunities, against a hundred a page.
            elif body.since:
                start = date.fromisoformat(body.since)
                end = date.fromisoformat(body.until) if body.until else date.today()
                if start > end:
                    raise HTTPException(400, "since is after until")
                # Newest first, so a run that stops early has covered the recent end and
                # the caller can move the window back for the next chunk.
                wanted = [end - timedelta(days=i) for i in range((end - start).days + 1)]
            else:
                today = date.today()
                wanted = [today - timedelta(days=i)
                          for i in range(max(0, min(body.days, 60)))]

            # Day queries run concurrently. Sequentially, 40 days of history spent the
            # entire budget fetching and left nothing to process, which reported zero
            # and looked like there was nothing there.
            covered_from = None
            sem_days = asyncio.Semaphore(SYNC_CONCURRENCY)

            async def fetch_day(day_d):
                async with sem_days:
                    day = str(day_d)
                    try:
                        d = await crm.records("Opportunity", new_date=day, page_size=100)
                        return day, d.get("items") or []
                    except Exception:
                        return day, None      # None marks a day that must be retried

            got_days = await asyncio.gather(*(fetch_day(d) for d in wanted))
            for day, items in got_days:
                if items is None:
                    errors.append({"id": None, "name": "day " + day,
                                   "error": "could not be read, run this window again"})
                    continue
                batches.append(("day " + day, items))
                covered_from = day

            # 2. Opportunities behind tickets we already hold, read directly by id so
            #    their stage and revenue stay current. Bounded by our own ticket count.
            if body.refresh and not truncated and known and not body.ids:
                ids = sorted(in_scope if wanted_groups else known)[:SYNC_REFRESH_MAX]
                sem = asyncio.Semaphore(SYNC_CONCURRENCY)

                async def one(oid: str):
                    async with sem:
                        try:
                            d = await crm.records("Opportunity", id=oid)
                            items = d.get("items") or []
                            return items[0] if items else None
                        except Exception:
                            return None

                got = await asyncio.gather(*(one(i) for i in ids))
                batches.append(("existing tickets", [g for g in got if g]))

            # 3. Backfill, only when explicitly asked for. This is the expensive path.
            for page in range(1, (0 if body.ids else max(0, min(body.pages, 40))) + 1):
                if time.monotonic() > deadline:
                    truncated = True
                    break
                # record_type_name is NOT a filterable field, passing it returns
                # 400 INVALID_FILTER_FIELD and the sweep finds nothing. The API accepts
                # exact matches on a small set of fields only, so the record type is
                # filtered here instead.
                data = await crm.records("Opportunity", page=page, page_size=100)
                items = data.get("items") or []
                if not items:
                    break
                batches.append(("page %d" % page, items))
                if not data.get("has_next"):
                    break

            # Warm every account the whole run needs in one round, not one round per
            # batch. A day holds five or six opportunities, so warming per batch spends
            # a full round trip on six lookups and wastes the concurrency entirely:
            # forty days cost forty rounds instead of two.
            #
            # Only opportunities that will actually be created need an account, since the
            # tier comes from it. Already-imported ones refresh from fields the record
            # already carries, and skipped ones are never looked at again.
            def needs_account(o):
                return (str(o.get("id")) not in known
                        # An ignored opportunity is never imported, so fetching its
                        # account is a round trip spent on a row we will throw away.
                        and str(o.get("id")) not in ignored
                        and (not SALESCRM_RECORD_TYPE
                             or o.get("record_type_name") == SALESCRM_RECORD_TYPE)
                        and o.get("stage") not in CLOSED_LOST_STAGES
                        and PRODUCT_MAP.get(
                            str(_first(o.get("core_product"))
                                or o.get("nv_product_line") or "").strip()))

            all_fresh = [o for _, items in batches for o in items if needs_account(o)]
            # Held tickets need their account too, now that a refresh copies the account
            # fields (commodity, the shipper ID Ops onboards against) and not only the
            # opportunity's. Accounts are cached and heavily shared between opportunities,
            # so this is far fewer round trips than it looks — and it is skipped entirely
            # once the run is out of budget, same as everything else in the sweep.
            held = [o for _, items in batches for o in items
                    if str(o.get("id")) in known] if body.refresh else []
            if time.monotonic() > deadline:
                truncated = True
                held = []
            await crm.warm_accounts(o.get("account_id") for o in all_fresh + held)
            await crm.warm_accounts(
                (crm._accounts.get(str(o.get("account_id"))) or {}).get("parent_account_id")
                for o in all_fresh)

            for label, items in batches:
                if time.monotonic() > deadline:
                    truncated = True
                    break
                new_on_this_page = 0

                for o in items:
                    if time.monotonic() > deadline:
                        truncated = True
                        break
                    scanned += 1
                    oid = str(o.get("id"))
                    if SALESCRM_RECORD_TYPE and o.get("record_type_name") != SALESCRM_RECORD_TYPE:
                        continue
                    for name in crm_unmapped(o):
                        unmapped[name] = unmapped.get(name, 0) + 1
                    # Checked before the already-imported branch, so an ignored id is not
                    # refreshed either — the point is that the sync leaves it alone.
                    if oid in ignored:
                        skipped.append({"id": oid, "name": o.get("name"),
                                        "why": f"on the ignore list: {ignored[oid]}"})
                        continue
                    if oid in known:
                        if wanted_groups and oid not in in_scope:
                            continue
                        # Already imported, so refresh the fields Sales CRM owns rather
                        # than skipping it. Stage, committed revenue and the close date
                        # are theirs, ours are only ever a copy, so theirs wins.
                        if body.refresh and not any(x["id"] == oid for x in refreshed):
                            if not body.dry_run:
                                acct_for_refresh = crm._accounts.get(
                                    str(o.get("account_id") or ""))
                                n = await _refresh_from_salescrm(
                                    o, acct_for_refresh,
                                    await crm.tier_for(acct_for_refresh)
                                    if acct_for_refresh else None)
                                if n:
                                    refreshed.append({"id": oid, "name": o.get("name"),
                                                      "stage": o.get("stage"),
                                                      "moved": n["moved"],
                                                      "revenue_filled": n["revenue_filled"],
                                                      "overwritten": n["overwritten"],
                                                      "missing": n["missing"]})
                            else:
                                # Predict the status move without writing, so the dry
                                # run shows what "for real" would do to held tickets.
                                trow = await q(
                                    "SELECT status, resp, potential_rev FROM tickets "
                                    "WHERE opportunity_id=%s", (oid,), one=True)
                                would = None
                                if trow:
                                    w = status_for_stage(o.get("stage"), trow["resp"])
                                    if w and trow["status"] != w and trow["status"] not in (
                                            "Lost", "Cancel",
                                            "Proposal Accepted / Ready to Ship"):
                                        would = w
                                would_fill = 0
                                if trow and not int(trow.get("potential_rev") or 0):
                                    try:
                                        would_fill = int(float(
                                            o.get("total_potential_revenue_mth") or 0))
                                    except (TypeError, ValueError):
                                        would_fill = 0
                                refreshed.append({"id": oid, "name": o.get("name"),
                                                  "stage": o.get("stage"),
                                                  "moved": would,
                                                  "revenue_filled": would_fill,
                                                  "overwritten": [],
                                                  "missing": []})
                        continue

                    new_on_this_page += 1
                    # The floor. Checked before anything else is done with the record so
                    # an out-of-range opportunity costs nothing but the line that says so.
                    raised = _crm_date(o)
                    if SYNC_MIN_DATE and raised and str(raised) < SYNC_MIN_DATE:
                        skipped.append({"id": oid, "name": o.get("name"),
                                        "why": f"raised {raised}, before the {SYNC_MIN_DATE} "
                                               f"floor this app imports from"})
                        continue
                    stage = o.get("stage")
                    if stage in CLOSED_LOST_STAGES:
                        skipped.append({"id": oid, "name": o.get("name"),
                                        "why": f"Sales CRM stage is {stage}"})
                        continue

                    raw_product = _first(o.get("core_product")) or o.get("nv_product_line")
                    service = PRODUCT_MAP.get(str(raw_product or "").strip())
                    if not service:
                        skipped.append({
                            "id": oid, "name": o.get("name"),
                            "why": PRODUCT_SKIP.get(str(raw_product or "").strip(),
                                                    f"no service mapping for '{raw_product}'")})
                        continue

                    try:
                        account = await crm.account(o.get("account_id"))
                        acct_type = await crm.tier_for(account)
                        revenue = int(float(o.get("total_potential_revenue_mth") or 0))
                        shipper_name = (o.get("account_name")
                                        or (account or {}).get("name") or "").strip()
                        if not shipper_name:
                            raise ValueError("opportunity has no account name")

                        plan = {
                            "opportunity_id": oid,
                            "opportunity_name": o.get("name"),
                            "shipper": shipper_name,
                            "service": service,
                            "revenue": revenue,
                            "acct_type": acct_type,
                            "stage": stage,
                            "parent_stage": o.get("parent_stage"),
                            "sales_name": o.get("owner_name"),
                            "account_id": str(o.get("account_id") or ""),
                            "parent_account_id": str((account or {}).get("parent_account_id") or ""),
                        }
                        mw, mw_field = read_must_win(o)
                        plan["must_win"] = mw
                        # big_group() in the backend's own terms: the account tier wins,
                        # else Must Win, else Standard. Kept identical to the rule the
                        # rest of the app uses so a "Hypercare only" run means exactly
                        # what the Hypercare screen means.
                        plan["group"] = (acct_type if acct_type in MANAGED_ACCTS
                                         else ("Must Win" if mw else None))
                        if wanted_groups and plan["group"] not in wanted_groups:
                            skipped.append({
                                "id": oid, "name": o.get("name"),
                                "why": f"not in the groups this run asked for "
                                       f"({', '.join(sorted(wanted_groups))}) — it is "
                                       f"{plan['group'] or 'Standard'}"})
                            continue
                        if mw_field:
                            mustwin_fields.add(mw_field)
                        plan["crm_date"] = _crm_date(o)
                        plan["ftl_unknown"] = str(raw_product or "").strip() == FTL_VARIANT_UNKNOWN
                        plan["sales_unknown"] = bool(plan["sales_name"]) and \
                            plan["sales_name"] not in known_people
                        r = route(acct_type, service, revenue)
                        plan["routes_to"] = r["resp"]

                        if not body.dry_run:
                            plan["ref"] = await _import_opportunity(o, account, plan, r, u)
                        created.append(plan)
                        known.add(oid)
                    except Exception as e:          # one bad row must not stop the sweep
                        log.exception("sync failed for opportunity %s", oid)
                        errors.append({"id": oid, "name": o.get("name"), "error": str(e)[:200]})

                if new_on_this_page:
                    log.info("sync: %d new in %s", new_on_this_page, label)

            # Nothing new across every day asked for means we are current. Said out loud
            # because "0 created" otherwise reads as a failure rather than as caught up.
            caught_up = not truncated and not created

    if not body.dry_run:
        await audit(u.email, "sync", "salescrm", None, "created", None, str(len(created)))
    # Salespeople Sales CRM names but this app has never heard of. Reported rather than
    # registered: creating a login is a permission grant, not a data import.
    unknown_sales = sorted({c["sales_name"] for c in created if c.get("sales_unknown")})
    return {"mustwin_source": sorted(mustwin_fields),
            "dry_run": body.dry_run, "scanned": scanned, "truncated": truncated,
            "caught_up": caught_up, "covered_to": covered_from,
            "created": created, "refreshed": refreshed, "skipped": skipped,
            "errors": errors, "unknown_sales": unknown_sales,
            # Commonest first: a field on every record is worth mapping, one that appears
            # twice in a thousand is probably not.
            "unmapped": [{"field": k, "seen": v} for k, v in
                         sorted(unmapped.items(), key=lambda kv: (-kv[1], kv[0]))],
            "counts": {"created": len(created), "refreshed": len(refreshed),
                       "skipped": len(skipped), "errors": len(errors),
                       "unknown_sales": len(unknown_sales),
                       "revenue_filled": sum(1 for r in refreshed
                                             if r.get("revenue_filled")),
                       "unmapped": len(unmapped)}}


async def _refresh_from_salescrm(o: dict, account: dict | None = None,
                                 tier: str | None = None) -> dict | None:
    """Re-copy onto a ticket we already hold everything Sales CRM has to say about it.

    **Sales CRM always takes priority** (Baskoro, 2026-08-14). Every field it carries is
    overwritten here, potential revenue, service line and account tier included. Those
    three used to be left alone on the reasoning that PNS corrects them deliberately;
    that reasoning is overruled. A copy that disagrees with its source is worse than no
    copy, because people believe it.

    The consequence is intended and worth stating plainly: **a correction made in this
    app to revenue, service or tier survives only until the next run.** If it is wrong in
    Sales CRM, it has to be fixed in Sales CRM. Reference / Fields says so per field, and
    is generated from the same tables this walks.

    What is NOT touched: a field Sales CRM did not send. It returns only populated
    fields, so absent means "no answer", not "blank it" — treating absence as an answer
    would wipe good data every morning.

    Terminal stages DO move our status (Baskoro, 2026-08-11): a deal that closed in
    Sales CRM must not sit open here. Closed-Lost/Future Opportunity -> Lost; the
    accepted stages -> Ready to Ship. When the move lands on a ticket whose onboarding
    fields are still blank, PNS and Sales are flagged to fill them, because Ops cannot
    onboard a shipper the account systems cannot find. Returns what happened, or None
    when no ticket holds this opportunity."""
    oid = str(o.get("id"))
    t = await q("SELECT id, ticket_ref, status, resp, stage, potential_rev, service_type, "
                "must_win, "
                "(SELECT name FROM shippers s WHERE s.id=shipper_id) AS shipper, "
                "(SELECT acct_type FROM shippers s WHERE s.id=shipper_id) AS acct_type, "
                # pricing is keyed on ticket_id, so these are single-valued. Needed
                # because a Proposal Submitted stage on a ticket carrying no price here
                # is the case worth shouting about, and without these columns the check
                # would read "no price" for every ticket and cry wolf on all of them.
                "(SELECT price_file FROM pricing p WHERE p.ticket_id=tickets.id) AS price_file, "
                "(SELECT price_url FROM pricing p WHERE p.ticket_id=tickets.id) AS price_url, "
                # An admin has said who prices this one, and that outranks the
                # matrix until they say otherwise -- see set_priced_by().
                "(SELECT JSON_UNQUOTE(JSON_EXTRACT(i.payload, '" + RESP_OVERRIDE_PATH + "')) "
                " FROM ticket_input i WHERE i.ticket_id=tickets.id) AS resp_override "
                "FROM tickets WHERE opportunity_id=%s", (oid,), one=True)
    if not t:
        return None
    # Must Win syncs both ways now that its source is known (Lead Source Detail), but
    # only when the field is actually present on the record — Sales CRM returns only
    # populated fields, so an absent one means "no answer", not "no". Treating absence
    # as false would wipe a flag set by hand here on every refresh.
    mw, mw_field = read_must_win(o)
    sets = ["stage=%s", "parent_stage=%s",
            "opportunity_name=COALESCE(%s, opportunity_name)",
            "sales_name=COALESCE(%s, sales_name)",
            # Sales CRM owns when the deal was raised. new_date is populated on every
            # opportunity and equals its creation date, so it is the honest "submitted".
            "submitted_on=COALESCE(%s, submitted_on)"]
    args = [o.get("stage"), o.get("parent_stage"), o.get("name"), o.get("owner_name"),
            _crm_date(o)]
    # Must Win rides the same rule as the tier now: Sales CRM decides, both ways. It
    # used to be written only when the field was PRESENT, so clearing the Lead Source
    # Detail value in Sales CRM left the flag standing here forever — a deal stayed in a
    # watched group after the business had stopped treating it as one. Absence is now an
    # answer, which is the whole point of "Sales CRM owns the watched groups".
    #
    # The by-hand endpoint (POST /must-win) still exists for tagging a deal before Sales
    # CRM catches up; it says plainly that the next sync wins, and now it really does.
    if mw != bool(t.get("must_win")):
        changed.append(f"Must Win {'off' if not mw else 'on'}"
                       + (f" (Sales CRM {mw_field})" if mw_field else " (not tagged in Sales CRM)"))
    sets.append("must_win=%s"); args.append(int(mw))

    # The three that used to be left alone. Sales CRM wins on all of them now.
    #
    # Each is applied only when Sales CRM actually stated it: revenue > 0, a product this
    # app can map, a tier that was resolved. A missing value is not an instruction to
    # zero ours out.
    changed = []
    try:
        crm_rev = int(float(o.get("total_potential_revenue_mth") or 0))
    except (TypeError, ValueError):
        crm_rev = 0
    new_rev = crm_rev if crm_rev > 0 else int(t.get("potential_rev") or 0)
    if crm_rev > 0 and crm_rev != int(t.get("potential_rev") or 0):
        changed.append(f"potential revenue Rp {int(t.get('potential_rev') or 0):,} "
                       f"to Rp {crm_rev:,}")

    raw_product = _first(o.get("core_product")) or o.get("nv_product_line")
    crm_service = PRODUCT_MAP.get(str(raw_product or "").strip())
    new_service = crm_service or t["service_type"]
    if crm_service and crm_service != t["service_type"]:
        changed.append(f"service {t['service_type']} to {crm_service}")

    # Sales CRM owns the tier in BOTH directions — watched to non-watched and back
    # (Baskoro, 2026-08-18). It was promote-only for a few hours on my reasoning that a
    # blank customer_success_manager cannot be told apart from a real demotion, so a
    # demotion would look like an accident. Overruled, and the reasoning stands but the
    # trade-off is his: an account Sales CRM does not tag becomes Standard, full stop.
    #
    # What that means in practice: tier_for() answers "Standard" both when Sales CRM says
    # ordinary and when it says nothing, so an account nobody has tagged there will be
    # Standard here within five minutes, whatever it was set to by hand. The four
    # accounts with no Sales CRM link at all are untouched — the sync never sees them.
    #
    # The change is written to the ticket history with the before and after, so it is
    # auditable after the fact. No notification: Baskoro does not want one.
    stated_tier = tier
    new_tier = stated_tier or t.get("acct_type") or "Standard"
    if stated_tier and stated_tier != t.get("acct_type"):
        changed.append(f"account tier {t.get('acct_type')} to {stated_tier}")
        # The tier lives on the shipper, not the ticket — it is an account fact and
        # applies to every deal that account brings.
        await execute("UPDATE shippers SET acct_type=%s, status_changed_by=%s, "
                      "status_changed_at=NOW() WHERE id=(SELECT shipper_id FROM tickets "
                      "WHERE id=%s)", (stated_tier, "Sales CRM sync", t["id"]))

    if changed:
        # Routing is re-derived on the corrected facts, because who prices the deal,
        # which ceiling applies and whether PNS reviews were all decided on the old ones.
        # An admin override is the one thing that survives it: without this, moving a
        # ticket to PNS by hand lasted only until Sales CRM next touched the revenue,
        # and the ticket bounced back to a queue somebody had deliberately taken it out
        # of, with the sync's own note as the only clue.
        over = str(t.get("resp_override") or "").strip()
        rr = route(new_tier, new_service, new_rev)
        sets += ["potential_rev=%s", "service_type=%s"]
        args += [new_rev, new_service]
        if over in ("PNS", "Sales"):
            changed.append(f"priced by stays {over}, set by an admin")
        else:
            sets += ["resp=%s", "needs_review=%s"]
            args += [rr["resp"], int(rr["review"])]
    filled_rev = crm_rev if (crm_rev > 0 and not int(t.get("potential_rev") or 0)) else 0

    # First time this app has ever seen the deal, written once and never revised.
    sets.append("first_synced_at=COALESCE(first_synced_at, NOW())")
    args.append(t["id"])
    await execute(f"UPDATE tickets SET {', '.join(sets)} WHERE id=%s", tuple(args))
    if changed:
        await log_note(t["id"], t["status"], "Sales CRM sync",
                       "Sales CRM takes priority — " + "; ".join(changed)[:400])

    payload = {}
    row = await q("SELECT payload FROM ticket_input WHERE ticket_id=%s", (t["id"],), one=True)
    if row:
        current = row["payload"] if isinstance(row["payload"], dict) \
            else json.loads(row["payload"] or "{}")
        # The same mapping table the import walks, so nothing is imported once and then
        # left to go stale. Sales CRM's own fields overwrite; everything else fills a
        # blank only, because PNS corrects these here deliberately.
        payload = merge_crm_payload(current, o, account)
        await execute("UPDATE ticket_input SET payload=%s WHERE ticket_id=%s",
                      (json.dumps(payload), t["id"]))

    moved, missing = None, []
    wants = status_for_stage(o.get("stage"), t["resp"])
    # Only open tickets follow the stage; a decided ticket keeps its recorded outcome.
    # "Proposal Submitted" additionally must never pull a ticket BACKWARDS: it is the one
    # non-terminal stage we follow, and Sales CRM can report it long after the shipper
    # has actually accepted. The terminal list below already covers accepted/Lost/Cancel,
    # so this only has to stop it re-entering a ticket that is already submitted.
    if wants and t["status"] != wants and t["status"] not in (
            "Lost", "Cancel", "Proposal Accepted / Ready to Ship"):
        ref = t["ticket_ref"]
        if wants == "Proposal Submitted":
            # The proposal has reached the shipper while this ticket was still inside its
            # approval chain, so a price went out without clearing its gates. Following
            # Sales CRM is right — the status should describe the world — but doing it
            # silently would erase the only evidence it happened, so the gates that were
            # bypassed are named in the history and PNS is told. ACCEPTED_STAGES has been
            # doing this move quietly since it was written; the same record now covers it.
            gate = t["status"] if t["status"].startswith("Pending Review") else None
            no_price = not (t.get("price_file") or t.get("price_url"))
            note = f"Sales CRM stage is {o.get('stage')}"
            if gate:
                note += f" — proposal went out while still at {gate}, that gate was bypassed"
            if no_price:
                note += " — no price is attached in this app"
            if gate or no_price:
                what = []
                if gate:
                    what.append(f"it was still at {gate}")
                if no_price:
                    what.append("no price is attached here, so the number the shipper "
                                "received exists nowhere in this app")
                await notify(
                    f"{ref}, {t['shipper']}: Sales CRM says the proposal is submitted, but "
                    + " and ".join(what) + ". Worth checking.",
                    groups=["PNS"], ticket_ref=ref)
        elif wants == "Lost":
            # Sales CRM's own reason, not the generic "Closed in Sales CRM" bucket
            # (Baskoro, 2026-08-18). Every synced loss used to land in one bucket that
            # explained nothing, which made the loss breakdown useless for exactly the
            # deals there are most of.
            #
            # Kept OUT of our seven-value loss_reason column: that enum is validated on
            # manual entry and rendered from a fixed label list, so writing Sales CRM's
            # picklist values into it would break both. It rides in the intake payload
            # instead, as crmLossReason / crmLossDetail, which merge_crm_payload already
            # writes on every run — so this needs NO MIGRATION. That matters: two people
            # deploy into one shared database from separate clones and migrations have
            # collided three times. A column is not worth a fourth.
            crm_reason = _crm_pick(o, ["loss_reason"])
            crm_detail = _crm_pick(o, ["detailed_lost_reason"])
            await execute("UPDATE tickets SET outcome='lost', loss_reason='salescrm' "
                          "WHERE id=%s", (t["id"],))
            note = f"Sales CRM closed this opportunity ({o.get('stage')})"
            if crm_reason:
                note += f", reason: {crm_reason}"
                if crm_detail:
                    note += f" ({crm_detail})"
        else:
            await execute("UPDATE tickets SET outcome='accepted' WHERE id=%s", (t["id"],))
            missing = [label for key, label in ONBOARDING_IDS.items()
                       if not str(payload.get(key) or "").strip()]
            if not str(payload.get("golive") or "").strip():
                missing.append("Go live date")
            note = f"Sales CRM stage is {o.get('stage')}"
            if missing:
                note += " — still blank: " + ", ".join(missing)
        await log_status(t["id"], wants, "Sales CRM sync", note)
        if missing:
            await notify(
                f"{ref}, {t['shipper']} moved to {wants} by the Sales CRM sync, but "
                f"onboarding needs: {', '.join(missing)}. Fill them on the ticket input.",
                groups=["PNS", "Commercial"], ticket_ref=ref)
        moved = wants
    return {"moved": moved, "missing": missing, "revenue_filled": filled_rev,
            "overwritten": changed}


async def _import_opportunity(o: dict, account: dict | None, plan: dict,
                              r: dict, u: User) -> str:
    """Write one opportunity in as a ticket. Returns the new ticket ref."""
    sh = await q("SELECT id FROM shippers WHERE account_id=%s OR name=%s",
                 (plan["account_id"], plan["shipper"]), one=True)
    if sh:
        shipper_id = sh["id"]
        await execute("UPDATE shippers SET account_id=%s, parent_account_id=%s, "
                      "account_name=%s, customer_success_manager=%s, acct_type=%s "
                      "WHERE id=%s",
                      (plan["account_id"] or None, plan["parent_account_id"] or None,
                       plan["shipper"], (account or {}).get("customer_success_manager"),
                       plan["acct_type"], shipper_id))
    else:
        shipper_id = await execute(
            "INSERT INTO shippers (name, acct_type, region, account_id, parent_account_id, "
            "account_name, customer_success_manager, global_shipper_id) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (plan["shipper"], plan["acct_type"], "GJ", plan["account_id"] or None,
             plan["parent_account_id"] or None, plan["shipper"],
             (account or {}).get("customer_success_manager"),
             (account or {}).get("global_id")))

    # Revenue decides who prices the deal, which 5A ceiling applies and whether PNS
    # reviews it, and change_status() refuses to enter any working status without it.
    # The import used to walk straight past that gate and drop a revenue-0 opportunity
    # into Pending PNS or Pending Sales anyway — a ticket sitting in a status the app's
    # own rule says it may not be in, routed as if it were the smallest possible deal.
    # Those land in Open instead: ready, visibly unclaimed, and asking for the number
    # before anybody prices anything. This is why tickets turn up with a CRM ID and no
    # revenue, and the Open screen already explains what is missing.
    status = pending_for(r["resp"]) if plan["revenue"] else "Open"
    last = await q("SELECT MAX(id) AS n FROM tickets", one=True)
    ref = f"SOF-{1300 + int((last or {}).get('n') or 0)}"

    tid = await execute(
        "INSERT INTO tickets (ticket_ref, opportunity_id, opportunity_name, stage, "
        "parent_stage, shipper_id, service_type, potential_rev, status, resp, "
        "needs_review, must_win, sales_email, sales_name, region, submitted_on) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (ref, plan["opportunity_id"], plan["opportunity_name"], plan["stage"],
         plan["parent_stage"], shipper_id, plan["service"], plan["revenue"], status,
         r["resp"], int(r["review"]), int(plan.get("must_win") or 0), None,
         plan["sales_name"], "GJ", plan.get("crm_date") or date.today()))
    await execute("UPDATE tickets SET first_synced_at=NOW() WHERE id=%s", (tid,))

    owner = await auto_assignee(plan["service"], tid, shipper_id) if r["resp"] == "PNS" else None
    if owner:
        await execute("UPDATE tickets SET owner_name=%s WHERE id=%s", (owner, tid))

    # Sales still has to complete the intake in this app: Sales CRM carries none of the
    # solutioning detail, and for FTL it cannot even say which line it is.
    # A quarter of Sales CRM opportunities carry no potential revenue, and revenue
    # decides both who prices the deal and which tier ceiling applies. Rather than let
    # it route silently as zero, the ticket says so where whoever picks it up will read.
    rev_note = ("\n\nNOTE: Sales CRM has no potential revenue on this opportunity, so it "
                "has been routed at Rp 0. Set the real figure before pricing, it changes "
                "both the routing and the pricing tier.") if not plan["revenue"] else ""
    # Sales CRM says only "Trucking". The ticket lands on FTL on-call so it can be worked
    # immediately, but the line must be confirmed before the charter goes out. Safe as a
    # provisional label: both FTL lines route to PNS and carry identical ceilings, so only
    # the name is uncertain, not the handling.
    ftl_note = ("\n\nNOTE: Sales CRM records this as Trucking and cannot say whether it is "
                "FTL on-call or FTL monthly. Imported as FTL on-call. Confirm the line "
                "before the charter is published.") if plan.get("ftl_unknown") else ""
    # Everything Sales CRM has to say goes in, through the one mapping table the refresh
    # also walks — so a field imported today is still current next week — plus the raw
    # record under `_crm`, so a field nobody has mapped yet is at least *here* rather
    # than needing a fresh sync run once somebody notices it exists.
    payload = merge_crm_payload({
        "brief": (f"Imported from Sales CRM opportunity {plan['opportunity_id']}"
                  f", {plan['opportunity_name'] or ''}").strip() + rev_note + ftl_note,
        # Also a field, not just prose in the brief, so the whole set can be found and
        # cleared rather than each one being noticed only if somebody reads the note.
        "ftlVariantNeeded": "Yes" if plan.get("ftl_unknown") else "",
        "shipper": plan["shipper"],
    }, o, account)
    await execute("INSERT INTO ticket_input (ticket_id, payload, updated_by) VALUES (%s,%s,%s)",
                  (tid, json.dumps({k: v for k, v in payload.items() if v}), u.email))
    await execute("INSERT INTO ticket_history (ticket_id, status, actor, note) "
                  "VALUES (%s,%s,%s,%s)",
                  (tid, status, u.name, f"imported from Sales CRM ({plan['stage']})"))
    await audit(u.email, "import", "ticket", ref, "opportunity_id", None,
                plan["opportunity_id"])
    return ref


@app.get("/api/workload")
async def workload(u: User = Depends(current_user)):
    """Who is carrying what, and how fast it clears.

    Two questions in one call because they are only useful together: a big queue on a
    fast closer is not the same problem as a small queue on a stalled one.

    Lead time is measured from first assignment to the ticket leaving PNS hands, taken
    from ticket_history rather than the ticket row, status_since only remembers the
    latest move, so it cannot answer 'how long did this take'.

    Two audiences since 2026-08-14, when taking a ticket became anyone in PNS's to do:

      the team   how loaded each person is, and who is at the cap. You cannot sensibly
                 choose whether to pick something up without it.
      the Head   the same, plus won / decided / average and worst days-to-clear.

    That second set is a per-person performance comparison and it is not published to
    the team. It is filtered out here rather than hidden in the UI, so it never leaves
    the server for someone who should not see it."""
    require(u, "seeWorkload")
    # The Head's view. manageUsers is pns_head-or-admin, which is exactly the audience.
    full = can(u, "manageUsers")

    pns = await q(
        "SELECT u.name, "
        "  SUM(t.status='Pending PNS') AS pending_pns, "
        "  SUM(t.status IN ('Pending PNS','Pending Review - Head PNS','Pending Vendor')) AS open_total, "
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
        "      WHERE status IN ('Proposal Submitted','Pending Review - Head PNS') GROUP BY ticket_id) done "
        "  ON done.ticket_id=t.id AND done.at >= first_seen.at "
        "WHERE t.deleted_at IS NULL AND t.owner_name IS NOT NULL "
        "GROUP BY t.owner_name")
    lead_by = {r["name"]: r for r in lead}

    team = []
    for r in pns:
        l = lead_by.get(r["name"], {})
        row = {
            "name": r["name"],
            "pending_pns": int(r["pending_pns"] or 0),
            "open_total": int(r["open_total"] or 0),
            "at_cap": int(r["pending_pns"] or 0) >= PNS_WIP_CAP,
        }
        if full:
            row |= {
                "won": int(r["won"] or 0),
                "decided": int(r["decided"] or 0),
                "avg_days_to_clear": float(l["avg_days"]) if l.get("avg_days") is not None else None,
                "worst_days_to_clear": int(l["worst_days"]) if l.get("worst_days") is not None else None,
                "finished": int(l.get("finished") or 0),
            }
        team.append(row)

    # Salespeople ranked by how much they currently have sitting on PNS. This is the
    # demand side of the same picture, a spike here explains a queue over there.
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
        # The screen says which view it is showing rather than leaving a PNS member to
        # wonder whether the missing columns are a bug.
        "full": full,
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
    oid = (body.opportunity_id or "").strip() or None
    if oid:
        clash = await q("SELECT ticket_ref FROM tickets WHERE opportunity_id=%s", (oid,),
                        one=True)
        if clash:
            raise HTTPException(409, f"Sales CRM opportunity {oid} is already on "
                                     f"{clash['ticket_ref']}")

    # No Sales CRM id, no pipeline. The sync finds a deal by its opportunity id, so a
    # ticket without one can never be kept in step with the commercial record — it would
    # drift silently and be believed anyway. It parks in Pending CRM ID instead, visible
    # and obviously incomplete, until Sales supplies the number.
    #
    # With an id the ticket lands in Open: intake is complete and nothing is owed by
    # Sales, but nobody has picked it up. That is a different thing from Pending PNS,
    # which reads as "someone is working on it", and the two were indistinguishable
    # before.
    status = "Open" if oid else NO_CRM_STATUS
    last = await q("SELECT MAX(id) AS n FROM tickets", one=True)
    ref = f"SOF-{1300 + int((last or {}).get('n') or 0)}"

    tid = await execute(
        "INSERT INTO tickets (ticket_ref, opportunity_id, shipper_id, service_type, "
        "potential_rev, status, resp, needs_review, must_win, sales_email, sales_name, "
        "region, submitted_on) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (ref, oid, shipper_id, body.service, body.revenue, status, r["resp"],
         int(r["review"]), int(body.must_win), body.sales_email or u.email, u.name,
         body.region, date.today()))

    # Only PNS-owned tickets get an owner here. A Sales-priced ticket has no PNS work
    # yet, and pre-assigning one would put it in someone's queue before it is theirs.
    owner = await auto_assignee(body.service, tid, shipper_id) if r["resp"] == "PNS" else None
    if owner:
        await execute("UPDATE tickets SET owner_name=%s WHERE id=%s", (owner, tid))
    elif r["resp"] == "PNS":
        # Everyone eligible is at the cap (or auto-assignment is off). Say so, rather
        # than letting it look like the Head simply has not got to it yet.
        await notify(f"{ref}, needs manual assignment: everyone eligible for "
                     f"{body.service} is at the {PNS_WIP_CAP}-ticket cap",
                     roles=["PNS - Head"], ticket_ref=ref)

    payload = dict(body.payload or {}); payload["brief"] = body.brief
    await execute("INSERT INTO ticket_input (ticket_id, payload, updated_by) VALUES (%s,%s,%s)",
                  (tid, json.dumps(payload), u.email))
    await execute("INSERT INTO ticket_history (ticket_id, status, actor, note) VALUES (%s,%s,%s,%s)",
                  (tid, status, u.name, "submitted"))
    await notify(f"New ticket {ref}, {body.shipper} ({body.service}, Rp {body.revenue:,})"
                 + (" — MUST WIN" if body.must_win else "")
                 + f" raised by {u.name}" + (f", assigned to {owner}" if owner else ""),
                 roles=["PNS - Head"] if r["resp"] == "PNS" else [],
                 groups=[] if r["resp"] == "PNS" else ["Commercial"], ticket_ref=ref)
    await audit(u.email, "create", "ticket", ref)
    return {"ok": True, "ref": ref, "status": status}


class PriceIn(BaseModel):
    price_file: str                      # human label, e.g. "Rate card - Sinar Kencana v2"
    price_url: str | None = None         # link to the spreadsheet holding the actual price
    price_size: int | None = None
    margin_pct: float | None = None      # checked against the 5A ceiling for the tier
    discount_pct: float | None = None    # the lever Sameday is capped on, not margin
    below_bottom: bool = False           # manual, LTL and B2BR only, checked server-side
    # Escalating to PSP is a standalone button (POST .../status), not a price-attach
    # field, so it shows up on PSP's queue the moment it's clicked rather than only
    # once a price is also submitted. See change_status.


def clean_url(raw: str | None) -> str | None:
    """Only http(s) links are stored. Anything else, javascript:, data:, would be
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
    # Same reason as the status gate: the 5A ceiling this price is about to be checked
    # against is chosen by revenue band, so pricing a ticket with no revenue checks it
    # against the smallest band by accident.
    if not int(t.get("potential_rev") or 0):
        raise HTTPException(
            409, f"{ref} has no potential revenue, so there is no 5A band to check this "
                 f"price against. Fill it in on the Input tab first.")

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
    # A fresh price starts a fresh cycle, so any earlier PSP clearance no longer applies.
    await execute("UPDATE tickets SET psp_ready=0 WHERE id=%s", (t["id"],))

    # The manual flag is only offered for services with a published floor (LTL, B2BR).
    # Rejected server-side as well as hidden in the UI, so a client cannot set it on a
    # service with nothing to check it against.
    if body.below_bottom and t["service_type"] not in BOTTOM_MARGIN:
        raise HTTPException(
            400, f"{t['service_type']} has no published bottom margin; "
                 f"below-bottom isn't available for it yet")

    # Two mechanisms, deliberately both live. The 5A guard computes a ceiling for every
    # service and catches a breach the pricer did not declare; the checkbox catches one
    # the numbers do not show, on the two services with a published floor.
    g = guard_for(t["acct_type"], t["service_type"], int(t["potential_rev"] or 0))
    breach = guard_breached(g, body.margin_pct, body.discount_pct)
    if g["kind"] == "standard" and (body.discount_pct or 0) > 0:
        breach = True          # a standard-rate tier permits no deviation at all
    # A margin floor is a bottom-rate question and the Sales Head owns it. Everything the
    # tier cannot authorise (a managed account, a band with no published ceiling, a
    # Sameday discount past 20%) is a PSP decision.
    # These reach PSP on the rule itself, not on an exception: a manual-review band
    # (a managed account, or either FTL line at or above 30 Mio) and a Sameday discount
    # past 20%. A plain margin breach is different and belongs to the Sales Head.
    to_psp = g["kind"] == "manual" or (breach and g["kind"] in ("discount", "standard"))

    # A Standard deal cannot be below the floor — Baskoro, 2026-08-13: "no way a non
    # deal can be below floor". The floor is the point of the tier; a Standard deal that
    # cannot be priced within it is a deal Ninja does not take at this price, and the
    # answer is to reprice or to escalate the ACCOUNT, not to wave the price through a
    # chain that exists for watched deals. Refused here rather than routed onward, so
    # the conversation happens before a number reaches the shipper.
    if (body.below_bottom or breach) and not big_group(t):
        raise HTTPException(
            409, f"{ref} is a Standard deal, so it cannot go below the floor "
                 f"({g['why']}). Reprice it within the ceiling, or ask the Head of PNS "
                 f"to tag the deal Must Win if it genuinely warrants the exception.")


    # The Head of PNS finalises the solution before anyone else is asked to approve it.
    # This is checked ahead of the PSP and below-floor branches on purpose: those still
    # apply, they just apply *after* the solution is finished. next_after_head_pns()
    # picks the chain back up from the flags recorded here.
    if review_level(t) == "head":
        if to_psp:
            await execute("UPDATE tickets SET manual_review=1 WHERE id=%s", (t["id"],))
        if breach or body.below_bottom:
            await execute("UPDATE tickets SET below_bottom=1 WHERE id=%s", (t["id"],))
        nxt = "Pending Review - Head PNS"
        note = f"{big_group(t)} — Head of PNS finalises the solution and pricing"
        await notify(f"{ref}, {t['shipper']} ({big_group(t)}): priced by {u.name}, "
                     f"needs your sign-off on the solution before it goes further",
                     roles=["PNS - Head"], ticket_ref=ref)
    elif review_level(t) == "pns":
        # Sales priced a Standard deal at or above 30 Mio, so PNS checks it — and this is
        # tested BEFORE to_psp on purpose, for the same reason the Head branch above is.
        # A band with no published ceiling (FTL on-call, Fulfillment and Complex
        # Logistics all go "manual" at this tier) used to satisfy to_psp first and send
        # the ticket to PSP with PNS never seeing it, even though route() had already
        # marked it for review and the ticket said "PNS review" on every screen.
        # Michael, 2026-08-18: PSP is where you go when there is no rate to price
        # against, and that is the escalation route from the review screen — it is not
        # a substitute for PNS reading a price Sales built.
        nxt, note = "Pending Review - PNS", "Sales priced at or above 30 Mio — PNS checks it"
        who = t.get("owner_name") or await auto_assignee(
            t["service_type"], t["id"], t.get("shipper_id"))
        if who:
            if not t.get("owner_name"):
                await execute("UPDATE tickets SET owner_name=%s WHERE id=%s", (who, t["id"]))
            await notify(f"{ref}, {t['shipper']}: Sales priced it at "
                         f"Rp {int(t['potential_rev']):,} — yours to review",
                         people=[who], ticket_ref=ref, subject=f"Review {t['shipper']}")
        else:
            await notify(f"{ref}, {t['shipper']}: Sales priced it at or above 30 Mio and "
                         f"everyone eligible is at the cap — needs manual assignment",
                         roles=["PNS - Head"], groups=["PNS"], ticket_ref=ref)
    elif to_psp:
        nxt, note = "Pending Review - PSP", g["why"]
        await execute("UPDATE tickets SET manual_review=1 WHERE id=%s", (t["id"],))
        await notify(f"{ref}, price attached by {u.name}; needs PSP approval ({g['why']})",
                     groups=["PSP"], ticket_ref=ref)
    elif breach or body.below_bottom:
        # Below the floor. PSP rules on whether the margin is survivable; the commercial
        # concession is then the Head of Sales's to accept IN SALES CRM, not here
        # (Baskoro, 2026-08-14), so there is no longer a gate for it in this app.
        #
        # Only a watched group can reach this line at all — a Standard deal below floor is
        # refused outright above. So where PSP does not take the ticket (a Must Win on a
        # Standard account, with no exception recorded), the Head of PNS is the remaining
        # gate and next_gate() puts it there.
        await execute("UPDATE tickets SET below_bottom=1 WHERE id=%s", (t["id"],))
        if may_go_to_psp(t):
            nxt = "Pending Review - PSP"
            note = (g["why"] or "flagged below bottom rate") + " — PSP decides the margin"
            await notify(f"{ref}, {t['shipper']}: BELOW BOTTOM RATE ({g['why']}), "
                         f"priced by {u.name}. PSP decides the margin first.",
                         groups=["PSP"], ticket_ref=ref)
        else:
            nxt = next_gate(t, None)
            note = (g["why"] or "flagged below bottom rate") + " — no PSP route"
            await notify(f"{ref}, {t['shipper']}: price attached by {u.name} and flagged "
                         f"BELOW BOTTOM RATE ({g['why']}); no PSP route, so it is yours to "
                         f"finalise", roles=["PNS - Head"], ticket_ref=ref)
    else:
        nxt, note = proposal_or_signoff(t), ""
        if nxt == "Pending Review - C-level":
            await notify(f"{ref}, {t['shipper']} ({t['acct_type']}): priced and awaiting "
                         f"Alex and Dhinesh sign-off", groups=["PNS"], ticket_ref=ref)
        else:
            await notify(f"{ref}, {t['shipper']}: proposal is ready",
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

    # The destination arrives as a plain string from the client, and nothing checked it
    # until now: a typo, or an old build's vocabulary, wrote a status the running code
    # does not recognise straight onto the ticket. That is exactly the orphaned-status
    # mess V20/V21 had to clean up by hand, and /api/diagnostics/orphaned-status exists
    # because of it. TRANSITIONS is the single map of what may move where; checked here
    # so a status this app cannot act on can never be written in the first place.
    if nxt not in ALL_STATUSES:
        raise HTTPException(400, f"'{nxt}' is not a status this app knows. "
                                 f"One of: {', '.join(ALL_STATUSES)}")
    allowed = MANUAL_MOVES.get(t["status"], set())
    if nxt != t["status"] and nxt not in allowed:
        raise HTTPException(
            409, f"{ref} is {t['status']} and cannot be moved to {nxt} from here. "
                 + (f"From {t['status']} you can choose: {', '.join(sorted(allowed))}. "
                    if allowed else "Nothing can be chosen from this status. ")
                 + "Everything else moves by doing the thing — attaching a price, "
                   "finalising, signing off — see Reference / Status flow.")

    # A ticket with no Sales CRM id leaves only by acquiring one, or by being abandoned.
    # Letting it walk into the pipeline is how a deal ends up solutioned here and
    # invisible in Sales CRM, which is the disagreement this whole rule exists to stop.
    if t["status"] == NO_CRM_STATUS and nxt not in ("Cancel", "Lost"):
        raise HTTPException(
            409, f"{ref} has no Sales CRM opportunity id. Add it on the ticket first — "
                 f"Sales CRM is the system of record and the sync finds this deal by id.")

    # Potential revenue decides who prices it, which pricing ceiling applies and whether
    # PNS reviews the result. A ticket that reaches PNS with revenue 0 has had all three
    # of those decided on a number nobody supplied — it routes as if it were the smallest
    # possible deal. Sales CRM leaves the field empty often enough that this has to be a
    # gate rather than a hope; the sync imports them, they sit in Open, and the number is
    # supplied before anyone prices anything.
    if nxt in WORK_STATUSES and not int(t.get("potential_rev") or 0):
        raise HTTPException(
            409, f"{ref} has no potential revenue. It decides who prices the deal, which "
                 f"5A ceiling applies and whether PNS reviews it, so it must be filled in "
                 f"before the ticket starts moving. Set it on the Input tab.")

    if is_lost:
        require(u, "acceptProposal")           # Sales owns the shipper outcome
        if body.loss_reason not in LOSS_REASONS:
            raise HTTPException(400, f"loss_reason must be one of {LOSS_REASONS}")
    elif nxt == "Proposal Accepted / Ready to Ship":
        require(u, "acceptProposal")
    elif nxt == "Cancel":
        # Dropping a request that cannot be built (Michael, 2026-08-18). Commercial raises
        # plenty that turns out not to be feasible — no rate to price against, no vendor
        # on the lane, a solution Ninja does not run — and leaving those in Awaiting price
        # makes the queue read as work when it is not. Same permission as a send-back,
        # because it is the same act one step further: instead of handing it back with a
        # reason, it stops here with one.
        require(u, "sendBackProposal")
        if not (body.reason or "").strip():
            raise HTTPException(
                400, f"say why {ref} is being cancelled. It is the only record of why "
                     f"this deal was dropped, and it is what Commercial will ask about.")
    elif nxt == "Pending Review - PSP":
        # Forwarding for a margin check, not a send-back, no reason required, and this
        # is not "the ticket came back to you", so it skips the send-back notification.
        # This is the only discretionary path to PSP now (both the Escalate button on
        # Awaiting Price and the Send to PSP button mid-review use it), so it is subject
        # to the entry gate: PSP takes managed accounts and tickets the PNS Head has
        # opened on Alex's exception, not anything a reviewer feels uncertain about.
        # Reaching PSP by rule (a manual-review band, Sameday past 20%) never goes
        # through this endpoint, only through submit_price.
        require(u, "sendToPsp")
        if not may_go_to_psp(t):
            raise HTTPException(
                400, f"{ref} cannot go to PSP. PSP takes Strategic and Hypercare "
                     f"accounts, or a ticket the PNS Head has opened after Alex granted "
                     f"an exception. Ask the PNS Head to open it first.")
    else:
        require(u, "sendBackProposal")
        # A send-back needs a reason; marking Lost carries its own.
        if not body.reason:
            raise HTTPException(400, f"a reason is required to send {ref} back to {nxt}")
        # Only the FTL lines ever wait on a vendor quote, the rest are priced off
        # Ninja's own network, so there is no vendor to wait for.
        if nxt == "Pending Vendor" and t["service_type"] not in VENDOR_SERVICES:
            raise HTTPException(
                400, f"{t['service_type']} is not priced through a vendor; "
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
        await notify(f"{ref}, {t['shipper']} ACCEPTED. Contract needed.",
                     groups=["PNS", "Commercial", "Ops"], ticket_ref=ref)
    elif nxt == "Cancel":
        # 'cancel' is the third value the outcome column was always documented to hold,
        # and it was the one nothing ever wrote — so a cancelled ticket read as still
        # undecided everywhere outcome is consulted. Win rate is unaffected: that counts
        # accepted against lost, and a deal nobody could build is neither.
        await execute("UPDATE tickets SET outcome='cancel' WHERE id=%s", (t["id"],))
        await notify(f"{ref}, {t['shipper']} was cancelled by {u.name}: {body.reason}",
                     groups=["PNS", "Commercial"], ticket_ref=ref)
    elif nxt == "Pending Review - PSP":
        await notify(f"{ref}, {t['shipper']}: sent to PSP for a margin check by {u.name}",
                     groups=["PSP"], ticket_ref=ref)
    else:
        # A send-back told nobody at all before this: the ticket just reappeared in a
        # queue. resp has already been rewritten above, so pass the new value through.
        await tell_owed({**t, "resp": "PNS" if nxt in ("Pending PNS", "Pending Review - Head PNS") else "Sales"},
                        nxt, u.name,
                        f"{ref}, {t['shipper']} was sent back to {nxt} by {u.name}: {body.reason}",
                        f"Sent back to you, {t['shipper']}", ref)

    await log_status(t["id"], nxt, u.name, body.reason or body.loss_reason or "")
    await audit(u.email, "status", "ticket", ref, "status", t["status"], nxt)
    return {"ok": True, "ref": ref, "status": nxt}


class AssignIn(BaseModel):
    """Who owns this ticket in PNS. Pass an empty string to clear it.

    `reviewer` is accepted and ignored: the separate reviewer slot was retired on
    2026-08-14 and an older tab still open in somebody's browser would otherwise get a
    422 on an ordinary assignment."""
    owner: str | None = None
    reviewer: str | None = None


@app.post("/api/tickets/{ref}/assign", response_model=Ok)
async def assign(ref: str, body: AssignIn, u: User = Depends(current_user)):
    t = await get_ticket(ref)
    if body.owner is None:
        raise HTTPException(400, "pass an owner")

    require(u, "assign", t)
    owner = body.owner.strip() or None
    await execute("UPDATE tickets SET owner_name=%s WHERE id=%s", (owner, t["id"]))
    await audit(u.email, "assign", "ticket", ref, "owner", t["owner_name"], owner)
    if owner:
        note = f"assigned to {owner}" if owner != u.name else f"{u.name} took this on"
        if owner != u.name:
            await notify(f"{ref}, {t['shipper']} assigned to you by {u.name}",
                         people=[owner], ticket_ref=ref)
    else:
        note = "owner cleared"

    await log_note(t["id"], t["status"], u.name, note)
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

        # A go-live date is a commitment to Ops, and Ops cannot act on it without the
        # account identifiers. Enforced at the point the date is SET, not on the merged
        # result — merged still carries an old go-live date on every later edit, so
        # checking merged here blocked every subsequent save on a ticket (a typo fix in
        # the brief, nothing to do with go-live) once a date existed with no IDs behind
        # it, which was every ticket the New Request form ever creates.
        if "golive" in body.payload and str(merged.get("golive") or "").strip():
            missing = [ONBOARDING_IDS[k] for k in ONBOARDING_IDS
                       if not str(merged.get(k) or "").strip()]
            if missing:
                raise HTTPException(
                    400, "a go-live date needs the account identifiers Ops will onboard "
                         "against. Still missing: " + ", ".join(missing))
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
        # An admin override outranks the matrix here for the same reason it does in the
        # sync: it was a deliberate decision about who prices this one deal, and a
        # correction to the revenue is not a reversal of it.
        #
        # Read from the row rather than from `merged`, which only exists when this edit
        # carried intake fields — an edit that changes revenue alone never binds it.
        _ov = await q("SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '" + RESP_OVERRIDE_PATH
                      + "')) AS v FROM ticket_input WHERE ticket_id=%s", (t["id"],), one=True)
        over = str((_ov or {}).get("v") or "").strip()
        if over == "null":
            over = ""
        if over in ("PNS", "Sales"):
            await execute("UPDATE tickets SET service_type=%s, potential_rev=%s "
                          "WHERE id=%s", (service, int(revenue), t["id"]))
            changes.append(f"priced by stays {over}, set by an admin")
        else:
            await execute("UPDATE tickets SET service_type=%s, potential_rev=%s, resp=%s, "
                          "needs_review=%s WHERE id=%s",
                          (service, int(revenue), r["resp"], int(r["review"]), t["id"]))
            if r["resp"] != t["resp"] or bool(r["review"]) != bool(t["needs_review"]):
                changes.append(f"now priced by {r['resp']}"
                               + (", PNS review required" if r["review"] else ""))

    note = f"edited by {u.name}, " + "; ".join(changes)
    await log_note(t["id"], t["status"], u.name, note[:500])
    await audit(u.email, "edit", "ticket", ref, "input", None, "; ".join(changes)[:500])
    await notify(f"{ref}, {t['shipper']}: {note}",
                 groups=["PNS", "Commercial"], ticket_ref=ref)
    return {"ok": True, "ref": ref, "status": t["status"]}


class PricedByIn(BaseModel):
    resp: str                      # "PNS" or "Sales"
    reason: str | None = None


@app.post("/api/tickets/{ref}/priced-by", response_model=Ok)
async def set_priced_by(ref: str, body: PricedByIn, u: User = Depends(current_user)):
    """Move a ticket between the Sales and PNS pricing queues by hand. Admin only.

    Normally nobody chooses this: route() derives it from account tier, service and
    revenue, and that derivation is what the 5A matrix says. The trial runs with Sales
    not yet on the platform, so PNS is working tickets the matrix has assigned to Sales,
    and there was no way to say so (Michael, 2026-08-18).

    The choice is REMEMBERED, not just written. Both places that re-derive routing — the
    Sales CRM sync and the intake edit — recompute resp whenever revenue, service or
    account tier changes, so a plain UPDATE here would be silently undone the next time
    Sales CRM moved any of the three, bouncing the ticket back to a queue the admin had
    deliberately moved it out of. The override is recorded and both of them honour it."""
    require(u, "setPricedBy")
    if body.resp not in ("PNS", "Sales"):
        raise HTTPException(400, "resp must be 'PNS' or 'Sales'")
    t = await get_ticket(ref)
    if t["resp"] == body.resp:
        raise HTTPException(400, f"{ref} is already priced by {body.resp}")

    # PNS does not re-check its own routine work, so a ticket moved to PNS carries no
    # PNS review; moved to Sales, the 5A answer for this deal applies again.
    r = route(t["acct_type"], t["service_type"], int(t.get("potential_rev") or 0))
    review = int(body.resp == "Sales" and bool(r["review"]))
    await execute("UPDATE tickets SET resp=%s, needs_review=%s WHERE id=%s",
                  (body.resp, review, t["id"]))

    row = await q("SELECT payload FROM ticket_input WHERE ticket_id=%s", (t["id"],), one=True)
    if row:
        p = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"] or "{}")
        p[RESP_OVERRIDE_KEY] = body.resp
        await execute("UPDATE ticket_input SET payload=%s WHERE ticket_id=%s",
                      (json.dumps(p), t["id"]))

    note = (f"priced by {t['resp']} to {body.resp}, set by {u.name}"
            + (f": {body.reason.strip()}" if (body.reason or "").strip() else ""))
    await log_note(t["id"], t["status"], u.name, note[:500])
    await audit(u.email, "priced_by", "ticket", ref, "resp", t["resp"], body.resp)
    await notify(f"{ref}, {t['shipper']}: {note}",
                 groups=["PNS", "Commercial"], ticket_ref=ref)
    return {"ok": True, "ref": ref, "status": t["status"]}


class SalesIn(BaseModel):
    name: str


@app.post("/api/tickets/{ref}/sales", response_model=Ok)
async def change_sales(ref: str, body: SalesIn, u: User = Depends(current_user)):
    """Hand the ticket to a different salesperson.

    The Sales Head and Sales Managers may move any ticket. A salesperson may hand over
    their own — checked against the ticket, so "my own" means this ticket's PIC really is
    them and not merely that they are in Commercial."""
    t = await get_ticket(ref)
    if not can(u, "setSales", t):
        raise HTTPException(
            403, f"{t['sales_name'] or 'somebody else'} is the sales PIC on {ref}. You can "
                 f"hand over a ticket that is yours; moving somebody else's is the Sales "
                 f"Manager's or Head's call.")
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "pick a salesperson")
    if name == (t["sales_name"] or ""):
        return {"ok": True, "ref": ref, "status": t["status"]}

    row = await q("SELECT email FROM users WHERE name=%s AND active=1", (name,), one=True)
    # A ticket handed to a name nobody has registered is a ticket with no working
    # notification address, which is how a deal goes quiet. Refused with the fix.
    if not row:
        raise HTTPException(
            400, f"{name} is not registered in this app, so notifications would go "
                 f"nowhere. Ask an administrator to add them under Administration / Users.")
    await execute("UPDATE tickets SET sales_name=%s, sales_email=%s WHERE id=%s",
                  (name, (row or {}).get("email"), t["id"]))
    await log_note(t["id"], t["status"], u.name,
                   f"sales PIC changed from {t['sales_name'] or 'unassigned'} to {name}")
    await notify(f"{ref}, {t['shipper']} reassigned to you by {u.name}",
                 people=[name], ticket_ref=ref)
    await audit(u.email, "reassign", "ticket", ref, "sales", t["sales_name"], name)
    return {"ok": True, "ref": ref, "status": t["status"]}


@app.post("/api/tickets/{ref}/pns-review", response_model=Ok)
async def pns_review(ref: str, u: User = Depends(current_user)):
    """A PNS member accepts the price Sales built, and it moves on.

    The ordinary review, not the Head's. Kept as its own endpoint rather than a flag on
    pns-final because they are different acts by different people: this one says "the
    number Sales put on a big Standard deal is sound", the Head's says "this whole
    watched solution is finished and the executives may be asked to sign it".

    Disagreeing is not done here — the reviewer sends it back to Sales with a reason, or
    escalates to PSP, both through POST /status. This endpoint is only the yes."""
    require(u, "markReviewed")
    t = await get_ticket(ref)
    if t["status"] != "Pending Review - PNS":
        raise HTTPException(409, f"{ref} is {t['status']}, not waiting on PNS review")

    nxt = next_gate(t, "Pending Review - PNS")
    await log_status(t["id"], nxt, u.name, "price checked by PNS")
    await execute("INSERT INTO approvals (ticket_id, kind, decision, actor, actor_role) "
                  "VALUES (%s,'pns_review','approved',%s,%s)", (t["id"], u.name, u.group))
    # Normally "Proposal Submitted" — but say what actually happened rather than assume,
    # the same way pns_finalise does. A watched ticket parked here by hand has a chain.
    if nxt == "Proposal Submitted":
        await notify(f"{ref}, {t['shipper']}: {u.name} checked the price — proposal is ready",
                     groups=["Commercial"], ticket_ref=ref)
    else:
        await notify(f"{ref}, {t['shipper']}: price checked by {u.name} — now at {nxt}",
                     groups=["PNS", "Commercial"], ticket_ref=ref)
    await audit(u.email, "pns_review", "ticket", ref, "status", t["status"], nxt)
    return {"ok": True, "ref": ref, "status": nxt}


@app.post("/api/tickets/{ref}/pns-final", response_model=Ok)
async def pns_finalise(ref: str, u: User = Depends(current_user)):
    """The Head of PNS signs off the solution and its pricing, and it moves on.

    Deliberately not a plain status change: what comes next is not one destination. The
    approval chain that applies was decided when the price was attached, so this asks
    next_after_head_pns() rather than letting the caller name a status and risk skipping
    PSP or C-level. Approving used to jump straight to "Proposal Submitted", which on a
    Hypercare deal would have bypassed the executive sign-off entirely."""
    require(u, "markReviewed")
    t = await get_ticket(ref)
    if t["status"] != "Pending Review - Head PNS":
        raise HTTPException(409, f"{ref} is {t['status']}, not waiting on PNS review")

    nxt = next_after_head_pns(t)
    await log_status(t["id"], nxt, u.name, "solution and pricing finalised by PNS")
    await execute("INSERT INTO approvals (ticket_id, kind, decision, actor, actor_role) "
                  "VALUES (%s,'pns_final','approved',%s,%s)", (t["id"], u.name, u.group))

    if nxt == "Pending Review - PSP":
        await notify(f"{ref}, {t['shipper']}: solution finalised by {u.name}, "
                     f"needs your margin decision", groups=["PSP"], ticket_ref=ref)
    elif nxt == "Pending Review - C-level":
        await notify(f"{ref}, {t['shipper']} ({t['acct_type']}): solution finalised by "
                     f"{u.name} and ready for Alex and Dhinesh",
                     groups=["PNS", "Commercial"], ticket_ref=ref)
    else:
        await notify(f"{ref}, {t['shipper']}: solution finalised — proposal is ready",
                     groups=["Commercial"], ticket_ref=ref)
    await audit(u.email, "pns_final", "ticket", ref, "status", t["status"], nxt)
    return {"ok": True, "ref": ref, "status": nxt}


class MustWinIn(BaseModel):
    must_win: bool


@app.post("/api/tickets/{ref}/must-win", response_model=Ok)
async def set_must_win(ref: str, body: MustWinIn, u: User = Depends(current_user)):
    """Tag or untag this deal as Must Win.

    Sales CRM carries this as the Lead Source Detail value "Must Win", and the sync reads
    it, so this is the manual override for a deal Sales has not tagged there yet — or has
    tagged wrongly. A later sync will overwrite it if Sales CRM has an opinion, which is
    correct: Sales CRM is the record. Must Win is per-deal and never touches the account
    or its sibling opportunities."""
    require(u, "editInput")
    t = await get_ticket(ref)
    await execute("UPDATE tickets SET must_win=%s WHERE id=%s", (int(body.must_win), t["id"]))
    await log_note(t["id"], t["status"], u.name,
                   "tagged Must Win" if body.must_win else "Must Win tag removed")
    await audit(u.email, "must_win", "ticket", ref, "must_win",
                bool(t.get("must_win")), body.must_win)
    if body.must_win:
        await notify(f"{ref}, {t['shipper']} tagged MUST WIN by {u.name} — it now needs "
                     f"PNS review even if Sales priced it",
                     groups=["PNS"], ticket_ref=ref)
    return {"ok": True, "ref": ref, "status": t["status"]}


class CrmIdIn(BaseModel):
    opportunity_id: str


@app.post("/api/tickets/{ref}/crm-id", response_model=Ok)
async def set_crm_id(ref: str, body: CrmIdIn, u: User = Depends(current_user)):
    """Attach the Sales CRM opportunity id and release the ticket into the pipeline.

    Anyone who can edit intake can do this — it is a missing fact, not a decision, and
    making Sales wait for a Head to unblock a typo helps nobody."""
    require(u, "editInput")
    t = await get_ticket(ref)
    oid = body.opportunity_id.strip()
    if not oid:
        raise HTTPException(400, "the Sales CRM opportunity id is required")
    # The current ids are short numbers (906031). A long one padded with zeros is the
    # retired Salesforce id, which the API will never match — caught here with the
    # reason, because "no opportunity with this id" sends people hunting in Sales CRM
    # for a record that is fine.
    if len(oid) > 10 and oid.lstrip("0").isdigit():
        raise HTTPException(
            400, f"{oid} looks like the old Salesforce id. Sales CRM now uses the short "
                 f"number from the record URL (for example 906031) — open the "
                 f"opportunity and copy the id from the address bar.")
    clash = await q("SELECT ticket_ref FROM tickets WHERE opportunity_id=%s AND id<>%s",
                    (oid, t["id"]), one=True)
    if clash:
        raise HTTPException(409, f"Sales CRM opportunity {oid} is already on "
                                 f"{clash['ticket_ref']}")
    await execute("UPDATE tickets SET opportunity_id=%s WHERE id=%s", (oid, t["id"]))

    # Only a ticket parked for the want of an id moves; correcting the id on a live
    # ticket must not drag it backwards through the pipeline.
    nxt = t["status"]
    if t["status"] == NO_CRM_STATUS:
        nxt = "Open"
        await log_status(t["id"], nxt, u.name, f"Sales CRM id {oid} supplied")
        await notify(f"{ref}, {t['shipper']} now has its Sales CRM id and is Open",
                     groups=["PNS"], ticket_ref=ref)
    else:
        await log_note(t["id"], t["status"], u.name, f"Sales CRM id set to {oid}")
    await audit(u.email, "crm_id", "ticket", ref, "opportunity_id",
                t.get("opportunity_id"), oid)
    return {"ok": True, "ref": ref, "status": nxt}


class ReopenIn(BaseModel):
    status: str


@app.post("/api/tickets/{ref}/reopen", response_model=Ok)
async def reopen(ref: str, body: ReopenIn, u: User = Depends(current_user)):
    """Put a lost or cancelled deal back into the pipeline. Any Commercial user."""
    require(u, "reopen")
    t = await get_ticket(ref)
    if t["status"] not in ("Lost", "Cancel"):
        raise HTTPException(400, f"{ref} is {t['status']}; only Lost or Cancel can be reopened")
    if body.status not in PENDING_STATUSES:
        raise HTTPException(400, f"reopen into one of {PENDING_STATUSES}")

    resp = "PNS" if body.status in ("Pending PNS", "Pending Review - Head PNS") else "Sales"
    await execute("UPDATE tickets SET outcome=NULL, loss_reason=NULL, resp=%s WHERE id=%s",
                  (resp, t["id"]))
    await log_status(t["id"], body.status, u.name, f"reopened by {u.name} (Sales)")
    await notify(f"{ref}, {t['shipper']} reopened as {body.status} by {u.name}",
                 groups=["PNS", "Commercial"], ticket_ref=ref)
    await audit(u.email, "reopen", "ticket", ref, "status", t["status"], body.status)
    return {"ok": True, "ref": ref, "status": body.status}


# POST /tickets/{ref}/head-ack lived here: the Sales Head accepting the commercial
# concession. Retired on 2026-08-14 with the gate itself — that decision is made in Sales
# CRM, where the Head of Sales already works. The `head_ack` rows already written to
# `approvals` are left alone; they are a record of what happened.


class AllowPspIn(BaseModel):
    allowed: bool = True
    note: str | None = None      # what Alex said, and where


@app.post("/api/tickets/{ref}/allow-psp", response_model=Ok)
async def allow_psp(ref: str, body: AllowPspIn, u: User = Depends(current_user)):
    """Open a non-managed ticket to PSP, on the PNS Head's authority.

    Strategic and Hypercare accounts never need this: they carry Alex's exception by
    being managed. This is the narrow path for the one-off Alex grants verbatim in a
    meeting, and the note is mandatory because an exception with no recorded reason is
    indistinguishable, months later, from a misclick."""
    require(u, "allowPsp")
    t = await get_ticket(ref)
    if t["acct_type"] in MANAGED_ACCTS:
        raise HTTPException(400, f"{ref} is {t['acct_type']} and already reaches PSP "
                                 f"without an exception")
    if body.allowed and not (body.note or "").strip():
        raise HTTPException(400, "a note is required: record what Alex granted and where")
    await execute("UPDATE tickets SET psp_allowed=%s, psp_allowed_by=%s, "
                  "psp_allowed_note=%s, psp_allowed_at=%s WHERE id=%s",
                  (int(body.allowed), u.name if body.allowed else None,
                   (body.note or "").strip()[:500] if body.allowed else None,
                   datetime.now() if body.allowed else None, t["id"]))
    await log_note(t["id"], t["status"], u.name,
                   (f"opened to PSP on Alex's exception: {body.note}" if body.allowed
                    else "PSP exception withdrawn"))
    await audit(u.email, "allow_psp", "ticket", ref, "psp_allowed",
                str(t.get("psp_allowed")), str(int(body.allowed)))
    return {"ok": True, "ref": ref, "status": t["status"]}


# The Project Charter field map. This mirrors SECTIONS in frontend/src/screens/
# TicketDetail.jsx, the screen renders its own copy for display and copy-to-clipboard,
# and this one is what gets emailed. Keep the two in step: a charter that reads
# differently depending on whether it was pasted or sent is worse than either alone.
CHARTER_SECTIONS = [
    # Invoicing PIC and its contact were dropped on 2026-08-11: billing never used them.
    # The Salesforce/Jira id fields went with them — they were three names for the one
    # Sales CRM opportunity id, which the ticket already carries as a column and shows
    # as CRM ID. Three places to type the same number is three places to mistype it.
    ("1 Â· Shipper profile", [
        ("shipper", "Shipper name"), ("shipperStatus", "Status"), ("brief", "Brief summary"),
        ("shipperPic", "Shipper PIC"), ("shipperContact", "Contact shipper PIC"),
        ("invAddr", "Invoicing address"), ("pickPic", "Pickup PIC"),
        ("pickContact", "Contact pickup PIC"), ("pickup", "Pickup address"),
        ("dest", "Destination"), ("freq", "Shipment frequency"), ("volume", "Shipment volume"),
    ]),
    ("2 Â· Cargo knowledge", [
        ("commodity", "Product"), ("product", "Specific product"), ("dim", "Dimension"),
        ("wt", "Weight (kg)"), ("pallet", "Palletized"),
    ]),
    # Pickup and delivery windows live here, with the rest of the service Ninja commits
    # to, rather than up in the shipper's profile: a waiting time is something Ninja
    # performs and is costed on, not a fact about the shipper.
    ("3 Â· Ninja's service", [
        ("pickSlot", "Pickup time"), ("pickWait", "Pickup waiting time"),
        ("delSlot", "Delivery time"), ("delWait", "Delivery waiting time"),
        ("destType", "Delivery destination type"), ("sla", "SLA"), ("mps", "MPS"),
        ("rdo", "RDO"), ("cod", "COD"), ("tkbmO", "TKBM origin"), ("tkbmD", "TKBM destination"),
        ("ins", "Insurance"), ("truck", "Vehicle request"),
        ("handling", "Custom handling request"), ("notes", "Notes"),
    ]),
    # Solutioning vs onboarding, split on Baskoro's call (2026-08-11): sections 1-3 are
    # the Project Charter (what PNS designed and priced); section 4 is the Kick-Off data
    # (what Ops needs to onboard). One document still carries both, clearly labelled,
    # until the charter audience question is settled; the IDs stay required for go-live.
    ("4 Â· Kick-off — onboarding & go-live", [
        ("golive", "Go live"),
        ("parentShipperId", "Parent shipper ID"), ("shipperId", "Shipper ID"),
        ("branchId", "Corporate branch ID"),
    ]),
]
CHARTER_HOURS = ("pickWait", "delWait")

# ------------------------------------------------------------------ the field guide
#
# "Which fields must be filled for a ticket to move, and which come from Sales CRM?"
# — Baskoro, 2026-08-14. Both were answerable only by reading main.py, so both were
# effectively unanswerable.
#
# The honest answer has two halves that are easy to confuse, and this table keeps them
# apart on purpose:
#
#   ENFORCED   the server refuses. There are only five of these, and they are the whole
#              reason a ticket ever gets stuck.
#   ASKED      the intake form marks it required and nothing checks it afterwards. Most
#              fields are here. Saying "required" for both would make the five that
#              actually block invisible among the thirty that do not.
#
# {key: (who fills it, when it is needed, what it blocks if empty)}
# An empty "blocks" means exactly that: nothing stops, the ticket is just less useful.
FIELD_RULES = {
    # 1 · Shipper profile
    "shipper":        ("Sales", "asked", ""),
    "shipperStatus":  ("Sales", "asked", ""),
    "brief":          ("Sales", "asked", "It is the first thing PNS reads. Nothing is "
                                         "refused without it, but the questions come back."),
    "shipperPic":     ("Sales", "asked", ""),
    "shipperContact": ("Sales", "asked", ""),
    "invAddr":        ("Sales", "won", ""),
    "pickPic":        ("Sales", "won", ""),
    "pickContact":    ("Sales", "won", ""),
    "pickup":         ("Sales", "asked", ""),
    "dest":           ("Sales", "asked", ""),
    "freq":           ("Sales", "asked", ""),
    "volume":         ("Sales", "asked", ""),
    # 2 · Cargo knowledge
    "commodity":      ("Sales", "asked", ""),
    "product":        ("Sales", "asked", ""),
    "dim":            ("Sales", "asked", ""),
    "wt":             ("Sales", "asked", ""),
    "pallet":         ("Sales", "asked", ""),
    # 3 · Ninja's service
    "pickSlot":       ("Sales", "asked", ""),
    "pickWait":       ("Sales", "optional", "Blank means the driver does not wait, which "
                                            "is a costed fact rather than a gap."),
    "delSlot":        ("Sales", "asked", ""),
    "delWait":        ("Sales", "optional", "Blank means the driver does not wait."),
    "destType":       ("Sales", "asked", ""),
    "sla":            ("Sales", "asked", ""),
    "mps":            ("Sales", "asked", ""),
    "rdo":            ("Sales", "asked", ""),
    "rdoNotes":       ("Sales", "optional", "Only when RDO is Yes. PNS cannot price an "
                                            "RDO it has not been told the shape of."),
    "cod":            ("Sales", "asked", ""),
    "tkbmO":          ("Sales", "asked", ""),
    "tkbmD":          ("Sales", "asked", ""),
    "ins":            ("Sales", "asked", ""),
    "truck":          ("Sales", "optional", ""),
    "handling":       ("Sales", "optional", ""),
    "notes":          ("Sales", "optional", ""),
    # 4 · Kick-off
    "golive":         ("Sales", "won", "ENFORCED the other way round: setting a go-live "
                                       "date is REFUSED until the three account "
                                       "identifiers below are filled in, because it is a "
                                       "commitment to Ops and Ops cannot act on a date "
                                       "with nothing to onboard against."),
    "parentShipperId": ("Sales", "won", "The Kick-off will not send without it."),
    "shipperId":      ("Sales", "won", "The Kick-off will not send without it."),
    "branchId":       ("Sales", "won", "The Kick-off will not send without it."),
}

# Facts that live on the ticket itself rather than in the intake payload. These are where
# the enforced gates actually are.
TICKET_FIELDS = [
    # key, label, who, when, blocks
    ("opportunity_id", "Sales CRM opportunity ID", "Sales", "enforced",
     "Without it the ticket parks in Pending CRM ID and CANNOT MOVE AT ALL. The sync "
     "finds every deal by this id, so a ticket it cannot see drifts out of step with the "
     "commercial record and gets believed anyway."),
    ("potential_rev", "Potential revenue", "Sales CRM; correctable here until the next sync",
     "enforced",
     "Without it the ticket cannot enter any working status and cannot be priced. It "
     "decides who prices the deal, which 5A ceiling applies and whether PNS reviews the "
     "result — at zero all three are decided as if it were the smallest possible deal. "
     "Sales CRM overwrites it on every run, and the routing is re-derived when it does."),
    ("service_type", "Service type", "Sales CRM; correctable here until the next sync",
     "enforced",
     "Decides the pricing ceiling and, with the tier, who prices it. Sales CRM says only "
     "\"Trucking\" for FTL, so an imported FTL ticket needs the line confirmed — and that "
     "confirmation is overwritten on the next run, because Sales CRM takes priority."),
    ("acct_type", "Account type", "Sales CRM account group", "asked",
     "Hypercare and Strategic put the deal in a watched group and route it to PNS. It is "
     "resolved from the account group on every sync and overwrites what is held here."),
    ("must_win", "Must Win", "Sales CRM Lead Source Detail, settable here", "optional",
     "Puts this one deal in a watched group."),
    ("region", "Region", "Sales", "asked", "Used by the meeting screens to run by region."),
    ("sales_name", "Sales PIC", "Sales", "asked",
     "An unregistered name means notifications go nowhere, so handing over to one is "
     "refused."),
]

# The five places the server actually says no. Kept as its own short list because it is
# the answer to "why is this stuck", and a reader should not have to find it inside a
# forty-row table.
HARD_GATES = [
    ("No Sales CRM opportunity id",
     "The ticket sits in Pending CRM ID. It can only acquire an id, or be cancelled.",
     "Add it on the ticket, or from the Pending CRM ID screen."),
    ("Potential revenue is 0",
     "It cannot enter Pending PNS, Pending Sales, any review status, or be priced.",
     "Set it on the Input tab. PNS can do this too during the pilot."),
    ("A go-live date with no account identifiers",
     "Saving the go-live date is refused.",
     "Fill parent shipper ID, shipper ID and corporate branch ID first."),
    ("Kick-off with a blank go-live or shipper ID",
     "The Kick-off email will not send.",
     "Complete section 4 on the Input tab."),
    ("A Standard deal priced below its floor",
     "Attaching the price is refused outright — a Standard deal can never be below floor.",
     "Reprice within the ceiling, or ask the Head of PNS to tag the deal Must Win."),
]


def field_guide() -> list[dict]:
    """Every intake field, what it is for, and where it comes from.

    Sync provenance is READ OUT OF the same CRM_OPP_PAYLOAD / CRM_ACCOUNT_PAYLOAD tables
    the sync itself walks, so this page cannot claim a field is synced when it is not —
    which is the failure mode a hand-written version of this table would have on day one.
    """
    src: dict[str, tuple[str, list[str]]] = {}
    for key, names, _label, owned in CRM_OPP_PAYLOAD:
        src[key] = ("overwritten" if owned else "gap-fill", names)
    for key, names, _label, owned in CRM_ACCOUNT_PAYLOAD:
        src[key] = ("overwritten" if owned else "gap-fill", names)

    out = []
    for section, fields in CHARTER_SECTIONS:
        for key, label in fields:
            who, when, blocks = FIELD_RULES.get(key, ("Sales", "asked", ""))
            how, names = src.get(key, ("never", []))
            out.append({"key": key, "label": label, "section": section, "who": who,
                        "when": when, "blocks": blocks, "sync": how,
                        "crm_fields": names, "on_ticket": False})
    # rdoNotes is deliberately not on the Project Charter — it is working detail for PNS,
    # not something the shipper reads back — so it is added here rather than to
    # CHARTER_SECTIONS.
    who, when, blocks = FIELD_RULES["rdoNotes"]
    out.append({"key": "rdoNotes", "label": "RDO details from Sales",
                "section": "3 Â· Ninja's service", "who": who, "when": when,
                "blocks": blocks, "sync": "never", "crm_fields": [], "on_ticket": False})

    # Everything the sync carries that is NOT on the Project Charter. These were invisible
    # on the first cut of this page — they are on no charter section, so walking
    # CHARTER_SECTIONS missed them entirely, and they are precisely the ones somebody
    # would waste an afternoon correcting by hand: Sales CRM owns them and overwrites
    # them every morning.
    seen = {f["key"] for f in out}
    labels = {k: lb for k, _n, lb, _o in CRM_OPP_PAYLOAD}
    labels |= {k: lb for k, _n, lb, _o in CRM_ACCOUNT_PAYLOAD}
    for key, (how, names) in sorted(src.items()):
        if key in seen:
            continue
        out.append({"key": key, "label": labels.get(key, key),
                    "section": "Carried from Sales CRM, not on the charter",
                    "who": "Sales CRM", "when": "optional",
                    "blocks": ("Reference only. Reported alongside potential revenue, "
                               "and re-read every sync."),
                    "sync": how, "crm_fields": names, "on_ticket": False})
    return out

# key -> human label, so a field comment can name the field it is about without the
# frontend having to send the label along with it.
CHARTER_FIELD_LABELS = {k: label for _, fields in CHARTER_SECTIONS for k, label in fields}

# Required before a go-live date can be set, see edit_input.
ONBOARDING_IDS = {"parentShipperId": "Parent shipper ID", "shipperId": "Shipper ID",
                  "branchId": "Corporate branch ID"}

_CS = {
    "table": "border-collapse:collapse;width:100%;max-width:760px;font-family:Arial,Helvetica,"
             "sans-serif;font-size:13px;color:#111827",
    "section": "background:#f1f5f9;font-weight:bold;font-size:12px;letter-spacing:.4px;"
               "text-transform:uppercase;color:#334155;padding:8px 10px;border:1px solid #cbd5e1",
    "label": "width:34%;background:#f8fafc;padding:7px 10px;border:1px solid #e2e8f0;"
             "vertical-align:top;color:#475569",
    "value": "padding:7px 10px;border:1px solid #e2e8f0;vertical-align:top",
}


def _charter_value(key: str, raw) -> str:
    """Waiting time is the one field where blank is an answer, not a gap: 'None' means
    the driver does not wait, which is a costed fact."""
    s = str(raw if raw is not None else "").strip()
    if key in CHARTER_HOURS:
        return "None" if s == "" else f"{s} hour{'' if s == '1' else 's'}"
    return s


def render_charter(t: dict, inp: dict, extras: list[tuple[str, str]],
                   sections: list[str] | None = None,
                   title: str = "Project Charter") -> tuple[str, str]:
    """Build the charter as (html, plain text). No cost, no margin, ever.

    `sections` narrows which CHARTER_SECTIONS are rendered — the Kick-off uses it to
    carry only what Ops act on. None means all of them, which is the Charter itself."""
    esc = lambda v: (str(v if v is not None else "").replace("&", "&amp;")
                     .replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))
    rp = lambda n: "Rp " + f"{int(n or 0):,}".replace(",", ".")

    head = [("Ticket", t["ticket_ref"]), ("Shipper", t["shipper"]),
            ("Account type", t["acct_type"]), ("Service", t["service_type"]),
            ("Potential revenue", rp(t["potential_rev"])), ("Region", t.get("region") or ", "),
            ("Status", t["status"]), ("Submitted", str(t["submitted_on"])),
            ("Sales PIC", t.get("sales_name") or ", "),
            ("PNS owner", t.get("owner_name") or "unassigned")]

    rows, text = [], [f"{title.upper()}, {t['shipper']}",
                      f"{t['ticket_ref']} Â· {t['service_type']} Â· {rp(t['potential_rev'])}", ""]
    rows.append(f'<tr><td colspan="2" style="{_CS["section"]}">Ticket</td></tr>')
    text.append("TICKET")
    for label, value in head:
        rows.append(f'<tr><td style="{_CS["label"]}">{esc(label)}</td>'
                    f'<td style="{_CS["value"]}">{esc(value)}</td></tr>')
        text.append(f"{label:<28}: {value}")

    for section, fields in CHARTER_SECTIONS:
        if sections is not None and section not in sections:
            continue
        rows.append(f'<tr><td colspan="2" style="{_CS["section"]}">{esc(section)}</td></tr>')
        text += ["", section.upper()]
        for key, label in fields:
            v = _charter_value(key, inp.get(key))
            cell = esc(v).replace("\n", "<br>") if v else "&mdash;"
            rows.append(f'<tr><td style="{_CS["label"]}">{esc(label)}</td>'
                        f'<td style="{_CS["value"]}">{cell}</td></tr>')
            text.append(f"{label:<28}: {v or ', '}")

    for label, value in extras:
        rows.append(f'<tr><td style="{_CS["label"]}">{esc(label)}</td>'
                    f'<td style="{_CS["value"]}">{esc(value)}</td></tr>')
        text.append(f"{label:<28}: {value}")

    html = (f'<div><p style="font-family:Arial,Helvetica,sans-serif;font-size:17px;'
            f'font-weight:bold;margin:0 0 2px">{esc(title)} &mdash; {esc(t["shipper"])}</p>'
            f'<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;'
            f'margin:0 0 14px">{esc(t["ticket_ref"])} &middot; {esc(t["service_type"])} '
            f'&middot; {esc(rp(t["potential_rev"]))}</p>'
            f'<table style="{_CS["table"]}" cellspacing="0" cellpadding="0"><tbody>'
            f'{"".join(rows)}</tbody></table>'
            f'<p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8;'
            f'margin:14px 0 0">Sent from Ninja PNS. Price only &mdash; this charter carries '
            f'no cost or margin.</p></div>')
    text += ["", "Price only, this charter carries no cost or margin."]
    return html, "\n".join(text)


class CharterSend(BaseModel):
    to: list[str] = []            # extra addresses beyond PNS, Sales and the sales PIC
    note: str | None = None


@app.post("/api/tickets/{ref}/charter/send", response_model=Ok)
async def send_charter(ref: str, body: CharterSend, u: User = Depends(current_user)):
    """Publish the Project Charter by email to PNS, Sales and the sales PIC.

    Only once PNS has cleared the intake: the charter is the official record, and one
    sent with gaps in it is what the commercial conversation is then held against."""
    require(u, "markReviewed")
    t = await get_ticket(ref)
    if not email_configured():
        raise HTTPException(503, "email is not configured on this deployment; "
                                 "use Copy for email on the ticket instead")
    row = await q("SELECT payload, cleared_at FROM ticket_input WHERE ticket_id=%s",
                  (t["id"],), one=True)
    if not row or not row["cleared_at"]:
        raise HTTPException(409, f"{ref} has not been cleared yet. Clear the intake first: "
                                 f"the charter is the official record and cannot go out with gaps")
    inp = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"] or "{}")

    pr = await q("SELECT price_file, price_url FROM pricing WHERE ticket_id=%s",
                 (t["id"],), one=True) or {}
    extras = [(k, v) for k, v in (("Pricing", pr.get("price_file")),
                                  ("Rate card link", pr.get("price_url"))) if v]
    if t.get("exec_signoff"):
        extras.append(("Executive sign-off", f"recorded by {t.get('exec_signoff_by')}"))

    # PNS and Sales only (Baskoro, 2026-08-11). The Charter is the solutioning record —
    # what Ninja agreed to do and at what price — and its audience is the two teams who
    # negotiated it. Ops get the Kick-off instead, which is a different document with a
    # different job; sending the Charter wide was how price ended up in front of people
    # who had no use for it.
    audience = await q("SELECT email FROM users WHERE role_group IN ('PNS','Commercial') "
                       "AND active=1")
    to = {r["email"] for r in audience} | set(body.to or [])
    if t.get("sales_email"):
        to.add(t["sales_email"])
    to.discard("")
    if not to:
        raise HTTPException(400, "nobody to send to. Register PNS or Sales users first")

    html, text = render_charter(t, inp, extras)
    if body.note:
        html = f'<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px">' \
               f'{body.note}</p>' + html
        text = body.note + "\n\n" + text
    subject = f"Project Charter - {t['shipper']}"
    await asyncio.to_thread(_send_sync, sorted(to), subject, text, html)

    await log_note(t["id"], t["status"], u.name,
                   f"charter emailed to {len(to)} recipient{'' if len(to) == 1 else 's'}")
    await audit(u.email, "charter_sent", "ticket", ref, "recipients", None, ",".join(sorted(to)))
    return {"ok": True, "ref": ref, "status": t["status"]}


# The Kick-off is a different document to a different audience. The Charter says what
# Ninja sold; the Kick-off says what Ops must now run, and deliberately carries no price
# at all — not the sheet, not the link, nothing. It cannot go out before the four
# onboarding facts exist, because those are precisely what Ops cannot start without.
KICKOFF_SECTIONS = ["2 Â· Cargo knowledge", "3 Â· Ninja's service",
                    "4 Â· Kick-off — onboarding & go-live"]


@app.post("/api/tickets/{ref}/kickoff/send", response_model=Ok)
async def send_kickoff(ref: str, body: CharterSend, u: User = Depends(current_user)):
    """Email the Kick-off to PNS, Sales and Ops once the deal is won and identified."""
    require(u, "markReviewed")
    t = await get_ticket(ref)
    if not email_configured():
        raise HTTPException(503, "email is not configured on this deployment")
    if t["status"] != "Proposal Accepted / Ready to Ship":
        raise HTTPException(409, f"{ref} is {t['status']}. The Kick-off goes out once the "
                                 f"shipper has accepted, not before")

    row = await q("SELECT payload FROM ticket_input WHERE ticket_id=%s", (t["id"],), one=True)
    inp = (row["payload"] if isinstance((row or {}).get("payload"), dict)
           else json.loads((row or {}).get("payload") or "{}"))
    missing = [label for key, label in ONBOARDING_IDS.items()
               if not str(inp.get(key) or "").strip()]
    if not str(inp.get("golive") or "").strip():
        missing.append("Go live date")
    if missing:
        raise HTTPException(409, "Ops cannot onboard without: " + ", ".join(missing))

    # Ops, plus the two teams who sold it. No price section and no pricing extras.
    people = await q("SELECT email FROM users WHERE role_group IN "
                     "('PNS','Commercial','Ops') AND active=1")
    to = {r["email"] for r in people} | set(body.to or [])
    if t.get("sales_email"):
        to.add(t["sales_email"])
    to.discard("")
    if not to:
        raise HTTPException(400, "nobody to send to. Register Ops users first")

    html, text = render_charter(t, inp, [], sections=KICKOFF_SECTIONS,
                                title="Kick-off")
    intro = (f"{t['shipper']} goes live on {inp.get('golive')}. "
             f"The Project Charter on ticket {ref} is the source of truth for what was "
             f"sold; this is what Ops need to run it.")
    html = (f'<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px">'
            f'{(body.note + "<br><br>") if body.note else ""}{intro}</p>') + html
    text = ((body.note + "\n\n") if body.note else "") + intro + "\n\n" + text

    await asyncio.to_thread(_send_sync, sorted(to),
                            f"Kick-off - {t['shipper']} - go live {inp.get('golive')}",
                            text, html)
    await log_note(t["id"], t["status"], u.name,
                   f"kick-off emailed to {len(to)} recipient"
                   f"{'' if len(to) == 1 else 's'} (PNS, Sales, Ops)")
    await audit(u.email, "kickoff_sent", "ticket", ref, "recipients", None,
                ",".join(sorted(to)))
    return {"ok": True, "ref": ref, "status": t["status"]}


class SignoffIn(BaseModel):
    done: bool
    note: str | None = None


@app.post("/api/tickets/{ref}/exec-signoff", response_model=Ok)
async def exec_signoff(ref: str, body: SignoffIn, u: User = Depends(current_user)):
    """Record that Alex (CSO) and Dhinesh (COO) have signed off the solution.

    The approval itself happens over email for now, this only records that it
    happened, so the charter can state it and the audit trail is not a gap. Managed
    accounts only; nothing else needs an executive sign-off."""
    t = await get_ticket(ref)
    if t["acct_type"] not in MANAGED_ACCTS:
        raise HTTPException(400, f"{ref} is {t['acct_type']}; executive sign-off applies "
                                 f"to {' and '.join(MANAGED_ACCTS)} accounts only")
    require(u, "markReviewed")
    await execute("UPDATE tickets SET exec_signoff=%s, exec_signoff_by=%s, "
                  "exec_signoff_at=%s WHERE id=%s",
                  (int(body.done), u.name if body.done else None,
                   datetime.now() if body.done else None, t["id"]))

    note = ("executive sign-off recorded" if body.done else "executive sign-off withdrawn") \
        + (f", {body.note}" if body.note else "")
    status = t["status"]
    if body.done and status == "Pending Review - C-level":
        # This was the last gate, so recording it releases the proposal.
        status = "Proposal Submitted"
        await log_status(t["id"], status, u.name, note)
        await notify(f"{ref}, {t['shipper']}: signed off by Alex and Dhinesh, proposal is ready",
                     groups=["Commercial"], ticket_ref=ref)
    else:
        await log_note(t["id"], status, u.name, note)

    await audit(u.email, "exec_signoff", "ticket", ref, "exec_signoff",
                str(t.get("exec_signoff")), str(int(body.done)))
    return {"ok": True, "ref": ref, "status": status}


@app.get("/api/tickets/{ref}/signoff-draft")
async def signoff_draft(ref: str, u: User = Depends(current_user)):
    """A ready-to-send draft for the sign-off email PNS currently writes by hand.

    Returned as text for the author to copy, edit and send from their own mailbox, 
    the app does not send it. An approval this senior should leave the building from a
    person's own address, and PNS routinely adds context no template can guess."""
    t = await get_ticket(ref)
    if t["acct_type"] not in MANAGED_ACCTS:
        raise HTTPException(400, f"{ref} is {t['acct_type']}; no executive sign-off needed")
    row = await q("SELECT payload FROM ticket_input WHERE ticket_id=%s", (t["id"],), one=True)
    p = {}
    if row and row["payload"]:
        p = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"])
    pr = await q("SELECT price_url, margin_pct, discount_pct FROM pricing WHERE ticket_id=%s",
                 (t["id"],), one=True) or {}

    def line(label, value):
        return f"{label}: {value}" if value not in (None, "", "-") else None

    body = [
        f"Subject: Solution sign-off, {t['shipper']} ({t['service_type']}), {ref}",
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
    return {"ref": ref, "to": ["Alex (CSO)", "Dhinesh (COO)"],
            "subject": f"Solution sign-off, {t['shipper']} ({t['service_type']}), {ref}",
            "body": "\n".join(body)}


class PspIn(BaseModel):
    approve: bool
    note: str | None = None
    # A ticket reaches PSP because the price needs PSP's own read on it, not
    # infrequently because nobody else could price it in the first place (a managed
    # account with no rate card to build from). These let PSP enter or correct the
    # figure in the same action as approving or rejecting it, rather than needing a
    # separate trip through Awaiting price first. All optional: leave them blank to
    # decide on whatever is already attached.
    price_file: str | None = None
    price_url: str | None = None
    margin_pct: float | None = None
    discount_pct: float | None = None


@app.post("/api/tickets/{ref}/psp", response_model=Ok)
async def psp_decide(ref: str, body: PspIn, u: User = Depends(current_user)):
    t = await get_ticket(ref)
    # PSP being unavailable should not stall a deal, so the PNS Head may decide in their
    # place. A note is mandatory and the record says it was an override, so how often
    # this happens stays visible instead of quietly becoming the norm.
    # The Head of PSP step is the Head's alone: PSP staff already signed the row before
    # it, and letting them sign again would make the second signature decorative.
    if t["status"] == "Pending Review - Head PSP":
        require(u, "pspHeadDecide")
    on_behalf = not can(u, "pspDecide")
    if on_behalf:
        require(u, "pspOverride")
        if not body.note:
            raise HTTPException(
                400, "a note is required when PNS approves in PSP's place. Say why PSP "
                     "could not decide and what you relied on")
    else:
        require(u, "pspDecide")

    if body.price_file or body.price_url:
        url = clean_url(body.price_url)
        await execute(
            "INSERT INTO pricing (ticket_id, price_file, price_url, margin_pct, "
            "discount_pct, priced_by, priced_at) VALUES (%s,%s,%s,%s,%s,%s,NOW()) "
            "ON DUPLICATE KEY UPDATE "
            "price_file=VALUES(price_file), price_url=VALUES(price_url), "
            "margin_pct=VALUES(margin_pct), discount_pct=VALUES(discount_pct), "
            "priced_by=VALUES(priced_by), priced_at=NOW()",
            (t["id"], body.price_file or "Pricing spreadsheet", url, body.margin_pct,
             body.discount_pct, u.name))
        # get_ticket() does not join pricing, so there is no prior value here to log
        # without a second query; the approvals row inserted below already carries
        # PSP's note as the record of why the figure changed.
        await audit(u.email, "price", "ticket", ref, "price_file", None, body.price_file)

    ready_to_submit = False
    if body.approve:
        # A ticket can reach PSP three ways: automatically when a price lands below the
        # floor, an optional early send from Awaiting price, or an optional send from
        # mid-review.
        #
        # Below-bottom now goes to the Sales Head *after* PSP, not before. PSP has ruled
        # on whether the margin is survivable; what remains is whether Sales will wear
        # the concession, and that is the Head's to answer with the margin settled.
        # PSP has two signatures on the watched below-floor path: staff decide, then
        # the Head of PSP owns it. next_gate() holds that order so this endpoint does
        # not have to re-derive it.
        nxt = next_gate(t, t["status"])
        if nxt == "Pending Review - Head PSP":
            await notify(f"{ref}, {t['shipper']}: PSP approved the margin, yours to own",
                         roles=["PSP - Head"], groups=["PSP"], ticket_ref=ref)
        elif nxt == "Pending Review - Head PNS":
            await notify(f"{ref}, {t['shipper']}: margin cleared by PSP — finalise the "
                         f"solution", roles=["PNS - Head"], ticket_ref=ref)
        elif nxt in ("Pending PNS", "Pending Sales"):
            ready_to_submit = True
            await execute("UPDATE tickets SET psp_ready=1 WHERE id=%s", (t["id"],))
    else:
        if not body.note:
            raise HTTPException(400, "a note is required to reject a price")
        nxt = pending_for(t["resp"])
    actor_role = f"{u.group} (on behalf of PSP)" if on_behalf else "PSP"
    await log_status(t["id"], nxt, u.name if on_behalf else "PSP",
                     (body.note or "price approved") + (" [PSP override]" if on_behalf else ""))
    await execute("INSERT INTO approvals (ticket_id, kind, decision, actor, actor_role, note) "
                  "VALUES (%s,'psp',%s,%s,%s,%s)",
                  (t["id"], "approved" if body.approve else "rejected", u.name,
                   actor_role[:30], body.note))
    await notify(f"{ref}, PSP {'approved' if body.approve else 'rejected'} the price"
                 f"{': ' + body.note if body.note else ''}",
                 groups=[t["resp"] == "PNS" and "PNS" or "Commercial"], ticket_ref=ref)
    if not body.approve:
        # A rejection puts the ticket back on whoever priced it, same rule as a send-back.
        await tell_owed(t, nxt, u.name,
                        f"{ref}, {t['shipper']}: PSP rejected the price. {body.note}",
                        f"Price rejected, {t['shipper']}", ref)
    elif ready_to_submit:
        # Approved and cleared to submit, the pricer needs to know it's their move, not
        # just that PSP acted (the broadcast above doesn't name anyone).
        await tell_owed(t, nxt, u.name,
                        f"{ref}, {t['shipper']}: PSP approved the margin. Submit the proposal.",
                        f"Ready to submit, {t['shipper']}", ref)
    return {"ok": True, "ref": ref, "status": nxt}


class PspAssignIn(BaseModel):
    assignee: str | None = None   # "" or None clears it


@app.post("/api/tickets/{ref}/psp-assign", response_model=Ok)
async def psp_assign(ref: str, body: PspAssignIn, u: User = Depends(current_user)):
    """Who in PSP is handling this. Flat, any PSP member may set or clear it, on any
    ticket, for themselves or a teammate. There is no PSP head to gate this on."""
    require(u, "pspAssign")
    t = await get_ticket(ref)
    assignee = (body.assignee or "").strip() or None
    await execute("UPDATE tickets SET psp_assignee=%s WHERE id=%s", (assignee, t["id"]))
    await log_note(t["id"], t["status"], u.name,
                   f"PSP PIC {'set to ' + assignee if assignee else 'cleared'}")
    if assignee and assignee != u.name:
        await notify(f"{ref}, {t['shipper']}: assigned to you for PSP review by {u.name}",
                     people=[assignee], ticket_ref=ref)
    await audit(u.email, "assign", "ticket", ref, "psp_assignee", t.get("psp_assignee"), assignee)
    return {"ok": True, "ref": ref}


@app.post("/api/tickets/{ref}/submit-proposal", response_model=Ok)
async def submit_proposal(ref: str, u: User = Depends(current_user)):
    """The final step after PSP clears a margin that did not also need PNS review. PSP
    approving the price is not the same as the proposal being ready, the side that
    priced it confirms explicitly. Nothing about the price is re-entered here; that
    already happened in submit_price."""
    t = await get_ticket(ref)
    if not t.get("psp_ready"):
        raise HTTPException(400, f"{ref} is not waiting on a final submit")
    if not attach_price(u, t):
        raise HTTPException(403, f"{t['resp']} owns {ref}")
    await execute("UPDATE tickets SET psp_ready=0 WHERE id=%s", (t["id"],))
    # Managed accounts still need Alex and Dhinesh. PSP clearing the margin is a pricing
    # decision; the executive sign-off is about the solution, and it stays last.
    nxt = proposal_or_signoff(t)
    await log_status(t["id"], nxt, u.name, "submitted after PSP approval")
    if nxt == "Pending Review - C-level":
        await notify(f"{ref}, {t['shipper']} ({t['acct_type']}): PSP cleared the margin, "
                     f"awaiting Alex and Dhinesh sign-off", groups=["PNS"], ticket_ref=ref)
    else:
        await notify(f"{ref}, {t['shipper']}: proposal is ready",
                     groups=["Commercial"], ticket_ref=ref)
    await audit(u.email, "submit", "ticket", ref, "status", t["status"], nxt)
    return {"ok": True, "ref": ref, "status": nxt}


@app.delete("/api/tickets/{ref}", response_model=Ok)
async def soft_delete(ref: str, u: User = Depends(current_user)):
    require(u, "deleteTicket")   # PNS Head or Admin
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
    (the foreign keys cascade). Admin only, and only from the bin, there is deliberately
    no way to hard-delete a live ticket in one step."""
    require(u, "purgeTicket")
    t = await q("SELECT id, deleted_at FROM tickets WHERE ticket_ref=%s", (ref,), one=True)
    if not t:
        raise HTTPException(404, f"{ref} not found")
    if not t["deleted_at"]:
        raise HTTPException(400, f"{ref} is still live; move it to the recycle bin first")
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


class Sibling(BaseModel):
    """Another opportunity on the same account. Deliberately thinner than Ticket: this is
    context for the deal you are looking at, not a second list to work from."""
    ref: str
    status: str
    service: str
    revenue: int
    must_win: bool = False
    opportunity_id: str | None = None
    opportunity_name: str | None = None
    owner: str | None = None
    sales: str | None = None
    submitted_on: str


class TicketDetail(BaseModel):
    ticket: Ticket
    siblings: list[Sibling] = []
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
    rate_card_url: str | None = None


# url is the actual pricing tool where one exists; None means there is nothing to link
# to yet and the name is shown as plain text instead.
WEB_PRICING_URL = "https://web-pricing.ninjavan.apps.substrait.build"
RATE_CARDS = {
    "LTL": {"name": "Published LTL Rates, 1 December 2025 (Commercial Head + PNS only)",
            "url": WEB_PRICING_URL},
    "B2BR": {"name": "[ID] Ninja Xpress 2025 Rate Card, B2BR", "url": WEB_PRICING_URL},
    "B2C": {"name": "[ID] Ninja Xpress 2025 Rate Card, B2BR (B2C prices off this card)",
            "url": None},
    "FTL on-call": {"name": "[ID] Ninja Xpress 2026 Rate Card FTL", "url": None},
    "FTL monthly": {"name": "FTL monthly, PNS costing (no published card)", "url": None},
    "Sameday": {"name": "Sameday calculator, Regular Rp 20.000 / 5kg, Premium Rp 35.000 / 5kg",
                "url": None},
}


class CancelledTicket(BaseModel):
    ref: str
    shipper: str
    service: str
    revenue: int
    acct_type: str
    region: str | None = None
    sales: str | None = None
    owner: str | None = None
    at: str                       # when it was cancelled
    by: str                       # who cancelled it
    reason: str | None = None     # what they said, mandatory at the time


class CancelledList(BaseModel):
    tickets: list[CancelledTicket]


@app.get("/api/tickets/cancelled", response_model=CancelledList)
async def list_cancelled(u: User = Depends(current_user)):
    """Dropped requests, with the date and the name against each.

    Readable by everyone who works the pipeline: "why did this one stop" is a question
    Commercial asks PNS and PNS asks Commercial, and an answer only one side can see is
    not an answer. Who and when come out of ticket_history rather than a new column —
    log_status() has always written the actor and the timestamp there, so the record
    already existed and only needed reading. Two people deploy into this database from
    separate clones and migrations have collided three times; a column that duplicates
    something already stored is not worth a fourth."""
    rows = await q(
        "SELECT t.ticket_ref AS ref, s.name AS shipper, t.service_type AS service, "
        "t.potential_rev AS revenue, s.acct_type, t.region, t.sales_name AS sales, "
        "t.owner_name AS owner, "
        # The LAST time it entered Cancel — a ticket can be reopened and dropped again,
        # and the current state is what this screen reports.
        "(SELECT h.at FROM ticket_history h WHERE h.ticket_id=t.id AND h.status='Cancel' "
        "ORDER BY h.at DESC LIMIT 1) AS at, "
        "(SELECT h.actor FROM ticket_history h WHERE h.ticket_id=t.id AND h.status='Cancel' "
        "ORDER BY h.at DESC LIMIT 1) AS by_who, "
        "(SELECT h.note FROM ticket_history h WHERE h.ticket_id=t.id AND h.status='Cancel' "
        "ORDER BY h.at DESC LIMIT 1) AS reason "
        "FROM tickets t JOIN shippers s ON s.id=t.shipper_id "
        "WHERE t.deleted_at IS NULL AND t.status='Cancel' "
        "ORDER BY t.status_since DESC")
    return {"tickets": [
        {"ref": r["ref"], "shipper": r["shipper"], "service": r["service"],
         "revenue": int(r["revenue"] or 0), "acct_type": r["acct_type"],
         "region": r["region"], "sales": r["sales"], "owner": r["owner"],
         # A ticket cancelled before this screen existed has no history row naming who;
         # say so rather than printing an empty cell that looks like a bug.
         "at": str(r["at"])[:16] if r["at"] else "—",
         "by": r["by_who"] or "not recorded",
         "reason": r["reason"]}
        for r in rows]}


@app.get("/api/tickets/deleted", response_model=TicketList)
async def list_deleted(u: User = Depends(current_user)):
    """The recycle bin. Admin only, deleted tickets keep their history."""
    require(u, "restoreTicket")
    rows = await q(
        "SELECT t.*, s.name AS shipper, s.acct_type, p.margin_pct, p.price_file, p.price_url, "
           "(SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id=t.id "
           "AND c.is_question=1 AND c.resolved_at IS NULL) AS open_q, "
           "(SELECT a.decision FROM approvals a WHERE a.ticket_id=t.id AND a.kind='psp' "
           "ORDER BY a.decided_at DESC LIMIT 1) AS psp_decision, "
        "TIMESTAMPDIFF(DAY, t.status_since, NOW()) AS sla_days_db "
        "FROM tickets t JOIN shippers s ON s.id=t.shipper_id "
        "LEFT JOIN pricing p ON p.ticket_id=t.id "
        "WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC")
    return {"tickets": [shape(r, u) for r in rows], "total": len(rows)}


@app.get("/api/tickets/{ref}", response_model=TicketDetail)
async def ticket_detail(ref: str, u: User = Depends(current_user)):
    """Everything one ticket knows about itself, filtered by what the caller may see."""
    t = await q("SELECT t.*, s.name AS shipper, s.acct_type, s.account_id, s.account_name, "
                "s.parent_account_id, p.margin_pct, p.cost, "
                "p.price_file, p.price_url, TIMESTAMPDIFF(DAY, t.status_since, NOW()) AS sla_days_db, "
                "(SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id=t.id "
                "AND c.is_question=1 AND c.resolved_at IS NULL) AS open_q, "
                "(SELECT a.decision FROM approvals a WHERE a.ticket_id=t.id AND a.kind='psp' "
                "ORDER BY a.decided_at DESC LIMIT 1) AS psp_decision "
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

    # The account's other opportunities. A ticket is raised per opportunity — that is the
    # level Sales CRM works at and the level a solution is priced at — but whoever opens
    # this ticket is talking to the shipper about all of them, and not knowing there are
    # three others is how two people price the same account against each other. It is
    # also what makes siblings readable as siblings rather than as duplicates.
    sibs = await q(
        "SELECT t.ticket_ref, t.status, t.service_type, t.potential_rev, t.must_win, "
        "t.opportunity_id, t.opportunity_name, t.owner_name, t.sales_name, t.submitted_on "
        "FROM tickets t WHERE t.shipper_id=%s AND t.id<>%s AND t.deleted_at IS NULL "
        "ORDER BY t.submitted_on DESC LIMIT 25", (t["shipper_id"], t["id"]))

    out = TicketDetail(
        ticket=shape(t, u),
        siblings=[Sibling(
            ref=s["ticket_ref"], status=s["status"], service=s["service_type"],
            revenue=int(s["potential_rev"] or 0), must_win=bool(s.get("must_win")),
            opportunity_id=(str(s["opportunity_id"]) if s.get("opportunity_id") else None),
            opportunity_name=s.get("opportunity_name"), owner=s.get("owner_name"),
            sales=s.get("sales_name"), submitted_on=str(s["submitted_on"]))
            for s in sibs],
        input=payload,
        input_cleared=bool(inp and inp["cleared_at"]),
        history=[HistoryEntry(status=h["status"], actor=h["actor"],
                              note=h["note"], at=str(h["at"])) for h in hist],
        price_file=t.get("price_file"), price_url=t.get("price_url"),
        open_questions=int(t.get("open_q") or 0),
        rate_card=(RATE_CARDS.get(t["service_type"]) or {}).get("name"),
        rate_card_url=(RATE_CARDS.get(t["service_type"]) or {}).get("url"),
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
    await notify(f"New CAPA {ref}, {body.shipper} raised by {u.name}",
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
    """Evidence for a corrective action, a photo of the damage, a screenshot, a report.
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
        await notify(f"{u.name} attached {file.filename} to {ref}, {c['shipper_name']}",
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
    await notify(f"{ref}, PNS submitted a CAPA proposal", groups=["Commercial"])
    return {"ok": True, "ref": ref, "status": "Submitted"}


@app.post("/api/capa/{ref}/close", response_model=Ok)
async def close_capa(ref: str, u: User = Depends(current_user)):
    require(u, "capaClose")
    await execute("UPDATE capa SET status='CAPA Closed', closed_by=%s, closed_at=NOW() "
                  "WHERE capa_ref=%s", (u.name, ref))
    await notify(f"{ref}, CAPA closed by {u.name}", groups=["PNS"])
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
    # The sales reporting line, so a Manager or Head can scope the pipeline to their own
    # people instead of picking names one at a time. Emails, both optional.
    manager_email: str | None = None
    head_email: str | None = None
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
    manager_email: str | None = None
    head_email: str | None = None


class UserPatch(BaseModel):
    name: str | None = None
    group: str | None = None
    level: str | None = None
    team: str | None = None
    manager_email: str | None = None
    head_email: str | None = None
    active: bool | None = None


def clean_user_fields(group: str | None, level: str | None, team: str | None):
    """Validate the role triple and normalise team, which only Commercial carries."""
    if group is not None and group not in ROLE_GROUPS:
        raise HTTPException(400, f"group must be one of {ROLE_GROUPS}")
    if level is not None and level not in ROLE_LEVELS:
        raise HTTPException(400, f"level must be one of {ROLE_LEVELS}")
    if level == "manager" and group != "Commercial":
        # Manager is the Sales Manager tier. Elsewhere it would grant nothing and
        # sit in the table looking like it means something.
        raise HTTPException(400, "manager is a Commercial (Sales) level only")
    if team not in (None, "", *TEAMS):
        raise HTTPException(400, f"team must be one of {TEAMS}")
    if group != "Commercial":
        return None                      # team is a Commercial-only concept
    if not team:
        raise HTTPException(400, "Commercial users need a team: Team1 (GJ/WJ) or Team2 (EJ/CJ)")
    return team


def clean_line(email: str | None) -> str | None:
    """Normalise a manager/head address. Empty string means "clear it"."""
    e = (email or "").strip().lower()
    return e or None


async def active_admin_count() -> int:
    row = await q("SELECT COUNT(*) AS n FROM users WHERE role_group='Admin' AND active=1",
                  one=True)
    return int((row or {}).get("n") or 0)


def shape_user(r: dict, u: User) -> UserRow:
    return UserRow(email=r["email"], name=r["name"], group=r["role_group"],
                   level=r["role_level"], team=r["team"],
                   manager_email=r.get("manager_email"), head_email=r.get("head_email"),
                   active=bool(r["active"]),
                   created_at=str(r["created_at"])[:10], is_self=r["email"] == u.email)


@app.get("/api/users", response_model=UserList)
async def list_users(u: User = Depends(current_user)):
    """Everyone with access to the app, for the Administration screen."""
    require(u, "manageUsers")
    rows = await q("SELECT email, name, role_group, role_level, team, manager_email, "
                   "head_email, active, created_at "
                   "FROM users ORDER BY active DESC, role_group, role_level DESC, name")
    return {"users": [shape_user(r, u) for r in rows],
            "groups": ROLE_GROUPS, "levels": ROLE_LEVELS, "teams": TEAMS}


@app.get("/api/users/assignable", response_model=NameList)
async def assignable_users(u: User = Depends(current_user)):
    """Names that can own a ticket or a CAPA: active PNS members, plus Admin accounts
    (Admin is a superset of PNS and does solutioning work too). Any signed-in user may
    read this, the assignee dropdowns need it, and a staff list is not sensitive."""
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
    """Everyone you can tag in a ticket discussion. Readable by any signed-in user, 
    tagging by email is the point, and a colleague list is not sensitive internally.
    Roles are not exposed beyond the group label."""
    rows = await q("SELECT email, name, role_group FROM users WHERE active=1 "
                   "ORDER BY role_group, name")
    return {"people": [DirEntry(email=r["email"], name=r["name"], group=r["role_group"])
                       for r in rows]}


# ------------------------------------------------------------------ bulk users
# Registering the team one form at a time is fine for three people and hopeless for
# thirty, and the reporting line (manager, head) is exactly the kind of thing that gets
# filled in as a batch after someone reorganises. Round-trip: download what is there,
# edit in Excel, upload it back.
BULK_COLUMNS = ["email", "name", "group", "level", "team", "manager_email",
                "head_email", "active"]


class BulkRow(BaseModel):
    email: str
    name: str | None = None
    group: str | None = None
    level: str | None = None
    team: str | None = None
    manager_email: str | None = None
    head_email: str | None = None
    active: str | None = None


class BulkIn(BaseModel):
    rows: list[BulkRow]
    dry_run: bool = True


class BulkResult(BaseModel):
    created: list[str] = []
    updated: list[str] = []
    unchanged: list[str] = []
    errors: list[dict] = []
    dry_run: bool = True


@app.post("/api/users/bulk", response_model=BulkResult)
async def bulk_users(body: BulkIn, u: User = Depends(current_user)):
    """Create or update people from a spreadsheet. Dry run by default.

    Every row is validated through the same clean_user_fields() the single-user form
    uses, so a bulk edit cannot introduce a role combination the form would refuse. A
    row that fails is reported with its reason and the rest still apply — one typo in
    row 14 must not silently discard the other twenty-nine."""
    require(u, "manageUsers")
    res = BulkResult(dry_run=body.dry_run)
    for i, r in enumerate(body.rows, start=2):        # row 1 is the header in the sheet
        email = (r.email or "").strip().lower()
        try:
            if not email or "@" not in email:
                raise ValueError("not an email address")
            if email == u.email:
                raise ValueError("you cannot change your own row in a bulk upload")
            existing = await q("SELECT email, name, role_group, role_level, team, "
                               "manager_email, head_email, active FROM users "
                               "WHERE email=%s", (email,), one=True)
            group = (r.group or "").strip() or (existing or {}).get("role_group")
            level = (r.level or "").strip() or (existing or {}).get("role_level") or "staff"
            name = (r.name or "").strip() or (existing or {}).get("name")
            if not group:
                raise ValueError("group is required for a new person")
            if not name:
                raise ValueError("name is required for a new person")
            if group == "Admin":
                require(u, "grantAdmin")
            team = clean_user_fields(group, level, (r.team or "").strip()
                                     or (existing or {}).get("team"))
            mgr = clean_line(r.manager_email if r.manager_email is not None
                             else (existing or {}).get("manager_email"))
            head = clean_line(r.head_email if r.head_email is not None
                              else (existing or {}).get("head_email"))
            if mgr == email or head == email:
                raise ValueError("somebody cannot report to themselves")
            act = (r.active or "").strip().lower()
            active = (1 if act in ("1", "true", "yes", "y", "active", "")
                      else 0) if act != "" else (1 if not existing else existing["active"])

            if not existing:
                if not body.dry_run:
                    await execute(
                        "INSERT INTO users (email, name, role_group, role_level, team, "
                        "manager_email, head_email, active) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (email, name, group, level, team, mgr, head, active))
                res.created.append(email)
                continue
            same = (name == existing["name"] and group == existing["role_group"]
                    and level == existing["role_level"] and team == existing["team"]
                    and mgr == existing["manager_email"] and head == existing["head_email"]
                    and active == existing["active"])
            if same:
                res.unchanged.append(email)
                continue
            # Never let a bulk upload remove the last way back in.
            if existing["role_group"] == "Admin" and existing["active"] and (
                    group != "Admin" or not active) and await active_admin_count() <= 1:
                raise ValueError("this is the only active Admin")
            if not body.dry_run:
                await execute(
                    "UPDATE users SET name=%s, role_group=%s, role_level=%s, team=%s, "
                    "manager_email=%s, head_email=%s, active=%s WHERE email=%s",
                    (name, group, level, team, mgr, head, active, email))
            res.updated.append(email)
        except HTTPException as e:
            res.errors.append({"row": i, "email": email, "why": e.detail})
        except Exception as e:
            res.errors.append({"row": i, "email": email, "why": str(e)[:180]})

    if not body.dry_run:
        await audit(u.email, "bulk_users", "user", None, "rows", None,
                    f"{len(res.created)} created, {len(res.updated)} updated")
    return res


class TagSuggestion(BaseModel):
    email: str
    name: str
    group: str
    why: str          # "assigned PNS", "Sales Head", ... — why they are worth tagging
    relevant: bool    # true = tied to this ticket, false = the wider directory


@app.get("/api/tickets/{ref}/taggable", response_model=list[TagSuggestion])
async def taggable(ref: str, u: User = Depends(current_user)):
    """Who is worth tagging on THIS ticket, most relevant first.

    The plain directory is everyone in the company, alphabetical, which is the wrong
    shape for the question being asked: at the moment of tagging you almost always want
    one of five people — the PNS PIC, their Head, the Sales PIC, and that PIC's
    Manager and Head. Those are returned first with a reason attached; the rest of the
    directory follows so nobody is unreachable."""
    t = await get_ticket(ref)
    rel: dict[str, str] = {}          # email -> why

    async def add(name_or_email: str | None, why: str, by_email: bool = False):
        if not name_or_email:
            return
        col = "email" if by_email else "name"
        r = await q(f"SELECT email FROM users WHERE {col}=%s AND active=1",
                    (name_or_email,), one=True)
        if r:
            rel.setdefault(r["email"], why)

    await add(t.get("owner_name"), "assigned PNS")
    await add(t.get("sales_name"), "Sales PIC")
    await add(t.get("sales_email"), "Sales PIC", by_email=True)

    # The reporting line above whoever holds it, and the two heads who own the gates.
    sales = await q("SELECT manager_email, head_email FROM users WHERE email=%s "
                    "AND active=1", (t.get("sales_email") or "",), one=True)
    if sales:
        await add(sales.get("manager_email"), "Sales Manager", by_email=True)
        await add(sales.get("head_email"), "Sales Head", by_email=True)
    for r in await q("SELECT email, role_group FROM users WHERE active=1 AND "
                     "role_level='head' AND role_group IN ('PNS','Commercial','PSP')"):
        rel.setdefault(r["email"],
                       {"PNS": "Head of PNS", "Commercial": "Sales Head",
                        "PSP": "Head of PSP"}[r["role_group"]])

    everyone = await q("SELECT email, name, role_group FROM users WHERE active=1 "
                       "ORDER BY role_group, name")
    out = [TagSuggestion(email=r["email"], name=r["name"], group=r["role_group"],
                         why=rel[r["email"]], relevant=True)
           for r in everyone if r["email"] in rel and r["email"] != u.email]
    out += [TagSuggestion(email=r["email"], name=r["name"], group=r["role_group"],
                          why=r["role_group"], relevant=False)
            for r in everyone if r["email"] not in rel and r["email"] != u.email]
    return out


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
        raise HTTPException(409, f"{email} is already registered; edit that row instead")

    await execute("INSERT INTO users (email, name, role_group, role_level, team, "
                  "manager_email, head_email, active) "
                  "VALUES (%s,%s,%s,%s,%s,%s,%s,1)",
                  (email, body.name.strip(), body.group, body.level, team,
                   clean_line(body.manager_email), clean_line(body.head_email)))
    await audit(u.email, "register", "user", email, "role",
                None, f"{body.group}/{body.level}")
    await notify(f"{body.name.strip()} was given {body.group} access by {u.name}",
                 groups=["PNS"], roles=["PNS - Head"])
    return {"ok": True, "ref": email}


@app.patch("/api/users/{email}", response_model=Ok)
async def update_user(email: str, body: UserPatch, u: User = Depends(current_user)):
    require(u, "manageUsers")
    email = email.strip().lower()
    row = await q("SELECT email, name, role_group, role_level, team, manager_email, "
                  "head_email, active FROM users WHERE email=%s", (email,), one=True)
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
            raise HTTPException(400, "you cannot change your own role; ask another administrator")
        if not active:
            raise HTTPException(400, "you cannot deactivate your own account")

    # Never let the last active Admin disappear.
    losing_admin = row["role_group"] == "Admin" and row["active"] and (
        group != "Admin" or not active)
    if losing_admin and await active_admin_count() <= 1:
        raise HTTPException(400, "this is the only active Admin; promote someone else first")

    team = clean_user_fields(group, level, row["team"] if body.team is None else body.team)
    name = (body.name or row["name"]).strip()
    if not name:
        raise HTTPException(400, "name cannot be empty")

    manager = row["manager_email"] if body.manager_email is None         else clean_line(body.manager_email)
    head = row["head_email"] if body.head_email is None else clean_line(body.head_email)
    if manager == email or head == email:
        raise HTTPException(400, "somebody cannot report to themselves")

    await execute("UPDATE users SET name=%s, role_group=%s, role_level=%s, team=%s, "
                  "manager_email=%s, head_email=%s, active=%s WHERE email=%s",
                  (name, group, level, team, manager, head, active, email))
    await audit(u.email, "update", "user", email, "role",
                f"{row['role_group']}/{row['role_level']}/active={row['active']}",
                f"{group}/{level}/active={active}")
    return {"ok": True, "ref": email}


@app.delete("/api/users/{email}", response_model=Ok)
async def deactivate_user(email: str, u: User = Depends(current_user)):
    """Revoke access. Deliberately not a row delete, ticket and CAPA history record
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
            raise HTTPException(400, "this is the only active Admin; promote someone else first")

    await execute("UPDATE users SET active=0 WHERE email=%s", (email,))
    await audit(u.email, "deactivate", "user", email, "active", "1", "0")
    return {"ok": True, "ref": email}


@app.get("/api/tickets/{ref}/files", response_model=FileList)
async def list_files(ref: str, u: User = Depends(current_user)):
    """Metadata only, the bytes come from /api/files/{id} so lists stay small."""
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
    attaches solution diagrams and survey shots, and Legal attaches contract drafts, 
    restricting this to one team would just push the rest back into email."""
    t = await get_ticket(ref)
    # rdo_evidence is its own kind rather than another document: the RDO reference page
    # collects these across every ticket, and it can only do that if they are labelled.
    if kind not in ("goods_photo", "document", "rdo_evidence"):
        raise HTTPException(400, "kind must be goods_photo, document or rdo_evidence")

    data, ctype = await read_upload(file)

    fid = await execute(
        "INSERT INTO ticket_files (ticket_id, kind, filename, content_type, size_bytes, "
        "caption, data, uploaded_email, uploaded_name) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (t["id"], kind, (file.filename or "attachment")[:255], ctype, len(data),
         (caption or None), data, u.email, u.name))

    label = {"goods_photo": "photo of the goods",
             "rdo_evidence": "RDO example from Sales"}.get(kind, "document")
    people = {n for n in (t["owner_name"], t["sales_name"]) if n}
    people.discard(u.name)
    if people:
        await notify(f"{u.name} attached a {label} to {ref}, {t['shipper']}: {file.filename}",
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
    field_key: str | None = None     # None = the ticket thread; otherwise an intake field
    thread_key: str | None = None    # None = the general thread
    thread_title: str | None = None
    edited_at: str | None = None     # shown in the thread: a post that moved after replies
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
    field_key: str | None = None  # an intake field key, or None for the ticket thread
    # Post into an existing thread by key, or start one by giving it a title. A ticket
    # carries several open points at once and one flat list makes "what is still open"
    # unanswerable without reading everything.
    thread_key: str | None = None
    new_thread_title: str | None = None


def shape_comment(r: dict, u: User) -> Comment:
    return Comment(
        id=r["id"], author=r["author_name"], author_email=r["author_email"],
        group=r["author_group"], body=r["body"], field_key=r.get("field_key"),
        thread_key=r.get("thread_key"), thread_title=r.get("thread_title"),
        edited_at=(str(r["edited_at"]) if r.get("edited_at") else None),
        is_question=bool(r["is_question"]),
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
    # and the response says who was actually tagged, a typo must not look like it worked.
    wanted = {e.strip().lower() for e in body.mentions if e.strip()}
    wanted |= {m.lower() for m in MENTION_RE.findall(text)}
    tagged: list[dict] = []
    if wanted:
        marks = ",".join(["%s"] * len(wanted))
        tagged = await q(f"SELECT email, name FROM users WHERE active=1 "
                         f"AND LOWER(email) IN ({marks})", tuple(wanted))

    field = (body.field_key or "").strip() or None
    if field and field not in CHARTER_FIELD_LABELS:
        raise HTTPException(400, f"'{field}' is not an intake field")

    # A thread is either named into existence here, or joined by key. The title travels
    # on every row of the thread so reading one row tells you what it is about; the key
    # is what groups them.
    thread_key, thread_title = None, None
    new_title = (body.new_thread_title or "").strip()
    if new_title:
        last = await q("SELECT thread_key FROM ticket_comments WHERE ticket_id=%s "
                       "AND thread_key IS NOT NULL ORDER BY id DESC LIMIT 1",
                       (t["id"],), one=True)
        n = int(str((last or {}).get("thread_key") or "t0")[1:] or 0) + 1
        thread_key, thread_title = f"t{n}", new_title[:200]
    elif (body.thread_key or "").strip():
        thread_key = body.thread_key.strip()
        row = await q("SELECT thread_title FROM ticket_comments WHERE ticket_id=%s "
                      "AND thread_key=%s LIMIT 1", (t["id"], thread_key), one=True)
        if not row:
            raise HTTPException(400, f"no thread '{thread_key}' on {ref}")
        thread_title = row["thread_title"]

    cid = await execute(
        "INSERT INTO ticket_comments (ticket_id, field_key, thread_key, thread_title, "
        "author_email, author_name, author_group, body, is_question, mentions) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (t["id"], field, thread_key, thread_title, u.email, u.name, u.group, text,
         int(body.is_question), ",".join(r["email"] for r in tagged) or None))

    # Whoever was tagged, plus the two people accountable for the ticket. A question
    # that only its author can see is not a question.
    people = {r["name"] for r in tagged}
    people |= {n for n in (t["owner_name"], t["sales_name"]) if n}
    people.discard(u.name)
    kind = "asked a question on" if body.is_question else "commented on"
    if people:
        await notify(f"{u.name} {kind} {ref}, {t['shipper']}: {text[:180]}",
                     people=sorted(people), ticket_ref=ref)

    found = {r["email"].lower() for r in tagged}
    unknown = sorted(e for e in wanted if e not in found)
    parts = []
    if tagged:
        parts.append("tagged " + ", ".join(sorted(r["name"] for r in tagged)))
    if unknown:
        parts.append("not registered, nobody notified: " + ", ".join(unknown))
    return {"ok": True, "ref": ref, "status": " Â· ".join(parts) or None}


class RecapIn(BaseModel):
    open_only: bool = True        # unanswered field questions only, or every field note
    intro: str | None = None


@app.post("/api/tickets/{ref}/comments/recap", status_code=201, response_model=Ok)
async def recap_field_comments(ref: str, body: RecapIn, u: User = Depends(current_user)):
    """Collect the per-field notes into one comment on the ticket thread.

    Field comments are for working: they sit beside the field being questioned. But
    Sales reads the thread, not the form, so at some point the scattered notes have to
    become one message. This writes that message as a normal comment, it is not a new
    kind of object, so mentions, notifications and the unanswered count all keep working.

    The recap is a snapshot, not a live view. It says what was open when it was sent,
    which is what makes it quotable in an email or a call."""
    t = await get_ticket(ref)
    sql = ("SELECT * FROM ticket_comments WHERE ticket_id=%s AND field_key IS NOT NULL"
           + (" AND is_question=1 AND resolved_at IS NULL" if body.open_only else "")
           + " ORDER BY created_at, id")
    rows = await q(sql, (t["id"],))
    if not rows:
        raise HTTPException(400, "there are no open field comments to recap"
                                 if body.open_only else "there are no field comments yet")

    # Group by field, in the charter's own order, so the recap reads like the form.
    order = list(CHARTER_FIELD_LABELS)
    by_field: dict[str, list[dict]] = {}
    for r in rows:
        by_field.setdefault(r["field_key"], []).append(r)

    lines = [body.intro.strip() if body.intro else
             ("Open questions on the intake, by field:" if body.open_only
              else "Notes on the intake, by field:")]
    for key in sorted(by_field, key=lambda k: order.index(k) if k in order else 999):
        lines.append(f"\n**{CHARTER_FIELD_LABELS.get(key, key)}**")
        for r in by_field[key]:
            mark = "?" if r["is_question"] and not r["resolved_at"] else "-"
            lines.append(f"  {mark} {r['author_name']}: {r['body'].strip()}")
    text = "\n".join(lines)[:4000]

    cid = await execute(
        "INSERT INTO ticket_comments (ticket_id, field_key, author_email, author_name, "
        "author_group, body, is_question) VALUES (%s,NULL,%s,%s,%s,%s,0)",
        (t["id"], u.email, u.name, u.group, text))
    await tell_owed(t, t["status"], u.name,
                    f"{ref}, {t['shipper']}: {u.name} sent a recap of "
                    f"{len(rows)} field note{'' if len(rows) == 1 else 's'}",
                    f"Intake questions, {t['shipper']}", ref)
    await audit(u.email, "recap", "ticket", ref, "comments", None, str(len(rows)))
    return {"ok": True, "ref": ref, "status": t["status"], "id": cid}


class EditComment(BaseModel):
    body: str


@app.patch("/api/comments/{cid}", response_model=Ok)
async def edit_comment(cid: int, body: EditComment, u: User = Depends(current_user)):
    """Reword your own post. Yours only — an edited message still carries your name."""
    r = await q("SELECT c.id, c.author_email, t.ticket_ref FROM ticket_comments c "
                "JOIN tickets t ON t.id=c.ticket_id WHERE c.id=%s", (cid,), one=True)
    if not r:
        raise HTTPException(404, "no such comment")
    if r["author_email"] != u.email:
        raise HTTPException(403, "you can only edit your own posts")
    text = body.body.strip()
    if not text:
        raise HTTPException(400, "write something, or delete the post instead")
    if len(text) > 4000:
        raise HTTPException(400, "that is too long for one message (4000 characters max)")
    await execute("UPDATE ticket_comments SET body=%s, edited_at=NOW() WHERE id=%s",
                  (text, cid))
    await audit(u.email, "edit", "comment", str(cid), "body", None, text[:200])
    return {"ok": True, "ref": r["ticket_ref"], "status": "edited"}


@app.delete("/api/comments/{cid}", response_model=Ok)
async def delete_comment(cid: int, u: User = Depends(current_user)):
    """Delete your own post.

    If it opened a thread, the whole thread goes with it — replies included, and those
    replies belong to other people. The count is returned by GET .../comments/{id}/impact
    so the UI can say exactly how many before anyone confirms; deleting somebody else's
    words as a side effect must never be a surprise."""
    r = await q("SELECT c.id, c.author_email, c.thread_key, c.ticket_id, t.ticket_ref "
                "FROM ticket_comments c JOIN tickets t ON t.id=c.ticket_id "
                "WHERE c.id=%s", (cid,), one=True)
    if not r:
        raise HTTPException(404, "no such comment")
    if r["author_email"] != u.email:
        raise HTTPException(403, "you can only delete your own posts")

    opener = None
    if r["thread_key"]:
        opener = await q("SELECT id FROM ticket_comments WHERE ticket_id=%s AND "
                         "thread_key=%s ORDER BY id LIMIT 1",
                         (r["ticket_id"], r["thread_key"]), one=True)
    if opener and opener["id"] == cid:
        n = await execute("DELETE FROM ticket_comments WHERE ticket_id=%s AND thread_key=%s",
                          (r["ticket_id"], r["thread_key"]))
        await audit(u.email, "delete", "thread", r["ticket_ref"], "thread_key",
                    r["thread_key"], None)
        return {"ok": True, "ref": r["ticket_ref"], "status": "thread deleted"}
    await execute("DELETE FROM ticket_comments WHERE id=%s", (cid,))
    await audit(u.email, "delete", "comment", str(cid))
    return {"ok": True, "ref": r["ticket_ref"], "status": "deleted"}


class DeleteImpact(BaseModel):
    is_thread_opener: bool
    replies: int
    thread_title: str | None = None


@app.get("/api/comments/{cid}/impact", response_model=DeleteImpact)
async def delete_impact(cid: int, u: User = Depends(current_user)):
    """What deleting this post would take with it, so the warning can be specific."""
    r = await q("SELECT id, thread_key, thread_title, ticket_id FROM ticket_comments "
                "WHERE id=%s", (cid,), one=True)
    if not r:
        raise HTTPException(404, "no such comment")
    if not r["thread_key"]:
        return {"is_thread_opener": False, "replies": 0}
    first = await q("SELECT id FROM ticket_comments WHERE ticket_id=%s AND thread_key=%s "
                    "ORDER BY id LIMIT 1", (r["ticket_id"], r["thread_key"]), one=True)
    if not first or first["id"] != cid:
        return {"is_thread_opener": False, "replies": 0}
    n = await q("SELECT COUNT(*) AS n FROM ticket_comments WHERE ticket_id=%s AND "
                "thread_key=%s", (r["ticket_id"], r["thread_key"]), one=True)
    return {"is_thread_opener": True, "replies": max(0, int(n["n"]) - 1),
            "thread_title": r["thread_title"]}


@app.post("/api/comments/{cid}/reopen", response_model=Ok)
async def reopen_comment(cid: int, u: User = Depends(current_user)):
    """Put an answered question back on the open list.

    Open to anyone, not just whoever closed it: the person who finds the answer wanting
    is usually not the person who was satisfied by it."""
    r = await q("SELECT c.id, c.is_question, c.resolved_at, t.ticket_ref, t.id AS tid "
                "FROM ticket_comments c JOIN tickets t ON t.id=c.ticket_id "
                "WHERE c.id=%s", (cid,), one=True)
    if not r:
        raise HTTPException(404, "no such comment")
    if not r["is_question"]:
        raise HTTPException(400, "only a question can be reopened")
    if not r["resolved_at"]:
        raise HTTPException(409, "that question is already open")
    await execute("UPDATE ticket_comments SET resolved_at=NULL, resolved_by=NULL "
                  "WHERE id=%s", (cid,))
    await audit(u.email, "reopen", "comment", str(cid))
    return {"ok": True, "ref": r["ticket_ref"], "status": "reopened"}


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
    """Three things reach a person, and nothing else (Baskoro, 2026-08-13).

      1. being named — a mention, an assignment, a send-back: to_people
      2. anything at all on a ticket they are a PIC on
      3. a group or role broadcast, but ONLY on their own tickets

    Before this, every group broadcast reached every member of that group, so a PNS
    member read the whole department's traffic and the genuinely personal items were
    buried in it. A notification list nobody can scan is the same as no notifications.
    """
    role_label = f"{u.group} - {'Head' if u.level == 'head' else 'Solution'}"
    # The refs this person is answerable for, so a broadcast can be tested against them.
    mine = {r["ticket_ref"] for r in await q(
        "SELECT ticket_ref FROM tickets WHERE deleted_at IS NULL AND ("
        "owner_name=%s OR sales_name=%s OR sales_email=%s)",
        (u.name, u.name, u.email))}

    rows = await q(
        "SELECT n.*, r.read_at FROM notifications n "
        "LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_email=%s "
        "ORDER BY n.created_at DESC LIMIT 200", (u.email,))
    out = []
    for r in rows:
        people = (r["to_people"] or "").split(",")
        if u.name in people:
            keep = True                      # named directly — always
        else:
            groups = (r["to_groups"] or "").split(",")
            roles = (r["to_roles"] or "").split(",")
            addressed = u.group in groups or role_label in roles
            # A broadcast with no ticket behind it (a sync summary, say) still reaches
            # the group it names; anything ticket-shaped has to be one of theirs.
            keep = addressed and (r["ticket_ref"] is None or r["ticket_ref"] in mine)
        if keep:
            out.append(Note(id=r["id"], body=r["body"], ticket_ref=r["ticket_ref"],
                            at=str(r["created_at"]), unread=r["read_at"] is None))
        if len(out) >= 60:
            break
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
            await asyncio.to_thread(_send_sync, [u.email], "Ninja PNS, email test",
                                    text, html)
            sent_to = u.email
        except Exception as exc:                      # noqa: BLE001
            return {"configured": True, "host": SMTP_HOST, "port": SMTP_PORT,
                    "sender": SMTP_FROM, "reachable": True,
                    "detail": f"connected, but sending failed, {type(exc).__name__}: {exc}"}

    return {"configured": True, "host": SMTP_HOST, "port": SMTP_PORT, "sender": SMTP_FROM,
            "reachable": True, "detail": detail, "sent_to": sent_to}


# Mirrors frontend STATUSES exactly. Kept here rather than derived from PENDING_STATUSES
# etc. because this needs the complete set, terminal statuses included.
# Derived, not restated. This list was hand-maintained and fell behind V22: "Open" and
# "Pending CRM ID" were never added, so the orphaned-status check reported every ticket
# in the two newest statuses as unrecognised — a diagnostic that cries wolf gets ignored,
# which is worse than not having it.
KNOWN_STATUSES = list(ALL_STATUSES)


class OrphanedTicket(BaseModel):
    ref: str
    shipper: str
    status: str
    status_since: str


class OrphanedStatusCheck(BaseModel):
    tickets: list[OrphanedTicket]


@app.get("/api/diagnostics/orphaned-status", response_model=OrphanedStatusCheck)
async def orphaned_status(u: User = Depends(current_user)):
    """Tickets whose status the running code does not recognise.

    Written for one specific, confirmed cause, V20 fixed it, but that migration only
    corrects the one string we had direct evidence of ("Pending Review - PSP" from
    Baskoro's overwritten .29/.30). If his unpushed build touched other statuses the same
    way, this is how to find them without guessing at what to rename them to."""
    require(u, "manageUsers")
    marks = ",".join(["%s"] * len(KNOWN_STATUSES))
    rows = await q(
        f"SELECT t.ticket_ref AS ref, s.name AS shipper, t.status, t.status_since "
        f"FROM tickets t JOIN shippers s ON s.id=t.shipper_id "
        f"WHERE t.deleted_at IS NULL AND t.status NOT IN ({marks})",
        tuple(KNOWN_STATUSES))
    return {"tickets": [OrphanedTicket(ref=r["ref"], shipper=r["shipper"],
                                       status=r["status"], status_since=str(r["status_since"]))
                        for r in rows]}


# ------------------------------------------------------------------ status flow
class Move(BaseModel):
    frm: str
    to: str
    trigger: str
    who: str
    via: str


class StageRule(BaseModel):
    """What a Sales CRM stage does to our status, if anything."""
    stages: list[str]
    becomes: str | None
    why: str


class StatusFlow(BaseModel):
    statuses: list[str]
    moves: list[Move]
    # Sales CRM's stage is not our status and never has been. But some stages DO move
    # ours, and which ones was only discoverable by reading status_for_stage(). Baskoro
    # asked for the mapping to be visible (2026-08-14), so it is served from the same
    # constants the sync applies.
    stage_rules: list[StageRule]
    # Only these can be chosen by naming a status; everything else is a consequence of
    # doing something. The screen says so, so nobody looks for a missing button.
    manual: dict[str, list[str]]


class GuideField(BaseModel):
    key: str
    label: str
    section: str
    who: str
    when: str            # enforced | asked | won | optional
    blocks: str
    sync: str            # overwritten | gap-fill | never
    crm_fields: list[str]
    on_ticket: bool


class Gate(BaseModel):
    what: str
    stops: str
    fix: str


class FieldGuide(BaseModel):
    fields: list[GuideField]
    ticket_fields: list[GuideField]
    gates: list[Gate]
    # Ticket columns Sales CRM owns outright, so a correction here is overwritten on the
    # next run. Stated because that surprises people exactly once, expensively.
    crm_owned_columns: list[str]


@app.get("/api/reference/fields", response_model=FieldGuide)
async def fields_reference(u: User = Depends(current_user)):
    """What every field is for, who fills it, what it blocks, and whether it syncs.

    Readable by everyone: "why is this stuck" and "will my correction survive the sync"
    are the two questions this answers, and neither is privileged."""
    tickets = []
    for key, label, who, when, blocks in TICKET_FIELDS:
        # The same provenance the sync applies to ticket columns, stated in its terms.
        # All three of revenue, service and tier became "overwritten" on 2026-08-14 when
        # Sales CRM was made to always take priority. If this drifts back to "never" the
        # page will quietly promise a durability the sync no longer provides.
        sync = {
            "opportunity_id": "never",
            "potential_rev": "overwritten",
            "service_type": "overwritten",
            "acct_type": "overwritten",
            "must_win": "overwritten",
            "region": "never",
            "sales_name": "overwritten",
        }.get(key, "never")
        crm = {
            "potential_rev": ["total_potential_revenue_mth"],
            "must_win": list(MUSTWIN_FIELDS),
            "sales_name": ["owner_name"],
        }.get(key, [])
        tickets.append(GuideField(key=key, label=label, section="On the ticket",
                                  who=who, when=when, blocks=blocks, sync=sync,
                                  crm_fields=crm, on_ticket=True))
    return {
        "fields": [GuideField(**f) for f in field_guide()],
        "ticket_fields": tickets,
        "gates": [Gate(what=a, stops=b, fix=c) for a, b, c in HARD_GATES],
        "crm_owned_columns": ["Sales CRM stage", "Deal name", "Sales PIC",
                              "Submitted date", "Must Win", "Committed revenue",
                              "Close date", "Lead source", "Potential revenue",
                              "Service line", "Account tier"],
    }


@app.get("/api/reference/status-flow", response_model=StatusFlow)
async def status_flow(u: User = Depends(current_user)):
    """What moves a ticket from each status to the next, and who does it.

    Readable by everyone: "why is this stuck / what do I press" is the question the
    whole reference section exists to answer, and it is not a privileged one."""
    return {
        "statuses": ALL_STATUSES,
        "moves": [Move(frm=f or "New ticket", to=t, trigger=w, who=o, via=v)
                  for f, t, w, o, v in TRANSITIONS],
        "manual": {k: sorted(v) for k, v in sorted(MANUAL_MOVES.items())},
        "stage_rules": [
            StageRule(
                stages=list(CLOSED_LOST_STAGES), becomes="Lost",
                why="The shipper walked away or the deal was parked as a future "
                    "opportunity. Solutioning it further is wasted effort, and a priced "
                    "proposal would be misleading. Recorded with loss reason "
                    "“Closed in Sales CRM”."),
            StageRule(
                stages=list(ACCEPTED_STAGES), becomes="Proposal Accepted / Ready to Ship",
                why="The shipper accepted. If the onboarding fields are still blank when "
                    "this lands, PNS and Sales are told exactly which ones, because Ops "
                    "cannot onboard a shipper the account systems cannot find."),
            StageRule(
                stages=list(SUBMITTED_STAGES), becomes="Proposal Submitted",
                why="The price has already reached the shipper, so holding the ticket in "
                    "an approval gate does not un-send it — it only makes our queues "
                    "describe work that is already moot. The one non-terminal stage that "
                    "overrides ours. Where the ticket was still in a gate, or carries no "
                    "price in this app at all, the history says so and PNS is notified: "
                    "the status follows Sales CRM, but a bypassed gate is not erased."),
            StageRule(
                # "Proposal Submitted" used to be listed here as left-alone. It moved to
                # the rule above on 2026-08-18 and listing it in both places said two
                # opposite things on one page.
                stages=["New", "Negotiation", "EKYC Approval", "Contract Sent",
                        "and every other stage"],
                becomes=None,
                why="Left alone on purpose. Sales CRM owns the COMMERCIAL stage; this app "
                    "owns the SOLUTIONING status, and they answer different questions. A "
                    "deal can sit at Negotiation there while PNS is still pricing here, "
                    "and neither is wrong. What overrides ours is the two terminal stages "
                    "plus Proposal Submitted, and nothing else."),
        ],
    }


# ------------------------------------------------------------------ duplicates
class DupTicket(BaseModel):
    ref: str
    shipper: str
    status: str
    service: str
    revenue: int
    opportunity_id: str | None
    submitted_on: str
    sales: str | None


class DupGroup(BaseModel):
    kind: str            # which of the checks below found it
    key: str             # the value they share
    why: str             # what to do about it
    tickets: list[DupTicket]


class DupCheck(BaseModel):
    groups: list[DupGroup]
    # Not a duplicate, but the thing most often mistaken for one, and it is worth saying
    # so on the same screen rather than leaving people to work it out.
    siblings: int


@app.get("/api/diagnostics/duplicates", response_model=DupCheck)
async def duplicates(u: User = Depends(current_user)):
    """Tickets that look like they cover the same deal twice.

    `tickets.opportunity_id` is UNIQUE (V12), so the same Sales CRM opportunity can never
    be imported twice — which is why the duplicates people actually see come from the
    three gaps that constraint leaves open:

      no-crm-id   MySQL lets a UNIQUE column hold any number of NULLs. A ticket raised
                  here before the opportunity existed in Sales CRM sits at Pending CRM ID
                  with a NULL id, the sync later imports the same deal under its real id,
                  and nothing connects the two. This is the common one.
      shipper     The same account under two `shippers` rows, because a hand-typed name
                  and the Sales CRM account name differ by a suffix or a PT/CV. The deals
                  are then correctly separate but the account is split in two.
      same-deal   Two Sales CRM opportunities that are themselves the same deal entered
                  twice. Nothing here can fix that; it is fixed in Sales CRM.

    Everything else is siblings: one account legitimately running several opportunities,
    which is what the Accounts screen is for."""
    require(u, "editInput")
    groups: list[DupGroup] = []

    def shape_dup(r: dict) -> DupTicket:
        return DupTicket(
            ref=r["ticket_ref"], shipper=r["shipper"], status=r["status"],
            service=r["service_type"], revenue=int(r["potential_rev"] or 0),
            opportunity_id=(str(r["opportunity_id"]) if r.get("opportunity_id") else None),
            submitted_on=str(r["submitted_on"]), sales=r.get("sales_name"))

    rows = await q(
        "SELECT t.ticket_ref, t.status, t.service_type, t.potential_rev, t.opportunity_id, "
        "t.submitted_on, t.sales_name, t.shipper_id, s.name AS shipper, "
        "s.account_id, s.parent_account_id "
        "FROM tickets t JOIN shippers s ON s.id=t.shipper_id "
        "WHERE t.deleted_at IS NULL AND t.status NOT IN ('Lost','Cancel') "
        "ORDER BY t.submitted_on")

    # 1. Same shipper + same service line, where at least one of the pair has no Sales
    #    CRM id. Two live tickets for one shipper on one product is either a real
    #    duplicate or a deal that was raised twice, and the missing id says which.
    by_deal: dict[tuple, list[dict]] = {}
    for r in rows:
        by_deal.setdefault((r["shipper_id"], r["service_type"]), []).append(r)
    for (_sid, svc), rs in sorted(by_deal.items(), key=lambda kv: kv[0][1]):
        if len(rs) < 2:
            continue
        unlinked = [r for r in rs if not r["opportunity_id"]]
        if unlinked:
            groups.append(DupGroup(
                kind="no-crm-id", key=f"{rs[0]['shipper']} · {svc}",
                why=("One of these has no Sales CRM opportunity id, so nothing tied it to "
                     "the imported ticket for the same deal. Put the id on the one that "
                     "should survive and delete the other, or cancel the unlinked one."),
                tickets=[shape_dup(r) for r in rs]))
        else:
            groups.append(DupGroup(
                kind="same-deal", key=f"{rs[0]['shipper']} · {svc}",
                why=("Two Sales CRM opportunities for the same shipper on the same service "
                     f"line ({', '.join(str(r['opportunity_id']) for r in rs)}). If they "
                     "really are one deal, close the spare in Sales CRM — this app follows."),
                tickets=[shape_dup(r) for r in rs]))

    # 2. One Sales CRM account arriving under two shipper rows. The tickets are not
    #    duplicates, but the account is, and every account-level view is wrong until it
    #    is merged.
    split = await q(
        "SELECT account_id, COUNT(*) AS n, GROUP_CONCAT(name ORDER BY name SEPARATOR ' | ') "
        "AS names FROM shippers WHERE account_id IS NOT NULL AND account_id<>'' "
        "GROUP BY account_id HAVING n > 1")
    for r in split:
        acc = str(r["account_id"])
        rs = [x for x in rows if str(x.get("account_id") or "") == acc]
        groups.append(DupGroup(
            kind="shipper", key=f"Sales CRM account {acc}",
            why=(f"One Sales CRM account is stored here under {int(r['n'])} shipper names "
                 f"({r['names']}). The tickets are fine; the account is split, so its "
                 f"totals and its Hypercare/Strategic tier can disagree between them."),
            tickets=[shape_dup(x) for x in rs]))

    # Siblings: an account with more than one live opportunity. Counted, never listed as
    # a problem — this is the normal shape of the business and the reason the Accounts
    # screen groups by account instead of pretending one account is one deal.
    sib = await q(
        "SELECT COUNT(*) AS n FROM (SELECT shipper_id FROM tickets "
        "WHERE deleted_at IS NULL AND status NOT IN ('Lost','Cancel') "
        "GROUP BY shipper_id HAVING COUNT(*) > 1) x", one=True)
    return {"groups": groups, "siblings": int((sib or {}).get("n") or 0)}


@app.post("/api/notifications/read", response_model=Ok)
async def mark_read(u: User = Depends(current_user)):
    await execute(
        "INSERT IGNORE INTO notification_reads (notification_id, user_email) "
        "SELECT id, %s FROM notifications", (u.email,))
    return {"ok": True}
