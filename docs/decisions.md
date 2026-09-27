# Decision register

Owner of accepted business and technical decisions (guide §21.1). Code references decisions by ID.
Business rules D01–D22 are bootstrapped from guide §3; see the guide for full wording. Change a
decision here and in code together, never in a private note.

## Business rules (from guide §3)

| ID  | Status                  | Summary                                                                          |
| --- | ----------------------- | -------------------------------------------------------------------------------- |
| D01 | Confirmed               | Companies are supplier brands under one distributor legal entity                 |
| D02 | Confirmed               | SR supplier-employed; DSR distributor-employed; no SR payroll                    |
| D03 | Confirmed               | One daily product summary per brand/DSR/date; no customer module                 |
| D04 | Confirmed / AB deferred | Samari = issue, Firot = unsold return, Credit = old-dues collection; AB excluded |
| D05 | Implementation default  | FEFO when expiry known, else FIFO; authorized override with reason               |
| D06 | Implementation default  | Actual receipt cost layers; sale prices are transaction snapshots                |
| D07 | Decided                 | Excel baseline, owner-adjusted opening cutover                                   |
| D08 | Confirmed / decided     | Bangla, BDT, Asia/Dhaka, no tax invoice; 2-place settlement, 6-place cost        |
| D09 | Implementation default  | Shared staff/cash; brand-attributed events                                       |
| D10 | Decided                 | One shared godown; internal custody/quarantine locations                         |
| D11 | Confirmed               | DSR personal due recovered from salary, capped; remainder carries forward        |
| D12 | Implementation default  | Source-linked corrections and returns                                            |
| D13 | Implementation default  | Period locks, approvals, optimistic concurrency, idempotency                     |
| D14 | Confirmed               | Neon PostgreSQL; Redis only after a measured SQL baseline                        |
| D15 | Confirmed               | Online only, responsive mobile; no offline queue or local drafts                 |
| D16 | Confirmed               | Company incentive = free product stock; no cash/payable effect                   |
| D17 | Confirmed               | Separate buyer and supplier damage replacement legs by product/batch             |
| D18 | Confirmed               | SR Sort = SR loan receivable; SR Over = SR payable                               |
| D19 | Confirmed               | Banking Amount = outgoing deposit to supplier                                    |
| D20 | Confirmed               | D:Comition and supplier incentive products have no accounting connection         |
| D21 | Confirmed               | Buyer replacement may be pending; market due never enters payroll                |
| D22 | Confirmed               | Dynamic per-company products with batches and variable prices                    |

## Pending business decisions

Do not resolve these in code; record the owner's answer here first.

| ID  | Question                                                                       | Source          | Provisional handling                                |
| --- | ------------------------------------------------------------------------------ | --------------- | --------------------------------------------------- |
| P01 | Rounding mode, line-vs-summary rounding and residual account                   | Guide §10.4     | `ROUND_HALF_UP` in `packages/domain/src/decimal.ts` |
| P02 | Workspace/catalog naming: file title says Drinko, `Jan 2026!G3` says PRAN      | Guide §2.1      | Demo uses synthetic names                           |
| P03 | Go-live / opening cutover date                                                 | Guide §2.5, §16 | None; the opening wizard requires an explicit date  |
| P04 | Pack definitions where carton factors differ (`Mar 2026!F109` ×72, `I109` ×24) | Guide §2.5      | Per-product factor, snapshotted per line            |
| P05 | Physical reconciliation of negative saved stock (`Jan 2026!T14`, `T28`, `T32`) | Guide §2.5      | Negative available stock blocked by default         |
| P06 | Discount, expiry, batch allocation and return policies (Phase 2 confirmation)  | Guide §17       | Implementation defaults D05, D12                    |

## Technical decisions

| ID  | Decision                                                                                  | Reason                                                                  |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| T01 | pnpm 10.22.0 workspace, one lockfile, exact versions (`save-exact`)                       | Guide §21.9                                                             |
| T02 | TypeScript 6.0.3, not 7.x                                                                 | typescript-eslint 8.70 supports TypeScript `<6.1.0`                     |
| T03 | ESLint 9.39.5, not 10.x                                                                   | eslint-plugin-react (via eslint-config-next 16.3.6) peers `eslint ^9.7` |
| T04 | Module boundary checker: ESLint `no-restricted-imports` per package (`eslint.config.mjs`) | Guide §21.3 requires one checker; verified against planted violations   |
| T05 | Workspace packages ship TS source, consumed via Next `transpilePackages`                  | No per-package build step during Phase 1                                |
| T06 | Decimal arithmetic: decimal.js 10.6.0, one configured clone in `@bsd/domain`              | Guide §7.2, §10.4                                                       |
| T07 | Bangla font: Noto Sans Bengali via `next/font/google` (self-hosted at build)              | Guide §5.1.1; print/PDF embedding still to verify                       |
| T08 | Next.js 16.3.6, React 19.3.0, Tailwind CSS 4.3.3, Zod 4.6.5, Vitest 5.0.2                 | Latest stable, compatible releases at bootstrap (2026-09-27)            |
