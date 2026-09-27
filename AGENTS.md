# Agent instructions

The canonical specification is [docs/DISTRIBUTION_SOFTWARE_IMPLEMENTATION_GUIDE.md](docs/DISTRIBUTION_SOFTWARE_IMPLEMENTATION_GUIDE.md).
Section 21 (SSOT, dependency governance, safe change rules) is mandatory. Do not copy its rules
into other files; link to it.

Before editing:

1. Check [docs/implementation-status.md](docs/implementation-status.md) for the current phase.
2. Check [docs/decisions.md](docs/decisions.md). Confirmed rules (D01–D22) are not open for
   reinterpretation; pending items (P01…) must not be silently decided in code.
3. Find the canonical owner of the fact/rule you are changing (guide §21.1) and change it once.

Current phase: **Phase 1 — interactive JSON prototype.** No database, Redis, auth or production
API integration until the client approval gate (guide §6.4, §17 Phase 2) is recorded in
[docs/client-approval.md](docs/client-approval.md).

## Layout

| Path                     | Owns                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `apps/web`               | Next.js App Router UI; `src/data/ports` service interfaces, `src/data/mock` JSON adapter |
| `packages/architecture`  | Leaf module/action/resource/event IDs (imports nothing from `@bsd/*`)                    |
| `packages/contracts`     | Zod request/response schemas; DTO types are inferred, never hand-written                 |
| `packages/domain`        | Pure decimal quantity/money rules; no React/Next/Prisma/Redis                            |
| `packages/i18n`          | Bangla dictionary, digit normalization, formatters                                       |
| `packages/design-system` | Semantic tokens and the company theme contract                                           |

Packages deferred to Phase 3: `application`, `database`, `auth`, `ui`, `observability`, `apps/worker`.

## Commands

```sh
pnpm dev     # start the web app
pnpm check   # format:check + lint (incl. module boundaries) + check:types + test (all Vitest)
pnpm build   # production build
```

## Non-negotiables

- Money and quantities: `Decimal` from `@bsd/domain`, strings at JSON boundaries. Never JS numbers.
- UI text: keys from `@bsd/i18n`. No hardcoded English on operational screens.
- Colors/spacing: tokens from `@bsd/design-system`. No literal brand colors in pages.
- Pin exact dependency versions (`save-exact`), one lockfile, pnpm only.
- Nontrivial changes include a change-impact manifest in `changes/` (guide §21.10).
- Report which checks actually ran; a passing build is not evidence of financial correctness.
