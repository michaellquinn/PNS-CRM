# Substrait — upload scaffold

This is the starter template for the **upload mode**: vibe-code your app on your own
tool (e.g. Claude Code), then upload it here as a `.zip` and the platform builds,
migrates and deploys it to a sandbox namespace.

You ship **app code plus your Dockerfile(s)**. The platform owns only the Kubernetes
manifests — it fills in the slug, namespace, image and ingress host automatically. Your
app builds from **its own Dockerfile**, so the contract is behavioural, not stack-locked:
any backend that EXPOSEs 8000 and serves `GET /health` works. This scaffold ships a
working FastAPI backend and the matching Dockerfiles — start from those. The platform
validates your app on upload and rejects clearly if something required is missing.

## What goes in the zip

```
cicd/
  Dockerfile.backend                    # REQUIRED — builds the backend image (EXPOSE 8000, GET /health)
  Dockerfile.frontend                   # REQUIRED when you ship frontend/ — builds the SPA image (port 80)
  nginx.conf                            # serves the built SPA; referenced by Dockerfile.frontend
backend/                                # your FastAPI application code
  main.py                               # exposes `app` (the scaffold Dockerfile runs uvicorn main:app)
  requirements.txt                      # your backend deps
  .env.example                          # OPTIONAL — declare custom env vars + secrets (prefilled in the portal)
  resources/db/migration/*.sql          # OPTIONAL — Flyway migrations (MySQL/OceanBase dialect)
frontend/                               # OPTIONAL — React + Vite + Tailwind (deployed with the backend)
```

**Don't include `k8s/`** — the platform generates and owns it (any `k8s/` you include is
discarded). You **do** ship the Dockerfiles above; the platform no longer generates one.

### Your Dockerfile owns the build

The scaffold's `cicd/Dockerfile.backend` installs deps **wheels-only**
(`pip install --only-binary=:all:`) so a dep with no wheel fails fast and legibly
instead of dying in a cryptic source-build on the compiler-less slim image. If you need
a source build, pin a version that ships a wheel, or add the toolchain
(`apt-get install -y gcc …`) and drop the flag. It's your Dockerfile — edit it freely,
as long as it still EXPOSEs 8000 and serves `GET /health`.

### Runtime contract

- Backend listens on **port 8000**, serves `GET /health` (the readiness probe), and
  exposes its API under **`/api`** (the ingress routes `/api` to the backend).
- Read connection info from env (injected via the `app-secrets` Secret):
  - `DATABASE_URL` — OceanBase (MySQL-wire). Use a MySQL driver (`asyncmy`), `%s` placeholders.
  - `JWT_SECRET`
  - `REDIS_URL` / `KAFKA_BROKERS` / `QDRANT_URL` — only when you declare the service in
    `substrait.yaml` (see that file; the platform provisions declared services for you).
- Declare your app's **own** config in `backend/.env.example` (`NAME=value` per line; add
  `# secret` to mark a secret). On upload the platform pre-creates these under the app's
  Settings, prefilled, for you to fill in — see `backend/.env.example` for the format.
- Put **all** DDL in `backend/resources/db/migration/` as Flyway `V*.sql` files — no DDL in code.
- Exclude `node_modules/`, `.venv/`, and build output from the zip (source only).

### Stack (full-stack)

- **Backend: FastAPI** in the scaffold. The deploy contract itself is just port 8000 +
  `GET /health`, and you own the Dockerfile — so any stack meeting that contract works.
- **Frontend (optional): React + Vite + Tailwind CSS** — a starter lives in `frontend/`.
  When present it's **deployed alongside the backend** behind one ingress host: `/api` →
  backend, everything else → frontend. Call the API via **relative `/api` paths**; the
  scaffold's `cicd/Dockerfile.frontend` builds the bundle with `VITE_API_URL=""`
  (same-origin) and serves it via nginx on port 80. Ship that Dockerfile alongside `frontend/`.
  **No `frontend/`?** Then *all* traffic (including `/`) routes to the backend, so the
  backend must serve its own root/pages — a pure-API backend returns its own 404 on `/`.

### Build-time frontend env vars (`frontend/.env.production`)

Vite inlines `import.meta.env.VITE_*` at **build time**. The portal's env vars are
injected into the **backend at runtime only** and never reach the Vite build, so to set
build-time frontend vars (e.g. an OAuth client ID) commit a **`frontend/.env.production`**
— the platform runs `npm run build` in production mode and Vite auto-loads it. See the
commented starter at `frontend/.env.production`.

- ⚠️ **Public, non-secret values only** — it's committed to git *and* baked into the JS
  bundle every visitor downloads. Real secrets go in `backend/.env.example`.
- **Don't set `VITE_API_URL`** — the platform forces `VITE_API_URL=""`, which overrides
  any value here (it's silently ignored). Use relative `/api` paths.
- If you add `.env*` to `frontend/.gitignore`, also add `!.env.production` so it ships.
