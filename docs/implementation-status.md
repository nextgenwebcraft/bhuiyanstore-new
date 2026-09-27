# Implementation status

Evidence-based progress against guide §17. Mark an item done only with evidence.

## Current phase: Phase 1 — Design and interactive JSON prototype

| Item (guide §17 Phase 1)                                                         | Status      | Evidence                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project skeleton, pinned versions, strict TypeScript, formatting and lint checks | Done        | 2026-09-27: `pnpm check` and `pnpm build` pass; boundary rule rejected planted `react`, `@bsd/database` and `@bsd/auth` imports                                                                                                                                                                                               |
| Record supplier-brand/distributor relationship and unresolved decision IDs       | Done        | [decisions.md](decisions.md) D01, P01–P06                                                                                                                                                                                                                                                                                     |
| Semantic design tokens, accessible components, desktop shell, mobile layouts     | Started     | Tokens; desktop shell with sidebar; mobile header + `<dialog>` drawer; `StatePanel`, `Skeleton`, `PageHeader`, `Button`. Verified 2026-09-27 in Chrome: no horizontal scroll at 360px on `/`, products, dashboard. No component catalog yet                                                                                   |
| Bangla dictionaries, Bengali/Latin digit normalization, Bangla print-font checks | Started     | `packages/i18n`: §3.1 vocabulary, navigation/state/error keys, digit + search normalization tests; print check not done                                                                                                                                                                                                       |
| Brand selector with themes, scoped navigation, products, demo role switching     | Done        | 2026-09-27: `/c/[companyId]` shell; 3 themed brands; nav = enabled module ∩ permission (`navigation.test.ts`); switching keeps equivalent route or falls back to dashboard; demo users owner/manager/operator. Browser script verified switching, theme change, Bangla-digit search, operator forbidden state and reduced nav |
| Contracts, decimal utilities, service ports, deterministic JSON fixtures         | Started     | Contracts: company/theme/workspace/product/error schemas, permission + module IDs. Port `DistributionService`; mock adapter validates seed and responses, enforces membership/permissions, supports abort (`mock-service.test.ts`). No transactions/batches yet                                                               |
| §21 ownership/dependency registry, component catalog, generated views, CI gates  | Started     | Module + resource IDs in `packages/architecture`; lint/types/test/build CI. No action registry or generated catalog yet                                                                                                                                                                                                       |
| Company-switch draft guard (Save draft / Discard / Stay, guide §4.2 step 2)      | Not started | Needed once the first draft form exists; TODO in `company-switcher.tsx`                                                                                                                                                                                                                                                       |
| All remaining Phase 1 items                                                      | Not started |                                                                                                                                                                                                                                                                                                                               |

## Demo notes

- Demo users: মালিক (all companies, all permissions), ম্যানেজার (Drinko + Demo Foods, no admin),
  ডিএসআর অপারেটর (Drinko only, sales/DSR/stock view).
- Demo Snacks enables only sales, inventory and reports; Demo Foods has no SR/DSR modules.
- Mock state lives in memory: a full page reload restores the seed and the default user.

## Not yet created (by design)

- `packages/application`, `packages/database`, `packages/auth`, `packages/observability`,
  `apps/worker`: Phase 3, after client approval. Shared UI components live in
  `apps/web/src/components` until a `packages/ui` extraction is justified.
- Scripts `check:registry`, `check:generated`, `check:contracts`, `check:schema`, `check:impact`,
  `check:dependencies`, `check:i18n`, `test:integration`, `test:ui`, `test:critical`
  (guide §21.11): add each only when it can verify real behavior. No placeholder scripts that
  just print success.
- Browser checks were run with a throwaway Playwright script outside the repo; committing
  Playwright as `test:ui` is a pending step.

## Suggested next step

Typed action registry (guide §21.4) and the first stateful workflow: product create/edit through
the mock port, then opening stock layers → godown stock view → batch drawer (guide §6.2, §6.3),
with the company-switch draft guard.
