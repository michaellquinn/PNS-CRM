# Changelog

**The changelog lives in the app**, on the "What changed" screen under Reference. It is
rendered from the `ENTRIES` array at the top of
[`frontend/src/screens/Changelog.jsx`](frontend/src/screens/Changelog.jsx).

That file is the single source. This page exists so anyone reading the repo rather than
the app knows where to look, and knows the rule.

## The rule

Every change gets an entry, added **in the same commit as the change itself**, at the top
of `ENTRIES`.

Each entry is:

```js
{
  date: "2026-08-10",          // when it shipped
  title: "Short description",
  by: "Who",
  changes: [ "..." ],          // what this release does that it did not before
  overruled: [ "..." ],        // decisions this release reverses or narrows
}
```

**`overruled` is the part that matters.** Two people ship to this app from separate
clones. If your change reverses, narrows or replaces something the other person built, it
goes under `overruled` with what stands instead. It does not go under `changes`.

A decision that gets overruled without being written down is how the same argument gets
had twice, six weeks apart, with nobody able to say why it was settled the first way.

## Why the app and not this file

Baskoro reads the app; Michael reads the repo. Keeping the entries in a rendered screen
means the person who needs them most does not have to open GitHub to see them, and a
single array cannot drift out of step with a second copy.

## Deployment note

`BUILD` in `backend/main.py` is bumped by hand and is the only version marker the running
app exposes (via `GET /api/me`). Because `.substrait/config.json` is gitignored, each
person deploys from their own clone, and nothing forces a push first. On 2026-08-10 two
deployments went out that were not in GitHub at the time. Before deploying, compare the
live `BUILD` against this repo's, and push first.
