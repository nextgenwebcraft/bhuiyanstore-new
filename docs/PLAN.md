# Implementation plan — distribution management software

**Status:** canonical plan from 2 October 2026. It replaces the phase plan in
[DISTRIBUTION_SOFTWARE_IMPLEMENTATION_GUIDE.md](DISTRIBUTION_SOFTWARE_IMPLEMENTATION_GUIDE.md)
(now called "the guide"). The guide stays as the reference for:

- design patterns and the SSOT and change rules in §21
- security (§12) and the Bangla vocabulary (§3.1)
- the workbook evidence (§2)

Business rules live in [decisions.md](decisions.md). D01–D30 apply, and D29 changes how cost is
calculated.

## 1. What we are building

The software replaces the monthly Excel book (`Drinko 2026.xlsx`, one book per company) with one web
application for every company (D28). Usage has three parts:

1. **Go-live (Drinko: 1 November 2026).** The owner enters opening balances once:
   - stock per product
   - goods still due from the company
   - market due
   - each staff member's and SR's balances
   - cash and bank
   - company payable or advance

   Opening balances can be entered on screen or through the standard template (§7).

2. **Every day after go-live.** Users enter the same raw facts they type into Excel today.
   The software calculates everything Excel calculates: stock, sales, profit, market due, cash in
   hand, staff balances, monthly totals, closing and reports.
3. **Optional Excel import.** If a whole month's raw data is available in the workbook layout, the
   software imports it, calculates the closing and reports, and shows a comparison against
   Excel's saved figures (§8).

Every company uses the same screens and calculations. Companies differ only in data: products,
carton sizes, prices, staff and opening balances (D28, guide §4.4).

## 2. Calculation specification (verified against the workbook)

This section is the single source for every calculation. `packages/domain` implements it once as
a pure month engine (§4). The API, the reports and the Excel import all call that engine.

### 2.1 Verification evidence

An independent engine that read only the raw inputs reproduced Excel's saved results:

| Month    | Result                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aug 2026 | **100 % match** on every check: Samari 302/302, Firot 223/223, sales 307/307, profit 307/307, goods due from company 581/581, stock 497/497, stock value 497/497, each person's net, closing stock 16/16, monthly receipt/sales/profit/damage/cartons, month totals (sales 2,036,615.518; profit 114,544.672), daily sales 27/27, daily cash 27/27, staff net |
| Sep 2026 | **100 % match** except two Excel mistakes that the software deliberately does not copy: Raju's net multiplies (`AC81=Y81*AB81`), and day 28 sales read a cost column (`WH34=TJ40`)                                                                                                                                                                            |
| Jul 2026 | Day 19's block is one column wider (the same shift seen in March and April). With header-driven mapping (§8) every product, stock and person check matches; the only difference is the carton-size conflict in §2.6                                                                                                                                           |

Since Phase A this comparison is repeatable: `pnpm verify:workbook` runs the real engine
(`computeMonth`) through the header-driven sheet reader (`packages/importer`) and labels every
known Excel mistake. Aug and Sep 2026 have no unexplained difference.

September has **no receipts and no company orders entered**, and almost no money entries. That
alone explains its negative closing stock (for example, Drinko 250ml at −25,104 pieces). August
is complete and is the reference month.

### 2.2 Inputs per company, per business day

| Input                               | Excel column                                    | Rule                                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pieces ordered from the company     | `C` Due Quantity                                | Per product                                                                                                                                               |
| Order (bill) price                  | `E` Due price                                   | Per product. **Carries forward** from the previous day until changed; day 1 takes the previous month's last price                                         |
| Pieces received                     | `G` Receive                                     | Per product; optional batch/lot and expiry (D29)                                                                                                          |
| Purchase (cost) price               | `H` Purchase Unit Price                         | Carries forward like `E`                                                                                                                                  |
| Sale price                          | `O` Sales Unit Price                            | Carries forward like `E`. A DSR line may split one product across several actual prices (D06); a single price reproduces Excel exactly                    |
| Issue to each DSR (Samari)          | person grid Caton/Pice                          | Cartons × the product's carton size + loose pieces, e.g. `Y45=(W45*24)+X45`; sizes per product (24, 96, 576, 150, 60, 30, 15, 12, 6, 72, 100, 20, 170, …) |
| Unsold return from each DSR (Firot) | person grid Firot                               | Same conversion                                                                                                                                           |
| Damaged pieces                      | `N` DAMAGE PRODUCT                              | Per product (software: per DSR line)                                                                                                                      |
| New market due (বাকি)               | `Due`                                           | Money per day (software: per DSR per day)                                                                                                                 |
| Old dues collected (Credit)         | `Credit`                                        | Per day (software: per DSR)                                                                                                                               |
| D:Comition                          | `D:Comition`                                    | SR incentive paid (D20)                                                                                                                                   |
| Operating cost and month expenses   | `Operating Cost`, Godawon, Garaj, …             | Expense entries by category                                                                                                                               |
| Staff money                         | `<name> Sort` / `Over` and single staff columns | Typed staff money entries (D27): Sort = money given to the person (advance, loan, shortage); Over = money received from the person (repayment, excess)    |
| Deposit to company                  | `Banking Amount`                                | Supplier deposit (D19)                                                                                                                                    |
| Company damage received/paid        | `Company Dameg …`                               | Damage replacement legs (D17)                                                                                                                             |
| Salary                              | Salari block                                    | Payroll (D24, D25)                                                                                                                                        |

### 2.3 Daily product calculations (per product, per day)

```text
issued        = Σ over DSRs (issue pieces)                     Excel K = M45+F45+F81
returned      = Σ over DSRs (return pieces)                    Excel L
delivered     = issued − returned                              Excel M = K−L
sold          = delivered − damaged                            (inside P, Q, S)
sales         = sold × sale_price                              Excel P = (M−N)×O
cost          = sold × cost_price                              Excel Q = (M−N)×H   (D29)
gross_profit  = sales − cost                                   Excel S
return_value  = returned × sale_price                          Excel R (report only)
order_value   = ordered × order_price                          Excel F
receipt_bill  = received × order_price                         Excel I
receipt_sale  = received × sale_price                          Excel J (report only)
due_from_co   = previous due_from_co + ordered − received      Excel D (W7 = D7+V7−Z7)
stock         = previous stock + received − delivered          Excel T (AM7 = T7+Z7−AF7)
                + company replacements − replaced from stock   (D17; no Excel column)
stock_value   = stock × cost_price                             Excel U
person_net    = person issue − person return                   Excel J45, Q45 (the software uses subtraction, always)
person_amount = person_net × sale_price                        Excel C45, R45 (report only)
```

Damaged pieces leave saleable stock as part of `delivered` and earn no revenue. A damaged item
received from a buyer goes to damaged stock, and the company replacement is tracked separately
(D17). It never adds back to saleable stock silently.

Damage cases (D17) feed the engine only through two posted legs:

- **Replaced from stock:** a good piece handed to a buyer straight from the godown (not on a DSR
  sheet). It leaves stock, counts in the damage value, and is not a sale.
- **Company replacement:** pieces the company sends back for accepted damage. They add to stock
  with no bill, no due from the company and no payable. `replacement_value` = quantity × the
  reviewed unit cost, reported apart from profit.

Dispatch, acceptance, rejection and write-off move damaged custody only.

### 2.4 Daily money calculations (per day)

```text
day_sales  = Σ products sales                                   Excel "Per Day sales in amount" = P40
cash_left  = day_sales + credit + money received from staff (Over / repayment / excess)
           − new market due − D:Comition − operating cost
           − money given to staff (Sort / advance / loan, incl. manager and helpers)
                                                                Excel "Total Amount", e.g. Aug WX8
```

The software derives the sign from each entry's type (D27); the single table is
`MONEY_KIND_EFFECTS` in `packages/domain`. Excel changes the formula from row to row: August day 1
leaves out the Manager column, while day 2 onward subtracts it. `cash_left` starts from sales, so
an approved shortage reduces it: that sales money never reached the cash box (Excel subtracts the
Sort columns). A business cost paid personally by staff is an expense and staff credit, with no
cash effect. Deposits to the company are reported as "banked", outside `cash_left`, as in Excel.

### 2.5 Month calculations

```text
per product: receipt_total = Σ receipt_bill           Excel "Total Receive amount in Tk"
             sales_total   = Σ sales                  "Total sale in Tk"
             profit_total  = Σ gross_profit           "Total Profit"
             closing_stock = stock on the last day    "present stock Per Pice"
             closing_value = closing_stock × last cost_price          "present stock Amount"
             closing_at_sale = closing_stock × last sale_price        "total product Sale price"
             due_from_co_value = due_from_co × last order_price        "Balance Quantity amount"
             order_total   = Σ order_value            "Total du Product amount"
             closing_cartons = closing_stock ÷ carton size             "present Stock Per Caton"
             sales_cartons = Σ delivered ÷ carton size                 "Total sales per Product"
             damage_value  = Σ (damaged + replaced_from_stock) × cost_price   "Dmage Product Amount"
             replacement_value = Σ company replacement quantity × unit cost (D17, report only)
per person:  month_net = Σ person_net; cartons = month_net ÷ carton size; amount = Σ daily person_amount
market due:  closing = opening + Σ new market due − Σ credit           Excel "Total Due" (row 42)
staff:       per person, owes us / we owe (D27); Excel net = Σ Sort − Σ Over − salary adjustment (row 42)
             statement line per money entry = its change to each balance + the balances after it
             payroll: recovery = advance → loan → shortage, capped at salary; Cash Pabe = salary − recovery
profit:      gross = Σ gross_profit
             net   = gross − salaries − operating cost − month expenses − D:Comition (D20)
cash book:   per account, opening + inflows − outflows (not Excel's cash_left, which is a daily view)
```

The software's net profit is lower than Excel's `VV42` by the D:Comition paid, because Excel leaves
it out (guide §2.8). The monthly report shows both figures. Person monthly amount is the sum of
daily amounts. Excel multiplies the month quantity by the last price, and the two only differ when
the price changed during the month.

### 2.6 Excel mistakes the software does not copy

| Excel cell / pattern                                                                                                   | Correct software rule                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Raju net `J81=F81*I81`, `AC81=Y81*AB81` (Sep and earlier)                                                              | issue − return                                                                                |
| Day 28 sales `WH34=TJ40` (a cost column)                                                                               | Σ sales of that day                                                                           |
| `Aug 2026!E7='Apr 2026'!UK7`; Oct–Dec opening from April                                                               | Opening always comes from the previous month's closing                                        |
| Market due opening (row 6) blank from June                                                                             | Opening market due carries forward automatically                                              |
| Daily cash formula differs by row                                                                                      | One rule by entry type (§2.4)                                                                 |
| Monthly profit without D:Comition                                                                                      | D:Comition is an expense (D20); both figures shown                                            |
| Commission history mixing SR money and incentive goods                                                                 | Kept separate (D20)                                                                           |
| `Sep 2026` has a 31st day block with 49 typed values, and the month totals add it                                      | Only real dates are imported; the owner confirms which date those entries belong to           |
| One product with two carton sizes: grids `×170`, `present Stock Per Caton` `/24` (Sun Drop Orange, Jul–Aug)            | One carton size per product in the product master, confirmed by the owner                     |
| Person-grid row labels not updated when product rows changed (e.g. grid "Oliver Cake" beside product "Sun Drop 200ml") | Excel's totals use position; the importer maps grids by position and reports label mismatches |
| Product rows differ between months (row 39 is Sun Drop Orange in Aug, Chocolate in Sep)                                | Products are matched by name (owner mapping), never by row                                    |

## 3. Architecture

| Layer       | Choice                                                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web         | Existing Next.js 16 App Router app (`apps/web`), current screens and design system, Bangla via `@bsd/i18n`                                                     |
| API         | Next.js Route Handlers under `/api/v1`, Node runtime; request/response schemas from `@bsd/contracts` (Zod)                                                     |
| Application | New `packages/application`: one service per command; checks permission, validates, posts in one DB transaction, idempotent by request key, writes an audit row |
| Calculation | `packages/domain`: pure Decimal month engine (§2), shared by the API, reports and import                                                                       |
| Database    | Neon PostgreSQL + Prisma (new `packages/database`), NUMERIC for money and quantities, reviewed migrations                                                      |
| Auth        | Better Auth (new `packages/auth`); seeded super-admin; dynamic roles of fixed action IDs                                                                       |
| Client data | TanStack Query through the existing `DistributionService` port. A new HTTP adapter replaces the mock in normal use; the mock stays for tests and demos         |
| Import      | `packages/importer`: reads one month sheet by headers and turns it into the same commands as manual entry                                                      |

These existing patterns stay:

- the query-key factory and `postingEffects` invalidation
- idempotent posting by request key
- company scoping in every query
- server-side redaction of cost and profit by permission
- the module boundaries in `eslint.config.mjs`

Money and quantities are `Decimal` in code, NUMERIC in Postgres and strings in JSON.

## 4. The month engine (heart of the system)

```text
computeMonth(input: {
  opening: per product { stock, dueFromCompany, orderPrice, costPrice, salePrice },
           marketDue, staffBalances, cashAccounts
  days:    per date { per product { ordered, received, prices?, damaged },
                      per DSR { per product { issue, return, priceSplits?, damaged } },
                      money entries (typed) }
}) → {
  days:    per date per product (all §2.3 values), per date money (§2.4)
  month:   per product / per person / market due / staff / profit (§2.5)
  closing: next month's opening (same shape as input.opening)
}
```

- It is pure and deterministic: no database or I/O.
- The closing of month N is the opening of month N+1. Opening balances entered at go-live are
  simply the first opening.
- Posted documents are converted into `days` by the application layer. Reports call the engine
  over a date range; stored balances, such as stock per product, are checked against the engine
  in tests.
- Tests use synthetic golden fixtures committed to the repo. `pnpm verify:workbook` runs the
  real-workbook comparison locally when `docs/*.xlsx` exists and is skipped otherwise. The
  workbook holds real business data and is never committed.

## 5. Data model (Postgres)

All rows carry `tenant_id`, and company-owned rows carry `company_id`.

- **Organization and access:** `tenant`, `company`, `company_module`, `user`, `membership`,
  `role`, `role_permission`, `audit_event`, `idempotency_record`.
- **Configuration (guide §4.4):** `expense_category`, `reason_code`, `staff_role`, `cash_account`,
  `setting`.
- **Catalog:**
  - `product` (company, code, name, aliases)
  - `product_pack` (carton size, effective from)
  - `price_change` (product, kind order|cost|sale, price, effective date): the effective price on
    a date is the latest change on or before it. This is Excel's carry-forward.
- **Parties:** `supplier`, `staff` (employer supplier|distributor), `staff_assignment` (company,
  role, from/to).
- **Opening:** `opening_session` (company, cutoff date, status), with lines for:
  - stock (product, pieces, cost, sale price, order price, optional lot/expiry)
  - company due quantity
  - market due (DSR or legacy) and shop due per shop (D38)
  - staff balance (type)
  - SR balance (type)
  - company account
  - cash account
- **Daily documents:** each one is posted once and immutable after posting, with reversal plus
  re-entry for corrections. Each lists the stock or balances it affects:

  | Document                                       | Effect                                                                                                                                   |
  | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
  | `purchase_order` / lines                       | Company due quantity                                                                                                                     |
  | `goods_receipt` / lines                        | Stock, company due quantity, and optional batch/lot/expiry for stock quantity only (D29)                                                 |
  | `dsr_day` (company, DSR, date; D03) / lines    | Per product: issue, return, damage and price splits, with carton-size and price snapshots; plus market due (বাকি) and credit for the day |
  | `expense`                                      | Operating cost and month expenses by category                                                                                            |
  | `sr_entry`                                     | Loan, repayment, owed, payment, incentive (D:Comition) (D18, D20)                                                                        |
  | `staff_money_entry` + `staff_money_allocation` | D27                                                                                                                                      |
  | `supplier_deposit`                             | Banking (D19)                                                                                                                            |
  | `damage_case` legs                             | D17                                                                                                                                      |
  | `field_visit` / lines (DSR, shop, date; D40)   | None until the DSR day is posted; posting writes per-shop due/collection entries and exchange custody, and locks the visits              |
  | `payroll_run` / lines                          | D24, D25                                                                                                                                 |

- **Derived ledgers:** append-only `stock_movement`, plus `market_due_item` and
  `due_collection_allocation`.
- **Period:** `month_close` (company, month, closing snapshot, locked by, at). A closed month
  rejects new or backdated postings unless an authorized user reopens it.
- **Import:** `import_job` (file hash, sheet, mapping, comparison report, status).

## 6. API (Route Handlers, `/api/v1`)

All write endpoints take a `requestKey`, are idempotent, check membership, module and permission,
and return contract DTOs. Errors use the existing `ServiceError` codes.

| Area          | Endpoints                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session       | `/api/auth/*` (Better Auth), `GET /me`, `GET /companies`, `GET /companies/{c}`                                                                                                                                                                                                                                                                                                   |
| Masters       | `products` (+ `packs`, `prices`), `suppliers`, `staff`, `staff-assignments`, `roles`, `expense-categories`, `cash-accounts`, `settings` (CRUD; deactivate, never delete once used)                                                                                                                                                                                               |
| Opening       | `GET/PUT /companies/{c}/opening`, `GET …/opening/template`, `POST …/opening/import`, `POST …/opening/activate`                                                                                                                                                                                                                                                                   |
| Daily entry   | `purchase-orders`, `goods-receipts`, `dsr-days` (`GET ?date=`, `PUT` draft, `POST …/post`, `POST …/reverse`), `collections`, `expenses`, `sr-entries`, `staff-money-entries`, `supplier-deposits`, `damage-cases`                                                                                                                                                                |
| Day and month | `GET /companies/{c}/days/{date}` (the workbook day block with every §2.3–2.4 value), `GET /companies/{c}/months/{yyyy-mm}` (§2.5), `POST …/months/{m}/close`, `POST …/months/{m}/reopen`                                                                                                                                                                                         |
| Reports       | `stock`, `sales`, `profit` (gross and net), `market-due`, `company-due`, `staff-statement/{staffId}`, `sr-statement/{srId}`, `cash-book`, `damage`, `cartons`, `person-sales`, `dsr-daily` (D39), `company-account` (the supplier ledger: opening row, bills, deposits, incentives, refunds, free-goods memo, running payable) (all with date range; export CSV/XLSX; printable) |
| Setup         | `GET /companies/{c}/setup` (the 9-step go-live checklist, computed on the server)                                                                                                                                                                                                                                                                                                |
| Field (D40)   | `GET /companies/{c}/field/day` (own day; `?staffId=` for the office), `POST …/field/visits`, `PUT/DELETE …/field/visits/{id}`, `POST …/field/shops`, `POST …/staff/{s}/login`                                                                                                                                                                                                    |
| Payroll       | `payroll-runs` (create, review recovery, approve, pay)                                                                                                                                                                                                                                                                                                                           |
| Import        | `POST /companies/{c}/imports` (upload + sheet), `GET …/imports/{id}` (mapping, preview, comparison), `POST …/imports/{id}/commit`                                                                                                                                                                                                                                                |
| Admin         | `users`, `memberships`, `roles`, `audit`                                                                                                                                                                                                                                                                                                                                         |

## 7. Opening balances

Opening balances are entered once per company at go-live, on screen (D36: no Excel import or
template). Validation:

- negative stock is rejected
- blank means unknown, not zero
- an explicit zero is allowed

Opening values become the engine's first `opening`. Stock is entered in cartons + pieces and
stored as pieces; carton sizes come from `setup/cartons` (D37). The `setup` page shows nine steps (company, products and
cartons, staff with monthly salary, opening stock, supplier opening, staff opening, shops and
dues, business opening, activation), each computed on the server, ending with "আমরা শুরু করতে প্রস্তুত".

## 8. Excel month import (removed, D36)

The app does not import Excel. Openings and every day are entered in the app. `packages/importer`
keeps the header-driven month-sheet reader only for `pnpm verify:workbook` (local evidence that
the engine reproduces the workbook, §2.1) and the report export (CSV/XLSX).

## 9. Phases

Each phase ends with working software, passing `pnpm check`, real-database integration tests from
Phase B onward, and an updated `implementation-status.md`.

| Phase                               | Deliverable                                                                                                                                                                                                                    | Exit check                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **A. Month engine**                 | `computeMonth` in `packages/domain` (Decimal), golden fixtures, `pnpm verify:workbook`                                                                                                                                         | Aug 2026 100 % match; Sep 2026 100 % except §2.6 items                                         |
| **B. Backend foundation**           | `packages/database` (Prisma, Neon dev + test branch or local Postgres), `packages/auth` (Better Auth, super-admin seed), `packages/application`, `/api/v1` skeleton, audit, idempotency, HTTP adapter behind the existing port | Login; companies and products CRUD through the real DB; isolation and idempotency tests pass   |
| **C. Masters and configuration**    | Products with carton sizes and price history, suppliers, staff with roles and assignments, expense categories, cash accounts, roles and users screens                                                                          | Adding a second company with different products needs no code change (T62)                     |
| **D. Opening balances**             | Opening screen with validation; activation                                                                                                                                                                                     | Activation is atomic and idempotent; the engine's first opening equals the entered values      |
| **E. Daily entry**                  | Godown day (orders, receipts, prices), DSR day sheet (issue/return in cartons + pieces per DSR, damage, price splits, বাকি, credit), money entries (expenses, D:Comition, staff money, SR, banking), day view                  | Entering August's raw facts through the API reproduces August's closing and daily cash exactly |
| **F. Month view, reports, closing** | Month page (workbook right side), all §6 reports with export, month close/reopen                                                                                                                                               | Month figures equal the engine; a closed month blocks backdating                               |
| **G. Staff, SR, payroll, damage**   | Staff money accounts and statements (D27), SR accounts (D18), payroll with recovery (D24, D25), damage replacement legs (D17)                                                                                                  | T55–T58 and T25–T27 pass                                                                       |
| **H. Excel import**                 | Removed 2026-10-09 (D36); only the reader behind `pnpm verify:workbook` remains                                                                                                                                                | —                                                                                              |
| **Go-live readiness**               | Built 2026-10-09: carton setup + one-time carton load (D37), opening cartons + shop dues (D38), setup checklist, monthly salary, free goods (D16), cash handover (D39), `dsr-daily` report, print, DSR field panel (D40)       | Integration tests for each; browser walkthrough before go-live                                 |
| **I. Go-live**                      | Production Neon + hosting, backups and a restore drill, security review, Bangla print checks, user training, Drinko opening on 1 November 2026                                                                                 | Opening approved by the owner; first live day balances                                         |

The existing prototype screens (receipts, daily summaries, collections, stock, batches, suppliers,
staff, dashboard) move onto the API in phases C–F. Two changes come with that move:

- Their cost and profit switch to D29.
- The daily summary takes বাকি (new due) as input, with cash derived as sales − বাকি, matching
  Excel.

## 10. Open items (none blocks Phase A or B)

- P01: rounding (provisional ROUND_HALF_UP to 2 places for money).
- P07: how a real SR's workbook Sort/Over columns import (the importer refuses them for now).
- P02: Drinko vs PRAN naming.
- P03: go-live dates for other companies.
- P04: pack sizes where grids disagree.
- P05: September's missing receipts, entered by the owner before the opening.
- P06: discount and return policy.
