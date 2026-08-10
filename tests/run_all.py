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
  verify_permissions three permissions were live in the backend and invisible in the
                     UI because /api/me never sent them
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SUITES = ["verify_rules.py", "verify_assign.py", "verify_charter.py",
          "verify_psp_gate.py", "verify_permissions.py"]

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
