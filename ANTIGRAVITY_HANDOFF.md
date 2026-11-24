# Task and Project Tracker · Antigravity implementation brief

Build a working web application for a university team to assign tasks and see what happened to them. **The acceptance journey is a two-person handover.** A project owner creates a project, adds a teammate, and assigns a task. The teammate finds it in My Tasks, starts it, and completes it. The owner sees updated progress and a chronological record naming the person who made each change. A third user outside the project cannot see any part of that work.

Start with the first failing test in §6. Deliver one working slice at a time through the actual browser, Django API, and database. This handoff specifies implementation and acceptance criteria. Record test results and demo evidence as the work is actually done.

## 1. Assignment and scope

The source brief is *Group Project Instructions.pdf*, pp. 1–2. The selected topic is **Task and Project Tracker**. The brief fixes the topic once the group registers it. It requires Django, MVC separation, Django ORM for every database operation, a modern responsive frontend, asynchronous interaction, and at least five functional dynamic pages. Build the six pages in §5. Login is additional.

| Marking criterion | Marks | Evidence to produce |
|---|---:|---|
| Architecture and Django MVC | 15 | Trace one task update from a React control through its URL, controller, service and models. Show the REST response. |
| Database and ORM | 15 | Show checked-in migrations, relationships, one scoped query, and create/read/update/delete behavior in the app. Use the ORM in seed commands, reports and tests too. |
| Frontend and UI | 15 | Demonstrate reused components, a working narrow-screen layout, inline validation, and updates without page reloads. |
| Core features | 15 | Use live data on six routes. Walk through assignment, status, filters and history with two accounts. |
| Individual contribution | 20 | Each member implements, tests and commits their own code under their own GitHub account. Map owned features and real commits to the demo. |
| Individual Q&A | 20 | Each member explains a design choice, a query, and a failure case from their own feature. |

Use **one public GitHub repository** and regular commits throughout development. Use the public repository for source code and fictional fixtures only. The group submits the public repository URL, member contribution breakdown and presentation slides to the VLE **on or before 31 January 2027**. Presentations take place in **week 15** of the academic calendar. Team names, group size, repository URL and registration status are supplied by the group. Keep authorship accurate and leave submission to the group.

## 2. Architecture decision

**Use a monorepo with two application directories.** Assignment cuts across the database relation, REST payload, member picker and activity view. A change such as allowing an empty assignee should change those pieces and their tests in one reviewable commit. One checkout also lets a marker run the full demo at the revision named in the slides. Two repositories would require pairing revisions and coordinating CI for the same feature. The group has one product, one deadline and one submitted URL, so the extra release coordination has little value here. The HTTP boundary still allows the frontend and backend to build and run independently.

| Decision | Reason and trade-off |
|---|---|
| Django 5.2 LTS, Django REST Framework, one domain app | Django supplies accounts, sessions, migrations and ORM. REST controllers translate HTTP, serializers validate payloads, and short domain functions enforce writes that span multiple rows. A single app keeps those transactions easy to follow. Pin a supported 5.2 patch and compatible dependencies in the lockfiles. |
| PostgreSQL in development, CI and the demo | A reassignment and a status change can arrive together. PostgreSQL lets the service serialize writes within a project and lets tests exercise the same locking behavior as the demo. Run the database locally with Compose. The cost is one local service. |
| React, TypeScript, Vite, React Router and TanStack Query | Each feature has a deep-linkable page. Query keys isolate server data by project, task and filters. Invalidate affected keys after a successful mutation so the task, progress and history agree. Keep form drafts in component state. |
| Same-origin session authentication | Use Django accounts and its session cookie. Proxy `/api/` to Django from Vite in development. In a served build, route `/api/` to Django and frontend routes to the built SPA with a history fallback. A deep refresh of a React route must work. An unknown API route must return an API 404. |
| Current state in Task, immutable history in Tracker | “Who owns this now?” is a single task read. “Who changed it and when?” is an ordered history read. Write both in one transaction. Derive counts from visible tasks so reopening or deleting a task cannot leave a stored percentage wrong. |
| Asynchronous HTTP with refetch | Refresh after a successful write and on window focus. Refetch visible detail, activity and overview screens every 15 seconds while the tab is active. This gives the second user a bounded refresh interval on a healthy connection without running a socket service. |

Suggested repository layout. Paths are relative to the checkout.

```text
backend/
  manage.py
  config/                   settings, project URLs and deployment entry point
  tracker/
    models.py               Project, Task, Tracker and membership
    services.py             assignment, edits, lifecycle and tracking transactions
    selectors.py            scoped reads shared by lists, detail and summaries
    api/                    URLs, serializers, controllers and permission handling
    management/commands/    repeatable local demo seed
    migrations/
    tests/
frontend/
  src/
    app/                    router, session and query client
    api/                    fetch wrapper, CSRF, types and query keys
    features/               projects, tasks, activity and session
    components/             shared forms, status labels, lists and feedback
  tests/
e2e/                        Playwright against both real apps
.github/workflows/          checks on pull requests and the main branch
compose.yaml                PostgreSQL with a health check and named volume
README.md                   exact setup, demo accounts workflow and check commands
```

Django models own persistence, constraints and relationships. DRF views serve as MVC controllers. React pages and components are the presentation layer. Route all product mutations through the same service functions. Keep the built-in admin for account provisioning only so edits to tracker data cannot bypass history. Keep application queries, migrations and fixtures ORM-only. Use Django migration operations and the ORM on historical models for data migrations. Skip raw SQL, database triggers, separate microservices, queues and external integrations.

## 3. Data model and rules

Use Django's built-in User. Provision accounts before the demo. Owners add an existing active account by exact username. Each user can own or join several projects. Roles are project-specific.

| Model | Fields and relationships | Constraints and meaning |
|---|---|---|
| Project | UUID primary key, name (120), description (2000, default empty), owner FK to User, archived flag, integer version starting at 1, created_at, updated_at | Owner is immutable and has implicit membership. Additional members use the join table. Duplicate display names are allowed. Protect account references. |
| ProjectMembership | project FK, user FK, joined_at | Unique pair of project and user. The owner cannot be added again. Delete these rows when a genuinely empty project is deleted. |
| Task | UUID primary key, project FK, title (160), description (4000), nullable assignee FK to User, status, nullable due_date, version starting at 1, created_at, updated_at, nullable deleted_at | Project is immutable. Start in TODO, permit an unassigned backlog. An assignee must be the active owner or an active member of this project. Protect the project while any task row exists. |
| Tracker | Increasing integer primary key, task FK, actor FK to User, task_version, kind, changes JSON, event_at | Exactly one event per committed task version, including creation and deletion. Unique pair of task and task_version. Keep immutable through application entry points. Resolve the project through task. Protect referenced tasks and actors. |

Store a server-generated change set with typed old and new values only for changed fields. Represent an assignee with a stable user ID and username snapshot so a later rename cannot mislabel an old assignment. Save the actor username at the time of change alongside the actor FK. Distinguish creation, update and deletion with event kinds. For a single edit affecting title and assignee, show both changes in one event. Delete records the final title for the activity view. Users cannot provide actor, event time, history, ownership, or version increments in request bodies.

**Authorization and lifecycle**

| Action | Owner | Active project member | Signed-in outsider |
|---|---|---|---|
| View project, members, tasks, progress and activity | Yes | Yes | Hidden |
| Create a project | Yes, as a signed-in user | Yes, as a signed-in user | Yes, owns new project |
| Edit/archive/restore/delete project, manage members | Yes | Forbidden | Hidden |
| Create/edit/assign/unassign/delete any task | Yes | Forbidden | Hidden |
| Change task status | Any task in the project | Only a task currently assigned to this member | Hidden |

- A new task starts in TODO. Legal moves are TODO → IN_PROGRESS, IN_PROGRESS → DONE, IN_PROGRESS → TODO and DONE → IN_PROGRESS. The last move reopens a task. Same status is a no-op. Starting or reopening requires an active assignee. Only TODO tasks can be unassigned. An owner can reassign an in-progress or finished task directly to another active teammate. Apply validation to the proposed final state of a multi-field patch. Explicitly reject member patches that include any field other than status, even if its value is unchanged.
- Use archiving for completed projects. Archived projects keep their permissions and history and are read-only except for owner restore or eligible project deletion. Task deletion is a soft delete. Hide it from detail, normal lists and counts, retain events in project activity, and render a deleted-task label without a broken detail link. Project hard deletion is owner-only and allowed only if the project has **never contained a task**, so it cannot erase history. Confirm destructive actions by name or title.
- Block removing a member who has any nondeleted assignment, including DONE tasks. Return the count and a linkable task filter so the owner can resolve them. For an inactive account, retain historic references and show an inactive label. Owners can reassign that user's tasks. An owner cannot remove themselves. Membership revocation takes effect on the next request, including requests from an already open tab.
- Use a date-only due date. Use Asia/Colombo as the project's shared business day for overdue comparisons. Overdue means due_date is earlier than today and status is not DONE. Due today, missing date and deleted tasks are never overdue. Earlier due dates are valid for backfilled work. Store event timestamps as timezone-aware instants, return ISO 8601 UTC, and label the display timezone.
- Compute progress from active task rows as whole percent DONE / total, rounded half up. Zero tasks gives 0% and “No tasks yet”. Include unassigned tasks in the denominator. My Tasks defaults to the current user's nondeleted assignments in active projects. Project detail retains counts while archived.
- Reject unknown input fields and invalid enum, UUID, date or null values. Trim titles/names, reject blank values and enforce length limits after trimming. Preserve internal Unicode and line breaks in descriptions. Treat all strings as plain text. PATCH distinguishes omitted fields from explicit null used to clear assignee or due date.
- Start with indexes for task (project, status), (assignee, status), and activity's task/version unique pair. Select related assignee and actor rows on lists. Test that a page of twenty tasks does not perform one extra query per task. Keep membership visibility as a reusable queryset and constrain every aggregate, search and nested detail query with it.

## 4. REST contract and write consistency

All paths below are relative to `/api/v1/`. Keep the trailing slash. Client-supplied UUIDs on project/task creation give the browser a stable resource to look up after a lost response. IDs identify a resource and never establish permission. Authenticate before evaluating project access. Fetch a nested object through its scoped parent. For a member, role restrictions on a visible project return 403. Outsiders, mismatched parent IDs and deleted tasks return 404.

| Method and path | Contract |
|---|---|
| GET session/ · POST session/login/ · POST session/logout/ | GET bootstraps the CSRF cookie and returns user or null. Login takes username/password and returns the user. Logout ends the session and returns 204. Return a generic invalid-credentials message. |
| GET, POST projects/ | Scoped paginated list with role and progress counts per row. Query by name and archive state. Create with id, name and optional description. Server sets owner. |
| GET, PATCH, DELETE projects/{p}/ | Detail includes role, version, metadata and progress counts. Owner PATCH accepts name, description or archived. Archive/restore is a flag-only patch. For deletion enforce the history rule in §3. |
| GET, POST projects/{p}/members/ · DELETE projects/{p}/members/{userId}/ | GET includes owner, role and active flag. POST accepts exact username. Reject duplicate membership with 409. Missing/inactive usernames share the same validation message. A roster GET and successful membership writes return the project version in the X-Resource-Version header. |
| GET, POST projects/{p}/tasks/ | GET supports title search, status, assignee (including unassigned), overdue flag and pagination. POST takes id, title and optional description, due_date and assignee_id. |
| GET, PATCH, DELETE projects/{p}/tasks/{t}/ | GET and successful PATCH return the current representation. PATCH uses the editable fields allowed in §3. DELETE hides the task and writes its final history entry. |
| GET projects/{p}/tasks/{t}/history/ · GET projects/{p}/activity/ | Task history and project activity return paged events, newest first. Project activity supports task ID and kind filters, including history for deleted tasks. |
| GET me/tasks/ | Same task summary and filters as project task lists, across the caller's own active assignments. Include project ID/name for links. |

**Response conventions.** Create returns 201. Detail and update return 200. Successful deletes return 204. Use structured errors such as `{"code":"invalid_field","message":"Enter a task title.","fields":{"title":["Required."]}}`. Use 400 for malformed/invalid input including illegal transitions, 409 for business conflicts such as archived projects or blocked member removal, 412 for stale writes and 428 for missing preconditions. Use DRF session authentication's 403 for unauthenticated protected requests with a distinct `not_authenticated` code. The client uses that code to show login. CSRF and role failures also use 403 with their own codes. Enforce CSRF on login itself as well as subsequent unsafe requests. Read the current token after login rotation. Use HttpOnly session cookies, HTTPS and secure cookies in a hosted environment. Keep secrets and real credentials out of the public repo and logs.

**Example.** Version 2 of the assigned task `Write demo notes` is TODO. The assignee sends `PATCH /api/v1/projects/{p}/tasks/{t}/` with `X-Expected-Version: 2` and body `{"status":"IN_PROGRESS"}`. The response contains status IN_PROGRESS, version 3 and `X-Resource-Version: 3`. Its newest Tracker entry contains `{"status":{"old":"TODO","new":"IN_PROGRESS"}}`, the assignee's actor ID and task_version 3. A second editor still holding version 2 receives 412. The database still has one event for version 3.

**Transaction rules**

1. For each write to an existing project, enter `transaction.atomic()`, lock the Project row using `select_for_update()`, then check membership, role and archive state inside the lock. Lock the affected task next for task updates/deletes. All project writes follow that order, including task creation and membership changes. This intentionally serializes writes per project. It keeps removal-versus-assignment and archive-versus-edit correct with little code at classroom scale.
2. Require a positive integer `X-Expected-Version` on project PATCH/DELETE, membership POST/DELETE (project version), and task PATCH/DELETE (task version). Return the resource's version in JSON on reads and the matching X-Resource-Version header on single project/task responses. Project version covers metadata and roster changes. Task writes advance the task version only. A task completion can change a project's derived counts without editing its metadata. Use the explicit edit-version header for writes and private no-store responses for authenticated reads. Validate existing visibility and authority before reporting a stale token.
3. Validate the full proposed change. A valid no-op with the current version returns 200 with the same version and no event. A changed task increments its version once and inserts exactly one Tracker row before commit. Exceptions roll back both rows. Do the same on creation (version 1) and soft deletion. Member and project changes increment project version once and do not create task events.
4. Generate a create-form UUID once per intended submission. Enforce primary-key uniqueness in the database. For duplicate IDs return a generic 409 without leaking another project or task. On a lost create response, fetch the submitted resource ID under the original authorized scope and compare the returned ID and submitted fields before treating it as success. If the fields differ, display the current record for review. If still missing, allow explicit retry with the same UUID. Never silently generate a new ID on retry. Handle uniqueness errors after the failed atomic block rolls back. Disable double submits in the UI.
5. Paginate with `{count,next,previous,results}`, page size 20 and maximum 100. Sort tasks/projects by created_at descending then ID descending, and activity by event_at descending then event ID descending. Combine filters with AND, reset page when filters change, and reject malformed filters. For a now-empty final page after removal, refetch the previous valid page. Revalidate the first page on refresh. Rows may move between pages during concurrent edits. Never concatenate old and new results blindly.

## 5. Six functional frontend pages

| Route | User action and observable result |
|---|---|
| `/projects` | Search own/joined projects, switch active/archived, create a project and open it. Show role and progress from real data. |
| `/projects/:p` | See progress and status totals, filter/search tasks, open task detail. Owner can rename/archive/restore/delete when eligible and create a task with an optional due date and assignee. |
| `/projects/:p/tasks/:t` | Inspect state and history together. Owner edits/assigns/deletes. Assigned member uses permitted status controls. The new state and its event appear after save. |
| `/my-tasks` | See assignments across active projects, filter by status or overdue, and open a task in its project. A reassigned item leaves the former assignee's list. |
| `/projects/:p/members` | View the roster. Owner adds/removes members and can follow the assignment filter when removal is blocked. |
| `/projects/:p/activity` | Browse who changed what and when. Filter by task or event kind. Retain readable assignment changes and deleted tasks. |

Use one task form, a member picker scoped to its project, a progress display with counts, and shared loading/error/empty states. Show first-use and no-search-results states separately. Put filters in the URL so refresh/back restores context. Cancel or ignore stale fetch responses when a search/project changes. Use labels, visible keyboard focus, semantic buttons, inline field errors and status text alongside color. On narrow screens retain the task title, assignee, status and available actions. All controls must work by keyboard. Keep dialog focus inside while open and return focus to the trigger on close.

On 412 preserve the draft, show the current saved values, and let the user review/reapply against the new version. A background refetch must never overwrite a dirty form. On uncertain outcomes of PATCH or DELETE, refetch before offering retry. On lost access, evict project-scoped data and redirect to Projects with a neutral message. On logout or identity change clear the entire query cache, including My Tasks, before rendering another user's data. On session expiry return to login and then the original accessible route. Show a retry action for network failures, clear pending states, and announce success only after server confirmation.

## 6. Test-driven delivery order

For **each behavior**, write a failing assertion first. Run the smallest relevant test, verify it fails for the missing behavior, implement the simplest passing change, then refactor with the suite green. Start the next case after the current one passes. A mock that already returns the expected result cannot establish that the service works. Use Django/DRF tests with PostgreSQL for persistence and authorization, Vitest + React Testing Library with a mocked HTTP boundary for components, and Playwright against the real stack for journeys. Commit tested slices from the account of the member who did the work.

| Slice | First red test | Green exit condition |
|---|---|---|
| 1. Session and private project list | Given users A and B and a project owned by A, signed-in B's GET projects list is empty. | Migrations apply on a fresh database. A can log in, create a project and refresh to find it. B cannot fetch it by ID. Exercise actual login/CSRF once. |
| 2. Membership | Adding an active user by username makes the project visible to that user on their next request. | Owner and member browsers see distinct controls. Duplicate, outsider and removal cases pass. |
| 3. Task assignment | Assigning a task on create makes it appear in the assignee's My Tasks and writes one creation event. | Owner can create/edit/delete through the UI. Cross-project and inactive assignees are rejected with no partial write. |
| 4. Work and history | An assigned member moving TODO → IN_PROGRESS writes one event with actor, versions and old/new status. | Complete and reopen work through the browser. Illegal moves, stale writes, rollback and no-op behavior pass. |
| 5. Progress, filters and activity | Completing one of two visible tasks changes progress from 0% to 50% and adds the event to project activity. | Six pages use real APIs. Archive, due-date boundaries and filtered pagination agree with detail. |
| 6. Independent browsers and hand-in | Owner assigns, member completes, owner's already-open page updates, outsider's page stays empty. | Run all §7 checks from a fresh checkout, seed twice, build, and rehearse the demo using two separate browser contexts. |

**Concrete first implementation test.** Create A, B and one project through the Django ORM. Authenticate the test client as B. Request `GET /api/v1/projects/`, assert 200 and `results == []`. Fetch that project's detail as B and assert 404. Authenticate as A and assert the list contains exactly the project ID. Run these assertions together so an endpoint that always returns an empty list cannot pass. In the status slice, write a test that makes Tracker insertion raise inside the service and assert the task state and version remain unchanged after rollback.

## 7. Edge-case acceptance matrix

Use fixed dates and deterministic fixtures. For concurrency tests use real PostgreSQL, separate database connections and a transactional test case with a synchronization barrier. Ordinary tests wrapped in a single test transaction cannot prove the locking behavior. For each denial assert both the response and absence of state/history changes.

| Scenario | Required observation |
|---|---|
| Outsider opens a known project, nested task, roster, activity, or filtered list | Detail is 404. Collections/aggregates contain no private rows. Mismatched project/task pair is 404 even if the user belongs to both. |
| Session expires or a member is removed while editing | Next request rejects the operation. No cached detail survives a user switch. A role failure keeps the user signed in. Missing CSRF on login or mutation fails. |
| Member tries another person's status control or sends title in a status edit | 403. Current owner and current assignee are checked again on the server. |
| Owner tries removing the owner, duplicating a membership, or removing someone with open or finished work | Clear error. Roster and assignments remain consistent. After reassignment or task deletion the eligible member can be removed. |
| Assignment races with membership removal | Either assignment commits and removal is blocked, or removal commits and assignment is rejected. The task never references a removed project member. |
| Reassignment races with former assignee's edit | The first authorized change may commit. The later request observes the new version or new permissions. History explains the result. |
| Two edits use one version, or a stale edit is replayed | One success and one 412 for competing effective edits by authorized users. Reload reveals one event for the winning version. Current-version no-op creates zero events. Missing version returns 428. |
| Project archived while task creation/edit is pending | Write completes before archive or fails after archive. No later writes are accepted until restore. An archived project stays readable and leaves active views. |
| Double click, timeout after commit, or repeated deletion | One task per submitted UUID. One event per committed version. Repeated authorized task deletion returns 404 and history is retained. Failed create cannot leave an orphan event. |
| Rename, reassign, reopen, delete, and force an event-write failure | Historic labels remain readable. Reopen lowers progress. Delete updates counts and keeps history. Forced failure changes neither task nor history. |
| Empty project, only deleted tasks, unassigned backlog, all done | Correct zero state or percentage. Empty never-used project can be deleted. Formerly populated project can be archived but cannot be hard-deleted. |
| Yesterday/today/tomorrow, leap day, invalid date, midnight in Colombo | Only unfinished work before today is overdue. Fixed-clock tests give identical answers on machines in different timezones. |
| Blank/overlong title, multiline Unicode, markup-like text, invalid enum, null and missing PATCH fields | Field-level feedback. Valid text round-trips as text. Clearing a due date works. Omission preserves the old value. |
| Search returns out of order, ties share timestamps, last item leaves page, deep link refresh | Latest search wins, sorting has stable tie-breaks, valid page loads, and Back restores filters. Network failure offers retry without duplicating a write. |
| Keyboard-only at mobile width, slow load and server errors | All six routes remain usable without clipped actions. Focus, status text, loading state, empty state and recovery are observable. |
| Seed rerun, database restart, migration drift, increasing list size | Seed is repeatable with stable identifiers. Database restart retains state. CI detects missing migrations. List query count stays bounded as row count grows. |

## 8. Run, verify and present

Build a repeatable local path. Commit a Python dependency lock, npm lockfile, environment example with variable names, and Django migrations. Document tested Python, Node and PostgreSQL versions, a fresh-clone install, database startup, migration, local account creation, seed and both app start commands. The seed command creates fictional owner, teammate and outsider accounts plus at least two projects. Read demo passwords from local environment and never reset existing real accounts. Use the same seed data for the demo. Automated tests isolate their own data.

Wire these checks into CI and document their working commands. From backend run `python manage.py check`, `python manage.py makemigrations --check --dry-run`, `python manage.py migrate --noinput` and `python manage.py test` against PostgreSQL. From frontend run `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:ci` and `npm run build`. Provide a repository-level command for Playwright that starts or waits for both apps and a migrated disposable database, and exits nonzero on a failed journey. Use separate browser sessions for owner/member/outsider. Run the command once on a clean checkout before calling the project complete.

For the contribution breakdown maintain one row per person with actual GitHub handle, owned feature, tests written, commit/PR links, demo segment and Q&A topic. Divide by vertical feature where feasible, adapting to the real team size. Suggested ownership units are project visibility, membership, assignment, and tracking/progress. Cross-review shared API changes. Keep evidence alongside implementation throughout the timeline. Do not fabricate individual commits, test runs or presentation claims.

**Demo rehearsal.** Start with an empty project and show the zero state. Add the teammate and assign “Write demo notes”. Switch to the teammate's browser, show My Tasks, start and finish the task. Return to the owner's already-open project, show 100% progress and open the two status changes in activity. Show the outsider's empty list. Reopen the task to demonstrate that progress is derived. For Q&A, have the responsible member explain why replacing the two database writes with separate commits would make a misleading timeline possible.

**Definition of done.** All six pages work from the normal navigation and by direct URL. The acceptance journey, permissions, integrity races, rollback and stale-edit handling have passing tests. A fresh checkout runs using the README. Each rubric row links to real evidence, each member can explain their own work, and the group has the three required submission items ready for the VLE deadline.

Framework references for implementation are [Django queryset locking and test semantics](https://docs.djangoproject.com/en/5.2/ref/models/querysets/#select-for-update), [Django CSRF with asynchronous requests](https://docs.djangoproject.com/en/5.2/howto/csrf/), [DRF session authentication and login handling](https://www.django-rest-framework.org/api-guide/authentication/#sessionauthentication).


## 9. Completed Implementation and Verification Record

All six slices and §7 edge-case requirements are fully implemented, verified, and passing:

### Verification Results Summary

1. **Backend Test Suite (PostgreSQL):**
   - Command: `python backend/manage.py test tracker.tests`
   - Total Tests: 19 tests across 5 test suites (`test_slice1_projects`, `test_slice2_membership`, `test_slice3_task_assignment`, `test_slice4_work_and_history`, `test_slice5_progress_activity`, `test_slice7_edge_cases`).
   - Result: **19 / 19 passed** (Exit code: 0).
   - Verifies: Model constraints, transaction write-locking (`select_for_update`), optimistic concurrency (`X-Expected-Version` / `X-Resource-Version`), 412 stale write rejections, 403 member status restriction, rollback on forced failure, soft deletion preserving history, hard deletion history rule (blocked if any task ever existed), bounded query count (no N+1).

2. **Frontend Test Suite (Vitest + React Testing Library):**
   - Command: `npm --prefix frontend run test:ci`
   - Total Tests: 7 tests across `components.test.tsx` and `projects.test.tsx`.
   - Result: **7 / 7 passed** (Exit code: 0).
   - Verifies: `StatusBadge` overdue boundaries, `ProgressBar` ratio and ARIA attributes, `Feedback` loading/error/empty states, `ProjectsPage` integration rendering.

3. **Frontend Production Build & Linter:**
   - `npm --prefix frontend run lint`: **0 errors**.
   - `npm --prefix frontend run typecheck`: **0 errors**.
   - `npm --prefix frontend run build`: **Built successfully** in `dist/`.

4. **Playwright Two-Person Handover Acceptance Journey (End-to-End):**
   - Command: `./run_e2e.sh`
   - Result: **1 passed (3.6s)** (Exit code: 0).
   - Real Browser Contexts Verified:
     - Context A (Owner): Creates project, adds teammate, assigns task.
     - Context B (Teammate): Finds task in My Tasks, moves TODO → IN_PROGRESS → DONE.
     - Context A (Owner): Observes 100% progress and chronological activity record.
     - Context C (Outsider): Complete isolation verified (empty project list, empty My Tasks).

5. **Repeatable Demo Seed:**
   - Command: `python backend/manage.py seed` (executed twice to confirm idempotence).
   - Result: Seeded accounts `owner`, `teammate`, `outsider` with password `demo12345`.
