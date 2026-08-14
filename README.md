# Shearly

On-demand marketplace for home beauty services.

## Status

MVP documentation is in `/docs`. Implementation starts at milestone **M0 Foundation** (`docs/mvp/04-implementation-plan/m0-foundation.md`).

## Local (M0)

```bash
pnpm install
docker compose up -d      # from M0-P3
pnpm nx run-many -t serve -p web,api,admin   # from M0-P2
```

Until Compose (M0-P3) lands, skip `docker compose` and run:

```bash
pnpm install
pnpm nx run-many -t serve -p web,api,admin
```

| App | URL |
|---|---|
| web | http://localhost:3000 |
| admin | http://localhost:4300 |
| api | http://localhost:4000/health |

## Docs

| Stage        | Path                               |
| ------------ | ---------------------------------- |
| Vision       | `docs/01-vision.md`                |
| Requirements | `docs/mvp/02-requirements.md`      |
| Design       | `docs/mvp/03-design.md`            |
| Plan         | `docs/mvp/04-implementation-plan/` |
