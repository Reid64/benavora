# SPEC_MULTI_PROJECT_MANAGEMENT.md
## AFS — Multi-Project Management
**Phase 4**
**Routes:** `/account/projects`, `/account/projects/[id]`

---

## 1. PURPOSE

GCs and PMs juggle multiple active jobs. Without project organization, their
AFS account becomes an unmanageable flat list of orders. Project management
lets them organize quote requests and orders by named project, store documents
per project, and see project-level history.

---

## 2. PROJECT LIST (`/account/projects`)

```typescript
// ProjectCard grid
// Card: project name, status badge, active orders count, last activity
// Status: 'active' | 'completed' | 'archived'
// Filters: Active | All | Archived
// [Create Project] button → ProjectCreateModal

interface ProjectCreateInput {
  name:           string;   // Required, max 100 chars
  description:    string;   // Optional
  jobsiteAddress: string;   // Optional — pre-fills delivery in quote wizard
}
```

---

## 3. PROJECT DETAIL (`/account/projects/[id]`)

```
ProjectDetailPage
  ProjectHeader: name, status badge, jobsite address, [Edit] button
  StatusActions: [Mark Complete] [Archive]

  Tabs:
    Quote Requests: All quote_requests linked to this project
    Orders:         All orders linked to this project
    Documents:      vault_documents filtered to this project
    Team:           Team members with access (if company team account)

  [New Quote Request for This Project] → /quote?project={id}
  [Upload Drawing] → /upload?project={id}
```

---

## 4. PROJECT ASSIGNMENT

```typescript
// Quote wizard Step 3: "Assign to project" dropdown
//   Shows: active projects for this user
//   Option: "Create New Project" (opens inline ProjectCreateModal)
//
// After submitting quote request or order:
//   Can reassign project via order detail edit
//
// Project assignment links quote_requests.project_id and orders.project_id
```

---

## 5. API

```typescript
// GET /api/projects — user's projects
// POST /api/projects — create project
// PATCH /api/projects/{id} — update name/description/status
// GET /api/projects/{id} — project detail with linked orders + requests
```

---

## 6. PLAYWRIGHT TESTS

```typescript
test('can create a project', async ({ page }) => {
  await page.goto('/account/projects');
  await page.click('text=Create Project');
  await page.fill('[name="name"]', 'Riverside Commons Phase 2');
  await page.click('button[type="submit"]');
  await expect(page.locator('text=Riverside Commons Phase 2')).toBeVisible();
});

test('quote request can be assigned to project', async ({ page }) => {
  // Create project, start quote, verify project in dropdown at step 3
});
```

---

*SPEC_MULTI_PROJECT_MANAGEMENT.md | AFS | Reid Whitesides | June 2026*
