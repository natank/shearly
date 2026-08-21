# QC lab

Shared environment for all MVP STDs. Milestone STDs add only what they need.

**Date of this lab:** 2026-08-15 (`main` after M3).

---

## 1. Surfaces

| Name | URL | Process |
|---|---|---|
| Web (customer + provider) | http://localhost:3000/en and `/he` | `web` |
| Admin | http://localhost:4300/en | `admin` |
| API | http://localhost:4000 | `api` |
| API health | http://localhost:4000/health | `api` |
| Mailpit UI | http://localhost:8025 | Compose `mailhog` (Mailpit image) |
| Mailpit SMTP | `smtp://127.0.0.1:1025` | same |
| Geocoder stub | http://localhost:3001/geocode?q=tel-aviv | Compose `geocoder-stub` |
| Postgres + PostGIS | `localhost:5432` db/user/pass `shearly` | Compose `postgres` |

Web rewrites `/api/*` to the API. Use the browser for cookie-backed flows. Use `curl` against `:4000` when the STD says so.

---

## 2. Bring-up

From the repo root, on `main` (or the commit under test):

```bash
pnpm install
cp -n .env.example .env
docker compose up -d
pnpm nx run api:migrate
pnpm nx run-many -t serve -p web,api,admin
```

If this machine uses Podman: `podman machine start` once per reboot. `docker` may be the Podman CLI.

**Podman socket:** `docker compose` needs `DOCKER_HOST` pointed at the Podman machine's API socket for this shell session:

```bash
export DOCKER_HOST='unix:///var/folders/qx/kr6jckrn5zl1f41jpc9c2zmc0000gp/T/podman/podman-machine-default-api.sock'
```

(Path is printed by `podman machine start`; it can change per machine/reboot — re-check if `docker compose` commands fail to connect.)

**No local `psql`:** if `psql` is not installed on the host, run SQL through the Postgres container instead:

```bash
docker exec shearly_postgres_1 psql "postgres://shearly:shearly@localhost:5432/shearly" -c "<query>"
```

Use this form wherever this doc says to run `psql ...` directly (bring-up checks, reset ladder, SQL peek).

**First checkout after M3** (or any time the volume was created with vanilla Postgres 16):

```bash
docker compose down -v
docker compose up -d
pnpm nx run api:migrate
```

Vanilla volumes cannot load PostGIS. Discovery (`ST_DWithin`) will fail until the volume is recreated.

Wait until:

- http://localhost:4000/health → `{"ok":true}`
- http://localhost:3000/en shows **Shearly**
- http://localhost:4300/en shows **Shearly Admin**
- http://localhost:8025 opens Mailpit
- http://localhost:3001/health → `{"ok":true}`

---

## 3. Seed credentials

| Role | Email | Password | How it exists |
|---|---|---|---|
| Admin | `admin@shearly.local` | `change-me-admin-10` | Created by `pnpm nx run api:migrate` when `ADMIN_SEED_*` is set (`.env.example` defaults) |

Do **not** register this email as customer or provider. One role per account.

Tester-created accounts use unique emails: `qc-<milestone>-<role>-<yyyymmdd>@example.com`.

| Policy | Value |
|---|---|
| Password minimum | 10 characters |
| Rate limit | 10 attempts / 60 s per IP+action (`AUTH_RATE_LIMIT_*`) |
| Session cookie | `shearly_session` — HttpOnly, SameSite=Lax |
| Guest draft cookie | `shearly_guest_draft` |
| Radius cap | 15 km |
| Commission | 20% (₪200 gross → ₪160 net) |
| Currency | ILS |

---

## 4. Geocoder fixtures

`GET http://localhost:3001/geocode?q=<key>` (spaces become `-`, case-insensitive).

| Query | lat | lng | Use |
|---|---|---|---|
| `tel aviv` / `tel-aviv` | 32.0853 | 34.7818 | In-radius home for listed Tel Aviv providers |
| `jerusalem` | 31.7683 | 35.2137 | ~50 km from Tel Aviv — outside a 10 km radius |
| `eilat` | 29.5577 | 34.9519 | Far south — out-of-area vs Tel Aviv listing |
| anything else | 404 | — | Unknown address |

Discovery also accepts `?lat=&lng=` so QC can skip the stub when proving radius math.

---

## 5. Browser profiles

Open **three** isolated profiles (or three browsers). Do not mix cookies.

| Profile | Used for |
|---|---|
| A — Visitor | Anonymous discovery (M3). No sign-in unless the procedure says so |
| B — Customer | Register / account / addresses |
| C — Provider | Register as provider / dashboard |
| D — Admin | http://localhost:4300 only |

A fourth window for Mailpit is fine (no Shearly cookies needed).

---

## 6. Reset ladder

Use the lightest reset that makes the next procedure valid.

### R0 — Soft (session only)

Sign out on web and admin. Clear site cookies for `localhost:3000` and `localhost:4300` if a procedure says “no session.”

### R1 — Rate-limit only

```sql
DELETE FROM identity.auth_rate_limits;
```

```bash
psql "postgres://shearly:shearly@localhost:5432/shearly" -c "DELETE FROM identity.auth_rate_limits;"
```

### R2 — Data wipe, keep schemas

Stops product rows. Keeps migrations. Re-seeds admin.

```bash
psql "postgres://shearly:shearly@localhost:5432/shearly" <<'SQL'
TRUNCATE
  identity.guest_drafts,
  identity.password_reset_tokens,
  identity.auth_rate_limits,
  identity.sessions,
  identity.addresses,
  identity.accounts
  RESTART IDENTITY CASCADE;
TRUNCATE
  catalog.document_access_log,
  catalog.reviews,
  catalog.vetting_documents,
  catalog.services,
  catalog.providers
  RESTART IDENTITY CASCADE;
TRUNCATE
  availability.exceptions,
  availability.weekly_rules
  RESTART IDENTITY CASCADE;
TRUNCATE
  payments.connect_accounts
  RESTART IDENTITY CASCADE;
SQL
pnpm nx run api:migrate
```

Migrate re-inserts `admin@shearly.local`. Delete `var/private-docs/*` if vetting files were uploaded (safe if the directory is missing).

`TRUNCATE … CASCADE` from `identity.accounts` is enough if catalog/availability FKs point at account ids stored as uuid without a DB FK. The explicit catalog/availability/payments truncates are still required — those schemas do **not** FK to `identity`.

### R3 — Hard (volume)

```bash
# stop serve processes first
docker compose down -v
docker compose up -d
pnpm nx run api:migrate
pnpm nx run-many -t serve -p web,api,admin
```

Use after PostGIS/image changes, corrupt volumes, or when R2 is not enough.

---

## 7. SQL peek (read-only helpers)

```bash
psql "postgres://shearly:shearly@localhost:5432/shearly"
```

Useful checks cited by STDs:

```sql
SELECT id, email, role, locale FROM identity.accounts ORDER BY created_at;
SELECT count(*) FROM identity.sessions;
SELECT * FROM identity.auth_rate_limits;
SELECT id, status, listed, display_name, base_lat, base_lng, radius_km, rating_count
  FROM catalog.providers;
SELECT * FROM catalog.document_access_log ORDER BY accessed_at;
SELECT extname FROM pg_extension WHERE extname = 'postgis';
```

---

## 8. What QC must not do

| Action | Why |
|---|---|
| `POST /bookings` | M4 |
| Capture/charge a real card | M4; no live Stripe in lab |
| Expect public S3 / CloudFront | Named hole; portfolio is an API GET |
| Expect SES | Mailpit only |
| Expect a map | DIS-006 is post-MVP |
| Share one account across customer + provider | PRV-001 forbids it |
