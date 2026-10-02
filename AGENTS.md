# Agent instructions

The canonical plan is [docs/PLAN.md](docs/PLAN.md): calculation specification (§2), architecture,
data model, API and phases. [docs/DISTRIBUTION_SOFTWARE_IMPLEMENTATION_GUIDE.md](docs/DISTRIBUTION_SOFTWARE_IMPLEMENTATION_GUIDE.md)
is the reference for design patterns, security and workbook evidence. Its section 21 (SSOT,
dependency governance, safe change rules) stays mandatory. Do not copy its rules into other files;
link to it.

Before editing:

1. Check [docs/implementation-status.md](docs/implementation-status.md) for the current phase.
2. Check [docs/decisions.md](docs/decisions.md). Confirmed rules (D01–D30) are not open for
   reinterpretation; pending items (P01…) must not be silently decided in code.
3. Find the canonical owner of the fact/rule you are changing (guide §21.1) and change it once.
   Every calculation is owned by the month engine in `packages/domain` (PLAN §4).

Current phase: **PLAN §9 Phase D — opening balances**, built; next Phase E daily entry (Phase A
month engine and Phase B database/auth/API foundation done; Phase C masters built). The owner
approved backend integration on 2026-10-02 (D30, [docs/client-approval.md](docs/client-approval.md)).
Redis stays out until a measured need.

## Layout

| Path                     | Owns                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`               | Next.js App Router UI and `/api/v1` Route Handlers; `src/data/ports` service interfaces, `src/data/mock` JSON adapter (tests/demo) |
| `packages/architecture`  | Leaf module/action/resource/event IDs (imports nothing from `@bsd/*`)                                                              |
| `packages/contracts`     | Zod request/response schemas; DTO types are inferred, never hand-written                                                           |
| `packages/domain`        | Pure decimal rules and the month engine; no React/Next/Prisma/Redis                                                                |
| `packages/i18n`          | Bangla dictionary, digit normalization, formatters                                                                                 |
| `packages/design-system` | Semantic tokens and the company theme contract                                                                                     |
| `packages/importer`      | Header-driven workbook month reader and Excel comparison (server side only)                                                        |
| `packages/database`      | Prisma schema, migrations and client (Postgres/Neon); the only package that talks to the database                                  |
| `packages/auth`          | Better Auth (email + password, no public sign-up), session → actor, super-admin bootstrap                                          |
| `packages/application`   | Use cases: tenant/company/permission checks, idempotency, audit; route handlers only call these                                    |

Only `apps/web/src/app/api/**` and `apps/web/src/server/**` may import `database`, `auth` or
`application` (lint-enforced). `NEXT_PUBLIC_DATA_SOURCE=http` switches the UI from the demo mock to
the real API (`src/data/http`). Secrets live in the root `.env` (see `.env.example`). The real
workbook (`docs/*.xlsx`) holds real business data, is gitignored and must never be committed or
copied into fixtures.

## Commands

```sh
pnpm dev     # start the web app
pnpm check   # format:check + lint (incl. module boundaries) + check:types + test (all Vitest)
pnpm build   # production build
pnpm verify:workbook  # local only: recalculate docs/*.xlsx months and compare with Excel
pnpm test:integration # migrate + test against TEST_DATABASE_URL (its schema is wiped; never public)
pnpm db:migrate       # apply migrations to DIRECT_URL
pnpm db:bootstrap-admin  # first super-admin from BOOTSTRAP_ADMIN_* (idempotent)
```

## Non-negotiables

- Money and quantities: `Decimal` from `@bsd/domain`, NUMERIC in Postgres, strings at JSON boundaries. Never JS numbers.
- UI text: keys from `@bsd/i18n`. No hardcoded English on operational screens.
- Colors/spacing: tokens from `@bsd/design-system`. No literal brand colors in pages.
- Pin exact dependency versions (`save-exact`), one lockfile, pnpm only.
- Nontrivial changes include a change-impact manifest in `changes/` (guide §21.10).
- Report which checks actually ran; a passing build is not evidence of financial correctness.
