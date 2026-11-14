# BSD Agent Rules

**Phase:** I — go-live (A–G done; H removed, D36: no Excel import). D30 approved 2026-10-02.

## Before editing

1. [docs/implementation-status.md](docs/implementation-status.md) — current phase
2. [docs/decisions.md](docs/decisions.md) — D01–D30 final; P01… must not be silently decided in code
3. Single owner per fact (guide §21.1); all calculations → `packages/domain` month engine

## Packages

| Package                  | Owns                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `apps/web`               | Next.js UI + `/api/v1` Route Handlers; `src/data/ports` interfaces, `src/data/mock` adapter |
| `packages/architecture`  | IDs only — no `@bsd/*` imports                                                              |
| `packages/contracts`     | Zod schemas; infer DTOs, never hand-write                                                   |
| `packages/domain`        | Decimal rules + month engine — no React/Next/Prisma/Redis                                   |
| `packages/i18n`          | Bangla dict, digit normalization, formatters                                                |
| `packages/design-system` | Semantic tokens + theme contract                                                            |
| `packages/importer`      | `verify:workbook` + report export (server-side only)                                        |
| `packages/database`      | Prisma schema/migrations/client — only DB-touching package                                  |
| `packages/auth`          | Better Auth (email+password, no public sign-up), session→actor                              |
| `packages/application`   | Use cases: tenant/permission checks, idempotency, audit                                     |

**Import rule:** only `apps/web/src/app/api/**` and `apps/web/src/server/**` may import `database`, `auth`, `application` (lint-enforced).

`NEXT_PUBLIC_DATA_SOURCE=http` → real API (`src/data/http`). Secrets in `.env` (see `.env.example`). `docs/*.xlsx` is gitignored — never commit.

## Commands

```sh
pnpm dev                  # start app
pnpm check                # format + lint + types + test
pnpm build                # production build
pnpm verify:workbook      # local: recalculate xlsx vs Excel
pnpm test:integration     # migrate + test (wipes TEST_DATABASE_URL schema)
pnpm db:migrate           # apply migrations to DIRECT_URL
pnpm db:bootstrap-admin   # idempotent super-admin from BOOTSTRAP_ADMIN_*
pnpm db:seed-demo         # local demo from xlsx (--dry-run prints counts)
```

## Non-negotiables

- Money/quantities: `Decimal` (`@bsd/domain`), NUMERIC (Postgres), strings at JSON boundaries — no JS numbers
- UI text: `@bsd/i18n` keys — no hardcoded English on operational screens
- Colors/spacing: `@bsd/design-system` tokens — no literal brand values in pages
- Exact dependency versions (`save-exact`), pnpm only, one lockfile
- Nontrivial changes → `changes/` manifest (guide §21.10)
- Report which checks ran; passing build ≠ financial correctness

## Key docs

- [docs/PLAN.md](docs/PLAN.md) — calculation spec (§2), architecture, data model, API, phases
- [docs/DISTRIBUTION_SOFTWARE_IMPLEMENTATION_GUIDE.md](docs/DISTRIBUTION_SOFTWARE_IMPLEMENTATION_GUIDE.md) — §21 SSOT rules (mandatory)
- [docs/client-approval.md](docs/client-approval.md) — D30
