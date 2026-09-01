"""Run every verification suite. Exit non-zero if any fails.

These parse backend/main.py with `ast` and execute the real functions, so they test the
code that ships rather than a copy of it. No database, no server, no dependencies.

    python tests/run_all.py

Each suite exists because something was actually wrong:

  verify_rules       routing tested revenue before service, which made the FTL monthly
                     and Sameday branch unreachable above 30 Mio
  verify_assign      assignment used to spill past the per-person cap instead of
                     stopping and asking the Head
  verify_charter     the charter must never carry cost or margin, and the executive
                     sign-off gate must not be skippable
  verify_psp_gate    PSP-by-rule and PSP-by-exception are different, and collapsing
                     them diverted Sameday and FTL away from PSP
  verify_names       _crm_date shipped called-but-never-defined: an edit removed the
                     region holding its definition and left both call sites. py_compile
                     is happy with a missing global (it is a run-time NameError), and no
                     suite touched the sync, so production found it first.

  verify_review_level who reviews a Sales-built price moved three times in two days
                     (revenue-only, then group-only, then split by level), and each
                     move silently changed who was on the hook for the busiest band.

  verify_permissions three permissions were live in the backend and invisible in the
                     UI because /api/me never sent them

  verify_sync_guards V24 created the salescrm_ignored table AND wired its permission,
                     and then nothing ever read the table. Also pins the revenue-0
                     import landing in Open, and that the import and the refresh walk
                     the same field map — all three were "built but not wired".

  verify_service_line the service line is a COMBINATION of NV Product Line and Service
                     Level, and everything downstream keys off the answer: who prices it,
                     which ceiling applies, who reviews, who owns it. The sheet writes an
                     EN DASH where the old map had a hyphen, so matching literally stopped
                     a whole product line importing with nothing to say why.

  verify_stages      "Future Opportunity" was read as a loss until 2026-08-31. Lost is
                     terminal, and the refresh will not move a ticket out of a terminal
                     status, so parking a deal killed the PNS ticket outright: it stayed
                     Lost even after Sales revived the opportunity and shipped it. Also
                     pins that every stage test compares NORMALISED - three of the four
                     compared raw, so a trailing space changed what a stage did.

  verify_threads     "General Discussion" is thread_key IS NULL, which no branch
                     asserts - it is the fall-through when neither a title nor a key
                     is sent. A future edit could take it away without touching a line
                     that mentions the general thread, so the contract is executed here
                     rather than read. Also pins that the weekly walk posts INTO it
                     instead of starting a thread per note, and as a note rather than a
                     question - filing each one as a question grew the unanswered count
                     by one per deal per week and never brought it back down.

  verify_transitions POST /status took whatever string it was handed, so a status the
                     running code cannot act on could be written straight onto a ticket.
                     Also pins that a "*" row does not let a Lost deal be walked
                     sideways instead of going through /reopen.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SUITES = ["verify_rules.py", "verify_assign.py", "verify_charter.py",
          "verify_psp_gate.py", "verify_permissions.py", "verify_review_level.py",
          "verify_transitions.py", "verify_sync_guards.py", "verify_names.py",
          "verify_service_line.py", "verify_stages.py", "verify_threads.py"]

failed = []
for name in SUITES:
    r = subprocess.run([sys.executable, os.path.join(HERE, name)],
                       capture_output=True, text=True)
    last = [ln for ln in r.stdout.strip().splitlines() if ln.strip()]
    print("%-24s %s" % (name, last[-1] if last else "(no output)"))
    if r.returncode != 0:
        failed.append(name)
        print(r.stdout[-2000:])
        if r.stderr.strip():
            print(r.stderr[-1000:])

print()
if failed:
    print("FAILED: " + ", ".join(failed))
    sys.exit(1)
print("All %d suites passed." % len(SUITES))
