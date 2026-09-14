-- Fulfillment is priced by PNS, on every account tier and at every revenue band
-- (Michael, 2026-09-14).
--
-- WHY
--   route() tests the account tier, then a list of services that are PNS's whatever the
--   tier, then the revenue band. Fulfillment was not on that list, so a Standard
--   Fulfillment deal fell through to the revenue test and came out "priced by Sales,
--   PNS reviews after". That is the wrong SHAPE, not merely the wrong tier: a review
--   afterwards assumes Sales could price it in the first place.
--
--   SOF-7001320, PT Catur Sentosa Adiprana, was sitting in the Sales pricing queue at
--   Rp 50.000.000 when Michael found it.
--
-- WHAT THIS DOES
--   The code change fixes every future routing decision -- imports, intake edits, and
--   the sweep whenever it re-derives. It does NOT touch tickets already routed, because
--   route() is only consulted when something changes. This file moves those.
--
--   resp becomes PNS and needs_review is cleared, which is what route() now returns for
--   this service. A ticket at 'Pending Sales' moves to 'Pending PNS' with it, because a
--   ticket waiting on Sales to price something Sales does not price is waiting on
--   nobody.
--
-- WHAT THIS DELIBERATELY LEAVES ALONE
--   * Managed accounts (Hypercare, Strategic) already routed to PNS by tier. The WHERE
--     only writes rows that would actually change, so they are untouched either way.
--   * Anything at a REVIEW gate. A ticket at 'Pending Review - PNS' is mid-flight: Sales
--     have already priced it and a PNS member is reading that price. Clearing the review
--     flag under them would drop the ticket out of the gate it is sitting in, which is a
--     worse outcome than one deal finishing under the old rule.
--   * Decided tickets -- Lost, Cancel, Proposal Accepted / Ready to Ship. Re-routing a
--     closed deal changes a historical record to no purpose.
--
-- Highest migration before this was V33. This file was written as V32 and renumbered
-- before it was committed: V32 and V33 were both taken by the operational-onboarding
-- work while this was being written, in another clone. Flyway does not warn about two
-- files claiming one version, it just behaves unpredictably -- which is why the check
-- is done at commit time and not at deploy time.
UPDATE tickets
   SET resp = 'PNS',
       needs_review = 0,
       status = CASE WHEN status = 'Pending Sales' THEN 'Pending PNS' ELSE status END,
       status_since = CASE WHEN status = 'Pending Sales' THEN NOW() ELSE status_since END
 WHERE service_type = 'Fulfillment'
   AND deleted_at IS NULL
   AND status IN ('Open', 'Pending Sales', 'Pending PNS', 'Pending Vendor',
                  'Pending Requirement', 'Pending CRM ID')
   AND (resp <> 'PNS' OR needs_review <> 0);
