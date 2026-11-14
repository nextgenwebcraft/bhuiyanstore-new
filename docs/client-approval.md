# Client approval record

Gate before any production API integration (guide §6.4, §17 Phase 2). Approvals reference stable
action IDs from `docs/action-catalog.generated.md` (generated from the typed action registry once
it exists) and an identified prototype version.

**Status: backend integration approved by the owner on 2026-10-02 (D30).** Screen-by-screen action
approvals are still recorded below as each screen moves onto the API.

## Review sessions

| Date       | Prototype version/commit                             | Reviewer | Scope reviewed                                                                 | Outcome                                                                                                                                    |
| ---------- | ---------------------------------------------------- | -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-02 | Working tree after the receipt/sale/collection slice | Owner    | Whole-project direction; workbook calculations (PLAN §2); costing method (D29) | Approved: start the real database + API immediately (PLAN §9 phases A–I); profit uses the Excel cost method; batches track quantity/expiry |

## Action decisions

| Action ID | Screen | Visual | Calculation | Decision | Reviewer | Date | Version |
| --------- | ------ | ------ | ----------- | -------- | -------- | ---- | ------- |

## Change requests

| ID  | Raised | Description | Status |
| --- | ------ | ----------- | ------ |
