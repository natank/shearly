# Shearly

On-demand marketplace for home beauty services.

## Status

MVP documentation is in `/docs`. **M0–M2** are on `main`. **M3** plan is accepted: `docs/mvp/04-implementation-plan/m3-demand.md`.

## Local (M0)

This machine may use **Podman** (`docker` is then the Podman CLI). Start the VM once per reboot: `podman machine start`.

```bash
pnpm install
cp -n .env.example .env
docker compose up -d
pnpm nx run api:migrate
pnpm nx run-many -t serve -p web,api,admin
```

| Surface           | URL                                                |
| ----------------- | -------------------------------------------------- |
| web               | http://localhost:3000/en and /he                   |
| admin             | http://localhost:4300                              |
| api               | http://localhost:4000/health                       |
| Postgres          | localhost:5432 (`shearly` / `shearly` / `shearly`) |
| Mailpit SMTP / UI | 1025 / 8025                                        |
| Geocoder stub     | http://localhost:3001/geocode?q=tel-aviv           |

Stripe CLI is opt-in: `docker compose --profile stripe up -d` with `STRIPE_API_KEY`. Image pulls happen inside the Podman VM; Hub TLS errors are a VM/CA issue, not this file.

## Checks

```bash
pnpm format:check
pnpm nx run-many -t lint,test,typecheck
pnpm e2e
```

CI (design §10.1 gates 1–8) runs on every PR and on `main`. The **Image** workflow builds the Fargate-shaped container and smokes `GET /health`. Merge should be blocked on both.

### Container (M0-P7)

One image, two processes: Next (`:3000`) and API (`:4000`).

```bash
docker build -t shearly:local .
docker run --rm -p 3000:3000 -p 4000:4000 --env-file .env shearly:local
```

ECR push is skipped unless these GitHub Actions secrets exist: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `ECR_REPOSITORY`. Preview/production URLs wait until AWS is provisioned (PQ-3).

## Docs

| Stage        | Path                               |
| ------------ | ---------------------------------- |
| Vision       | `docs/01-vision.md`                |
| Requirements | `docs/mvp/02-requirements.md`      |
| Design       | `docs/mvp/03-design.md`            |
| Plan         | `docs/mvp/04-implementation-plan/` |
