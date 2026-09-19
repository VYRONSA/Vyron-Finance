-- Down script for 0105_document_number_sequences.sql.
--
-- Drops the counter table and both functions. Safe for the ledger: this
-- migration never wrote to `sales_invoices`, so every document number
-- already issued stays exactly as it is and no accounting record is
-- touched.
--
-- What IS lost is the counters' current position. After this runs, the
-- application falls back to whatever generator it has (pre-5J: the
-- `COUNT(*) + 1` behaviour, with its race). Re-applying 0105 reseeds each
-- counter from the highest number already issued, so numbering resumes
-- correctly — the state is derivable, which is why dropping it is
-- acceptable.
--
-- Run the application rollback FIRST. `createSalesInvoice` calls
-- `next_document_number` via RPC; dropping the function under a running
-- 5J build makes every invoice creation fail.

drop function if exists next_document_number(uuid, text);
drop function if exists document_number_prefix(text);
drop table if exists document_number_sequences;
