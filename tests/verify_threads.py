"""The general thread, executed out of the real main.py.

Michael, 2026-09-01: every ticket needs a standing "General Discussion", and the weekly
walk through Pending & proposals writes into it instead of starting a thread per note.

Nothing was built to make that work. thread_key IS NULL has meant "the general thread"
since threads were introduced in V16 — it just had no name, and the one screen that
posted from a queue row named a NEW thread on every note. A deal walked weekly for two
months collected eight one-post threads, and the running history of what had been said
about it could only be reassembled by reading all eight.

So the whole feature rests on one API contract: send neither `new_thread_title` nor
`thread_key` and the comment is stored with thread_key NULL. That is worth EXECUTING
rather than reading, because it is a fall-through — no branch asserts it, it is simply
what happens when neither branch is taken, and a future edit could take it away without
touching a line that mentions the general thread at all.

The three things pinned here:

  * the API's three shapes still resolve to general / new / existing;
  * Pending & proposals still sends the general shape, and does NOT name a thread;
  * Discussion still seeds the general thread, so a ticket nobody has posted on shows a
    place to post rather than nothing at all.

The frontend checks match the OBJECT-KEY form (`new_thread_title:`), not the bare word.
The comment in that file explains this contract and names the field, so a substring
check would match the explanation of the fix instead of the fix. Two guards in this repo
have already shipped green against a broken file exactly that way.
"""
import ast
import io
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)


def _read(*parts):
    return io.open(os.path.join(_REPO, *parts), encoding="utf-8").read()


src = _read("backend", "main.py")

fails = []


def check(label, ok, hint=""):
    if not ok:
        fails.append(label + (" - " + hint if hint else ""))
    print(("  ok   " if ok else "  FAIL ") + label)


# ---------------------------------------------------- lift the thread-resolution block
# Anchored on the SHAPE of the code, not on one spelling of it: the start is whatever
# line initialises both names, whatever it initialises them to. Anchoring on the literal
# "= None, None" meant that changing the initialiser -- the exact regression this file
# exists to catch -- made the guard crash instead of fail, which reads as a broken test
# rather than a broken app. A missing anchor is itself reported as a failure.
fn = next((n for n in ast.walk(ast.parse(src))
           if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
           and n.name == "add_comment"), None)

block = None
if fn is None:
    check("add_comment exists in main.py", False, "the endpoint has been renamed or moved")
else:
    body_src = ast.get_source_segment(src, fn) or ""
    m = re.search(r"^ {4}thread_key, thread_title = .*$", body_src, re.M)
    end = body_src.find("    cid = await execute(")
    if not m or end < 0:
        check("the thread-resolution block is still where this guard reads it", False,
              "add_comment has been restructured - re-read it and re-anchor this check")
    else:
        block = body_src[m.start():end]


class Body:
    def __init__(self, new_thread_title=None, thread_key=None):
        self.new_thread_title = new_thread_title
        self.thread_key = thread_key


async def fake_q(*a, **k):
    """Stands in for the database. Only the named-thread paths reach it."""
    if "thread_key IS NOT NULL" in a[0]:
        return {"thread_key": "t3"}
    return {"thread_title": "Pickup window at Cikarang"}


class HttpErr(Exception):
    def __init__(self, code, msg):
        self.code, self.msg = code, msg


def run(body):
    """Execute the REAL block with a stub q(), returning (thread_key, thread_title)."""
    import asyncio
    src_async = ("async def _resolve(body, q, t, ref, HTTPException):" + chr(10)
                 + block + "    return thread_key, thread_title" + chr(10))
    ns = {}
    exec(compile(src_async, "<block>", "exec"), ns)
    return asyncio.run(ns["_resolve"](body, fake_q, {"id": 1}, "SOF-1", HttpErr))


print("what the API stores for each shape the screens send")
if block:
    # 1. The + Note button on Pending & proposals, and Discussion's default composer.
    k, title = run(Body())
    check("no title and no key -> the general thread (thread_key NULL)", k is None,
          "got %r - the general thread is what General Discussion is built on" % (k,))
    check("...and it carries no thread title", title is None, "got %r" % (title,))

    # 2. Discussion's "Start a new thread..."
    k, title = run(Body(new_thread_title="Pickup window"))
    check("a new title -> its own numbered thread", k == "t4", "got %r" % (k,))
    check("...titled as given", title == "Pickup window", "got %r" % (title,))

    # 3. Discussion's "Reply in this thread"
    k, title = run(Body(thread_key="t2"))
    check("an existing key -> that thread", k == "t2", "got %r" % (k,))
    check("...inheriting its title", title == "Pickup window at Cikarang",
          "got %r" % (title,))

# ---------------------------------------------------- the screens agree with the API
print()
print("the screens agree with the API")
meet = _read("frontend", "src", "screens", "Meetings.jsx")
check("Pending & proposals posts the general shape",
      "api.addComment(t.ref, { body, is_question: false })" in meet,
      "the + Note call no longer matches the general-thread shape")
check("...and does not name a new thread",
      "new_thread_title:" not in meet,
      "a new_thread_title here starts a thread per note again")
check("...and does not file a weekly note as a question",
      "is_question: true" not in meet,
      "every weekly update would add one to the unanswered count, permanently")

disc = _read("frontend", "src", "screens", "Discussion.jsx")
check("Discussion seeds the general thread, so every ticket shows one",
      'const groups = [{ key: "", title: GENERAL_TITLE, items: [] }];' in disc,
      "a ticket nobody has posted on would show no place to post")

api = _read("frontend", "src", "api.js")
check("the thread is named once, in api.js",
      'export const GENERAL_TITLE = "General Discussion";' in api)
for f, name in ((disc, "Discussion.jsx"), (meet, "Meetings.jsx")):
    check(f"{name} takes the name from that constant",
          "GENERAL_TITLE" in f and "GENERAL_TITLE" in f.split(chr(10))[1],
          "a second spelling of the name would drift from the first")

print()
if fails:
    print("FAILED %d check(s):" % len(fails))
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("ALL THREAD CHECKS PASSED")
