import io

NL = chr(10)


def patch(path, old, new, n=1):
    s = io.open(path, encoding="utf-8").read()
    c = s.count(old)
    assert c == n, (path, c, n, old[:70])
    io.open(path, "w", encoding="utf-8").write(s.replace(old, new, n))


# 1. the Tile itself: shorter, not narrower ---------------------------------------
# Shared with CAPA, whose four tiles carry short labels and only get tidier for this.
# Attachments has its own Tile and is untouched.
patch(
    "frontend/src/ui.jsx",
    '''      className={`rounded-xl border bg-white px-4 py-3.5 text-left ${''',
    '''      className={`rounded-xl border bg-white px-3.5 py-2.5 text-left ${''',
)
patch(
    "frontend/src/ui.jsx",
    '''      {/* Not truncated: these carry full status names now ("Pending Review - Head
          Sales"), and a clipped label defeats the whole point of the tile. */}
      <div className="min-h-[2.4em] text-[12.5px] font-medium leading-snug text-slate-600">{label}</div>
      <div className={`mt-1.5 font-mono text-[27px] font-bold leading-none tabular-nums tracking-tight ${tone || "text-slate-900"}`}>
        {value}
      </div>
      <div className="mt-1 truncate text-[11.5px] text-slate-400">{sub || " "}</div>''',
    '''      {/* Not truncated: these carry full status names now ("Pending Review - Head
          Sales"), and a clipped label defeats the whole point of the tile. The
          min-height reserves TWO lines so a one-line label and a two-line one still
          line their numbers up across a row — without it the grid reads as ragged.
          Tightened on 2026-09-02: twelve status tiles at the old size pushed the
          filters below the fold on a laptop. */}
      <div className="min-h-[2.5em] text-[12px] font-medium leading-snug text-slate-600">{label}</div>
      <div className={`mt-1 font-mono text-[22px] font-bold leading-none tabular-nums tracking-tight ${tone || "text-slate-900"}`}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-slate-400">{sub || " "}</div>''',
)

# 2. more tiles per row ------------------------------------------------------------
D = "frontend/src/screens/Dashboard.jsx"
patch(
    D,
    '      <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(178px,1fr))]">',
    '      {/* 150px, down from 178 (Michael, 2026-09-02): twelve status tiles wrapped to\n'
    '          three rows with an orphan pair on the last one, and pushed the filters off\n'
    '          screen. Narrower fits more per row and closes the ragged tail. gap-2.5 with\n'
    '          it, since tighter tiles do not need as much air between them. */}\n'
    '      <div className="mb-3 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">',
)
patch(
    D,
    '        <div className="mb-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">',
    '        <div className="mb-4 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">',
)

print("dashboard tiles tightened")
