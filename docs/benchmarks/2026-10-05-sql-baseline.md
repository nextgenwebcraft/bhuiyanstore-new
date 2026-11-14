# SQL baseline, 2026-10-05 (evidence for T19)

Reproduce with `pnpm benchmark:sql` (wipes the `TEST_DATABASE_URL` schema; `BENCH_SCALE`, `BENCH_RUNS`,
`BENCH_TRACE=1` optional). Source: `packages/application/src/sql-baseline.benchmark.ts`.

## Setup

- Client: developer PC in Bangladesh, `pnpm` + Node 24, application services called directly
  (no HTTP layer), super-admin (cost and profit visible, the largest payloads).
- Database: Neon Postgres, `ap-southeast-1` (Singapore), `test` schema. `SELECT 1` round trip
  p50 ≈ 116–123 ms.
- Data (workbook-sized company): 110 products, 6 DSRs, 97 days after a 2026-06-30 cutoff,
  34,920 DSR lines (60 products per sheet), 3,602 price splits, 2,940 stock entries,
  679 money entries, 140 price changes.
- Budgets (guide §15.5): common list/report p95 ≤ 800 ms, dashboard p95 ≤ 1 s.

## Results (p50 of 3 runs after a warm-up)

| Operation                   | 3 past months open | past months closed |
| --------------------------- | -----------------: | -----------------: |
| company access check        |             231 ms |             243 ms |
| day view (today)            |           8,657 ms |           1,912 ms |
| dashboard (today)           |           7,901 ms |           1,800 ms |
| month view (this month)     |           9,006 ms |           2,453 ms |
| month view (last month)     |           8,089 ms |           3,521 ms |
| stock report, month to date |           8,524 ms |           4,312 ms |
| stock report, 90 days       |           8,337 ms |           7,489 ms |
| staff accounts (today)      |          10,758 ms |           1,983 ms |
| staff statement, 90 days    |           8,124 ms |           6,452 ms |

95–99 % of every request's time is spent waiting on the database client; computing the month
engine and building the response take 20–480 ms.

## Where the time goes

The posted DSR sheets (sheet → lines → price splits) dominate; measured for the same data:

| Range                 | Postgres execution (`EXPLAIN ANALYZE`) | One flat SQL, rows to client | Prisma nested include |
| --------------------- | -------------------------------------: | ---------------------------: | --------------------: |
| 5 days, 1,800 lines   |                                 7.9 ms |                       205 ms |                572 ms |
| 90 days, 32,400 lines |                                19.1 ms |                     3,124 ms |              3,373 ms |

- The database itself is fast (indexes are used; under 20 ms for 90 days).
- Almost all time is the link between the application and Neon: about 120 ms per statement and
  roughly 1 MB/s for result rows. Rewriting the query saves little over this link (3.1 s vs 3.4 s).
- With months still open, `runLedger` replays each open month one after another, multiplying the
  cost (day view 8.7 s open vs 1.9 s closed).

## Conclusion

Redis is not the fix for these numbers (T19). A cache would only hide the transfer for repeated
reads, and the daily screens are re-read right after each posting, which invalidates it. The
remedies, in guide §15.1 order, are: host the web app in the database's region, close months
promptly, then re-run this benchmark from the production host. This run measures a developer
link, not production; it is not a claim of production speed.
