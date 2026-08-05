-- Intake payloads and status history for the ten seed tickets.
--
-- V2 seeded the tickets themselves but left ticket_input and ticket_history empty, so
-- the Project Charter and History tabs had nothing to show. This fills both, and pulls
-- status_since back to each ticket's last real transition so the SLA counters age
-- realistically instead of all reading zero.
--
-- Ticket ids are looked up by ticket_ref rather than assumed to be 1..10.

-- ---------------------------------------------------------------- intake payloads
INSERT INTO ticket_input (ticket_id, payload, cleared_at, updated_by)
SELECT id,
'{"shipper":"PT Sinar Kencana Utama","shipperStatus":"New shipper","brief":"Wants LTL freight from their Cikarang plant to modern-trade DCs across Greater Jakarta. Currently on two local truckers and unhappy with pickup reliability.","shipperPic":"Bapak Handoko","shipperContact":"0812-8877-4410","invPic":"Ibu Ratna","invContact":"0812-8877-4402","invAddr":"Kawasan Industri Jababeka II Blok C, Cikarang","pickPic":"Bapak Yusuf","pickContact":"0813-1122-9087","pickup":"Kawasan Industri Jababeka II Blok C, Cikarang, Bekasi","dest":"GJ - 14 modern-trade DCs","freq":"3x per week","volume":"Approx 180 tonnes per month","pickSlot":"08:00 - 11:00","delSlot":"13:00 - 17:00","sfid":"OPP-2026-04412","globalId":"","jiraId":"","commodity":"FMCG","product":"Instant noodles and seasoning, cartoned","dim":"40 x 30 x 28","wt":"12.5","pallet":"Palletized","destType":"MT","sla":"Standard","mps":"Yes","rdo":"Yes","cod":"No","tkbmO":"Yes","tkbmD":"No","ins":"No","truck":"CDD","golive":"2026-09-01","handling":"Pallet exchange at DC gate; no stacking above 5 cartons.","notes":"Shipper asked for a rate comparison against their current trucker before signing."}',
NULL, 'arif.pratama@ninjavan.co' FROM tickets WHERE ticket_ref='SOF-1284';

INSERT INTO ticket_input (ticket_id, payload, cleared_at, updated_by)
SELECT id,
'{"shipper":"Berkah Sentosa Distribusi","shipperStatus":"New shipper","brief":"Regional distributor moving B2B retail parcels under 50 kg to small shops around Bandung and Cimahi.","shipperPic":"Bapak Sutrisno","shipperContact":"0813-2244-1900","invPic":"Ibu Wulan","invContact":"0813-2244-1902","invAddr":"Jl. Soekarno Hatta 421, Bandung","pickPic":"Bapak Sutrisno","pickContact":"0813-2244-1900","pickup":"Jl. Soekarno Hatta 421, Bandung","dest":"WJ - Bandung, Cimahi, Padalarang","freq":"Daily, Monday to Saturday","volume":"Approx 900 parcels per month","pickSlot":"14:00 - 16:00","delSlot":"Next day, 09:00 - 17:00","sfid":"OPP-2026-04390","globalId":"","jiraId":"","commodity":"FMCG","product":"Household cleaning products","dim":"30 x 25 x 20","wt":"8","pallet":"Non palletized","destType":"GT","sla":"Standard","mps":"No","rdo":"Yes","cod":"Yes","tkbmO":"No","tkbmD":"No","ins":"No","truck":"","golive":"2026-08-18","handling":"","notes":"Straightforward B2BR case, well inside the standard card."}',
NULL, 'dimas.nugroho@ninjavan.co' FROM tickets WHERE ticket_ref='SOF-1279';

INSERT INTO ticket_input (ticket_id, payload, cleared_at, updated_by)
SELECT id,
'{"shipper":"PT Anugerah Kimia Raya","shipperStatus":"Existing shipper","brief":"Strategic account expanding from spot FTL to a monthly dedicated fleet for chemical raw materials, Greater Jakarta to Semarang and Surabaya.","shipperPic":"Ibu Melati","shipperContact":"0811-9900-2314","invPic":"Bapak Gunawan","invContact":"0811-9900-2301","invAddr":"Menara Kimia, Jl. TB Simatupang 88, Jakarta Selatan","pickPic":"Bapak Rahmat","pickContact":"0812-4455-6677","pickup":"Kawasan Industri Pulogadung Blok F, Jakarta Timur","dest":"CJ Semarang and EJ Surabaya","freq":"Dedicated, 22 working days per month","volume":"Approx 640 tonnes per month","pickSlot":"06:00 - 09:00","delSlot":"Next day before 12:00","sfid":"OPP-2026-04201","globalId":"GLB-8842","jiraId":"NVID-3391","commodity":"Chemical","product":"Non-hazardous industrial resin in drums","dim":"Drum 58 dia x 88 h","wt":"210","pallet":"Palletized","destType":"Factory","sla":"Custom","mps":"Yes","rdo":"No","cod":"No","tkbmO":"Yes","tkbmD":"Yes","ins":"Yes","truck":"FUSO","golive":"2026-08-01","handling":"Dedicated fleet, drivers briefed on non-hazardous chemical handling. Forklift at both ends, provided by shipper at origin.","notes":"Strategic account so PNS owns this end to end. Legal wants an annexed SLA schedule in the contract."}',
'2026-06-19 14:05:00', 'arif.pratama@ninjavan.co' FROM tickets WHERE ticket_ref='SOF-1240';

INSERT INTO ticket_input (ticket_id, payload, cleared_at, updated_by)
SELECT id,
'{"shipper":"Toko Mandiri Grosir","shipperStatus":"New shipper","brief":"Small wholesaler sending mixed goods to general-trade shops in the Bandung area. Low volume, standard rate card.","shipperPic":"Bapak Andi","shipperContact":"0857-1177-4400","invPic":"Bapak Andi","invContact":"0857-1177-4400","invAddr":"Pasar Baru Blok D 17, Bandung","pickPic":"Bapak Andi","pickContact":"0857-1177-4400","pickup":"Pasar Baru Blok D 17, Bandung","dest":"WJ - Bandung and surrounds","freq":"2x per week","volume":"Approx 260 parcels per month","pickSlot":"15:00 - 17:00","delSlot":"Next day","sfid":"OPP-2026-04455","globalId":"","jiraId":"","commodity":"FMCG","product":"Assorted dry goods","dim":"35 x 30 x 25","wt":"14","pallet":"Non palletized","destType":"GT","sla":"Standard","mps":"No","rdo":"No","cod":"Yes","tkbmO":"No","tkbmD":"No","ins":"No","truck":"","golive":"2026-08-11","handling":"","notes":"Proposal sent, shipper comparing against a competitor quote."}',
'2026-07-22 09:40:00', 'dimas.nugroho@ninjavan.co' FROM tickets WHERE ticket_ref='SOF-1266';

INSERT INTO ticket_input (ticket_id, payload, cleared_at, updated_by)
SELECT id,
'{"shipper":"CV Karya Plastindo","shipperStatus":"New shipper","brief":"Plastics manufacturer wanting LTL freight from Tangerang to distributors in Semarang and Surabaya. Needs a vendor quote for the eastbound leg.","shipperPic":"Bapak Wirawan","shipperContact":"0812-9911-7788","invPic":"Ibu Sari","invContact":"0812-9911-7701","invAddr":"Jl. Industri Raya III Blok AE, Tangerang","pickPic":"Bapak Joko","pickContact":"0813-8877-2211","pickup":"Jl. Industri Raya III Blok AE, Jatake, Tangerang","dest":"CJ Semarang, EJ Surabaya","freq":"2x per week","volume":"Approx 95 tonnes per month","pickSlot":"09:00 - 12:00","delSlot":"Within 2 days","sfid":"OPP-2026-04431","globalId":"","jiraId":"","commodity":"Plastic","product":"Injection-moulded housewares, bulk bagged","dim":"60 x 50 x 45","wt":"9","pallet":"Non palletized","destType":"DC","sla":"Standard","mps":"Yes","rdo":"Yes","cod":"No","tkbmO":"Yes","tkbmD":"Yes","ins":"No","truck":"CDDL","golive":"2026-09-15","handling":"Bulky but light - cube-weight case, so the declared weight will not match DWS.","notes":"Blocked on the Surabaya leg vendor cost. Bottom rate is tight at this revenue."}',
NULL, 'nadia.kusuma@ninjavan.co' FROM tickets WHERE ticket_ref='SOF-1251';

INSERT INTO ticket_input (ticket_id, payload, cleared_at, updated_by)
SELECT id,
'{"shipper":"PT Cahaya Elektronik","shipperStatus":"Existing shipper","brief":"Electronics retailer adding Sameday delivery for online orders inside Bandung city. Wants a premium tier for orders placed before 11:00.","shipperPic":"Ibu Dewi","shipperContact":"0811-2233-9955","invPic":"Bapak Firman","invContact":"0811-2233-9900","invAddr":"Jl. Asia Afrika 122, Bandung","pickPic":"Ibu Dewi","pickContact":"0811-2233-9955","pickup":"Jl. Asia Afrika 122, Bandung","dest":"WJ - Bandung city, within 20 km","freq":"Daily including Sunday","volume":"Approx 1400 orders per month","pickSlot":"Two waves, 11:00 and 15:00","delSlot":"Same day before 21:00","sfid":"OPP-2026-04408","globalId":"","jiraId":"NVID-3402","commodity":"Electronics","product":"Small appliances and phone accessories","dim":"30 x 22 x 15","wt":"3.2","pallet":"Non palletized","destType":"GT","sla":"Custom","mps":"No","rdo":"Yes","cod":"Yes","tkbmO":"No","tkbmD":"No","ins":"Yes","truck":"","golive":"2026-08-25","handling":"Fragile items, no stacking. Signature plus photo proof of delivery.","notes":"Sameday has no published product bottom margin, so the below-bottom check on this one is manual."}',
'2026-07-24 10:15:00', 'nadia.kusuma@ninjavan.co' FROM tickets WHERE ticket_ref='SOF-1233';

INSERT INTO ticket_input (ticket_id, payload, cleared_at, updated_by)
SELECT id,
'{"shipper":"Sumber Rejeki Niaga","shipperStatus":"New shipper","brief":"Online seller shipping B2C parcels nationwide from a Jakarta warehouse. Standard B2C rate card, no customization asked for.","shipperPic":"Bapak Halim","shipperContact":"0857-9900-1212","invPic":"Ibu Tuti","invContact":"0857-9900-1200","invAddr":"Jl. Kembangan Raya 45, Jakarta Barat","pickPic":"Bapak Halim","pickContact":"0857-9900-1212","pickup":"Jl. Kembangan Raya 45, Jakarta Barat","dest":"Nationwide","freq":"Daily, Monday to Saturday","volume":"Approx 2100 parcels per month","pickSlot":"16:00 - 18:00","delSlot":"Per published SLA","sfid":"OPP-2026-04122","globalId":"","jiraId":"","commodity":"FMCG","product":"Apparel and small accessories","dim":"28 x 20 x 12","wt":"1.4","pallet":"Non palletized","destType":"GT","sla":"Standard","mps":"No","rdo":"Yes","cod":"Yes","tkbmO":"No","tkbmD":"No","ins":"No","truck":"","golive":"2026-06-16","handling":"","notes":"Accepted. With Legal for the contract, then handover to Ops."}',
'2026-05-28 11:00:00', 'arif.pratama@ninjavan.co' FROM tickets WHERE ticket_ref='SOF-1218';

INSERT INTO ticket_input (ticket_id, payload, cleared_at, updated_by)
SELECT id,
'{"shipper":"PT Global Tekstil Jaya","shipperStatus":"New shipper","brief":"Textile mill needing on-call FTL from Karawang to garment factories in Bandung and Sukabumi. Volume is lumpy and follows their order book.","shipperPic":"Bapak Surya","shipperContact":"0812-3311-8899","invPic":"Ibu Lina","invContact":"0812-3311-8800","invAddr":"Kawasan Industri KIIC Lot 22, Karawang","pickPic":"Bapak Surya","pickContact":"0812-3311-8899","pickup":"Kawasan Industri KIIC Lot 22, Karawang","dest":"WJ Bandung and Sukabumi","freq":"On call, roughly 12 trips per month","volume":"Approx 210 tonnes per month","pickSlot":"07:00 - 10:00","delSlot":"Same day before 18:00","sfid":"OPP-2026-03988","globalId":"","jiraId":"","commodity":"Textile","product":"Rolled fabric","dim":"Roll 40 dia x 160 l","wt":"85","pallet":"Non palletized","destType":"Factory","sla":"Standard","mps":"Yes","rdo":"No","cod":"No","tkbmO":"Yes","tkbmD":"Yes","ins":"Yes","truck":"WB","golive":"2026-06-01","handling":"Wing-box body so rolls can be loaded from the side. Tarpaulin required in the wet season.","notes":"Lost on price. Competitor came in around 12 percent below our bottom rate."}',
'2026-04-22 13:20:00', 'dimas.nugroho@ninjavan.co' FROM tickets WHERE ticket_ref='SOF-1204';

INSERT INTO ticket_input (ticket_id, payload, cleared_at, updated_by)
SELECT id,
'{"shipper":"PT Harum Boga Nusantara","shipperStatus":"Existing shipper","brief":"Food distributor adding B2B retail delivery to convenience-store chains across Greater Jakarta. Asked for a discount beyond the published tier.","shipperPic":"Ibu Ayu","shipperContact":"0811-4455-7788","invPic":"Bapak Teguh","invContact":"0811-4455-7700","invAddr":"Jl. Daan Mogot Km 14, Jakarta Barat","pickPic":"Bapak Rudi","pickContact":"0812-6677-8899","pickup":"Jl. Daan Mogot Km 14, Jakarta Barat","dest":"GJ - 340 convenience stores","freq":"Daily, Monday to Saturday","volume":"Approx 5200 parcels per month","pickSlot":"05:00 - 07:00","delSlot":"Before store opening, 07:00 - 10:00","sfid":"OPP-2026-04441","globalId":"","jiraId":"","commodity":"FMCG","product":"Ambient snacks and beverages","dim":"38 x 28 x 24","wt":"11","pallet":"Non palletized","destType":"MT","sla":"Custom","mps":"Yes","rdo":"Yes","cod":"No","tkbmO":"Yes","tkbmD":"No","ins":"No","truck":"CDE","golive":"2026-08-15","handling":"Delivery window is before store opening, so the run has to leave the hub by 04:30.","notes":"Margin lands below the tier at the requested discount, so it went to PSP."}',
'2026-07-25 09:20:00', 'arif.pratama@ninjavan.co' FROM tickets WHERE ticket_ref='SOF-1290';

INSERT INTO ticket_input (ticket_id, payload, cleared_at, updated_by)
SELECT id,
'{"shipper":"CV Lestari Agro","shipperStatus":"New shipper","brief":"Agricultural processor needing on-call FTL from Jember to Surabaya port and to distributors in Malang. Above 30 Mio, so Sales priced it and PNS reviews.","shipperPic":"Bapak Slamet","shipperContact":"0813-5566-2233","invPic":"Ibu Endang","invContact":"0813-5566-2200","invAddr":"Jl. Raya Rambipuji 12, Jember","pickPic":"Bapak Slamet","pickContact":"0813-5566-2233","pickup":"Jl. Raya Rambipuji 12, Jember, Jawa Timur","dest":"EJ Surabaya port and Malang","freq":"On call, roughly 16 trips per month","volume":"Approx 380 tonnes per month","pickSlot":"06:00 - 09:00","delSlot":"Same day before 20:00","sfid":"OPP-2026-04470","globalId":"","jiraId":"","commodity":"FMCG","product":"Processed cassava and corn starch, sacked","dim":"Sack 60 x 40 x 20","wt":"50","pallet":"Palletized","destType":"Factory","sla":"Standard","mps":"Yes","rdo":"No","cod":"No","tkbmO":"Yes","tkbmD":"Yes","ins":"Yes","truck":"FUSO","golive":"2026-09-01","handling":"Loading at a rural site with no dock - tail lift or manual loading with TKBM at origin.","notes":"Needs a PNS reviewer assigned. Port slot timing is the main operational risk."}',
'2026-07-28 15:55:00', 'nadia.kusuma@ninjavan.co' FROM tickets WHERE ticket_ref='SOF-1295';

-- ---------------------------------------------------------------- status history
INSERT INTO ticket_history (ticket_id, status, actor, note, at)
SELECT t.id, h.status, h.actor, h.note, h.at
FROM tickets t
JOIN (
            SELECT 'SOF-1284' AS ref, 'Pending Sales' AS status, 'Arif Pratama' AS actor, 'submitted' AS note, '2026-07-14 08:40:00' AS at
  UNION ALL SELECT 'SOF-1279', 'Pending Sales', 'Dimas Nugroho', 'submitted', '2026-07-09 10:05:00'
  UNION ALL SELECT 'SOF-1240', 'Pending PNS', 'Arif Pratama', 'submitted - strategic account, PNS owns it', '2026-06-18 09:15:00'
  UNION ALL SELECT 'SOF-1240', 'Pending PNS', 'Baskoro', 'assigned to Annisa', '2026-06-19 14:05:00'
  UNION ALL SELECT 'SOF-1266', 'Pending Sales', 'Dimas Nugroho', 'submitted', '2026-07-21 09:00:00'
  UNION ALL SELECT 'SOF-1266', 'Proposal Submitted', 'Dimas Nugroho', 'price attached, proposal sent to shipper', '2026-07-23 11:30:00'
  UNION ALL SELECT 'SOF-1251', 'Pending Sales', 'Nadia Kusuma', 'submitted', '2026-07-11 08:20:00'
  UNION ALL SELECT 'SOF-1251', 'Pending Vendor', 'Ramdhani', 'waiting on vendor cost for the Surabaya leg', '2026-07-16 16:45:00'
  UNION ALL SELECT 'SOF-1233', 'Pending PNS', 'Nadia Kusuma', 'submitted - Sameday, PNS prices it', '2026-07-23 09:30:00'
  UNION ALL SELECT 'SOF-1233', 'Pending PNS', 'Baskoro', 'assigned to Niko', '2026-07-24 10:15:00'
  UNION ALL SELECT 'SOF-1218', 'Pending Sales', 'Arif Pratama', 'submitted', '2026-05-27 09:00:00'
  UNION ALL SELECT 'SOF-1218', 'Proposal Submitted', 'Arif Pratama', 'price attached from the B2C card', '2026-05-30 15:20:00'
  UNION ALL SELECT 'SOF-1218', 'Proposal Accepted / Ready to Ship', 'Arif Pratama', 'shipper accepted, handed to Legal', '2026-06-06 11:00:00'
  UNION ALL SELECT 'SOF-1204', 'Pending Sales', 'Dimas Nugroho', 'submitted', '2026-04-15 08:50:00'
  UNION ALL SELECT 'SOF-1204', 'Pending PNS Review', 'Dimas Nugroho', 'price attached - above 30 Mio, so PNS reviews', '2026-04-22 13:20:00'
  UNION ALL SELECT 'SOF-1204', 'Proposal Submitted', 'Ramdhani', 'reviewed and approved', '2026-04-25 10:40:00'
  UNION ALL SELECT 'SOF-1204', 'Lost', 'Dimas Nugroho', 'lost on price - competitor about 12 percent below', '2026-05-08 16:00:00'
  UNION ALL SELECT 'SOF-1290', 'Pending Sales', 'Arif Pratama', 'submitted', '2026-07-24 09:10:00'
  UNION ALL SELECT 'SOF-1290', 'Pending PSP Approval', 'Arif Pratama', 'margin below the tier at the requested discount', '2026-07-27 14:25:00'
  UNION ALL SELECT 'SOF-1295', 'Pending Sales', 'Nadia Kusuma', 'submitted', '2026-07-25 08:35:00'
  UNION ALL SELECT 'SOF-1295', 'Pending PNS Review', 'Nadia Kusuma', 'price attached - 52 Mio, so PNS reviews', '2026-07-28 15:55:00'
) h ON h.ref = t.ticket_ref;

-- The SLA counter measures time in the current status, so anchor it to the last
-- transition rather than to when the rows happened to be inserted.
UPDATE tickets t
   SET t.status_since = (SELECT MAX(h.at) FROM ticket_history h WHERE h.ticket_id = t.id)
 WHERE EXISTS (SELECT 1 FROM ticket_history h2 WHERE h2.ticket_id = t.id);
