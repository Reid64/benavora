# Benavora — Testing Guide

A plain-English, click-by-click manual for testing every part of Benavora. **No
technical knowledge required.** Just follow each step in order and check that
what you see matches the **"✅ You should see"** notes.

If something doesn't match, that's a bug worth writing down — note the step
number, what you did, and what actually happened.

---

## Before you start

**1. The web address.**
Everywhere this guide says `http://localhost:3000`, use the address where the
app is running:

- Running on your own computer (the normal case for testing): **`http://localhost:3000`**
- Running online (deployed): use the address you were given, e.g.
  `https://benavora.vercel.app`. Replace `http://localhost:3000` with that
  address in every link below.

**2. Use a real email you can open.**
Sign-up may send a confirmation link. Use an inbox you can actually check.

**3. Do the steps in order.**
Features build on each other. You can't add a **contact** until you have a
**funder**; you can't make an **application** until you have an **opportunity**;
and the **AI Draft** works best after the **Knowledge Base** is filled in. This
guide is already in the right order — don't skip around.

**4. The left-hand menu (the "sidebar").**
After you sign in, a menu runs down the left side of every screen. The buttons,
top to bottom, are:

> Dashboard · Funders · Contacts · Opportunities · Applications · Draft
> Generator · Documents · Knowledge Base · Deadlines · Outcomes & Analytics ·
> Outreach · Search Profiles · Settings

Whichever page you're on is highlighted in teal. You can click these any time to
jump around.

**A few heads-ups (not your fault if these happen):**

- 🤖 **AI features** (the Draft Generator) need an AI key set up by a developer.
  If drafting shows a configuration error, that key isn't set yet — skip the AI
  steps and tell the developer.
- 📎 **Document upload** needs file storage set up by a developer. If uploads
  fail with a storage error, same thing — note it and move on.
- ✉️ **Email confirmation** may or may not be turned on. The guide covers both.

---

# STEP 1 — Start the app and open it

> **You only need this step if the app is running on your own computer.** If you
> were given an online web address, skip to Step 2 and just open that address in
> your browser.

**What to do (on your own computer):**

1. Open the **PowerShell** app (click the Start menu, type `PowerShell`, press
   Enter).
2. Go to the Benavora folder. Type this and press Enter:
   ```powershell
   cd C:\Users\suppo\Documents\benavora
   ```
3. Start the app. Type this and press Enter:
   ```powershell
   pnpm dev
   ```
4. Wait until you see a line that mentions **`Local: http://localhost:3000`** (it
   may take 10–30 seconds the first time).
5. Open your web browser (Chrome, Edge, etc.) and go to:
   **`http://localhost:3000`**

**✅ You should see:** The Benavora welcome/landing page, or it may take you
straight to a **Sign in** screen. Either is fine.

> **Leave that PowerShell window open** the whole time you're testing. Closing it
> stops the app. When you're done testing, click in that window and press
> `Ctrl + C` to stop it.

> **If `pnpm dev` gives an error** about missing settings or a database, the app
> hasn't been fully set up yet — show the error to a developer.

---

# STEP 2 — Register a new account and create your organization

**Go to:** `http://localhost:3000/register`
(Or, from the sign-in screen, click the **"Create one"** link.)

**What to do:** Fill in the form titled **"Create your account"**:

| Field | What to type |
|---|---|
| **Organization name** | `Hope Foundation` |
| **Your name** | `Test User` (or your own name) |
| **Email** | A real inbox you can open, e.g. `you@youremail.com` |
| **Password** | At least **8 characters**, e.g. `Testing123` |
| **Confirm password** | The **exact same** password again |

Then click the **"Create account"** button. It briefly reads
**"Creating account…"**.

**✅ You should see one of these two outcomes:**

- **Email confirmation is OFF:** You land directly on the **Dashboard**
  (`/dashboard`). You're signed in. ✅
- **Email confirmation is ON:** A **"Check your email"** message appears saying a
  confirmation link was sent to your address. Open your email, click the link,
  then come back and **sign in** at `http://localhost:3000/login` with the same
  email and password.

**Things to try (to confirm the form is careful):**

- Type a password under 8 characters → you should see
  **"Password must be at least 8 characters."**
- Make the two passwords different → **"Passwords do not match."**
- Try registering the same email twice → **"That email is already registered.
  Try signing in instead."**

> **Note:** The Organization name you typed (`Hope Foundation`) *is* your
> organization — it's created automatically with your account. There is no
> separate "create organization" screen.

---

# STEP 3 — Fill out the Organization Profile (in the Knowledge Base)

This is the verified information about your nonprofit that the AI is allowed to
use. Fill it in honestly (with fake test data) so later AI steps have something
to work with.

**Go to:** `http://localhost:3000/knowledge-base/profile`
(Or click **Knowledge Base** in the left menu, then the **"Organization
Profile"** tab at the top.)

**What to do:** Fill in the cards. Only **Legal name** is required; the rest are
optional but fill several so the AI has real material. Suggested test data:

**Card "Identity & Status"**
| Field | What to type |
|---|---|
| **Legal name** | `Hope Foundation` |
| **Doing business as (DBA)** | `Hope` |
| **EIN** | `12-3456789` |
| **Tax status** | `501(c)(3)` |
| **Founding date** | Pick any past date, e.g. `2015-01-01` |

**Card "Mission & Focus"**
| Field | What to type |
|---|---|
| **Mission statement** | `Hope Foundation provides safe, affordable housing and job training to families experiencing homelessness in rural Texas.` |
| **Vision statement** | `A Texas where every family has a stable home and a path to self-sufficiency.` |
| **Service area** | `Rural Texas` |
| **Target population** | `Families experiencing homelessness` |

**Card "Founder"**
| Field | What to type |
|---|---|
| **Founder name** | `Maria Gomez` |
| **Founder bio** | `Maria founded Hope Foundation in 2015 after 12 years in social work.` |

**Card "Capacity"**
| Field | What to type |
|---|---|
| **Annual budget (USD)** | `1200000` |
| **Total staff** | `14` |
| **Total volunteers** | `60` |

**Card "Contact & Address"**
| Field | What to type |
|---|---|
| **Website** | `https://hopefoundation.org` |
| **Phone** | `(555) 123-4567` |
| **Email** | `info@hopefoundation.org` |
| **Address line 1** | `100 Main Street` |
| **City** | `Austin` |
| **State** | `TX` |
| **ZIP** | `78701` |

Click the **"Save profile"** button at the bottom.

**✅ You should see:** A green **"✓ Profile saved"** message. If you refresh the
page, your typed-in values are still there.

**Bonus — add a board member and a program** (optional but good to test):

1. Find the **Board Members** section, click **"Add member"**. In the pop-up,
   type a **Name** (e.g. `John Smith`) and a **Board role** (e.g. `Chair`), then
   click **"Add member"**. ✅ The member appears in the list.
2. Find the **Programs** section, click **"Add program"**. Type a **Program
   name** (e.g. `Family Housing Program`), a short description, and click
   **"Add program"**. ✅ The program appears in the list.

---

# STEP 4 — Add your first funder

A "funder" is any organization that might give you money (a company, foundation,
or government agency).

**Go to:** `http://localhost:3000/funders`
(Or click **Funders** in the left menu.)

**What to do:**

1. Click the **"New funder"** button (top right). This opens `/funders/new`.
2. Fill in the form titled **"New funder"**:

| Field | What to type / choose |
|---|---|
| **Funder name** *(required)* | `Home Depot Community Giving` |
| **Category** *(required)* | Choose **`Corporation`** from the dropdown |
| **Description** | `Corporate giving program supporting housing and community repair projects.` |
| **Website** | `https://corporate.homedepot.com/foundation` |
| **Giving portal URL** | `https://homedepot.com/grants` |
| **Portal login status** | Choose **`Needs account`** |
| **Preferred application method** | Choose **`Online portal`** |
| **Annual giving budget (USD)** | `5000000` |
| **Geographic focus** | `National` |
| **Has a giving page** | Leave the checkbox **checked** |
| **Notes** | `Met their program officer at a conference.` |

3. Click **"Create funder"**.

**✅ You should see:** The funder's own page opens (the address becomes
`/funders/...`) with **"Home Depot Community Giving"** as the big title, a
**Corporation** badge, and tabs across the middle: **Overview · Contacts ·
Opportunities · Applications · Notes**. Go back to **Funders** in the menu and
confirm `Home Depot Community Giving` now appears in the list.

> **Try the safety check:** Start another new funder with the *same* name and
> category. You should get a warning that a funder with that name already exists,
> and the button changes to **"Save anyway."** Click **Cancel** — you don't need
> a duplicate.

---

# STEP 5 — Add a contact for that funder

A "contact" is a real person at a funder. Every contact must be attached to a
funder.

**Go to:** `http://localhost:3000/contacts`
(Or click **Contacts** in the left menu.)

**What to do:**

1. Click **"New contact"** (top right). This opens `/contacts/new`.
2. Fill in the form titled **"New contact"**:

| Field | What to type / choose |
|---|---|
| **Funder** *(required)* | Choose **`Home Depot Community Giving`** from the dropdown |
| **Name** *(required)* | `Sarah Johnson` |
| **Title** | `Director of Community Giving` |
| **Relationship** | Choose **`Warm`** |
| **Email** | `sarah.johnson@homedepot.com` |
| **Phone** | `(555) 987-6543` |
| **Preferred contact method** | Choose **`Email`** |
| **Last contacted** | Pick a recent date |
| **Notes** | `Introduced by a board member. Open to a housing proposal.` |

3. Click **"Create contact"**.

**✅ You should see:** Sarah Johnson's contact page opens, showing her name, a
**Warm** badge, her title, and a clickable link back to **Home Depot Community
Giving**. If you open the funder's page (Step 4) and click its **Contacts** tab,
Sarah now appears there.

> **Tip:** If the **Funder** dropdown is empty or you see a yellow warning that
> you need a funder first, go back and finish Step 4 — a contact can't exist
> without a funder.

---

# STEP 6 — Create an opportunity linked to that funder

An "opportunity" is a specific grant or giving program you might apply to.

**Go to:** `http://localhost:3000/opportunities`
(Or click **Opportunities** in the left menu.)

**What to do:**

1. Click **"New opportunity"** (top right). This opens `/opportunities/new`.
2. Fill in the form titled **"New opportunity"**:

| Field | What to type / choose |
|---|---|
| **Opportunity name** *(required)* | `Community Housing Grant 2026` |
| **Category** *(required)* | Choose **`Corporation`** |
| **Funder** | Choose **`Home Depot Community Giving`** (this is the link!) |
| **Status** | Leave as **`Open`** |
| **Description** | `Funds repair and construction of affordable housing for low-income families.` |
| **Amount available (USD)** | `2000000` |
| **Minimum request (USD)** | `10000` |
| **Maximum request (USD)** | `100000` |
| **Deadline** | Pick a date **in the future** (e.g. a few months out) |
| **Application / info URL** | `https://homedepot.com/grants/housing` |
| **Application method** | Choose **`Online portal`** |
| **Recurrence** | Choose **`Annual`** |
| **Geographic restrictions** | `Texas only` |
| **Eligibility requirements** | `Must be a 501(c)(3) serving low-income families.` |
| **Required documents** | Type `501(c)(3) letter` and press **Enter**, then type `Project budget` and press **Enter** (each becomes a little tag) |
| **Keywords** | Type `housing` press **Enter**, type `affordable` press **Enter** |

3. Click **"Create opportunity"**.

**✅ You should see:** The opportunity's page opens with the title **"Community
Housing Grant 2026"**, an **Open** badge, and the funder name **Home Depot
Community Giving** shown as a clickable link. The deadline reads **"Due [your
date]"**.

> **Important — the deadline must be in the future.** If you pick today or a past
> date, you'll see **"Deadline must be in the future."** Pick a later date.

> **This deadline also feeds Step 13** (the Deadlines calendar) automatically.

---

# STEP 7 — Create an application from that opportunity

**Read this first — it's the one part that surprises people.** In Benavora you
don't make an application with an "Add application" button. Instead, an
application is **born automatically the first time you generate and save a draft
for an opportunity** in the **Draft Generator**. So Steps 7 and 10 happen on the
same screen — here we'll create the application; in Step 10 we'll dig into the AI
draft itself.

**Go to:** `http://localhost:3000/draft-generator`
(Or click **Draft Generator** in the left menu.)

**What to do:**

1. Under **"1. Choose an opportunity"**, open the dropdown and select
   **`Community Housing Grant 2026 · Corporation`**.
2. Under **"2. Choose a template"**, click the **"Grant narrative"** card (it
   turns teal when selected).
3. Click the **"Generate draft"** button (it shows **"Generating…"** while it
   works — this can take 10–30 seconds).
4. When the draft appears, find the **"Save draft"** button (under the draft
   text) and click it.

**✅ You should see:** The page moves to a web address like
`/draft-generator/...` — that long code is your new **application's ID**. The
application has now been created in the very first pipeline stage,
**"Discovered."**

5. Confirm it exists: go to **Applications** in the left menu
   (`http://localhost:3000/applications`). You should see a card for
   **Community Housing Grant 2026** sitting in the **"Discovered"** column.

> **If the AI isn't set up** (you get a configuration error on "Generate
> draft"), you can't create the application this way, because applications are
> only born from a saved draft. Note the error for the developer and skip the
> application-related steps (7, 8, 11).

### Move the application through the pipeline stages

**Go to:** `http://localhost:3000/applications` — this is the **Board** view, a
set of columns. The full set of stages, left to right, is:

> Discovered → Eligibility Review → Qualified → Drafting → Awaiting Documents →
> Ready for Review → Submitted → Follow-up Due → Awarded → Denied →
> Reporting Required → Renewal Opportunity

**What to do (two ways to move a card):**

- **Easiest way:** Click the application card to open its detail page, then click
  the **"Move application"** button. A pop-up titled **"Move application"**
  appears. Open the **"Move to stage"** dropdown — only the *allowed* next stages
  are listed — choose the next one, optionally type a note, and click **"Confirm
  move."**
- **Or, on the Board:** drag the card from one column and drop it on the next.
  The same **"Move application"** pop-up appears to confirm.

**Walk it forward** one stage at a time for this test:
`Discovered → Eligibility Review → Qualified → Drafting → Awaiting Documents →
Ready for Review → Submitted`.

**✅ You should see:** Each time, the card moves to the new column, and on the
application's **Timeline** tab a new entry appears showing the move (e.g.
"Discovered → Eligibility Review" with the date and your name).

> **Two things the app enforces on purpose:**
> - Moving an application **backward** (to an earlier stage) **requires a
>   reason** — you'll be asked to type why.
> - Moving to **"Submitted"** may require an owner/admin and may ask you to
>   confirm a checkbox. Just read the pop-up and follow what it says.

> **Get it to "Submitted"** before Step 11, because outcomes can only be recorded
> on applications that reached Submitted, Awarded, or Denied.

---

# STEP 8 — Upload a sample document

**First, make a test file** if you don't have one: open Notepad, type a few
words, and save it as `test-document.txt` on your Desktop. (A small PDF or image
works too.)

**Go to:** `http://localhost:3000/documents`
(Or click **Documents** in the left menu.)

**What to do:**

1. In the **"Upload a document"** card, either **drag your file** onto the box
   that says *"Drag and drop a file, or click to browse,"* **or click that box**
   and pick your file. ✅ The file name appears in the box.
2. Open the **Category** dropdown (required) and choose any category, e.g.
   **`Tax document`** or **`Financial`** (the exact list depends on your setup —
   pick anything).
3. *(Optional)* Set an **Expiration date** and type a **Description** like
   `Test upload`.
4. Click **"Upload document"** (it shows a spinner while uploading).

**✅ You should see:** The upload box clears and your document appears in the
list below, showing its name and the category badge you chose.

> **If you get a storage error**, file storage hasn't been configured by a
> developer yet. Note it and move on — this doesn't block the other steps.

> The file types allowed are: PDF, DOC, DOCX, JPG, PNG, XLS, XLSX, and TXT.

---

# STEP 9 — Write a Knowledge Base narrative

A "narrative" is a reusable paragraph (your mission, the need you address, your
impact, etc.) that the AI can weave into drafts.

**Go to:** `http://localhost:3000/knowledge-base/narratives`
(Or click **Knowledge Base** → the **"Narratives"** tab.)

**What to do:**

1. Click **"New narrative"** (top right). A pop-up titled **"New narrative"**
   opens.
2. Fill it in:

| Field | What to type / choose |
|---|---|
| **Title** *(required)* | `Rural housing need statement` |
| **Category** *(required)* | Choose **`Need`** from the dropdown |
| **Narrative** *(required, at least 50 characters)* | `In rural Texas, more than 30,000 families lack stable housing. Hope Foundation closes that gap with affordable homes and on-site job training, turning temporary shelter into lasting independence.` |
| **Keywords** *(optional)* | Type `housing` press **Enter**, type `rural` press **Enter** |
| **Effective for funder types** *(optional)* | Click the **Corporation** button to highlight it |

> Watch the small counter under the Narrative box — it must reach the **50
> character minimum** before you can save. The toolbar above the box (Bold,
> Italic, Heading, List, Quote) is optional formatting.

3. Click **"Create narrative"**.

**✅ You should see:** The pop-up closes and a card titled **"Rural housing need
statement"** appears in the list, with a **Need** badge and your keywords. Use
the **category filter** dropdown at the top (e.g. choose **Need**) to confirm it
filters correctly.

---

# STEP 10 — Use the AI Draft Generator to create a grant narrative

In Step 7 you already used this screen once to create the application. Now look
more closely at what the AI produced and how to refine it. (With the Knowledge
Base now filled in from Steps 3 and 9, the draft should be richer.)

**Go to:** `http://localhost:3000/draft-generator`

**What to do:**

1. Under **"1. Choose an opportunity"**, select
   **`Community Housing Grant 2026 · Corporation`** again.
2. Under **"2. Choose a template,"** you can pick any of the six options — for a
   grant write-up, choose **"Grant narrative"**. (The others are: Donation
   request letter, Budget narrative, Impact statement, Letter of inquiry, Full
   proposal.)
3. Click **"Generate draft"** and wait.

**✅ You should see, once it finishes:**

- The **draft text** appears in an editable box in the middle, with a **word
  count**.
- On the right: a **"Confidence"** score and a **"Sources used"** list showing
  which Knowledge Base items the AI drew from (it should reference your
  organization profile and narrative).
- If the AI had to guess at anything, you may see markers like
  **`[NEEDS INPUT: …]`** inside the draft and a note about **unresolved gaps** —
  this is the app being honest that it won't invent facts. Replace those markers
  with real info.

4. Click inside the draft box and **edit** a sentence to confirm it's editable.
5. Click **"Save draft."**

**✅ You should see:** A **"Draft saved."** confirmation. Because this opportunity
already has an application (from Step 7), the draft attaches to that same
application rather than making a new one.

6. *(Optional)* Click **"Regenerate with AI"** to have it try again — you'll see
   **"Regenerated. Review and save to keep these changes."** Save again if you
   like the new version.

> **A yellow warning** that the draft "contains AI-generated content not verified
> against your Knowledge Base" is normal when confidence is low — it's reminding
> you to read carefully before using it for real.

---

# STEP 11 — Record an outcome on a submitted application

This tells Benavora whether you won or lost — and winning narratives train the
system to get better.

> **You need an application in the Submitted (or Awarded/Denied) stage.** If you
> haven't moved your application to **Submitted** yet, go back to Step 7 and do
> that first.

**Go to:** `http://localhost:3000/outcomes`
(Or click **Outcomes & Analytics** in the left menu.)

**What to do:**

1. In the **"Record an outcome"** card, find **Community Housing Grant 2026** in
   the list of eligible applications.
2. Click its **"Record"** button. A pop-up titled **"Record outcome"** opens.
3. Fill it in (let's pretend you won):

| Field | What to choose / type |
|---|---|
| **Outcome** | Choose **`Awarded`** |
| **Amount awarded** | `75000` |
| **Funder feedback** *(optional)* | `Strong proposal, clear community need.` |

> If you instead choose **`Partial`**, you'll enter a smaller awarded amount. If
> you choose **`Denied`**, you'll type a **Denial reason** like
> `Out of geographic scope` instead of an amount.

4. Click **"Record outcome."**

**✅ You should see:** The pop-up closes, and the outcome appears in the
**"Recorded outcomes"** list below with a green **"Awarded"** badge, the
application name, and **$75,000**. The card header now reads something like
**"1 awarded · $75,000 total awarded."**

---

# STEP 12 — Check the Dashboard metrics

**Go to:** `http://localhost:3000/dashboard`
(Or click **Dashboard** in the left menu.)

**What to do:** Just read the screen — no typing. Confirm the numbers reflect the
test data you entered.

**✅ You should see** a row of metric cards and several summary panels:

- **Metric cards:** *Total Opportunities, Applications Submitted, Drafts Pending
  Review, Deadlines This Week, Total Dollars Requested, Total Dollars Awarded,*
  and *Overall Success Rate.*
- After all the steps above, expect **Total Opportunities** to be at least **1**,
  **Total Dollars Awarded** to show around **$75,000** (from Step 11), and the
  **Deadlines This Week** card to reflect your opportunity's deadline if it's
  within 7 days.
- **Panels lower down:** *Pipeline summary* (applications by stage), *Recent
  opportunities, Upcoming deadlines,* and *Success rate trend.*

> **Note on Success Rate:** It may show **"—"** until you have enough recorded
> outcomes (one isn't always enough for a meaningful percentage). That's
> expected, not a bug.

> If you're testing on a brand-new empty account, you'll instead see a teal
> **"Welcome to Benavora"** banner telling you to add data first.

---

# STEP 13 — Check the Deadlines calendar

**Go to:** `http://localhost:3000/deadlines`
(Or click **Deadlines** in the left menu.)

**What to do:** Read the screen and toggle the two views.

**✅ You should see:**

- A color legend: **Overdue** (red), **≤ 3 days** (orange), **≤ 7 days**
  (yellow), **7+ days** (green).
- Two buttons top-right: **"Calendar"** and **"List."**
- In **Calendar** view: a month grid. The deadline from your opportunity
  (**Community Housing Grant 2026**, Step 6) should appear on its date, colored
  by how soon it is. Use **"Previous month" / "Next month" / "Today"** to
  navigate to the month your deadline is in.
- In **List** view: the same deadlines as a list, each with an urgency pill like
  **"In 45 day(s)"** and a **"Complete"** button (for editors).

**Things to try:**

- Click **"Complete"** on a deadline → it gets marked done. Tick the **"Show
  completed"** checkbox to see completed items (and a **"Reopen"** button to
  undo).

> Deadlines are created **automatically** from the dates you put on opportunities
> — you don't add them by hand here. If the list is empty, go back to Step 6 and
> make sure your opportunity has a future deadline.

---

# STEP 14 — Check Outcomes Analytics

**Go to:** `http://localhost:3000/outcomes/analytics`
(Or, from the **Outcomes** page, click the **"View analytics"** button.)

**What to do:** Read the charts — no typing.

**✅ You should see:**

- **Four summary cards** at the top: *Outcomes recorded, Success rate, Dollars
  awarded,* and *Dollar efficiency.* After Step 11, **Outcomes recorded** is at
  least **1** and **Dollars awarded** shows about **$75,000**.
- **"Success rate by funder category"** and **"Success rate by grant category"**
  — bars per category.
- **"Success rate over time"** — a month-by-month bar chart (awarded vs. total).
- **"Dollars requested vs. awarded"** — monthly bars comparing the two.
- **"Top performing narratives"** — narratives that helped win, ranked. After one
  awarded outcome, your **Rural housing need statement** may begin to appear
  here.
- **"Denial patterns"** — common reasons applications were denied (empty if you
  recorded an award, which is fine).

> **An amber banner** may say success-rate percentages only appear once you have
> several recorded outcomes. With just one test outcome, that's expected — the
> totals and dollar figures still show.

---

## 🎉 You're done!

If every **"✅ You should see"** matched, the core of Benavora works end to end:
accounts, your organization, the Knowledge Base, funders, contacts,
opportunities, applications and the pipeline, documents, AI drafting, outcomes,
and all the reporting screens.

### Quick reference — where each feature lives

| Feature | Web address |
|---|---|
| Register | `/register` |
| Sign in | `/login` |
| Dashboard | `/dashboard` |
| Funders | `/funders` |
| Contacts | `/contacts` |
| Opportunities | `/opportunities` |
| Applications (board) | `/applications` |
| Applications (list) | `/applications/list` |
| Draft Generator | `/draft-generator` |
| Documents | `/documents` |
| Organization Profile | `/knowledge-base/profile` |
| Narratives | `/knowledge-base/narratives` |
| Deadlines | `/deadlines` |
| Outcomes | `/outcomes` |
| Outcomes Analytics | `/outcomes/analytics` |

### If you found a bug

Write down: (1) the **step number**, (2) exactly **what you clicked or typed**,
(3) **what you expected**, and (4) **what actually happened** (a screenshot
helps). Hand that to the developer.
