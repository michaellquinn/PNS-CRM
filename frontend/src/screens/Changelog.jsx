import { Card, Head, Pill } from "../ui";

const ENTRIES = [
  {
    date: "2026-08-26",
    title: "FIXED: most tickets were never re-read by the sync at all",
    by: "Michael + Claude",
    changes: [
      "Michael asked why three FTL shippers were still showing B2BR after the service-line rewrite. Chasing it turned up something bigger than those three tickets.",
      "FIXED: the sync re-read the same first 400 opportunity ids on every single run and never looked at the rest. Not a slow refresh — no refresh ever, for every ticket past position 400 in a sort of the ids. So a rule change reached some tickets within five minutes and others never, and nothing anywhere said which was which. Stage changes, revenue corrections and tier moves were all going unseen on those deals too; the service line is just where it happened to show.",
      "The window rotates now. A full pass over everything held takes as many runs as it takes, and every ticket gets its turn — with 1,000 tickets that is three runs, about fifteen minutes.",
      "FIXED: “These opportunity IDs only” did nothing to any ticket that already existed. It sent refresh=false, so every id you named that was already a ticket was skipped and the run reported nothing done. The one tool for putting a single deal right ignored every deal you actually have. Naming an id now re-reads it.",
      "So the way to pull a specific deal back into line after a rule change is Sync → These opportunity IDs only, paste its Sales CRM id, run it. No waiting for the rotation to come round.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-26",
    title: "The service line comes from NV Product Line AND Service Level, and FTL is read off the shipper name",
    by: "Michael + Claude",
    changes: [
      "The service line is now a COMBINATION of two Sales CRM fields, not one. Restock alone never said whether a deal was B2BR, Same Day or Next Day — the Service Level does, and the same level means different things under different product lines. Restock/Standard is B2BR, Restock/Same Day is Sameday, Restock/Next Day is Next Day, LTL/Standard is LTL, and the three Last Mile lines (Parcel, Document, Cargo) map by level the same way.",
      "FTL is identified from the SHIPPER NAME, and that beats the product line. Sales CRM has no FTL category yet, so the name is the only place an FTL deal announces itself; deferring to the product line would mean deferring to a field that currently has no way of carrying the answer. It matches FTL as a whole word, so a shipper called SHIFTLESS is not quietly turned into a truck deal.",
      "A shipper-name FTL lands on a new provisional line, “FTL” — not on on-call or monthly, because a name cannot say which and guessing put half of them on the wrong team. It carries the same ceilings as both real FTL lines, can wait on a vendor quote like them, and routes to PNS, who is the one who resolves it. The ticket says on its face that the line needs setting, and setting it re-derives the routing. Trucking now lands here too instead of being labelled on-call.",
      "New Next Day service line. No published 5A ceiling yet, so every band is a decision until Commercial issues one — the same position Fulfillment and Complex Logistics are in.",
      "Matching is normalised now: case, spacing, and every kind of dash. The sheet writes “Last Mile – Parcel” with an EN DASH where the old map had a hyphen, and matching literally would have stopped that whole product line importing with nothing to say why but one line in the sync report.",
      "A missing or unpublished Service Level falls back to the product line’s standard reading rather than refusing the deal, and the ticket says it was assumed. A product line nothing recognises is still refused and reported rather than guessed onto a line.",
      "New verify_service_line suite pins all of it, including the dash, the whole-word FTL match, and that every service the mapping can produce has a pricing ceiling at every band — a missing one falls through to “no published ceiling” and looks deliberate.",
    ],
    overruled: [
      "PRODUCT_MAP read the NV Product Line alone and could not express any of this. Gone, replaced by the combination table plus a product-line-only fallback.",
      "“Last Mile – Parcel” used to map to B2C. Per the table it is B2BR now, by service level. B2C stays a valid service for the tickets already on it, but nothing in Sales CRM maps to it any more.",
      "Trucking used to be imported as FTL on-call. The comment justifying that said both FTL lines route identically — which stopped being true when FTL monthly went to PNS at every revenue band, so on-call deals under 30 Mio were going to Sales on a guessed label.",
    ],
  },
  {
    date: "2026-08-26",
    title: "Pending and proposals shows when each deal was raised",
    by: "Michael + Claude",
    changes: [
      "Every row now carries the date the ticket was raised, with its age in days beside it. Past 30 days the age turns amber — on a list you walk top to bottom, the question behind most rows is how long this has been going on, and a date alone still makes you do the arithmetic.",
      "The date sits under the ticket number rather than beside it, in a fixed-width column, so the shipper names still line up down the list instead of each one starting wherever the date happened to end.",
      "It is the raised date, not the last-moved date. Where the ticket came from the sync it is what Sales CRM says about the opportunity; where it was raised here it is ours. A missing or unreadable date shows as no date rather than as a broken number.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-21",
    title: "FIXED: live tickets wearing a red “Lost” badge",
    by: "Michael + Claude",
    changes: [
      "FIXED: a ticket could show “Lost: Duplicate Opportunity” while sitting at Proposal Submitted. Reported by Michael on SOF-2001424 (PT Teknologi Medika Pratama). The badge is meant to replace our generic “Closed in Sales CRM” with the real reason on a lost deal, but it was drawn whenever the reason field had anything in it, without ever checking whether the ticket was lost. It now only appears on a ticket whose status actually is Lost.",
      "Why the reason is there at all: the sync copies loss_reason from Sales CRM on EVERY run, whatever the stage says. Somebody marked that opportunity a duplicate in Sales CRM, and the field kept the value after the deal carried on. Our copy is faithful; the badge was the part drawing the wrong conclusion from it.",
      "The data itself is worth a look, separately from the display. A live opportunity carrying a loss reason usually means it really was raised twice — clearing the reason in Sales CRM, or closing whichever of the two is the duplicate, is the fix at the source. Reference / Data checks already lists duplicates by account.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-21",
    title: "Put a cancelled request back on the Open shelf",
    by: "Michael + Claude",
    changes: [
      "Planning / Cancelled has a Return to Open button on every row. A deal that could not be built and now can goes back to the unclaimed shelf for somebody to pick up, rather than to a queue naming a side nobody has decided on yet.",
      "Nothing is recreated. It is the same ticket with the same reference and the same history — the cancellation and the reason it carried stay in the timeline, so the record of why it stopped once is not lost by starting it again.",
      "FIXED on the way: reopening into Open used to set the ticket to Sales-priced whatever it had been. Only Pending PNS and Review - Head PNS were treated as PNS's and everything else fell through to Sales, so a PNS-priced deal came back in the wrong queue and the reopen itself looked clean. Open names no side, so the side is now worked out again from account tier, service and revenue — and an admin's priced-by override still outranks that, as it does everywhere else.",
      "The API description for reopen also said “Commercial Head only”, which has not been true since the permission was widened to any Commercial user.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-21",
    title: "FIXED: the Pending and proposals filter really does stay now",
    by: "Michael + Claude",
    changes: [
      "FIXED: picking a PNS PIC, opening a ticket and coming back cleared the filter — the thing the sticky filters were supposed to stop. Reported by Michael with the three screenshots that made it obvious.",
      "The saving and restoring were working the whole time. What undid them was the rule that drops a name no longer in the list when you change region: the salesperson and PNS PIC lists are BUILT from the tickets, so before the fetch comes back they are empty — and that rule ran on mount. It checked the restored names against an empty list, found none of them, cleared the selection, and the sticky store then wrote that empty value over the good one. The filter was restored and wiped within the same breath.",
      "It now waits until both lists have actually loaded before dropping anything. Changing region still prunes names that no longer have a deal there, which is what the rule was for.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-21",
    title: "One screen for the review: proposals and everything pending together",
    by: "Michael + Claude",
    changes: [
      "Pending & proposals replaces the two separate menu entries. A review walks the proposals sitting with shippers AND everything still open in the same sitting, so having them apart meant leaving the list to see the other half and losing your place.",
      "The two halves do different jobs and the screen shows that. A submitted proposal has an outcome to record, so it carries the status controls inline — accept it, send it back, or mark it lost without leaving the list. A pending ticket is discussed and updated inside the ticket, so it is a link and nothing more.",
      "The salesperson heading above each group is gone. The list is one flat numbered run now, and the name moved onto the row itself beside the region and the PNS PIC — same information, without a header that chopped the list into blocks nobody was walking separately.",
      "Region, salesperson and PNS PIC filters cover both halves and stay put when you open a ticket and come back, which is the whole point of walking a list this way.",
      "The status controls are now one piece of code shared with the Proposal submitted screen, which is still reachable at ?screen=proposals. A second copy of “what may a submitted proposal become” is exactly the sort of thing that drifts until one screen offers a move the other has retired.",
      "Open - PNS gained the send-back Open already had: say what is missing and hand the ticket to Sales. That judgement is made while reading the list, not after claiming the ticket. Pricing still belongs to Awaiting price and checking to Review - PNS.",
    ],
    overruled: [
      "Proposal submitted is no longer its own menu entry. Nothing was removed — the screen still exists and still works, it is just not a second thing to click past during a review.",
    ],
  },
  {
    date: "2026-08-21",
    title: "FIXED: blank screen. And a blank screen can no longer happen quietly",
    by: "Michael + Claude",
    changes: [
      "FIXED: the whole app went white. Reported by Michael. Yesterday's sticky filters stored the region and name selections on All pending as arrays, and the code that read them back treated every array as a plain object — so [\"GJ\"] came back as {} and the next line that called .join() on it threw. React unmounts the entire tree on an unhandled render error, so one screen took down the header, the sidebar and everything else.",
      "It only appeared on the SECOND visit to a screen in the same tab, which is what made it look random: the first visit had nothing saved to restore, and the crash needed a saved value to read. Anything already corrupted repairs itself on load.",
      "A crashing screen no longer blanks the app. The header and menu stay, the screen area explains what failed and shows the error line to pass on, and every other screen keeps working. It also offers Clear saved filters and reload — a filter restored in a shape the screen no longer understands is the likeliest reason a screen breaks on open but works in a fresh tab, and a plain reload does not fix that.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-18",
    title: "Filters stay put when you open a ticket and come back",
    by: "Michael + Claude",
    changes: [
      "Every filter now survives leaving the screen. Opening a ticket from a filtered list unmounted that list, so the filter was gone by the time you returned — and on a review call, where you pick a ticket, discuss it and come back for the next one, that meant re-filtering before every single ticket.",
      "It covers All pending (region, salesperson, PNS PIC), both dashboards, and every queue: Open, Open - PNS, both Awaiting price screens, Review - PNS, Review - PSP, Review - C-level, Proposal submitted, Ready to ship and the three Watched screens.",
      "Each screen keeps its OWN filter. Narrowing Awaiting price - PNS does not quietly narrow Open, and the two dashboards do not share, so a filter set on one board cannot hide rows on the other.",
      "It lasts for the browser tab, not forever. That covers the whole complaint — navigation and a page reload — without leaving a filter set last Tuesday quietly hiding rows next week. Closing the tab resets everything, and Clear still works as it always did.",
      "A filter saved before a control changed shape is dropped rather than restored, so nothing from an older build comes back as a value the screen can no longer read.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-18",
    title: "Admin can move a ticket between the Sales and PNS pricing queues",
    by: "Michael + Claude",
    changes: [
      "New Move to Sales / Move to PNS button on the ticket, beside Priced by. Admin only — no other role sees it and the server refuses it for anyone else.",
      "Why it exists: the trial runs with Sales not yet on the platform, so PNS is working tickets the 5A matrix has already assigned to Sales, and there was no way to say so. It is a stopgap with a name (setPricedBy), not a general capability — normally nobody chooses this, route() derives it from account tier, service and revenue.",
      "The choice is REMEMBERED, not just written. Both places that re-derive routing — the Sales CRM sync and the intake edit — recompute who prices a deal whenever revenue, service or account tier changes. Without this, moving a ticket to PNS by hand would have lasted only until Sales CRM next touched any of those three, and the ticket would have bounced back to a queue somebody had deliberately taken it out of, with the sync's own note as the only clue. Both now honour the override and say so in the history.",
      "Moving to PNS clears the PNS review, because PNS does not re-check its own work. Moving back to Sales restores whatever the 5A answer for that deal is.",
      "The override rides in the intake payload rather than a new column, the same way the Sales CRM loss reason does — no migration, which matters when two people deploy into one database from separate clones and migrations have already collided three times. It is also what makes this cheap to delete the day Sales onboards.",
    ],
    overruled: [
      "Who prices a deal was derived and nothing could override it. Admin can now, per ticket, and the derivation stops applying to that ticket until an admin moves it back.",
    ],
  },
  {
    date: "2026-08-18",
    title: "Drop a request that cannot be built, and a record of everything dropped",
    by: "Michael + Claude",
    changes: [
      "Awaiting price has a Cancel ticket action. Commercial raises plenty that turns out not to be feasible — no rate to price against, no vendor on the lane, a solution Ninja does not run — and leaving those sitting in the queue makes it read as work when it is not.",
      "The reason is typed in beside the button and is mandatory. It becomes the only record of why the deal stopped, and it is what Commercial will ask about, so it is not a bare confirm.",
      "New Planning / Cancelled screen: every dropped request with the date, who cancelled it and the reason they gave. Open to everyone who works the pipeline, because “why did this one stop” is a question Commercial asks PNS and PNS asks Commercial, and an answer only one side can see is not an answer.",
      "Who and when come out of the ticket history rather than a new column — log_status() has always written the actor and the timestamp, so the record already existed and only needed reading. Two people deploy into this database from separate clones and migrations have collided three times; a column duplicating something already stored is not worth a fourth. A ticket cancelled before today says “not recorded” rather than showing an empty cell that looks like a bug.",
      "Cancelling now writes outcome = cancel. That was the third value the column has always been documented to hold and the one nothing ever wrote, so a cancelled ticket read as still undecided everywhere outcome is consulted. Win rate is unaffected: it counts accepted against lost, and a deal nobody could build is neither.",
      "A cancelled ticket is not deleted. Sales can put it back in the pipeline if the deal becomes possible again, and the cancellation travels with it in the history.",
    ],
    overruled: [
      "The transition table described Cancel as Sales withdrawing the request. PNS drops infeasible work too, with the same permission as a send-back — it is the same act one step further: instead of handing it back with a reason, it stops here with one.",
    ],
  },
  {
    date: "2026-08-18",
    title: "Sales CRM leads the sidebar; Review meeting becomes All pending",
    by: "Michael + Claude",
    changes: [
      "Sales CRM sits above Solutioning now. The sidebar reads in the order the work happens: a deal arrives from the sync, and only then becomes PNS's.",
      "Review meeting is renamed All pending, and the Proposals submitted block inside it is gone. A submitted proposal is out with the shipper and already has a queue of its own — listing it here made the same tickets appear twice and the agenda read longer than the work actually was. What is left is everything still open, grouped by the salesperson who presents it, with the same region, salesperson and PNS PIC filters.",
      "The screen keeps its address, so a ?screen=meeting link sent before the rename still lands on it.",
    ],
    overruled: [
      "The Review meeting opened with Proposals submitted and walked pending second. It is one list now.",
    ],
  },
  {
    date: "2026-08-18",
    title: "Sidebar reorganised: Solutioning is PNS's work, Sales CRM is the commercial side",
    by: "Michael + Claude",
    changes: [
      "The sections now split by WHOSE WORK a screen is rather than by where a ticket sits in the pipeline. Solutioning: Dashboard PNS, Open - PNS, My requests, Awaiting price - PNS, the three review gates. Sales CRM: Dashboard all, New request, Pending CRM ID, Awaiting price - Sales, Open, Accounts, Sync. Planning: Review meeting, Proposal submitted.",
      "Awaiting price is split into two menu entries, PNS and Sales, each with its own badge. One component behind both — the cut is on who owes the price NOW (resp), not on isPnsWork(), because a Sales-priced deal PNS reviews later is still Sales' to price today. On a side-specific entry the Priced by filter is hidden, having nothing left to choose.",
      "?screen=awaiting still resolves, so a link sent before the split does not land on a blank page.",
    ],
    overruled: [
      "Four entries were not in the requested layout and are kept anyway, in the nearest sensible place. Review - PNS is a LIVE GATE: tickets reach Pending Review - PNS and Pending Review - Head PNS by rule, and with no menu entry nothing could clear them — they would stop moving with no error to explain why. Open still holds the tickets unclaimed by EITHER side, and Open - PNS shows only the PNS half. Ready to ship is the won-deal list Legal and Ops read. Workload is the only screen answering who has capacity. Say the word on any of them and they go.",
    ],
  },
  {
    date: "2026-08-18",
    title: "Open - PNS: the assignment inbox, not a status",
    by: "Michael + Claude",
    changes: [
      "New Open - PNS menu: PNS work with nobody on it yet, whatever status it is in. A ticket is here because PNS owes the price or PNS reviews the price Sales built, and no PNS PIC has taken it.",
      "Michael found the gap: a Sales-priced deal at or above Rp 30 Mio sits at \"Pending Sales\" until Sales attaches a price, carries \"PNS review after\" the whole time, and has no PNS PIC — unassigned PNS work that the Open queue never showed, because its status is not \"Open\". \"Open is the menu for us to assign the ticket\" is the job, and matching one status was too narrow for it.",
      "Its own menu entry rather than a filter inside Open, for the badge: how much is sitting on nobody is worth answering from the sidebar without opening anything. Same reason the watched groups have their own entries.",
      "Assignment is the only action on it. Pricing a ticket is still Awaiting price and checking one is still Review - PNS — duplicating those here would be two screens racing on the same ticket. Claiming a ticket does not change its status.",
      "The screen and its badge share one definition of both halves — isPnsWork() and LIVE_STATUSES — so the number in the sidebar and the list behind it cannot answer differently.",
    ],
    overruled: [
      "Open stays exactly as it was, showing the \"Open\" status. The Sales half of the split Michael proposed is deliberately NOT built: Sales is not on the platform yet, and inventing a queue for a team that will not open it is how the Head of Sales gate ended up retired three days after it shipped. It can be added the day Sales onboards and can say what they need from it.",
    ],
  },
  {
    date: "2026-08-18",
    title: "Filter Open and Awaiting price by whether PNS reviews it",
    by: "Michael + Claude",
    changes: [
      "New Review filter on Open and Awaiting price: PNS reviews it after, or no PNS review. Priced by alone could not answer this — Sales prices plenty that PNS never sees again, and separately prices the ones at or above Rp 30 Mio that PNS checks afterwards. Both read \"Priced by Sales\" and they are not the same work.",
      "Open also shows the \"PNS review after\" badge now, the same one Awaiting price carries. Filtering on something the card does not display leaves the reader unable to check the answer.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-18",
    title: "Open carries a Priced by filter, and stays one queue",
    by: "Michael + Claude",
    changes: [
      "Open now has the same Priced by filter Awaiting price carries, so PNS and Sales can each read their own half of it in one click.",
      "Michael asked whether Open is a PNS screen or a Sales screen, and whether it should be split in two. It is deliberately both, and it stays one. A ticket in Open is unclaimed — the question it asks is \"will somebody take this\", which is not a question you want answered only inside the half of the app the other side never opens.",
      "The stronger reason not to split: a ticket imported with no potential revenue lands in Open, and its Priced by was worked out FROM that missing revenue — route() read zero, fell through every band, and answered Sales. Splitting the screen on that value would file every revenue-less ticket under Sales as though it had been decided, when in truth nobody knows yet. The filter narrows the list without asserting the answer is right.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-18",
    title: "Every queue filter takes more than one value",
    by: "Michael + Claude",
    changes: [
      "Service, PNS PIC, Priced by and the Watched chips all multi-select now, on every queue — Open and Awaiting price included. One value at a time was the wrong shape for the question people actually bring to a queue: \"LTL and B2BR\", \"Annisa's and Ramdhani's\", \"Hypercare and Must Win\".",
      "Unassigned is a choice in the PNS PIC list rather than a separate mode, so it combines: \"unassigned, or mine\" is one filter now. Assigned to me toggles your own name in and out of the same list instead of replacing whatever was picked.",
      "This lands on all the queues, not only the two asked for — they share one filter bar, and two bars that look identical but behave differently is worse than either behaviour applied consistently.",
      "Fixed stale wording on the Watched screens: they still described a watched deal going \"to the Head of PNS first, then the Head of Sales, then C-level\". The Head of Sales gate was retired on 14 August.",
    ],
    overruled: [
      "Queue filters were single-select. Same filters, same bar, arrays behind them.",
    ],
  },
  {
    date: "2026-08-18",
    title: "A submitted proposal in Sales CRM now moves our status too",
    by: "Michael + Claude",
    changes: [
      "If Sales CRM says the stage is Proposal Submitted, the ticket here becomes Proposal Submitted. Michael found several after a sync sitting in our approval gates while Sales CRM already had the proposal out — PT. LF Services Indonesia (Maersk OCF) - Puma - Sameday - REG - (B2BR) and PT. Farma Bangun Bersama - Sameday (PRM) among them.",
      "This makes the rule consistent rather than looser. The accepted stages (Agreed to Ship, Onboarding, Closed-Won) have ALWAYS overridden our status from any open state, so \"the shipper accepted\" was allowed to jump every gate while the weaker \"the proposal went out\" was not. Proposal Submitted is the one non-terminal stage worth following, because it is the only one that says something already reached the shipper. Negotiation, EKYC and Contract Sent still leave our status alone.",
      "Where the ticket was still in an approval gate, the move is recorded rather than made quietly: the history names the gate that was bypassed and PNS is notified. A proposal reaching the shipper before PSP or the Head of PNS cleared it is a real event, and setting the status silently would erase the only evidence of it. Same notice fires when Sales CRM says the proposal is out but no price is attached here at all — meaning the number the shipper received exists nowhere in this app.",
      "Review meeting filters are multi-select again. Salesperson and PNS PIC are still dropdowns rather than a wrapping row of thirty name pills, but you can now tick several — a review is run for the people in the room, and that is rarely one person. Making them single-select on 14 August was the wrong trade. Unassigned is one of the PNS PIC options.",
      "The multi-select dropdown is now one shared control used by both dashboards and the Review meeting, rather than two implementations drifting apart.",
      "Stage matching is normalised — case-folded, whitespace collapsed — so \"Proposal submitted\" and \"Proposal Submitted \" are the same stage. Sales CRM's picklist is hand-edited, which is why these lists already carried \"Closed Lost\" beside \"Closed-Lost\" and the misspelt \"Future Oppurtunity\". An exact match means a renamed stage silently stops being recognised and the ticket simply never moves, with nothing anywhere saying so.",
    ],
    overruled: [
      "status_for_stage() was \"deliberately one-way and coarse — only terminal stages override ours\". Proposal Submitted is now the one non-terminal exception, on the argument that ACCEPTED_STAGES already did exactly this and the inconsistency was the bug.",
      "The Review meeting salesperson filter was made single-select on 14 August. Reversed — multi-select, in a dropdown.",
    ],
  },
  {
    date: "2026-08-18",
    title: "Review - PNS is its own gate: Sales prices, PNS checks, and PSP stops jumping the queue",
    by: "Michael + Claude",
    changes: [
      "FIXED: a Sales-priced deal at or above Rp 30 Mio could skip the PNS review entirely and land in PSP. Reported by Michael on Tanamera Coffee Indonesia (FTL on-call): the ticket said \"PNS review\" on every screen, route() had marked it for review, and it went to PSP anyway. The cause was branch order at price-attach — a band with no published ceiling was tested BEFORE the review, so it won. FTL on-call, Fulfillment and Complex Logistics all go \"manual\" above 30 Mio, so all three were affected.",
      "PSP is where you go when there is no rate to price against — it is not an automatic stop on the way past. A manual band now changes nothing about who reads the price first. Where the reviewer genuinely needs PSP, there is an Escalate to PSP button on the review screen, which is the gated and recorded route (a Standard deal still needs the Head of PNS to open it on Alex's exception).",
      "New status: Pending Review - PNS, distinct from Pending Review - Head PNS. Two PNS gates, deliberately not one — an ordinary member checks one number Sales put on a big Standard deal; the Head finalises a whole watched solution before the executives see it. Different decisions, separate statuses, separate endpoints.",
      "They share ONE menu entry, Review - PNS, and the screen branches per card: a watched deal shows \"Finalise solution & pricing\", a Sales-priced Standard deal shows \"Price is sound\" and a send-back box. Which of two review queues a given ticket sits in is not something you can tell from the sidebar, so two entries asked a question the reader could not answer. The badge counts both.",
      "The review used to land in plain Pending PNS, which meant it was indistinguishable from ordinary pricing work in the queue, and the only way to finish it was to attach a price over the top of Sales'. There is now an explicit \"Price is sound\" that records who checked it, and \"Send back to Sales\" with a reason beside it.",
      "The chain test was collapsing \"Pending PNS\" and \"Pending Review - PNS\" to the same string, so it would have passed either way. It now distinguishes them, and pins the Tanamera case by name: Standard, 30 Mio or above, manual band, still reviewed by PNS first.",
    ],
    overruled: [
      "A manual-review 5A band no longer sends a Standard deal straight to PSP at price-attach. It goes to PNS review, and PSP is reached by escalation from there. Watched deals are untouched — they still go to the Head of PNS first, exactly as before.",
      "The ordinary PNS review no longer shares the \"Pending PNS\" status with pricing work.",
    ],
  },
  {
    date: "2026-08-14",
    title: "Head of Sales approves in Sales CRM; Sales CRM wins; the sync runs itself",
    by: "Baskoro + Claude",
    changes: [
      "The Head of Sales gate is removed from the approval chain. They approve in Sales CRM, where they already work — a queue here that nobody opens does not gate anything, it just leaves the ticket waiting. Checked first: zero tickets were sitting at that status, so nothing was stranded. A watched deal below the floor now goes PSP → Head of PNS → C-level, and a Standard deal under Rp 30 Mio has nothing left to clear here at all: Sales priced it, Sales owns it, the proposal goes straight out.",
      "Sales CRM always takes priority. Every field it carries is now overwritten on every run — including potential revenue, service line and account tier, which used to be left alone on the reasoning that PNS corrects them deliberately. That reasoning is overruled: a copy that disagrees with its source is worse than no copy, because people believe it. The consequence is intended and worth saying plainly — a correction made here to any of those three survives only until the next run. If the value is wrong, fix it in Sales CRM.",
      "Whenever revenue, service or tier changes, the routing is re-derived on the corrected facts and the change is written to the ticket history, so nobody has to work out why a deal changed sides overnight. The sync screen lists exactly what each refresh overwrote.",
      "The sync now runs itself every 5 minutes. Sales CRM has no webhooks, so the app was only ever as fresh as the last person who remembered to press the button. It skips a tick rather than queueing when a manual run is in progress, and — because an unattended sync that dies is silent by nature — its last result is kept and shown at the top of the Sync screen. A failed run gets a red banner naming the likeliest cause, the API key expiring, which it does roughly every 30 days.",
      "The account group is a real link now. Hypercare and Strategic are inherited from the parent account, so an account whose parent you could not open was one whose tier the screen could not explain. Accounts shows the parent by name, links into Sales CRM, and says how many other shippers sit in the same group.",
      "Our status and the Sales CRM stage now read as the same kind of thing in the table. Ours was a coloured pill and theirs was bare grey text, which made one look like data and the other like a footnote — both are states and both matter at a glance. The stage gets a matching pill shape in a deliberately different palette, so they can never be mistaken for each other either.",
      "Reference / Status flow gains the stage mapping: which Sales CRM stages move our status, which is all of them and none. Only the terminal ones override ours — Closed-Lost and Future Opportunity become Lost, the accepted stages become Ready to Ship — and everything else is left alone, which is why a deal can sit at Negotiation there while PNS is still pricing here. Served from the same constants the sync applies.",
      "The manual sync can be limited to Hypercare, Strategic and Must Win. Pick any of the three on the Sync screen and everything else is skipped with that reason stated, and held tickets outside those groups are not re-read either — a run scoped to Hypercare should not quietly touch two hundred Standard tickets. Sales CRM has no field for any of the three (the tier is resolved by walking the account group up to its parent, Must Win is a Lead Source Detail value), so the filter is applied after each account is read rather than sent as a query.",
      "Thirty-two more Sales CRM fields are now read, from Baskoro’s field list of the Opportunity object. The ones that matter most were questions the intake form was ALREADY asking while Sales CRM held the answer: COD, insurance, SLA, parcel weight, parcel size, delivery SLA, shipment frequency and shipping requirements. Asking a salesperson to retype what they typed in Sales CRM an hour ago is how intake ends up half empty.",
      "The go-live date now comes from Sales CRM’s target_start_date. It was reading expected_close_date — when the DEAL closes, not when the shipper starts shipping — which was flagged on 14 August as the one field the sync deliberately would not overwrite. The right field existed all along, so the exception is gone and Sales CRM takes priority everywhere without a carve-out.",
      "Pricing facts Sales has already promised the shipper are carried onto the ticket: the shipper discount, credit terms, the named rate card, billing weight logic, and the COD and insurance fee structures. A pricer needed a second Sales CRM tab open to see any of them. Also carried: the competitor, the real loss reason and its detail (our own loss reason stays the short enum, but “Closed in Sales CRM” answers nothing in a win/loss review), the four named contacts, and the bank, tax and reconciliation details Ops and Finance chase by hand.",
      "When Sales CRM closes a deal as Lost, its own reason is now recorded and shown on the ticket instead of the generic “Closed in Sales CRM”, which explained nothing and was where most losses ended up. Our own seven-value reason stays what manual losses are recorded against — Sales CRM’s picklist values are carried alongside rather than forced into it, so nothing about existing reporting changes and no migration was needed.",
      "Sales CRM moves accounts between the watched groups by itself, in BOTH directions — watched to non-watched and back (Baskoro, 2026-08-18). An account it tags Hypercare or Strategic becomes that here within five minutes; an account it does not tag becomes Standard. Must Win follows the same rule: clearing the Lead Source Detail value in Sales CRM now clears the flag here, where before it left the deal sitting in a watched group after the business had stopped treating it as one. No notification is sent — the change is written to the ticket history with the before and after, and that is the record.",
      "Nothing raised in Sales CRM before 1 August 2026 is imported, whatever window is asked for. The routine run only looks at the last couple of days anyway; the floor is what holds when somebody back-dates an opportunity or runs a wide manual window, so one careless “last 60 days” cannot pull the whole history of the book onto the board. Tickets already held are still refreshed whatever their date — that is how they learn their opportunity was closed or won.",
      "verify_sync_guards grew checks for both new rules: that every mapped field is Sales CRM's bar the stated go-live exception, that the refresh overwrites service and tier and records what it changed, and that the auto-sync loop records its failures rather than dying quietly.",
    ],
    overruled: [
      "Pending Review - Head Sales is gone as a status, a queue, a nav entry and a permission. head_ack, headAck and head_for went with it. Approvals already recorded against it are kept — they are a record of what happened.",
      "Potential revenue, service line and account tier were never overwritten by the sync. All three are now. This reverses the rule stated on 2026-08-14 morning that PNS corrections to those fields survive.",
      "The sync only ran when somebody pressed the button.",
      "Pending CRM ID moves back into Solutioning. Michael grouped it under Sales CRM in .42 with the other opportunity-shaped screens, which reads well — but it is not a Sales CRM screen, it is the first stop of the pipeline, and the people who clear it are working the queues either side of it. Baskoro’s call, 18 August.",
      "go-live was the one field the sync would not overwrite. It reads the right Sales CRM field now, so it is owned like everything else.",
    ],
  },
  {
    date: "2026-08-14",
    title: "Dashboard PNS: the same board, cut to the work PNS actually owns",
    by: "Michael + Claude",
    changes: [
      "The dashboard is renamed Dashboard all, and a second board sits beside it: Dashboard PNS, open to PNS, Commercial and Admin. Same filters, same tiles, same export — it just refuses to hold tickets PNS has no part in.",
      "A ticket is on the PNS board when PNS owes the price, or when PNS reviews the price Sales built. That is the backend's own resp and review_level, not a status list, so a ticket stays on the board from intake through to won or lost instead of appearing and vanishing as it moves between gates.",
      "Why it exists: the Sales CRM sync imports every opportunity it can map, and most of them are Sales working alone. On the full board that is the majority of the rows, and finding PNS's own work meant filtering by hand every time.",
      "The board says what it is holding back — how many of the book's tickets qualify, how many sit on the Sales side — and points at Dashboard all for the rest. Win rate and Total are recomputed from the PNS rows rather than read from the whole-book stats endpoint, so the headline numbers and the tiles under them count the same tickets.",
      "Review meeting now filters by PNS PIC as well as by salesperson, including an Unassigned option, since the answer to 'where is this one' in a review is usually a PNS name. Both are dropdowns now rather than a wrapping row of name pills; region stays as toggles, there being four of them.",
      "Status, Service and Group are dropdowns on both boards instead of three rows of chips. They were twenty-five pills wrapping over five lines and pushing the table below the fold before anyone had filtered anything. Still multi-select — the panel holds ordinary checkboxes and stays open while you tick several, and the button says how many are picked. The status grouping (Not started, Being worked, In approval, With shipper, Decided) survives inside the panel, because 'show me what is stuck at approval' is the question people bring to that filter.",
    ],
    overruled: [
      "The salesperson filter on Review meeting was multi-select. It is one at a time now — the row of pills was what made the bar unreadable once Commercial grew past a handful of names.",
      "Status, Service and Group filtered as chip rows. Same filters and same multi-select, in dropdowns. Applied to Dashboard all as well as Dashboard PNS: they are one component, and two sibling boards with different filter controls would be worse than either choice made consistently.",
    ],
  },
  {
    date: "2026-08-14",
    title: "Sidebar regrouped: Weekly meeting removed, Planning and Sales CRM sections added",
    by: "Michael + Claude",
    changes: [
      "Weekly meeting is gone. It covered the same ground as Review meeting (everything pending, by who's carrying it) and the two were confusing people about which one to open.",
      "New Planning section holds Review meeting and Workload — both a step back from any single ticket, walking the team's agenda or capacity rather than acting on one queue.",
      "New Sales CRM section holds Pending CRM ID, Accounts and the sync screen (renamed from \"Sales CRM sync\" to just \"Sync\" now that it sits under a Sales CRM heading) — everything that traces back to a Sales CRM opportunity, together instead of scattered through Solutioning's queue list.",
      "No backend or routing changes — every screen kept its id, so links and the global search still resolve the same places. This is a sidebar reorganization only.",
    ],
    overruled: [
      "Review meeting, Workload, Pending CRM ID, Accounts and Sync were entries in the Solutioning list. They now live in their own sections.",
    ],
  },
  {
    date: "2026-08-14",
    title: "Edit input fixed; the rest of the backlog: ignore list, two meetings, RDO",
    by: "Baskoro + Claude",
    changes: [
      "FIXED: Edit input was dead on every ticket. Pressing it threw a React error and blanked the whole tab, so nobody could correct an intake at all. The cause: the Input tab swaps about forty read-only values for form controls in one pass, and those values were rendered as bare text. Text has no identity for React to match against, so its deletion pass failed and took the tab down with it. Every one of them is now wrapped in an element. Found by instrumenting the live build until it named the exact node — the “Rp 25.000.000” text inside the Potential revenue row.",
      "The Sales CRM sync now actually consults the ignore list. The table and its permission were built on 13 August and nothing ever read the table, so “Test Ninja Biz - 1” arrived on every single import and was dismissed by hand every time. An ignored id is skipped before anything else happens to it — not created, not refreshed, and its account is not even fetched — and the skip still appears in the run’s report with its reason, which is the whole difference between ignoring a deal and losing one.",
      "New Administration / Sync ignore list to manage it. A reason is required, for the same purpose it is on a PSP exception. The screen also says what ignoring does NOT do: it stops future imports, it does not delete a ticket already raised, and any id that still has one is marked.",
      "Review meeting is now run by region. Pick the regions in the room and the salesperson list narrows to whoever actually has a live deal there — picking from all of Commercial when three of them cover your region is how an agenda ends up with somebody else’s deals in it. Both selectors are multi-select, and the salesperson list is derived from the tickets rather than from a region field on a user, so there is no second thing to keep in step with reality.",
      "New Weekly meeting screen beside it, for the PNS side: everything active at Pending PNS, grouped by watched group first and by whoever holds it inside that. Unassigned sorts to the top of each group, because an unowned ticket in a watched group is the thing most worth saying out loud in the room. Same region and salesperson filters.",
      "New Reference / RDO page. Every opportunity Commercial has said carries RDO, filterable by region, with decided deals greyed rather than hidden — what was agreed on a won deal is the precedent somebody will quote back at you. It also sets out where RDO sits in the 5A customization levers. What it does not yet carry is the acceptance criteria and the example photos: those are not in anything the app holds, and inventing them would be worse than the gap, so the page says so.",
      "The one-pager flow chart is redrawn and correct again. It had shown the approval line as Price → PSP → Head Sales → C-level, which has not been true since 13 August: the Head of PNS goes FIRST, there is a Head of PSP step, and Must Win reaches C-level like the other two watched groups. It now shows all four cases explicitly and carries a note at the top telling anyone who learned the old order to re-read it.",
      "New Reference / Fields page, answering two questions that could previously only be answered by reading the backend source. First: which fields actually stop a ticket. About thirty are marked required on the intake form and nothing checks them afterwards — only FIVE things genuinely block, and calling all of them required buried the five among the thirty. Those five are listed first, with what each one stops and how to clear it. Second: which fields come from Sales CRM, and whether a correction made here survives. Sales CRM OWNS the stage, deal name, Sales PIC, submitted date, Must Win, committed revenue, close date and lead source — those are re-copied every morning, so correcting one here lasts until tomorrow. Everything else it sends only fills a blank. The page is generated from the same tables the sync walks, so it cannot claim a field syncs when it does not.",
      "RDO details now come from Sales, per deal. “RDO: Yes” on its own is not something PNS can price against, and what counts as valid differs by shipper, so there is no single company-wide rule to publish. The New Request form asks for RDO details as soon as RDO is set to Yes, and example photographs attach to the ticket as their own kind, “RDO example from Sales” — labelled separately from goods photos so the RDO page can collect them across every deal. Reference / RDO shows the details in full and marks every deal tagged Yes with nothing behind it, which is the list to chase.",
      "New verify_sync_guards test suite. Every check in it exists because something was built and then not wired up — the ignore list, the revenue-0 import landing in a status the rules forbid, and the refresh re-reading two fields out of fifteen. That is this repo’s most expensive failure mode: the code looks present and nothing happens.",
    ],
    overruled: [
      "The Review meeting filtered by a single salesperson chosen from everyone in Commercial. It is region-first now, and the salesperson list follows the region.",
      "The weekly agenda was section B of the Review meeting (“All pending”, by salesperson). PNS gets its own screen grouped by watched group, because the question in a PNS meeting is where the Hypercare deals are, not whose they are.",
    ],
  },
  {
    date: "2026-08-14",
    title: "PNS rollout: self-assignment, watched-group menu, accounts, status flow",
    by: "Baskoro + Claude",
    changes: [
      "Assignment belongs to the PNS team, not only the Head, and there is one assignment rather than two. Anyone in PNS can take a ticket, hand it over or put it back, on any ticket whoever priced it — and now from the queue list as well as from the ticket, because taking a ticket should cost one click from the list you are already reading. Every move is still written to the history and the audit log with a name on it, which is the oversight that was actually doing the work.",
      "A salesperson can hand over a ticket that is theirs. Previously only a Sales Manager or the Head could change the Sales PIC, so somebody going on leave needed a manager to type a name. You can only hand it away — once it is somebody else's, moving it back is the Manager's or Head's call. The app also now refuses to hand a ticket to a name nobody has registered, because notifications to an unregistered person go nowhere.",
      "Must Win is on the New Request form. It sits next to Account type but is deliberately not one of its options: Hypercare and Strategic describe the ACCOUNT and come down from the Sales CRM account group, Must Win describes THIS DEAL. A later sync overwrites it from Lead Source Detail, which is correct — Sales CRM is the record.",
      "New Watched section in the sidebar with one screen per group — Hypercare, Strategic, Must Win — each badged with how many are live. The same three are toggles on every queue's filter bar, so a list you are already reading can be narrowed without navigating away.",
      "New Accounts screen. A ticket is still raised per opportunity and always will be, but one account normally runs several at once, and the flat queues made one shipper look like four unrelated ones. The same tickets are now also served grouped by account, with the account's live total, its tier, and every deal under it. Each ticket also shows the account's other opportunities inline.",
      "New Reference / Status flow screen: every way a ticket can change status, what triggers it, and who does it. It is generated from the same table the server enforces, so it cannot drift from the rule.",
      "How do I… gains 'My ticket is stuck — what actually moves it?', which is the same explanation in the guided flow rather than only on a reference page: most statuses are a consequence of doing something and have no dropdown, a few are a choice and have buttons, and the two things that stop a ticket dead are a missing Sales CRM id and revenue 0. 'Take me there' opens Status flow.",
      "PNS can now correct potential revenue and account type, not just the rest of the intake. Those two re-route the ticket, so they were the Sales Head's alone — but while PNS is the only team on the platform that left the fix with the one role not using the app, and revenue 0 is the single thing that stops a ticket moving at all. They go back to the Sales Head when PNS_PILOT is turned off. Every edit re-runs the routing rule and is written to the history with a name and the before/after, so a re-route is never silent. How do I… has a new entry for it.",
      "Workload is now visible to the whole PNS team, not just the Head — you cannot sensibly decide whether to pick a ticket up without seeing who is at the cap. It is split by audience: the team sees queue depth, and days-to-clear and won/decided stay with the Head. Those figures are filtered out on the server, not hidden in the page, so they never leave it for someone who should not see them.",
      "POST /status now validates where it is being asked to go. It used to accept any string, so a typo or an older build's vocabulary could write a status the running code cannot act on straight onto a ticket — which is the orphaned-status mess V20/V21 had to clean up by hand. Most statuses are a consequence rather than a choice (attaching a price, finalising, a signature), and those cannot be reached by naming them at all.",
      "New Reference / Data checks screen for the duplicates question. Three different things get called duplicates and they have three different fixes, so the screen names which one it found: a ticket raised here before the opportunity existed and then imported again under its real id (the common one — a UNIQUE column accepts any number of NULLs); two Sales CRM opportunities that are one deal; and one account arriving under two shipper names. Sibling opportunities are counted and deliberately not listed, because they are not a fault.",
      "Imported opportunities with no potential revenue now land in Open, not Pending PNS or Pending Sales. Revenue decides who prices the deal, which 5A ceiling applies and whether PNS reviews it, and the app already refuses to enter a working status without it — the import was walking past its own gate and leaving tickets in a status the rules say they may not be in. That is why tickets appeared with a CRM ID and no revenue.",
      "The sync reads every mapped field on every run, through one table the import and the refresh both walk. Sales CRM's own facts (stage, committed revenue, close date, lead source) overwrite ours; volume, destination, contact and go-live fill a blank only, because PNS corrects those here deliberately. Potential revenue is filled in when ours is still 0 and Sales CRM now has one, and the routing is re-derived with it.",
      "The whole raw Sales CRM record is kept on each ticket and shown under 'Sales CRM record', and the sync now reports which fields Sales CRM sends that this app does not read yet. 'Are we syncing everything we could?' was previously answerable only by opening a record in Sales CRM and comparing by eye.",
      "Fixed: the orphaned-status diagnostic never learned about Open and Pending CRM ID, so it reported every ticket in the two newest statuses as unrecognised. It is now derived from the status list instead of being maintained by hand.",
    ],
    overruled: [
      "Assignment was the PNS Head's alone. It is now any PNS member's, for the PNS-first rollout — the Head keeps oversight through the audit trail rather than through a gate.",
      "The Sales PIC could only be changed by a Sales Manager or the Head.",
      "Potential revenue and account type were Commercial Head only.",
      "Workload was gated on the assign permission, which made it PNS-Head-only. It now has its own seeWorkload permission — widening assign to the whole team would otherwise have published the per-person days-to-clear and win figures to everyone as a side effect.",
      "setAcct is removed. It was declared in can() and sent by /api/me and checked by absolutely nothing — the account tier is edited through editAcctOrRev like the revenue beside it.",
      "PNS_REVIEW_DELEGATE and review_delegate() are removed. A standing reviewer for the Standard 30 Mio+ band was agreed on 2026-08-11 and the code for it was written but never called by anything — submit_price answers the same question with auto_assignee(), which is the same intent and does not go stale when one person is on leave.",
      "The separate 'PNS price reviewer' slot is retired. It asked a second question — who is checking this? — on top of the one that matters, who owns this, and nothing a reader could see told the two apart. There is one PNS assignment now, the PNS PIC. A second opinion is asked for in the ticket's Discussion, where the answer is written down against the deal; PSP remains the formal margin check. The Pending Review - Head PNS notification now goes to the ticket's PNS PIC. tickets.reviewer_name stays in the schema — dropping it needs a migration on a database two people deploy into, and a column nothing reads costs nothing — but nothing writes it any more.",
      "The refresh re-copied two payload fields (committed revenue, close date) out of the fifteen the import reads. Anything Sales filled in after a deal was imported stayed blank here forever.",
    ],
  },
  {
    date: "2026-08-11",
    title: "Sales CRM becomes the system of record: CRM ID mandatory, Must Win, Open",
    by: "Baskoro + Claude",
    changes: [
      "The agreed process: Sales raise the opportunity in Sales CRM first, then either open the ticket here with its CRM ID or wait for the daily sync. A ticket raised here without a CRM ID parks in the new status Pending CRM ID and cannot move — the sync finds each deal by id, so a ticket it cannot see would drift out of step and be believed anyway. Its own screen collects the id and releases the ticket.",
      "The daily sync now treats Sales CRM as the priority on every run: stage, deal name, Sales PIC and Must Win are re-copied as they stand there. Service line, potential revenue and account tier are still left alone, because PNS corrects those here on purpose.",
      "New status Open: intake complete, nothing owed by Sales, and nobody has picked it up. Previously these sat in Pending PNS, which reads as 'someone is working on it' and hid the difference between work in progress and work nobody has started. Its screen offers exactly two moves — start work on it, or send it back to Sales with what is missing.",
      "Must Win joins the tiering as a third watched group, alongside Hypercare and Strategic. It sits on the OPPORTUNITY, not the account: the same account can have a must-win deal and five ordinary ones, so tagging the account would have promoted all of them. Hypercare and Strategic stay at account level, inherited from the parent group.",
      "Non-Strategic is renamed Standard — same tier, a name that says what it is rather than what it is not.",
      "Review - Head PNS is narrowed to the three watched groups. A Standard deal now goes straight to the shipper whatever its revenue; the old 'any Sales price at or above 30 Mio' rule was catching ordinary deals in volume and turning PNS review into a toll booth.",
      "Two dates instead of one. Submitted is now Sales CRM's own date (its new_date, the day the opportunity was raised) and is corrected on every refresh; First synced is the day this app first saw the deal, written once and never revised. Before this, an imported ticket claimed it arrived the day somebody ran the sync, so weeks of pipeline age disappeared — one deal checked in Sales CRM was raised on 14 July and would have shown as 12 August.",
      "Must Win is read from Sales CRM's Lead Source Detail field, where the value is literally 'Must Win' — it is not a field of its own. It can also be set by hand on the ticket for a deal Sales has not tagged there yet; a later sync overwrites that, because Sales CRM is the record.",
      "Every ticket shows which Sales CRM records it is tied to — the opportunity (the deal, where Must Win and the stage live) and the account (which sets the tier, inherited from the parent group) — each with a link straight into Sales CRM.",
    ],
    overruled: [
      "PNS review was triggered by revenue (Sales-priced at or above Rp 30 Mio). It is now triggered by group membership: Hypercare, Strategic or Must Win.",
      "A ticket could be raised here with no link to Sales CRM at all. Now it can be raised, but not progressed.",
      "'Non-Strategic' as a tier name.",
    ],
  },
  {
    date: "2026-08-11",
    title: "Reconciled: Michael's PSP work and Baskoro's .30/.31 are both in .32",
    by: "Baskoro + Michael + Claude",
    changes: [
      "The two clones had diverged. Michael's three commits (PSP entry gate on the forward path, Escalate as a button, PSP entering pricing while deciding, the edit-input go-live fix, rate-card links, Hypercare in the New Request dropdown) were in GitHub but not in the live .31. Baskoro's .29/.30/.31 were live but not in GitHub. Both are now merged into .32 and pushed; neither side was dropped.",
      "Michael's new code paths were renamed onto the new status vocabulary as part of the merge, so Escalate and Send to PSP both target Pending Review - PSP.",
      "From now on a change is previewed locally against a mock API before it is deployed, and the branch is compared against GitHub first. The .31 deploy overwrote Michael's live build because neither check was run.",
    ],
    overruled: [
      "ask_psp on POST .../price stays retired, as Michael decided — escalation goes only through POST .../status, where the gate is now enforced. The Escalate checkbox added on the Baskoro side is replaced by his button.",
    ],
  },
  {
    date: "2026-08-11",
    title: "Review statuses renamed, sync closes tickets, PNS pilot, in-app guide",
    by: "Baskoro + Claude",
    changes: [
      "The four review statuses are renamed to say who owes the decision: Pending Review - Head PNS, Pending Review - Head Sales, Pending Review - PSP, Pending Review - C-level. Existing tickets and their history were renamed with them, so the timeline reads in today's vocabulary.",
      "The Sales CRM sync now moves our status when the opportunity closes there. Closed-Lost and Future Opportunity become Lost (reason: closed in Sales CRM); the accepted stages become Ready to Ship. If the ticket's onboarding fields are still blank when that happens, PNS and Sales are notified with the exact list of what is missing.",
      "The sync screen has explicit modes. 'Re-check held tickets only' ignores dates entirely and re-reads every opportunity behind a ticket you hold — this is how you find deals that closed in Sales CRM after they were imported. The day window has always been the opportunity's creation date, never its last edit; the screen now says so.",
      "Account tier (Hypercare / Strategic / Non-Strategic) filters on the dashboard with counts, and is colour-coded in the table. It decides routing, pricing ceilings, PSP entry and exec sign-off, so it sits beside status rather than hiding.",
      "PNS pilot: while the tool runs inside PNS before Sales is onboarded, PNS can attach prices on Sales-owed tickets including below the floor, and the PNS Head can acknowledge in the Sales Head's place. Set PNS_PILOT=0 in the portal the day Sales starts working its own queues and every rule snaps back with no deploy.",
      "New 'How do I…' screen under Reference: every flow written as the thing you are trying to do, with a button that takes you to the right screen. Open to everyone.",
      "The intake and charter now separate Kick-off from Charter. Sections 1-3 are solutioning; section 4 holds go-live and the account-system IDs Ops needs to onboard.",
      "Reopening a lost or cancelled deal is any salesperson's to do, not only the Sales Head.",
      "The PSP exception card gained 'Open & send now', so recording Alex's exception and sending the ticket to PSP is one step when you mean both.",
      "Shipper names are no longer truncated in the dashboard table — the part that told two tickets apart was the part being cut off.",
    ],
    overruled: [
      "The old status names (Pending PNS Review, Pending Head Review, Pending PSP Approval, Pending Exec Sign-off) are gone. Same gates, named for who decides.",
      "The sync was strictly one-way for status: it copied the Sales CRM stage but never acted on it, and status_for_stage() was dead code. Baskoro's call is that a closed opportunity closes our ticket, with a flag when required fields are blank.",
      "Reopen was Commercial Head only.",
      "Pricing was strictly the responsible side's. PNS covers both during the pilot only.",
    ],
  },
  {
    date: "2026-08-11",
    title: "Open visibility, global search, phases and the Sales Manager tier",
    by: "Baskoro + Claude",
    changes: [
      "Everyone signed in can now browse every queue — active, pending and closed. What stays gated per role is acting: the buttons inside each screen, which the backend refuses anyway. Cost and margin stay restricted to PNS, PSP and CSO.",
      "A search bar sits in the header on every screen. It finds tickets by reference, shipper or Sales CRM opportunity id, and also jumps to any view — type 'psp' or 'sales' and pick the screen. Press / to focus it.",
      "The PSP queues moved into the Solutioning menu, tagged PSP — margin approval is a step of solutioning, not a separate pipeline.",
      "Every queue carries the same filter bar, with a PNS PIC dropdown and an 'Assigned to me' toggle, so PNS members can narrow any list to their own assignment in one click.",
      "The dashboard breaks the book down by phase — Being worked, In approval, With shipper, Won, Lost — instead of only won and lost. Each phase tile is a click-to-filter. A 'Waiting on me' tile shows how many of your own tickets still need a move.",
      "Tickets can be filtered by Sales CRM stage on the dashboard. The stage is reference data from the sync; it is not this app's status and never overwrites it.",
      "The PNS Head can now delete a ticket to the recycle bin, and restore from it. Erasing permanently from the bin stays Admin only.",
      "New Sales Manager tier (Commercial only): a Sales Manager can reassign the Sales PIC on a ticket, exactly like the Sales Head, and nothing else beyond staff.",
      "The PNS assignment is stated on every ticket card and on the ticket header even when empty — 'PNS unassigned' in amber, because an unowned ticket is a fact people must see.",
      "The count badge next to a menu entry is the number of tickets sitting in that status. One ticket in Proposal Submitted reads as 'Proposal submitted · 1' — the 1 is a live count, not part of the name.",
    ],
    overruled: [
      "Legal was scoped to accepted deals only when browsing. Baskoro opened visibility to every role; Legal still cannot act on anything.",
      "Delete to the recycle bin was Admin only. The PNS Head has it too now; permanent erase stays Admin.",
      "Sales PIC reassignment was Commercial Head only. The new Sales Manager tier shares it.",
    ],
  },
  {
    date: "2026-08-11",
    title: "The .30 collision had a real casualty: SOF-2001322 vanished from PSP — Pending",
    by: "Michael + Claude",
    changes: [
      "Baskoro's overwritten .29/.30 used \"Pending Review - PSP\" as the status a ticket carries once sent to PSP. This build has always used \"Pending PSP Approval\". Deploying over his version fixed the code but not data already written with his string, so SOF-2001322 (PT Supa Surya Niaga) sat under a status nothing in the running app matched, and stopped appearing in PSP — Pending with no error, no deletion, nothing to see. Reported by Michael, traced from a screenshot of the ticket's own status pill, not found by any test in tests/.",
      "V20 corrects that one confirmed ticket. status_since is left alone, this is a label fix, not a real transition.",
      "Administration now has an Orphaned ticket status check: any ticket whose status isn't one the running code recognises, found without guessing what an unfamiliar value should become. Baskoro's unpushed build may have touched other statuses the same way; this is how to find them instead of waiting for someone to notice a ticket went quiet.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-11",
    title: "PSP can enter pricing on the ticket they're deciding, not just approve or reject",
    by: "Michael + Claude",
    changes: [
      "PSP — Pending now has link, label, margin and discount fields, submitted in the same action as Approve or Reject. Left blank, PSP decides on whatever is already attached, unchanged. A ticket reaches PSP precisely because someone else could not price it as often as it reaches PSP to check someone else's number, and there was no way to enter the first case without a separate trip through Awaiting price.",
      "Confirmed and left alone: for a managed account (Strategic/Hypercare), both Approve and Reject already returned the ticket to whoever priced it (Pending PNS or Pending Sales) — Approve does it via psp_ready and an explicit Submit proposal, Reject via the normal re-quote path. That part was already correct.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-11",
    title: "Deploy collision: Baskoro's live .30 was not in GitHub and got overwritten",
    by: "Michael + Claude",
    changes: [
      "Before this deploy, the live app reported build 2026-08-11.30. The newest commit in GitHub at that point was 5e163d3 (2026-08-10.28). .29 and .30 were deployed directly and never pushed, so this repo has no record of what changed in them.",
      "Michael chose to deploy anyway rather than wait, knowing this overwrites .30 on the live app. This entry exists so that choice, and what it cost, is written down rather than silently lost — the live build number will read lower after this deploy than it did before, which is the visible sign something upstream of it was never in git.",
      "If you are Baskoro reading this: whatever .29/.30 did on your machine still exists there. Push it as its own commit against current main so it can be reconciled and re-applied, rather than redone from memory.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-11",
    title: "PSP entry gate closed on the forward path, Escalate as a button",
    by: "Michael + Claude",
    changes: [
      "The PSP entry gate is now also enforced on POST .../status, not only on submit_price. That endpoint is what both Escalate to PSP and Send to PSP (mid-review) actually call, and it had no may_go_to_psp check at all, so either button could route any ticket to PSP with no exception recorded, the exact thing the gate exists to stop.",
      "Escalate to PSP is a button, not a checkbox bundled into Attach price. It acts immediately, independent of whether a price is entered yet, so the ticket appears on PSP's Pending queue the moment it's clicked instead of only once someone also finishes and submits the price form.",
      "Fixed edit-input save failing on unrelated changes: the missing-onboarding-IDs check read the merged payload, so a ticket that already had a go-live date (nearly every ticket the New Request form creates, since Sales CRM imports one too) failed to save any edit at all, a typo in the brief included, until Parent shipper ID, Shipper ID and Corporate branch ID were also filled in. It now only fires when go-live is part of the edit being made.",
      "LTL and B2BR rate cards link to the pricing tool (web-pricing.ninjavan.apps.substrait.build), on Awaiting Price and in the ticket's Pricing tab.",
      "Hypercare added to the New Request account-type dropdown: Hypercare, Strategic, Non-Strategic.",
    ],
    overruled: [
      "The Escalate-to-PSP checkbox on Attach price, and ask_psp on POST .../price, are retired. Escalating now goes only through POST .../status, the same endpoint Send to PSP already used. Two endpoints doing the same discretionary-PSP job, gated separately, is how the gate ended up enforced on one and not the other.",
    ],
  },
  {
    date: "2026-08-10",
    title: "Importer, assignment and sync sizing",
    by: "Baskoro + Claude",
    changes: [
      "Trucking opportunities are imported instead of held back. Sales CRM cannot say whether they are FTL on-call or FTL monthly, so they land as on-call with a note and a flag for Sales to confirm before the charter goes out. Safe as a provisional label, since both FTL lines route to PNS and carry the same ceilings.",
      "Complex Logistics assignment now splits on the account rather than on load. A new account goes to Michael Quinn; an account already shipping goes to Adila. Sameday is Annisa's exclusively from intake to published charter.",
      "PNS can edit intake. During the Sales CRM rollout most intake arrives imported and incomplete, and waiting on Sales to complete it would stall the solutioning it exists to feed.",
      "The sync sizes itself. It reads from the newest opportunity and stops once it reaches ones already imported, so a routine run reads a single page. The page count is now only a ceiling for a first import or a long gap.",
      "Accounts for a page are fetched concurrently. Sequentially it was up to 200 round trips before the first ticket was considered, which ran past the ingress timeout and returned an empty 502.",
      "A sweep that runs out of time now returns what it has and says so, rather than being cut off with no explanation.",
    ],
    overruled: [
      "Trucking was being skipped entirely to avoid guessing the FTL line. Holding the work back cost more than a provisional label that gets corrected.",
      "Intake was Sales and Sales Planning only. PNS is added for the rollout period.",
      "The sync asked how many pages to read. It now works that out itself.",
    ],
  },
  {
    date: "2026-08-10",
    title: "PSP entry gate",
    by: "Baskoro + Claude",
    changes: [
      "Three routes reach PSP on the rule itself: a Sameday discount over 20 percent, either FTL line at or above Rp 30 Mio, and any Hypercare or Strategic account.",
      "The discretionary routes are gated instead. A below-bottom price the Sales Head has acknowledged, and the optional Escalate to PSP checkbox, only continue to PSP where Alex (CSO) has granted an exception.",
      "Strategic and Hypercare carry that exception by being managed. Any other ticket needs the PNS Head to open it, recording what Alex granted and where. The note is mandatory.",
      "A below-bottom price on a ticket with no exception now ends with the Sales Head, who is the sign-off rather than a step on the way to PSP.",
    ],
    overruled: [
      "Every below-bottom price was going to PSP after the Sales Head acknowledged it. That sent deals to PSP that carry no exception, which is not what PSP reviews.",
      "The gate was then applied too widely, which would have diverted Sameday over 20 percent and FTL at or above 30 Mio away from PSP. Those are PSP's by rule and were restored.",
      "The optional Escalate to PSP checkbox was open to anyone on any service. It now follows the exception gate.",
    ],
  },
  {
    date: "2026-08-10",
    title: "Sales CRM sync, approvals and field comments",
    by: "Baskoro + Claude",
    changes: [
      "Sales CRM sync: manual, dry run by default, restricted to one named owner. Creates tickets for new opportunities and refreshes stage, committed revenue and close date on ones already imported.",
      "Pricing ceilings from the four 5A tables, checked automatically when a price is attached, per service and per revenue band.",
      "Routing fix: service is tested before revenue, so FTL monthly and Sameday reach PNS at every band. Previously they were handed to Sales above 30 Mio.",
      "Hypercare added as a third account tier, alongside Strategic and Non-Strategic.",
      "Executive sign-off gate for Hypercare and Strategic solutions, Alex and Dhinesh, always last.",
      "Project Charter can be emailed to Legal, Sales Admin and the sales PIC.",
      "Comments can be attached to a single intake field, with a recap into the main thread.",
      "PNS assignment by service line, capped at 10 tickets each. Past the cap a ticket stays unassigned and the Head is told.",
      "QC becomes a role group and owns CAPA closure. Legal, Finance and Visitor are view only. Sales Planning may correct intake.",
      "Status filter grouped by who is acting, with counts.",
    ],
    overruled: [
      "Global ID field removed. The shipper ID is the global shipper id, one number under one name.",
      "Below-bottom was going to be fully automatic. Michael's manual checkbox is kept alongside the computed guard, so both run.",
      "Sales Head was going to be the final acknowledger for a margin breach. Michael's flow wins: the Sales Head acknowledges, then PSP signs off. More oversight, and it is what production already does.",
    ],
  },
  {
    date: "2026-08-10",
    title: "PSP queue and mandatory margin review",
    by: "Michael",
    changes: [
      "PSP gets its own Pending and Finished queues, plus a PIC per ticket.",
      "Below-bottom prices go to the Sales Head to acknowledge, then to PSP for a mandatory margin sign-off.",
      "Optional Escalate to PSP checkbox for a second opinion on any service.",
      "After PSP approves a price that needed no PNS review, the ticket returns to whoever priced it for an explicit final submit.",
      "Bottom margin narrowed to the two services with a published floor, LTL 5 percent and B2BR 10 percent.",
    ],
    overruled: [
      "The Awaiting Price form had stopped collecting margin. It collects margin and discount again, because the 5A tier ceilings need both to check anything.",
    ],
  },
  {
    date: "2026-08-08",
    title: "Waiting times, copyable charter, CAPA attachments",
    by: "Michael",
    changes: [
      "Pickup and delivery waiting times added to the intake.",
      "Project Charter can be copied as a formatted table for pasting into email.",
      "CAPA supports file attachments.",
    ],
    overruled: [],
  },
];

function Table({ head, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Entry({ entry }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-[13.5px] font-semibold">{entry.title}</h2>
          <p className="text-[12px] text-slate-500">{entry.date} &middot; {entry.by}</p>
        </div>
        {entry.overruled.length > 0 && (
          <Pill tone="bg-rose-50 text-rose-700">
            {entry.overruled.length} overruled
          </Pill>
        )}
      </div>

      <Table
        head={["#", "What changed"]}
        rows={entry.changes.map((c, i) => [
          <span className="font-mono tabular-nums text-slate-400">{i + 1}</span>,
          c,
        ])}
      />

      {entry.overruled.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="mb-2 text-[12px] font-semibold text-slate-600">
            Overruled by this release
          </p>
          <Table
            head={["", "What was decided instead"]}
            rows={entry.overruled.map((o) => [
              <Pill tone="bg-rose-50 text-rose-700">overruled</Pill>,
              o,
            ])}
          />
        </div>
      )}
    </Card>
  );
}

export default function Changelog() {
  return (
    <>
      <Head title="Changelog"
        sub="Read-only. Newest first."
        right={<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{ENTRIES.length} entries</span>} />

      <p className="mb-4 max-w-3xl text-[13px] leading-relaxed text-slate-600">
        Two people ship to this app, and a decision one makes can quietly undo the other&rsquo;s.
        This screen records what went in and, where the two streams disagreed, which call was
        overruled and what stands instead.
      </p>

      {/* The rule is stated in the app because this is the page both people actually open.
          It is repeated in CHANGELOG.md for whoever is reading the repo instead. */}
      <div className="mb-5 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-[12.5px] font-semibold text-amber-900">
          Every change to this app gets an entry here.
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-amber-800">
          Add it in the same commit as the change, at the top of the <code>ENTRIES</code>{" "}
          array in <code>frontend/src/screens/Changelog.jsx</code>. If your change reverses
          or narrows something the other person built, it belongs under{" "}
          <b>overruled</b>, not under what changed. An overruled decision that goes
          unrecorded is how the same argument gets had twice.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {ENTRIES.map((e) => <Entry key={e.date + e.title} entry={e} />)}
      </div>
    </>
  );
}

// New entries go at the top of ENTRIES.
