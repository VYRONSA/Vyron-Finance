-- Master Implementation Tracker — Programme 4, Epic E8, Finding #050.
--
-- Depreciation Run and Disposal postings hardcoded 2/5 GL account codes
-- respectively regardless of which Asset Class the asset belonged to
-- (`asset-lifecycle-engine.ts::buildDepreciationRunJournalLines`/
-- `buildAssetDisposalJournalLines`) — `asset_classes` had no GL account
-- columns at all to vary them by. Nullable — a class that doesn't
-- override an account falls back to the platform default (the exact
-- codes these functions hardcoded before this migration), so every
-- existing asset/class posts identically until a class is explicitly
-- given its own accounts.
--
-- Disclosed scope boundary: this closes the actual posting-layer defect
-- (the engine can now vary by class) — there is no Asset Class
-- management UI in this platform yet at all (not even to create/rename
-- one), so setting non-default values today requires a direct data
-- change. Building that UI is a separate, larger gap this Finding's own
-- sizing ("small/scoped — migration + engine grouping") did not include.
alter table asset_classes
  add column gl_asset_account_code text,
  add column gl_accumulated_depreciation_account_code text,
  add column gl_depreciation_expense_account_code text,
  add column gl_accumulated_impairment_account_code text,
  add column gl_gain_on_disposal_account_code text,
  add column gl_loss_on_disposal_account_code text;
