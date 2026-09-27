# Implementation status

Evidence-based progress against guide §17. Mark an item done only with evidence.

## Current phase: Phase 1 — Design and interactive JSON prototype

| Item (guide §17 Phase 1)                                                         | Status      | Evidence                                                                                                                        |
| -------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Project skeleton, pinned versions, strict TypeScript, formatting and lint checks | Done        | 2026-09-27: `pnpm check` and `pnpm build` pass; boundary rule rejected planted `react`, `@bsd/database` and `@bsd/auth` imports |
| Record supplier-brand/distributor relationship and unresolved decision IDs       | Done        | [decisions.md](decisions.md) D01, P01–P06                                                                                       |
| Semantic design tokens, accessible components, desktop shell, mobile layouts     | Started     | Tokens only: `packages/design-system/src/tokens.css`                                                                            |
| Bangla dictionaries, Bengali/Latin digit normalization, Bangla print-font checks | Started     | `packages/i18n`: §3.1 vocabulary and digit tests; print check not done                                                          |
| Brand selector with themes, scoped navigation, products, demo role switching     | Not started |                                                                                                                                 |
| Contracts, decimal utilities, service ports, deterministic JSON fixtures         | Started     | `packages/domain` quantity/money with workbook golden tests; contracts primitives only                                          |
| §21 ownership/dependency registry, component catalog, generated views, CI gates  | Started     | Module IDs in `packages/architecture`; lint/types/test/build CI in `.github/workflows/ci.yml`                                   |
| All remaining Phase 1 items                                                      | Not started |                                                                                                                                 |

## Not yet created (by design)

- `packages/application`, `packages/database`, `packages/auth`, `packages/ui`,
  `packages/observability`, `apps/worker`: Phase 3, after client approval. (`packages/ui` may be
  pulled into Phase 1 once shared components exist.)
- Scripts `check:registry`, `check:generated`, `check:contracts`, `check:schema`, `check:impact`,
  `check:dependencies`, `check:i18n`, `test:integration`, `test:ui`, `test:critical`
  (guide §21.11): add each only when it can verify real behavior. No placeholder scripts that
  just print success.
- `changes/` holds change-impact manifests (guide §21.10), required for nontrivial changes from
  here on.

## Suggested next step

Build the app shell: company switcher with themes, `/c/[companyId]/...` routes, Bangla navigation
(guide §5.2), the mock service port/adapter and the first seed fixtures (guide §6.2).
