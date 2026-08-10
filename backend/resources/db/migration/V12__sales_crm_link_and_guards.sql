-- Sales CRM linkage + the manual-review flag the 5A pricing tables call for.
-- Flyway migration, OceanBase / MySQL dialect. All DDL lives here, never in code.
--
-- Naming rule for this migration: columns copied from Sales CRM keep **their Sales CRM
-- field name exactly**, so anyone holding a salescrm.ninjavan.co record open can match
-- them by eye. That is why `stage` sits next to `status` — `stage` is Sales CRM's,
-- `status` is ours. They are not the same field and must not be merged.

-- ---------------------------------------------------------------- opportunity link
-- Sales CRM Opportunity.id. UNIQUE is the whole point: the sync polls the same
-- newest-first list every few minutes and will re-see opportunities it already
-- imported, so the database — not the worker — guarantees one ticket per opportunity.
-- NULL for tickets raised directly in this app.
ALTER TABLE tickets
    ADD COLUMN opportunity_id   VARCHAR(40)  NULL AFTER ticket_ref,
    ADD COLUMN opportunity_name VARCHAR(255) NULL AFTER opportunity_id,
    ADD COLUMN stage            VARCHAR(40)  NULL AFTER opportunity_name,
    ADD COLUMN parent_stage     VARCHAR(40)  NULL AFTER stage,
    ADD UNIQUE KEY uq_tickets_opportunity (opportunity_id);

-- ---------------------------------------------------------------- account level
-- Sales CRM tracks a shipper at two levels and hangs the opportunity off the child.
-- PNS mirrors both: account_id is the account the opportunity belongs to,
-- parent_account_id is the group above it (sparse in Sales CRM — only ~12% of
-- accounts carry one — so it is nullable and must never be assumed present).
ALTER TABLE shippers
    ADD COLUMN account_id               VARCHAR(40)  NULL AFTER global_shipper_id,
    ADD COLUMN parent_account_id        VARCHAR(40)  NULL AFTER account_id,
    ADD COLUMN account_name             VARCHAR(255) NULL AFTER parent_account_id,
    ADD COLUMN customer_success_manager VARCHAR(120) NULL AFTER account_name,
    ADD KEY idx_shippers_account (account_id),
    ADD KEY idx_shippers_parent (parent_account_id);

-- ---------------------------------------------------------------- manual review
-- 5A marks whole cells "Manual Review" — managed accounts at any band, and the
-- >= 30 Mio band for both FTL tables. Those cannot be settled by comparing a number,
-- so the ticket carries a flag and routes to PSP rather than straight to proposal.
ALTER TABLE tickets
    ADD COLUMN manual_review TINYINT(1) NOT NULL DEFAULT 0 AFTER below_bottom;

-- Hypercare and Strategic solutions are signed off by Alex (CSalesO) and Dhinesh (COO)
-- outside this app for now. The toggle records that it happened and who confirmed it,
-- so the charter can state it without the approval itself living here yet.
ALTER TABLE tickets
    ADD COLUMN exec_signoff    TINYINT(1)   NOT NULL DEFAULT 0 AFTER manual_review,
    ADD COLUMN exec_signoff_by VARCHAR(255) NULL AFTER exec_signoff,
    ADD COLUMN exec_signoff_at DATETIME     NULL AFTER exec_signoff_by;

-- Hypercare joins Strategic as a managed tier. acct_type is already VARCHAR(20) so
-- no column change is needed — existing rows predate the third value and are left as-is.
