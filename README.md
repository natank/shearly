# Shearly

On-demand marketplace for home beauty services.

## Status

MVP documentation is in `/docs`. Implementation starts at milestone **M0 Foundation** (`docs/mvp/04-implementation-plan/m0-foundation.md`).

## Local (M0)

This machine may use **Podman** (`docker` is then the Podman CLI). Start the VM once per reboot: `podman machine start`.

```bash
pnpm install
cp -n .env.example .env
docker compose up -d
pnpm nx run-many -t serve -p web,api,admin
```

| Surface | URL |
|---|---|
| web | http://localhost:3000/en and /he |
| admin | http://localhost:4300 |
| api | http://localhost:4000/health |
| Postgres (PostGIS) | localhost:5432 (`shearly` / `shearly` / `shearly`) |
| Mailhog SMTP / UI | 1025 / 8025 |
| Geocoder stub | http://localhost:3001/geocode?q=tel-aviv |

Stripe CLI is opt-in: `docker compose --profile stripe up -d` with `STRIPE_API_KEY`. Image pulls happen inside the Podman VM; Hub TLS errors are a VM/CA issue, not this file.

## Docs

| Stage        | Path                               |
| ------------ | ---------------------------------- |
| Vision       | `docs/01-vision.md`                |
| Requirements | `docs/mvp/02-requirements.md`      |
| Design       | `docs/mvp/03-design.md`            |
| Plan         | `docs/mvp/04-implementation-plan/` |
