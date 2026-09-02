# SPEC_DESIGN_CONSULTATION.md
## AFS — Design Consultation Request
**Phase 5 — Route:** `/architects/consultation`
**Public — no auth required to submit**

Captures the "too complex for self-service" project. A form with scheduling
preferences. Closes the loop for architects with unusual requirements.
Prevents losing those orders to competitors who answer the phone.

**Form (multi-step — 4 steps):**
```
Step 1: Contact + Project
  Name, firm name, email, phone
  Project name, project type, project location
  Estimated bid date (optional)

Step 2: What You Need Help With
  Topic radio: Custom Profile | Material Selection | Spec Review | Budget Estimate | Other
  Description textarea (required): "What do you need our team's help with?"

Step 3: File Upload (optional)
  "Upload plans, sketches, or existing specs"
  DocumentUploader (context: vault, max 3 files, 25MB each)
  Accepted: PDF, DWG, DXF, images

Step 4: Scheduling Preference + Submit
  Preferred contact: Phone | Email | Video call
  Time zone selector
  Preferred days: Mon | Tue | Wed | Thu | Fri (checkboxes)
  Preferred times: Morning | Afternoon (checkboxes)
  [Submit Request] button (copper — architect portal)
```

**On submit:**
```
POST /api/consultation/request
  → Insert consultation_requests record
  → Admin email: "New Consultation Request — [Name] at [Firm]"
  → Customer confirmation: "We'll reach out within 1 business day."
```

**Admin view (`/admin/consultations`):**
```
List: name, firm, topic, submitted date, status
Status: new | contacted | completed | no_response
Admin can update status + add notes
```

**Database: `consultation_requests` (in SCHEMA.md)**

*SPEC_DESIGN_CONSULTATION.md | AFS | Reid Whitesides | June 2026*
