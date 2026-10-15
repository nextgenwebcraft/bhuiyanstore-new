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

   Opening balances are entered on screen, section by section; each section is live as soon as it is
   saved (D43, §7).

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
| Pieces ordered from the company     | `C` Due Quantity                                | Per product; D57: carton rate (taka per carton) and free pieces on the order line                                                                         |
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
sales         = Σ sold pieces × their batch sale price         Excel P = (M−N)×O; with one batch this is sold × sale_price; − commission D41, D49
cost          = Σ (delivered + replaced from stock + godown damaged) pieces × their batch cost (FIFO, D49; one batch = × cost_price)  Excel Q = (M−N)×H on sold only; the engine charges every delivered piece (D47) and every piece found damaged in the godown (D53)
gross_profit  = sales − cost                                   Excel S
return_value  = returned × sale_price                          Excel R (report only)
order_value   = ordered × order_price                          Excel F; billed on the order day (D48)
              (D57: with a carton rate, order_value = Σ order pieces × carton_rate ÷ pieces_per_carton; free pieces add to the undelivered quantity only)
receipt_bill  = excess × order_price                           Excel I bills every received piece; D48 bills only excess = received − min(received, due + ordered)
due_value     = Σ order bills − value released on receipt      D48: billed value of goods not yet received (proportional; 0 when due is 0)
receipt_sale  = received × sale_price                          Excel J (report only)
due_from_co   = max(0, previous due_from_co + ordered − received)  Excel D (W7 = D7+V7−Z7), floored at 0 (D46)
stock         = previous stock + received − delivered          Excel T (AM7 = T7+Z7−AF7)
                + company replacements + free goods            (D17, D16; no Excel column)
                − replaced from stock − godown damaged         (D17, D53)
damaged_stock = previous + sheet damaged + godown damaged      D53: damaged goods held here, not saleable
                + buyer pieces taken in at the godown (replaced from stock)
                − dispatched to the company + rejected back − written off
damage_at_co  = previous + dispatched − rejected               D53: pieces the company holds awaiting its decision
                − company replacement pieces − company refund pieces
stock_value   = Σ batch quantity × batch cost                  Excel U = stock × cost_price (identical while one batch exists)
person_net    = person issue − person return                   Excel J45, Q45 (the software uses subtraction, always)
person_amount = person_net × sale_price − commission           Excel C45, R45 (report only)
commission    = Σ over DSR lines (taka given to shops, D41)     lowers sales, the DSR's expected cash and profit
```

**Batches, FIFO (D49).** Stock is a list of batches per product, oldest first, derived from posted
facts (no table): `{seq, startDate, costPrice, salePrice, quantity}`.

- A receipt with a cost or sale price different from the newest batch is a new batch (seq + 1); the
  same prices merge into the newest batch; a negative newest batch (deficit) is filled first. A
  price change on a day without a receipt re-prices the newest batch only. Free goods and company
  replacements are zero-cost batches at the current sale price (merged only into a newest batch with
  cost 0 and the same sale price).
- **Receipt cost (D57).** The cost of a receipt's batch is its billed value per piece:
  `receiptValue ÷ received`, where `receiptValue` = the undelivered value released (orders' bills,
  free pieces counted in the quantity, so free goods lower the cost) + the excess billed at the
  current order price. The cost price typed at a receipt no longer decides the batch. The sale price
  is still the receipt day's price.
- Inflows come before outflows. Each DSR line (input order) takes its net pieces from the oldest
  batches: allocation `[{seq, quantity, costPrice, salePrice}]`. Sold pieces are the first
  `sold` allocated ones, damaged pieces the rest; price-split pieces are the first sold pieces and
  adjust against the batch sale price they replace. When all batches are used up the newest batch
  goes negative (NEGATIVE_STOCK warning, valued at its prices); a negative net returns pieces to the
  oldest batch. Then replaced-from-stock and godown damage take FIFO too.
- `stock` = Σ batch quantity; zero older batches disappear (the newest stays for merging, hidden
  at 0). The current product prices (display, MISSING_PRICE) are the carry-forward prices = the
  newest batch; the order price is a company bill price, not part of a batch.

Damaged pieces leave saleable stock as part of `delivered` and earn no revenue, but their cost is
charged like any delivered piece, so profit falls by their full sale value (D47). The good piece
handed to a buyer from the godown also charges its cost to the day. A damaged item
received from a buyer goes to damaged stock, and the company replacement is tracked separately
(D17). It never adds back to saleable stock silently.

**Godown damage (D53).** A godown stock entry of kind `damage` (pieces found damaged in the
godown) is the engine input `godownDamaged`: saleable stock falls, the cost (quantity × cost price)
is charged so gross profit falls, `damage_value` rises, damaged stock rises, and there is no sales
effect. The product-level `damaged` input (Excel N) remains only for the workbook reader
(`verify:workbook`).

Damage cases (D17, D53) feed the engine through their posted legs:

- **Replaced from stock:** a good piece handed to a buyer straight from the godown (not on a DSR
  sheet). It leaves stock, counts in the damage value, is not a sale, and the buyer's damaged piece
  enters damaged stock. It is refused on a case linked to a DSR day: those pieces were handed out on
  the sheet already.
- **Company replacement:** pieces the company sends back for accepted damage. They add to stock
  with no bill, no due from the company and no payable, as their own batch at cost 0 (the D49 batch
  task). `replacement_value` = quantity × the reviewed unit cost, a memo.
- **Company damage money refund:** lowers what we owe the company only. It is **not profit**
  (D47 amendment): the figure stays a memo ("ড্যামেজ বাবদ ফেরত") on the company account page and in
  the damage report.
- **Dispatch, reject, write-off:** damaged-goods custody (`damaged_stock`, `damage_at_co`) only; no
  money or profit effect, because the loss was charged when the damage happened. A company reject
  returns the pieces to the case's still-here quantity.

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

**Cash and bank book (D52).** `cash_left` is a daily view; the authoritative balance of each cash,
bank and mobile account is the book. Every money entry whose kind moves cash (`cash` ≠ 0 in
`MONEY_KIND_EFFECTS`), a supplier deposit and the new `cashTransfer` carry an optional account
(`money_entry.cash_account_id`; a transfer also `to_cash_account_id`). When omitted, the entry gets
the company's default account: the first `cash`-kind account among the opening's cash lines, else
the tenant's first active one (a supplier deposit: the tenant's first bank account, else that
default); with no account at all the engine uses the bucket `""` ("হিসাব নির্ধারিত নয়"). Movements:
the entry's amount in or out by its direction; each day's `day_sales` into the default cash account
(market due given and collected and the handover difference are money entries, so the account ends
at the real cash); a supplier deposit out of its account while `cash_left` still ignores it; a
transfer out of one account and into another with no other effect. Opening balances come from the
opening's cash lines; the month close stores each account's closing balance
(`closing.cashAccounts`). A snapshot stored before the book has none: the engine starts the accounts
at 0 and warns `CASH_SNAPSHOT_MISSING` once (reopening and closing again fixes it).

**DSR cash handover (D54, replaces D39 "display only").** Posting a DSR day sheet with the cash
handed over entered settles `difference = handed over − expected` (expected = sales − new due +
collected − DSR expenses): below 0 posts a `staffShortage` of the difference, above 0 a
`staffExcess`, both on the DSR, dated the sheet's day, linked to the day (`dsr_day_id`) and in the
default cash account. They are owned by the day: individual reversal is refused and reversing the
day reverses them.

**SR owed (D55).** `srOwed` is an incentive the SR earned and we have not paid: it adds to the
month's SR incentive expense on its entry date (no cash) and raises what we owe the SR. `srPayment`
lowers it with cash out and no expense. `srIncentive` (paid in cash at once) is unchanged.

### 2.5 Month calculations

```text
per product: receipt_total = Σ receipt_bill (excess only, D48)  Excel "Total Receive amount in Tk" (every received piece)
             sales_total   = Σ sales                  "Total sale in Tk"
             profit_total  = Σ gross_profit           "Total Profit"
             closing_stock = stock on the last day    "present stock Per Pice"
             closing_value = Σ batch quantity × batch cost (D49)         "present stock Amount"
             closing_at_sale = Σ batch quantity × batch sale price (D49)      "total product Sale price"
             due_from_co_value = due_value (billed value of the undelivered goods, D48)   "Balance Quantity amount"
             order_total   = Σ order_value (billed on the order day, D48)   "Total du Product amount"
             closing_cartons = closing_stock ÷ carton size             "present Stock Per Caton"
             sales_cartons = Σ delivered ÷ carton size                 "Total sales per Product"
             damage_value  = Σ (damaged + replaced_from_stock + godown_damaged) × cost_price   "Dmage Product Amount"
             damaged_stock, damage_at_co = the last day's values (D53)
             replacement_value = Σ company replacement quantity × unit cost (D17, report only)
per person:  month_net = Σ person_net; cartons = month_net ÷ carton size; amount = Σ daily person_amount
market due:  closing = opening + Σ new market due − Σ credit           Excel "Total Due" (row 42)
staff:       per person, owes us / we owe (D27); Excel net = Σ Sort − Σ Over − salary adjustment (row 42)
             statement line per money entry = its change to each balance + the balances after it
             payroll: recovery = advance → loan → shortage, capped at salary; Cash Pabe = salary − recovery
profit:      gross = Σ gross_profit
             net   = gross − salaries − operating cost − month expenses − D:Comition (D20; D55 adds srOwed)
             damage refunds and replacement goods are not profit (D47 amendment); the company's
             money incentive (D33) changes the company balance only, never profit
company:     payable closing = opening + Σ order bills + Σ excess receipt bills − deposits
                               − money incentives − damage refunds     (negative = money with the company, D48)
             balance shown = −payable ("কোম্পানিতে জমা"); undelivered value = Σ due_value
             Σ order bills + Σ excess bills = Σ goods received at bill + closing undelivered − opening undelivered
cash book:   per account (D52), closing = opening + inflows − outflows, where inflows include the
             day's sales cash and transfers in (not Excel's cash_left, which is a daily view)
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
  closing: next month's opening (same shape as input.opening; per product also the FIFO batches, D49)
}
```

- It is pure and deterministic: no database or I/O. Batches (D49) are engine state carried in the closing; no table stores them.
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
- **Opening:** `opening_session` (company, cutoff date, version; live once the cutoff date is saved, D43), with lines for:
  - stock (product, pieces, cost, sale price, order price, optional lot/expiry)
  - company due quantity
  - market due (DSR or legacy) and shop due per shop (D38)
  - staff balance (type)
  - SR balance (type)
  - company account
  - cash account
- **Daily documents:** each one is posted once and immutable after posting, with reversal plus
  re-entry for corrections. Each lists the stock or balances it affects:

  | Document                                       | Effect                                                                                                                                                          |
  | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `purchase_order` / lines                       | Company due quantity                                                                                                                                            |
  | `goods_receipt` / lines                        | Stock, company due quantity, and optional batch/lot/expiry for stock quantity only (D29)                                                                        |
  | `dsr_day` (company, DSR, date; D03) / lines    | Per product: issue, return, damage, shop commission (D41) and price splits, with carton-size and price snapshots; plus market due (বাকি) and credit for the day |
  | `expense`                                      | Operating cost and month expenses by category                                                                                                                   |
  | `sr_entry`                                     | Loan, repayment, owed, payment, incentive (D:Comition) (D18, D20)                                                                                               |
  | `staff_money_entry` + `staff_money_allocation` | D27                                                                                                                                                             |
  | `supplier_deposit`                             | Banking (D19); leaves its cash/bank account (D52). `cashTransfer` moves money between two accounts (D52)                                                        |
  | `damage_case` legs                             | D17                                                                                                                                                             |
  | `field_visit` / lines (DSR, shop, date; D40)   | None until the DSR day is posted; posting writes per-shop due/collection entries and exchange custody, and locks the visits                                     |
  | `payroll_run` / lines                          | D24, D25                                                                                                                                                        |

- **Derived ledgers:** append-only `stock_movement`, plus `market_due_item` and
  `due_collection_allocation`.
- **Period:** `month_close` (company, month, closing snapshot, locked by, at). A closed month
  rejects new or backdated postings unless an authorized user reopens it.
- **Import:** `import_job` (file hash, sheet, mapping, comparison report, status).

## 6. API (Route Handlers, `/api/v1`)

All write endpoints take a `requestKey`, are idempotent, check membership, module and permission,
and return contract DTOs. Errors use the existing `ServiceError` codes.

| Area          | Endpoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session       | `/api/auth/*` (Better Auth), `GET /me`, `GET /companies`, `GET /companies/{c}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Masters       | `products` (+ `packs`, `prices`), `suppliers`, `staff`, `staff-assignments`, `roles`, `expense-categories`, `cash-accounts`, `settings` (CRUD; DELETE only when unused, otherwise deactivate; company creation seeds a synthetic starter dataset and the standard lists, D51)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Opening       | `GET /companies/{c}/opening`, `PUT …/opening/cutoff` (go-live date), `PUT …/opening/section` (one section: `stock`, `marketDue`, `shopDue`, `staff`, `company` or `cash`; D43)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Daily entry   | `purchase-orders`, `goods-receipts`, `dsr-days` (`GET ?date=`, `PUT` draft, `POST …/post`, `POST …/reverse`), `collections`, `expenses`, `sr-entries`, `staff-money-entries`, `supplier-deposits`, `damage-cases`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Day and month | `GET /companies/{c}/days/{date}` (the workbook day block with every §2.3–2.4 value), `GET /companies/{c}/months/{yyyy-mm}` (§2.5), `POST …/months/{m}/close`, `POST …/months/{m}/reopen`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Reports       | `stock`, `sales`, `profit` (gross and net), `market-due`, `company-due` (pieces ordered but not yet received and their billed value; never negative, floored at 0, D46; the order is billed at once, D48), `staff-statement/{staffId}`, `sr-statement/{srId}`, `cash-book`, `damage`, `cartons`, `person-sales`, `dsr-daily` (D39), `company-account` (D48: the money deposited with the company: opening row, order bills, receipts (pieces, excess bill), deposits, money incentives and damage money returns in, free-goods and replacement memos, with the running balance (−payable) and undelivered value; any range or all time from the go-live cutoff, no 365-day limit) (all with date range; export CSV/XLSX; printable) |
| Dashboard     | `GET /companies/{c}/dashboard?from&to` (D44): the totals summed over the range (sales, gross profit and received/stock value only with their permissions, cash collected, market due new/collected/closing, per-DSR rows) from one engine run; same range rules as reports (`to` stops at today, at most a year); needs `company.view`                                                                                                                                                                                                                                                                                                                                                                                              |
| Setup         | `GET /companies/{c}/setup` (the go-live steps, computed on the server; shown on the opening page, D43)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Field (D40)   | `GET /companies/{c}/field/day` (own day; `?staffId=` for the office), `POST …/field/visits`, `PUT/DELETE …/field/visits/{id}`, `POST …/field/shops`, `POST …/staff/{s}/login`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Payroll       | `payroll-runs` (create, review recovery, approve, pay)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Import        | `POST /companies/{c}/imports` (upload + sheet), `GET …/imports/{id}` (mapping, preview, comparison), `POST …/imports/{id}/commit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Admin         | `users`, `memberships`, `roles`, `audit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 6.1 Navigation and dashboard (D44)

The sidebar is nine hubs, each a row of tabs shown above the page (`apps/web/src/features/shell/navigation.ts`
owns both the access rules per path and the hubs): ড্যাশবোর্ড, দৈনিক বিক্রয় হিসাব, মাল ও মজুদ, দোকান,
টাকার লেনদেন, খাতা ও ব্যালান্স, মাস শেষে, প্রারম্ভিক তথ্য, সেটআপ (Alt+1…9). A hub shows when at least one of its
tabs is open to the person; its link goes to the first such tab. There are no separate day, month, stock, money or
staff report screens and no samari/firot screens: the dashboard shows every report for a period chosen at the top
(today by default; this month, last month, an earlier month back to the opening cutoff, or a year; kept in
`?period=`). It opens with the summary (the range summary above), today's work checklist (today only), then the
reports by DSR, sales and profit; cash, stock, market due, company account, damage and staff balances open on demand
and fetch only then. The month screen stays under মাস শেষে for closing and reopening and links to the dashboard
for that month.

## 7. Opening balances

Opening balances are entered once per company at go-live, on screen (D36: no Excel import or
template). Validation:

- negative stock is rejected, and so is stock with pieces but no unit cost
- a blank counts as 0 in every calculation and shows its section as pending (D43); blanks never
  block a save
- an explicit zero is allowed

Opening values become the engine's first `opening`. Stock is entered in cartons + pieces and
stored as pieces; carton sizes come from `setup/cartons` (D37). The opening is **save = live** (D43): there is no approve or
activate step. The `admin/opening` page shows the go-live date, what the opening needs first
(products with carton sizes, staff with monthly salary, shops) and one card per section (stock,
market due, shop due, staff, company, cash). A section saves on its own and takes effect at once;
the go-live date makes the opening live. It stays editable until the company's first month is
closed (then locked until the months are reopened), and the go-live date is fixed once any daily
record exists. Opening prices are written as catalog prices at the go-live date on each stock save.
The setup steps are computed on the server (`GET /setup`).

## 8. Excel month import (removed, D36)

The app does not import Excel. Openings and every day are entered in the app. `packages/importer`
keeps the header-driven month-sheet reader only for `pnpm verify:workbook` (local evidence that
the engine reproduces the workbook, §2.1) and the report export (CSV/XLSX).

## 9. Phases

Each phase ends with working software, passing `pnpm check`, real-database integration tests from
Phase B onward, and an updated `implementation-status.md`.

| Phase                               | Deliverable                                                                                                                                                                                                                                              | Exit check                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **A. Month engine**                 | `computeMonth` in `packages/domain` (Decimal), golden fixtures, `pnpm verify:workbook`                                                                                                                                                                   | Aug 2026 100 % match; Sep 2026 100 % except §2.6 items                                           |
| **B. Backend foundation**           | `packages/database` (Prisma, Neon dev + test branch or local Postgres), `packages/auth` (Better Auth, super-admin seed), `packages/application`, `/api/v1` skeleton, audit, idempotency, HTTP adapter behind the existing port                           | Login; companies and products CRUD through the real DB; isolation and idempotency tests pass     |
| **C. Masters and configuration**    | Products with carton sizes and price history, suppliers, staff with roles and assignments, expense categories, cash accounts, roles and users screens                                                                                                    | Adding a second company with different products needs no code change (T62)                       |
| **D. Opening balances**             | Opening cards with per-section save; live on save (D43)                                                                                                                                                                                                  | Each section save is atomic and idempotent; the engine's first opening equals the entered values |
| **E. Daily entry**                  | Godown day (orders, receipts, prices), DSR day sheet (issue/return in cartons + pieces per DSR, damage, price splits, বাকি, credit), money entries (expenses, D:Comition, staff money, SR, banking), day view                                            | Entering August's raw facts through the API reproduces August's closing and daily cash exactly   |
| **F. Month view, reports, closing** | Month page (workbook right side), all §6 reports with export, month close/reopen                                                                                                                                                                         | Month figures equal the engine; a closed month blocks backdating                                 |
| **G. Staff, SR, payroll, damage**   | Staff money accounts and statements (D27), SR accounts (D18), payroll with recovery (D24, D25), damage replacement legs (D17)                                                                                                                            | T55–T58 and T25–T27 pass                                                                         |
| **H. Excel import**                 | Removed 2026-10-09 (D36); only the reader behind `pnpm verify:workbook` remains                                                                                                                                                                          | —                                                                                                |
| **Go-live readiness**               | Built 2026-10-09: carton setup + one-time carton load (D37), opening cartons + shop dues (D38), setup steps (folded into the opening page, D43), monthly salary, free goods (D16), cash handover (D39), `dsr-daily` report, print, DSR field panel (D40) | Integration tests for each; browser walkthrough before go-live                                   |
| **I. Go-live**                      | Production Neon + hosting, backups and a restore drill, security review, Bangla print checks, user training, Drinko opening on 1 November 2026                                                                                                           | Opening saved and checked by the owner; first live day balances                                  |

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
