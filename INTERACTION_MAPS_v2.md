# BENAVORA — Interaction Maps v2.0
## Supersedes: INTERACTION_MAPS.md v1.0
## Date: July 17, 2026
## Status: CANONICAL — Every interactive element on every page must appear here.
## Purpose: Prevents FORGE from building pages with dead-end navigation, missing toasts, or broken flows.

---

## Interaction Map Conventions

Every interaction follows this structure:
- **User action:** What the user does
- **Frontend reaction:** Immediate UI response (optimistic updates, loading states, disabled states)
- **API call:** Exact route and method
- **Backend processing:** What the server does
- **Database write:** Table(s) written
- **Side effects:** Notifications, redirects, other triggered events
- **Success response:** What user sees on success
- **Error response:** What user sees on failure
- **Tracking event:** Analytics event name

---

## Section 1: Authentication & Onboarding

### 1.1 Registration
- **User action:** User fills email, password, organization name on /register and clicks Create Account
- **Frontend reaction:** Button disabled, spinner shown
- **API call:** Supabase Auth signUp()
- **Backend processing:** Creates auth.users record, triggers DB function to create organizations + profiles records
- **Database write:** organizations, profiles
- **Side effects:** Redirect to /onboarding
- **Success response:** User lands on onboarding wizard step 1
- **Error response:** Toast: 'An account with this email already exists.' / 'Password must be at least 8 characters.'
- **Tracking event:** user_registered

### 1.2 Login
- **User action:** User enters email/password on /login and clicks Sign In
- **Frontend reaction:** Button disabled, spinner shown
- **API call:** Supabase Auth signInWithPassword()
- **Backend processing:** Middleware validates session, reads profiles.onboarding_completed
- **Database write:** none
- **Side effects:** Middleware checks onboarding_completed — redirect to /onboarding if false, /dashboard if true
- **Success response:** User lands on dashboard or onboarding
- **Error response:** Toast: 'Invalid email or password.'
- **Tracking event:** user_logged_in

### 1.3 Onboarding Wizard Step Completion
- **User action:** User completes a step and clicks Next
- **Frontend reaction:** Progress bar advances, next step renders
- **API call:** PATCH /api/onboarding
- **Backend processing:** Updates progress.completed_steps array in onboarding record
- **Database write:** organizations (onboarding fields)
- **Side effects:** On final step: sets onboarding_completed=true, redirects to /dashboard
- **Success response:** Next step renders or redirect to dashboard
- **Error response:** Toast: 'Failed to save. Please try again.'
- **Tracking event:** onboarding_step_completed

### 1.4 Explore Platform First (Skip Onboarding)
- **User action:** User clicks 'Explore the platform first' on onboarding
- **Frontend reaction:** Sets benavora_onboarding_skip session cookie
- **API call:** none (client-side cookie only)
- **Backend processing:** Middleware reads cookie and bypasses onboarding gate for this session
- **Database write:** none
- **Side effects:** User can access all pages for this browser session. Fresh login resets the gate.
- **Success response:** Redirect to /dashboard
- **Error response:** none
- **Tracking event:** onboarding_skipped

---

## Section 2: Dashboard

### 2.1 FlightPathHUD Card Click (Front Face)
- **User action:** User clicks any of the 6 stage cards on the front face
- **Frontend reaction:** Immediate navigation (Link component, no loading state needed)
- **API call:** none (navigation only)
- **Backend processing:** none
- **Database write:** none
- **Side effects:** Navigate to stage href: /onboarding, /research, /opportunities, /draft-generator, /admin/autoapply-ops, /donor-discovery
- **Success response:** Target page loads
- **Error response:** 404 if page missing
- **Tracking event:** hud_stage_clicked

### 2.2 FlightPathHUD Card Hover (Flip to Back Face)
- **User action:** User hovers over any HUD card
- **Frontend reaction:** CSS 3D flip animation (group-hover:rotate-y-180). Back face shows: Last Activity, progress bar, action button.
- **API call:** Data already loaded on mount via parallel fetch
- **Backend processing:** none (data pre-loaded)
- **Database write:** none
- **Side effects:** none
- **Success response:** Back face visible with live data
- **Error response:** Shows '—' for any null data fields
- **Tracking event:** none

### 2.3 Today's Action Items — Row Click
- **User action:** User clicks any row in the Today's Action Items widget
- **Frontend reaction:** Immediate navigation via Link component
- **API call:** none
- **Backend processing:** none
- **Database write:** none
- **Side effects:** Navigate to: /emails, /opportunities, /draft-generator, /deadlines, /applications, /admin/autoapply-ops, /research
- **Success response:** Target page loads
- **Error response:** none
- **Tracking event:** action_item_clicked

### 2.4 Quick Actions — Run Research
- **User action:** User clicks 'Run Research' in Quick Actions panel
- **Frontend reaction:** Navigate to /research
- **API call:** none
- **Side effects:** none
- **Tracking event:** quick_action_research_clicked

### 2.5 View All Deadlines
- **User action:** User clicks 'View all' in Upcoming Deadlines panel
- **Frontend reaction:** Navigate to /deadlines
- **Tracking event:** deadlines_view_all_clicked

---

## Section 3: Opportunities

### 3.1 Add New Opportunity (Manual)
- **User action:** User clicks 'Add Opportunity' and fills form
- **Frontend reaction:** Modal or new page form. Submit button disabled while saving.
- **API call:** POST /api/opportunities
- **Backend processing:** Validates fields. Inserts to opportunities table. Triggers Eligibility Scoring Agent async. Triggers Grant Probability Agent async.
- **Database write:** opportunities, opportunity_keywords
- **Side effects:** Agent runs queued for eligibility + probability scoring. Toast: 'Opportunity added.'
- **Success response:** New opportunity appears in list with 'Scoring...' badge
- **Error response:** Toast: 'Failed to add opportunity. Please try again.'
- **Tracking event:** opportunity_created

### 3.2 Probability Score Badge Display
- **User action:** User views opportunity list
- **Frontend reaction:** Each row shows probability badge. Green (70+), Amber (40-69), Red (<40), Gray (unscored/loading).
- **API call:** GET /api/opportunities (includes join on opportunity_probability_scores)
- **Backend processing:** Returns opportunities with probability_score, confidence fields
- **Database write:** none
- **Side effects:** none
- **Success response:** Colored badges render per row
- **Error response:** Gray 'Unscored' badge shown if score missing
- **Tracking event:** opportunity_list_viewed

### 3.3 Sort by Probability
- **User action:** User selects 'Probability (High to Low)' from sort dropdown
- **Frontend reaction:** Updates URL param ?sort=probability_desc, re-fetches list
- **API call:** GET /api/opportunities?sort=probability_desc
- **Backend processing:** ORDER BY probability_score DESC NULLS LAST
- **Database write:** none
- **Side effects:** none
- **Success response:** List re-orders with highest probability at top
- **Error response:** Toast: 'Failed to load. Please refresh.'
- **Tracking event:** opportunities_sorted_by_probability

### 3.4 Run Probability Scoring (Batch)
- **User action:** User clicks 'Score All' button on opportunities page
- **Frontend reaction:** Button shows spinner. Disables during run.
- **API call:** POST /api/intelligence/grant-probability (batch mode)
- **Backend processing:** Runs computeGrantProbability for all active opportunities for org. Upserts scores.
- **Database write:** opportunity_probability_scores, opportunities (probability_score field)
- **Side effects:** Toast: 'Scoring complete. X opportunities scored.'
- **Success response:** All badges update with scores
- **Error response:** Toast: 'Scoring failed. Please try again.'
- **Tracking event:** probability_batch_scored

### 3.5 Add Opportunity to Pipeline
- **User action:** User clicks 'Add to Pipeline' on any opportunity
- **Frontend reaction:** Confirms, shows loading
- **API call:** POST /api/applications
- **Backend processing:** Creates application record with stage='discovered', links opportunity_id
- **Database write:** applications
- **Side effects:** Toast: 'Added to pipeline.' Redirect to /applications/[id]
- **Success response:** Application created, user redirected to application detail
- **Error response:** Toast: 'Failed to add to pipeline.'
- **Tracking event:** opportunity_added_to_pipeline

---

## Section 4: Applications Pipeline

### 4.1 Kanban Stage Card Drag
- **User action:** User drags application card to new stage column
- **Frontend reaction:** Optimistic update — card moves immediately. Loading state on card.
- **API call:** PATCH /api/applications/[id]
- **Backend processing:** Validates stage transition rules. Updates stage. Inserts application_stage_history record.
- **Database write:** applications, application_stage_history
- **Side effects:** Toast: 'Application moved to [Stage].' Auto-create deadline if moved to submitted.
- **Success response:** Card renders in new column
- **Error response:** Card snaps back to original column. Toast: 'Stage transition not allowed.'
- **Tracking event:** application_stage_changed

### 4.2 Generate Draft from Application
- **User action:** User clicks 'Generate Draft' on application detail page
- **Frontend reaction:** Loading overlay. Streaming response rendered in editor as it arrives.
- **API call:** POST /api/ai/draft (streaming)
- **Backend processing:** Reads Digital Twin + KB entries + proven narratives + opportunity. Calls Claude with streaming. Returns streamed text.
- **Database write:** drafts (on completion)
- **Side effects:** Draft saved to drafts table. Toast: 'Draft generated.'
- **Success response:** Draft renders in editor. Confidence score shown. KB sources listed.
- **Error response:** Toast: 'Draft generation failed. Please try again.'
- **Tracking event:** draft_generated

### 4.3 Clone Application
- **User action:** User clicks 'Clone' on application row and selects target opportunity
- **Frontend reaction:** Modal with opportunity search dropdown. Clone button.
- **API call:** POST /api/applications/[id]/clone
- **Backend processing:** Reads source draft. Calls Claude to adapt for new opportunity. Creates new application record.
- **Database write:** applications, drafts
- **Side effects:** Toast: 'Application cloned. Reviewing adapted draft.' Redirect to new application.
- **Success response:** User redirected to new application with adapted draft
- **Error response:** Toast: 'Clone failed. Please try again.'
- **Tracking event:** application_cloned

### 4.4 Submit via AutoApply
- **User action:** User clicks 'Submit via AutoApply' on application in ready_for_review stage
- **Frontend reaction:** Confirmation modal. Shows funder portal URL to be visited.
- **API call:** POST /api/agents/automation
- **Backend processing:** Creates submission_queue record. Railway worker picks up job. Launches Playwright session.
- **Database write:** submission_queue
- **Side effects:** Notification when session reaches approval checkpoint or completes.
- **Success response:** Toast: 'Submission queued. You'll be notified when ready for review.'
- **Error response:** Toast: 'Failed to queue submission.'
- **Tracking event:** autoapply_submission_queued

### 4.5 Budget Entry
- **User action:** User adds budget line item on application detail
- **Frontend reaction:** Inline form. Add row button. Total auto-calculates.
- **API call:** POST /api/applications/[id]/budget
- **Backend processing:** Upserts grant_budgets record with line_items array.
- **Database write:** grant_budgets
- **Side effects:** Total requested field updates.
- **Success response:** Toast: 'Budget saved.'
- **Error response:** Toast: 'Failed to save budget.'
- **Tracking event:** budget_updated

---

## Section 5: Research Hub

### 5.1 Resource Card Visit
- **User action:** User clicks Visit on any research resource card
- **Frontend reaction:** Opens URL in new tab (target="_blank", rel="noopener noreferrer")
- **API call:** none
- **Backend processing:** none
- **Database write:** none
- **Side effects:** none
- **Success response:** Resource opens in new tab
- **Error response:** none
- **Tracking event:** research_resource_visited

### 5.2 Resource Search
- **User action:** User types in the 'Search resources...' input
- **Frontend reaction:** Client-side filter — no API call. Filters both pinned and additional resources by name and category in real time.
- **API call:** none
- **Backend processing:** none
- **Database write:** none
- **Side effects:** 'No results found' empty state if no match
- **Success response:** Matching resources shown
- **Error response:** none
- **Tracking event:** research_resource_searched

### 5.3 Funder Match Search
- **User action:** User enters mission statement + filters on /research/match and clicks Find Matches
- **Frontend reaction:** Loading spinner. Results render as cards on complete.
- **API call:** POST /api/match/foundations
- **Backend processing:** Calls matchFunders() — tokenizes mission, computes Jaccard similarity against 1K+ foundation records, returns top 50 ranked by score.
- **Database write:** none
- **Side effects:** none
- **Success response:** Cards showing foundation name, score badge, matchReasons tags
- **Error response:** Toast: 'Match search failed. Please try again.'
- **Tracking event:** funder_match_searched

### 5.4 Run Opportunity Discovery
- **User action:** User clicks 'Run Discovery' button on research page
- **Frontend reaction:** Loading state. Shows source progress indicators.
- **API call:** POST /api/agents/discovery
- **Backend processing:** Calls runOpportunityDiscovery — polls Grants.gov, SAM.gov, Federal Register. Scores matches. Inserts to discovery_matches.
- **Database write:** discovery_matches, discovery_runs
- **Side effects:** Toast: 'Discovery complete. X new opportunities found.'
- **Success response:** Discovery matches appear in morning digest and opportunities section
- **Error response:** Toast: 'Discovery run failed. Check integration settings.'
- **Tracking event:** discovery_run_completed

---

## Section 6: Intelligence Hub

### 6.1 Digital Twin — Rebuild
- **User action:** User clicks 'Rebuild Twin' on /intelligence/twin
- **Frontend reaction:** Loading spinner on rebuild button. Completeness score animates to new value on complete.
- **API call:** POST /api/intelligence/digital-twin
- **Backend processing:** Calls buildDigitalTwin — reads KB entries, org profile, outcomes, applications. Recomputes twin and completeness score. Upserts to organizational_digital_twins.
- **Database write:** organizational_digital_twins
- **Side effects:** Toast: 'Digital Twin rebuilt. Completeness: X%'
- **Success response:** Twin data refreshes on page. Completeness score updates.
- **Error response:** Toast: 'Failed to rebuild twin. Please try again.'
- **Tracking event:** digital_twin_rebuilt

### 6.2 Knowledge Engine Query
- **User action:** User enters question in Knowledge Engine textarea and clicks Submit
- **Frontend reaction:** Loading spinner. Results render in sections: Patterns, Proposals, Insights.
- **API call:** POST /api/intelligence/knowledge-query
- **Backend processing:** Calls queryKnowledgeEngine. Queries knowledge_patterns and intelligence_funded_proposals. Logs to knowledge_queries.
- **Database write:** knowledge_queries
- **Side effects:** none
- **Success response:** Results render in 3 sections with matched patterns, proposals, and AI insights
- **Error response:** Toast: 'Query failed. Please try again.'
- **Tracking event:** knowledge_engine_queried

### 6.3 Reputation Monitor — Check Entity
- **User action:** User enters funder name and clicks 'Check Now'
- **Frontend reaction:** Loading spinner. Alert cards appear on complete.
- **API call:** POST /api/intelligence/reputation
- **Backend processing:** Calls checkEntityReputation — searches news API, calls Claude to classify signals, inserts to reputation_signals, creates reputation_alerts for org.
- **Database write:** reputation_signals, reputation_alerts
- **Side effects:** Toast: 'Check complete. X signals found.'
- **Success response:** Alert cards render with severity color coding
- **Error response:** Toast: 'Reputation check failed. Please try again.'
- **Tracking event:** reputation_checked

### 6.4 Reputation Alert — Mark Read
- **User action:** User clicks 'Mark Read' on alert card
- **Frontend reaction:** Optimistic update — card dims or hides
- **API call:** PATCH /api/intelligence/reputation with {alertId, status: 'read'}
- **Backend processing:** Updates reputation_alerts.status = 'read'
- **Database write:** reputation_alerts
- **Side effects:** Alert count badge decrements
- **Success response:** Card marked as read
- **Error response:** Card reverts. Toast: 'Failed to update.'
- **Tracking event:** reputation_alert_read

### 6.5 Disaster Response — Deploy Response
- **User action:** User clicks 'Deploy Response' on a disaster declaration card
- **Frontend reaction:** Loading state on button. Result summary shown on complete.
- **API call:** POST /api/agents/disaster with {declarationId}
- **Backend processing:** Calls deployDisasterResponse — finds affected orgs, surfaces emergency funds, identifies nearby corporate donors, creates disaster_response_campaigns record.
- **Database write:** disaster_response_campaigns
- **Side effects:** Toast: 'Response deployed. X emergency funds surfaced, Y corporate donors identified.'
- **Success response:** Summary card shows actions taken
- **Error response:** Toast: 'Deployment failed. Please try again.'
- **Tracking event:** disaster_response_deployed

---

## Section 7: Donor Discovery

### 7.1 NAICS Category Selection
- **User action:** User clicks a category card on /donor-discovery/discover
- **Frontend reaction:** Category expands to show sub-types as chips. Selection highlights in brand color.
- **API call:** none (client-side state)
- **Backend processing:** none
- **Database write:** none
- **Side effects:** Advances to step 2 parameters form
- **Tracking event:** naics_category_selected

### 7.2 Prospect Search
- **User action:** User sets radius, keywords, clicks Search
- **Frontend reaction:** Loading state. Results grid renders on complete.
- **API call:** POST /api/donor-discovery/discover
- **Backend processing:** Calls Google Places API with NAICS type + radius. Returns up to 50 prospects.
- **Database write:** donor_discovery_directory (new prospects)
- **Side effects:** none
- **Success response:** Prospect cards render with name, address, rating, enrichment status
- **Error response:** Toast: 'Search failed. Please try again.'
- **Tracking event:** donor_discovery_searched

### 7.3 Route Prospect to AutoApply
- **User action:** User clicks 'Add to AutoApply Queue' on prospect card
- **Frontend reaction:** Button shows loading. Switches to 'Queued' on success.
- **API call:** POST /api/donor-discovery/prospects/[id]/route-to-autoapply
- **Backend processing:** Checks enrichment.giving_portal_url. If present: inserts to submission_queue. If absent: returns {queued: false}.
- **Database write:** submission_queue (if giving portal found)
- **Side effects:** Toast: 'Added to AutoApply queue.' or 'No giving portal found. Use email campaign instead.'
- **Success response:** Button shows 'Queued ✓'
- **Error response:** Toast: 'Failed to queue.'
- **Tracking event:** prospect_routed_to_autoapply

### 7.4 Route Prospect to Email Campaign
- **User action:** User clicks 'Add to Email Campaign' on prospect card
- **Frontend reaction:** Button shows loading. Switches to 'Added' on success.
- **API call:** POST /api/donor-discovery/prospects/[id]/route-to-email
- **Backend processing:** Creates outreach_campaign record with prospect contact email and template type 'cold_donation_request'.
- **Database write:** email_campaigns or outreach_campaigns
- **Side effects:** Toast: 'Added to email campaign.'
- **Success response:** Button shows 'Added ✓'
- **Error response:** Toast: 'Failed to add to campaign.'
- **Tracking event:** prospect_routed_to_email

---

## Section 8: Agent Marketplace

### 8.1 Enable Agent
- **User action:** User toggles an agent ON on /settings/agents
- **Frontend reaction:** Optimistic toggle switch flips. Loading ring briefly shown.
- **API call:** POST /api/agents/registry/configure with {agent_id, enabled: true}
- **Backend processing:** Upserts agent_configurations record with enabled=true.
- **Database write:** agent_configurations
- **Side effects:** Toast: '[Agent Name] enabled. It will run on its next scheduled cycle.'
- **Success response:** Toggle shows green. Last run / run count section appears.
- **Error response:** Toggle reverts. Toast: 'Failed to enable agent.'
- **Tracking event:** agent_enabled

### 8.2 Disable Agent
- **User action:** User toggles an agent OFF
- **Frontend reaction:** Optimistic toggle flips.
- **API call:** POST /api/agents/registry/configure with {agent_id, enabled: false}
- **Backend processing:** Updates agent_configurations.enabled = false
- **Database write:** agent_configurations
- **Side effects:** Toast: '[Agent Name] disabled.'
- **Success response:** Toggle shows gray.
- **Error response:** Toggle reverts. Toast: 'Failed to disable agent.'
- **Tracking event:** agent_disabled

### 8.3 Upgrade Prompt on Locked Agent
- **User action:** User clicks lock icon on agent requiring higher plan
- **Frontend reaction:** Modal: 'This agent requires [Professional/Enterprise] plan. Upgrade to unlock.'
- **API call:** none
- **Backend processing:** none
- **Database write:** none
- **Side effects:** 'Upgrade Now' button links to Stripe billing portal
- **Tracking event:** upgrade_prompt_shown

---

## Section 9: Foundation Directory

### 9.1 Foundation Search
- **User action:** User types in foundation search input
- **Frontend reaction:** Debounced (300ms). Spinner in input. Results update.
- **API call:** GET /api/foundations?search=term&state=TX
- **Backend processing:** Full-text search on name + city. Filters by state if selected. Returns paginated results with enrichment status.
- **Database write:** none
- **Side effects:** none
- **Success response:** Foundation cards render with name, EIN, assets, enrichment badge
- **Error response:** Toast: 'Search failed.'
- **Tracking event:** foundation_searched

### 9.2 View Foundation Profile
- **User action:** User clicks foundation card
- **Frontend reaction:** Navigate to /foundations/[id]
- **API call:** GET /api/foundations/[id] + GET /api/foundations/[id]/profile
- **Backend processing:** Reads foundation_directory + foundation_profiles. Triggers profile computation if stale (>30 days).
- **Database write:** foundation_profiles (if recomputed)
- **Side effects:** none
- **Success response:** Full foundation detail page with enrichment fields and computed profile
- **Error response:** Toast: 'Failed to load foundation.'
- **Tracking event:** foundation_viewed

### 9.3 Add Foundation as Funder
- **User action:** User clicks 'Add to My Funders' on foundation detail page
- **Frontend reaction:** Loading state on button.
- **API call:** POST /api/funders
- **Backend processing:** Creates funders record with data populated from foundation_directory. Links foundation_id.
- **Database write:** funders
- **Side effects:** Toast: 'Foundation added to your funders.'
- **Success response:** Button changes to 'View in Funders' with link
- **Error response:** Toast: 'Failed to add funder.'
- **Tracking event:** foundation_added_as_funder

---

## Section 10: Compliance & Financials

### 10.1 Add Compliance Event
- **User action:** User clicks 'Add Event' on /compliance and fills form
- **Frontend reaction:** Modal form. Submit button.
- **API call:** POST /api/compliance/events
- **Backend processing:** Inserts compliance_events record. If recurring: creates future events per recurrence schedule.
- **Database write:** compliance_events
- **Side effects:** Toast: 'Compliance event added.' Auto-create alerts if due within 30 days.
- **Success response:** Event appears in calendar list
- **Error response:** Toast: 'Failed to add event.'
- **Tracking event:** compliance_event_added

### 10.2 Mark Compliance Event Complete
- **User action:** User clicks 'Mark Complete' on compliance event
- **Frontend reaction:** Optimistic — event shows green checkmark immediately
- **API call:** PATCH /api/compliance/events/[id] with {completed_at: now()}
- **Backend processing:** Updates compliance_events.completed_at
- **Database write:** compliance_events
- **Side effects:** Toast: 'Event marked complete.'
- **Success response:** Event shows completion state
- **Error response:** Reverts. Toast: 'Failed to update.'
- **Tracking event:** compliance_event_completed

### 10.3 Financial Reconciliation
- **User action:** User clicks 'Reconcile' on application financial view
- **Frontend reaction:** Loading state. Report card renders on complete.
- **API call:** GET /api/applications/[id]/reconcile
- **Backend processing:** Reads grant_budgets and grant_expenses for application. Computes variance. Upserts grant_reconciliation_reports.
- **Database write:** grant_reconciliation_reports
- **Side effects:** Toast: 'Reconciliation complete.' Color-coded compliance_status shown.
- **Success response:** Report shows total_budget, total_spent, variance, compliance_status badge
- **Error response:** Toast: 'Reconciliation failed.'
- **Tracking event:** reconciliation_run

---

## Section 11: Settings & Admin

### 11.1 Invite Team Member
- **User action:** Owner/admin enters email + selects role + clicks Invite
- **Frontend reaction:** Loading state. Success message.
- **API call:** POST /api/users/invite
- **Backend processing:** Creates invitation record. Sends invitation email via Resend. Sets 7-day expiry.
- **Database write:** invitations
- **Side effects:** Email sent to invitee with accept link.
- **Success response:** Toast: 'Invitation sent to [email].'
- **Error response:** Toast: 'Failed to send invitation.' / 'User already exists in your organization.'
- **Tracking event:** team_member_invited

### 11.2 Notification Preferences Toggle
- **User action:** User toggles In-App or Email on any event type
- **Frontend reaction:** Optimistic toggle update
- **API call:** POST /api/settings/notifications with {event_type, in_app, email}
- **Backend processing:** Upserts notification_preferences record
- **Database write:** notification_preferences
- **Side effects:** Toast: 'Preferences saved.'
- **Success response:** Toggle reflects new state
- **Error response:** Toggle reverts. Toast: 'Failed to save.'
- **Tracking event:** notification_preference_updated

### 11.3 White-Label — Grant Client Access
- **User action:** Consultant enters client email + clicks Grant Access
- **Frontend reaction:** Loading state.
- **API call:** POST /api/consultant/clients with {client_email}
- **Backend processing:** Looks up org by user email. Creates consultant_client_access record.
- **Database write:** consultant_client_access
- **Side effects:** Toast: 'Access granted to [org name].' or 'No organization found for that email.'
- **Success response:** Client appears in client list table
- **Error response:** Toast: 'Failed to grant access.'
- **Tracking event:** consultant_access_granted

### 11.4 Platform Admin — Suspend Organization
- **User action:** Owner clicks 'Suspend Organization' on org detail page
- **Frontend reaction:** Confirmation modal: 'This will prevent all users in this organization from accessing Benavora. Are you sure?'
- **API call:** POST /api/admin/orgs/[id]/suspend
- **Backend processing:** Sets organizations.status = 'suspended' via service role
- **Database write:** organizations
- **Side effects:** Toast: 'Organization suspended.' All org users see suspended state on next login.
- **Success response:** Org status shows 'Suspended' badge
- **Error response:** Toast: 'Failed to suspend.'
- **Tracking event:** org_suspended

---

## Section 12: Executive Command Center

### 12.1 Page Load
- **User action:** Owner/admin navigates to /command-center
- **Frontend reaction:** Dark navy canvas renders. 6 panels load in parallel from server-side fetches.
- **API call:** Server-side parallel fetch of 8 data sources
- **Backend processing:** Parallel queries for pipeline, discovery, alerts, recommendations, deadlines, forecasts, agent runs
- **Database write:** none
- **Side effects:** Role gate — viewer role redirected to /dashboard
- **Success response:** All 6 panels render with live data
- **Error response:** Individual panel shows error state with retry button
- **Tracking event:** command_center_viewed

### 12.2 Panel Data Click-Through
- **User action:** User clicks any stat or item within a command center panel
- **Frontend reaction:** Navigate to relevant page
- **API call:** none
- **Backend processing:** none
- **Database write:** none
- **Side effects:** Navigate to: /opportunities, /applications, /donor-discovery, /intelligence/reputation, /deadlines, /reports
- **Tracking event:** command_center_drilldown

---

## Section 13: AutoApply Operations

### 13.1 Approve Submission (Human Gate)
- **User action:** User clicks 'Approve' on submission requiring human review
- **Frontend reaction:** Loading state. Session continues in Railway worker.
- **API call:** POST /api/agents/automation/[sessionId]/approve
- **Backend processing:** Sets submission_queue.requires_human_approval = false. Worker resumes Playwright session.
- **Database write:** submission_queue
- **Side effects:** Notification when submission completes.
- **Success response:** Toast: 'Submission approved. Processing...'
- **Error response:** Toast: 'Approval failed. Worker may have timed out.'
- **Tracking event:** submission_approved

### 13.2 Reject Submission (Human Gate)
- **User action:** User clicks 'Reject' on submission
- **Frontend reaction:** Rejection reason modal.
- **API call:** PATCH /api/agents/automation/[sessionId] with {status: 'rejected', reason}
- **Backend processing:** Sets status = 'rejected'. Logs reason. Cancels Playwright session.
- **Database write:** submission_queue
- **Side effects:** Toast: 'Submission rejected.' Application remains in ready_for_review stage.
- **Success response:** Queue item shows rejected status
- **Tracking event:** submission_rejected

---

## Section 14: Import Wizard

### 14.1 CSV Upload (Step 1)
- **User action:** User drops CSV file on import zone or clicks to upload
- **Frontend reaction:** FileReader parses first 5 rows. Preview table renders.
- **API call:** none (client-side parsing)
- **Backend processing:** none
- **Database write:** none
- **Side effects:** Detected columns listed. Next button enabled.
- **Success response:** Preview table shows first 5 rows
- **Error response:** Toast: 'Invalid CSV file. Please check the format.'
- **Tracking event:** csv_uploaded

### 14.2 Column Mapping (Step 2)
- **User action:** User maps CSV columns to target fields via dropdowns
- **Frontend reaction:** Dropdowns populate with detected column names
- **API call:** none
- **Backend processing:** none
- **Database write:** none
- **Side effects:** Next button enables when required field (name) is mapped
- **Tracking event:** csv_columns_mapped

### 14.3 Import Execution (Step 3)
- **User action:** User clicks 'Import' on confirmation screen
- **Frontend reaction:** Progress indicator. Result summary on complete.
- **API call:** POST /api/import/csv
- **Backend processing:** Applies mapping. Validates name present. Upserts to funders table. Returns {imported, failed, errors}.
- **Database write:** funders
- **Side effects:** Toast: 'Import complete. X records imported, Y failed.'
- **Success response:** Summary shows imported vs failed counts with error list
- **Error response:** Toast: 'Import failed. Please try again.'
- **Tracking event:** csv_imported

---

## Section 15: Reports

### 15.1 Generate Board Report
- **User action:** User selects date range and clicks 'Generate Report'
- **Frontend reaction:** Loading state. Report renders in page on complete.
- **API call:** GET /api/reports/board-report?dateFrom=&dateTo=
- **Backend processing:** Calls generateBoardReport — parallel queries for opportunities, applications, outcomes, deadlines, top funders. Builds narrative summary.
- **Database write:** none
- **Side effects:** none
- **Success response:** Report renders: stat cards, top funders table, upcoming deadlines, print button
- **Error response:** Toast: 'Failed to generate report.'
- **Tracking event:** board_report_generated

### 15.2 Print/Export Report
- **User action:** User clicks 'Print / Export PDF'
- **Frontend reaction:** window.print() called
- **API call:** none
- **Backend processing:** none
- **Database write:** none
- **Side effects:** Browser print dialog opens. CSS @media print rules hide sidebar and nav.
- **Tracking event:** board_report_printed

---

## Section 16: Global Interactions

### 16.1 Sidebar Navigation Click
- **User action:** User clicks any sidebar nav item
- **Frontend reaction:** Immediate navigation. Active item gets teal left border + background.
- **API call:** none
- **Backend processing:** none
- **Database write:** none
- **Side effects:** x-pathname header updated in middleware on next request
- **Tracking event:** nav_clicked

### 16.2 Alert Bell Click
- **User action:** User clicks alert bell in header
- **Frontend reaction:** Dropdown shows unread alerts. Badge clears on open.
- **API call:** GET /api/alerts + PATCH /api/alerts/mark-read
- **Backend processing:** Returns unread alerts. Marks all as read.
- **Database write:** alerts (is_read = true)
- **Side effects:** Badge count resets to 0
- **Success response:** Alerts listed with type, message, timestamp
- **Error response:** Empty dropdown with error message
- **Tracking event:** alerts_opened

### 16.3 Global Error Boundary
- **User action:** Any unhandled error on any page
- **Frontend reaction:** Error boundary component renders: 'Something went wrong.' with Refresh button
- **API call:** none
- **Backend processing:** none
- **Database write:** none
- **Side effects:** Error logged to console (future: error tracking service)
- **Tracking event:** error_boundary_triggered

### 16.4 Session Expiry
- **User action:** User's session expires (idle or token expiry)
- **Frontend reaction:** Next API call returns 401. Middleware redirects to /login.
- **API call:** Any protected route
- **Backend processing:** Supabase getUser() returns null. Middleware redirects.
- **Database write:** none
- **Side effects:** Current page lost. User must re-authenticate.
- **Tracking event:** session_expired

---

## Navigation Map — All Routes

```
/ (landing/marketing)
├── /login
├── /register
├── /forgot-password
├── /reset-password
├── /invite
└── /onboarding

/(dashboard) [authenticated, onboarding_completed OR skip cookie]
├── /dashboard                          ← Mission Control
├── /command-center                     ← Owner/admin only
├── /research
│   └── /research/match
├── /funders
│   ├── /funders/new
│   └── /funders/[id]
├── /foundations
│   └── /foundations/[id]
├── /contacts
│   └── /contacts/[id]
├── /opportunities
│   ├── /opportunities/new
│   └── /opportunities/[id]
├── /applications
│   ├── /applications/list
│   ├── /applications/new
│   └── /applications/[id]
├── /draft-generator
│   ├── /draft-generator/queue
│   └── /draft-generator/[id]
├── /documents
├── /knowledge-base
│   ├── /knowledge-base/profile
│   ├── /knowledge-base/narratives
│   └── /knowledge-base/answers
├── /intelligence                       ← Intelligence Library
│   ├── /intelligence/twin              ← Digital Twin
│   ├── /intelligence/knowledge         ← Knowledge Engine
│   ├── /intelligence/reputation        ← Reputation Monitor
│   └── /intelligence/disaster          ← Disaster Response
├── /donor-discovery
│   ├── /donor-discovery/prospects
│   ├── /donor-discovery/connectors
│   ├── /donor-discovery/discover
│   └── /donor-discovery/corporate
│       ├── /donor-discovery/corporate/[id]
│       ├── /donor-discovery/corporate/campaigns
│       ├── /donor-discovery/corporate/monitoring
│       └── /donor-discovery/corporate/relationships
├── /deadlines
├── /compliance
├── /financials
├── /outcomes
│   └── /outcomes/analytics
├── /reports
├── /import
├── /alerts
├── /admin                              ← Owner only
│   ├── /admin/autoapply-ops
│   ├── /admin/monitor
│   ├── /admin/audit-log
│   ├── /admin/sales-outreach
│   └── /admin/orgs/[id]
└── /settings
    ├── /settings/integrations
    ├── /settings/notifications
    ├── /settings/agents
    └── /settings/white-label
```

---

## Dead-End Prevention Rules

Every page must have at least one of these exit paths:
1. A back/breadcrumb navigation link
2. A sidebar nav item that stays visible
3. A primary action button that leads somewhere
4. A related entity link (e.g., 'View in Applications')

Pages that must never 404:
- All /[id] routes must show a 'Not found' component — never throw an unhandled error
- All API routes must return JSON even on error — never return HTML error pages
- All pages must handle the case where the user's org has no data — always show empty state with call-to-action

Toast requirements (ALL toasts must include):
- Success: green background, checkmark icon, 3-second auto-dismiss
- Error: red background, X icon, 5-second auto-dismiss, manual dismiss button
- Warning: amber background, 4-second auto-dismiss
- Info: blue background, 4-second auto-dismiss
