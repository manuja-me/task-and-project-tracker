# Task and Project Tracker

University team task assignment, lifecycle management, and immutable audit history tracking web application built with **Django REST Framework**, **PostgreSQL**, and **React + TypeScript + Vite**.

---

## 1. Tech Stack

- **Backend:** Python 3.12+, Django 6.1.3, Django REST Framework 3.18.3, `django-cors-headers` 4.9.0, `psycopg` / `psycopg-binary` 3.3.9
- **Database:** PostgreSQL 16 (`postgres:16-alpine` in `compose.yaml` and CI)
- **Frontend:** React 19, TypeScript 5.8, Vite 6, React Router 7, TanStack Query 5
- **Testing & Quality:** Django `TestCase` (`backend/tracker/tests/`), ESLint 9 + `tsc` + Vitest 3 + React Testing Library (`frontend/tests/`), Playwright (`e2e/`)

---

## 2. Architecture Summary (MVC + Pure Django ORM)

The backend uses Django's ORM exclusively (zero raw SQL, `.raw()`, `.extra()`, or manual database cursors) organized into clear Model, Controller/Service, and View layers:

### Models (`backend/tracker/models.py`, `backend/tracker/migrations/0001_initial.py`)
- **`Project`**: UUID primary key, `name` (max 120), `description` (max 2000), `owner` (`ForeignKey` to `auth.User`, `on_delete=PROTECT`, `related_name="owned_projects"`), `archived` flag, and `version` integer for optimistic concurrency control.
- **`ProjectMembership`**: Join table linking `project` (`ForeignKey` to `Project`, `on_delete=CASCADE`, `related_name="memberships"`) and `user` (`ForeignKey` to `auth.User`, `on_delete=PROTECT`, `related_name="project_memberships"`), enforcing `unique_together = ("project", "user")`.
- **`Task`**: UUID primary key, `project` (`ForeignKey` to `Project`, `on_delete=PROTECT`, `related_name="tasks"`), `title` (max 160), `description` (max 4000), nullable `assignee` (`ForeignKey` to `auth.User`, `on_delete=PROTECT`, `related_name="assigned_tasks"`), `status` (`TaskStatus`: `TODO`, `IN_PROGRESS`, `DONE`), `due_date`, `version`, and soft-delete timestamp `deleted_at`.
- **`Tracker`**: Append-only audit history table linking `task` (`ForeignKey` to `Task`, `on_delete=PROTECT`, `related_name="events"`) and `actor` (`ForeignKey` to `auth.User`, `on_delete=PROTECT`, `related_name="tracker_events"`), storing `actor_username` snapshot, `task_version`, `kind` (`TrackerKind`: `CREATED`, `UPDATED`, `DELETED`), `changes` (`JSONField`), and `event_at`, enforcing `unique_together = ("task", "task_version")`.

### Query, Service, and API Controller Layers
- **Selectors (`backend/tracker/selectors.py`)**: Read-only ORM queries using `Q`, `Exists`, `OuterRef`, `select_related`, and `Count` aggregations/annotations. Enforces project visibility isolation (outsiders receive `404`), computes project progress/task counts, and evaluates overdue tasks against `Asia/Colombo` (`TIME_ZONE = "Asia/Colombo"` in `backend/config/settings.py`).
- **Services (`backend/tracker/services.py`)**: Mutating business logic wrapped in `transaction.atomic()` with `select_for_update()` row locks, optimistic `version` verification (raising `StaleWriteError` on mismatch), owner/member authorization checks, soft-deletion of tasks (`deleted_at`) to preserve `Tracker` history, and atomic `Tracker` event creation on every task create/update/delete.
- **API & Routing (`backend/tracker/api/`, `backend/config/urls.py`)**: DRF `APIView` endpoints under `/api/v1/` (`session/`, `session/login/`, `session/logout/`, `projects/`, `projects/<uuid:project_id>/`, `projects/<uuid:project_id>/members/`, `projects/<uuid:project_id>/members/<int:user_id>/`, `projects/<uuid:project_id>/tasks/`, `projects/<uuid:project_id>/tasks/<uuid:task_id>/`, `projects/<uuid:project_id>/tasks/<uuid:task_id>/history/`, `projects/<uuid:project_id>/activity/`, `me/tasks/`). Uses Django session + CSRF authentication (`SessionAuthentication`), `StrictFieldsMixin` payload validation, `StandardPagination` (`PAGE_SIZE = 20`), and `custom_exception_handler`. `backend/config/urls.py` also returns JSON `404` for unknown `/api/*` paths and serves built `frontend/dist` SPA assets.

### Frontend Views (`frontend/src/`)
- Single-page React application (`BrowserRouter`) communicating with `/api/v1/` via `frontend/src/api/client.ts` (with CSRF header injection and credentialed cookies) and TanStack Query (`15s` `refetchInterval` live polling, cache invalidation on mutations, no full-page reloads).
- Reusable components in `frontend/src/components/`: `Navbar.tsx`, `Modal.tsx` (accessible dialog with focus trap and Escape handling), `Feedback.tsx` (`LoadingSpinner`, `EmptyState`, `ErrorAlert`), `ProgressBar.tsx`, and `StatusBadge.tsx`.

---

## 3. Dynamic Pages & Routes (`frontend/src/app/router.tsx`)

1. **`/login`** (`frontend/src/features/session/LoginPage.tsx`): Public session sign-in page with form validation, API error banner, and demo account reference; redirects signed-in users to `/projects`.
2. **`/projects`** (`frontend/src/features/projects/ProjectsPage.tsx`): Active and Archived project tabs, search filter, completion progress bars with task counts, and `+ New Project` modal. (`/` and unknown routes redirect here.)
3. **`/projects/:projectId`** *(alias: `/projects/:projectId/tasks`)* (`frontend/src/features/projects/ProjectOverviewPage.tsx`): Project summary and progress bar, task search and `status`/`assignee`/`overdue` filters, `+ New Task` modal, and owner-only `Edit Project Settings`, `Archive`/`Restore Project`, and `Delete Project` actions.
4. **`/projects/:projectId/members`** (`frontend/src/features/projects/ProjectMembersPage.tsx`): Project roster displaying owner and members; owner-only `Add Member` by exact username and member removal.
5. **`/projects/:projectId/activity`** (`frontend/src/features/projects/ProjectActivityPage.tsx`): Chronological project-wide `Tracker` audit feed showing actor username snapshot, event kind (`created`/`updated`/`deleted`), task link, `task_version`, and field diffs.
6. **`/my-tasks`** (`frontend/src/features/tasks/MyTasksPage.tsx`): Cross-project view of active tasks assigned to the logged-in user with search, status, and overdue filters.
7. **`/projects/:projectId/tasks/:taskId`** (`frontend/src/features/tasks/TaskDetailPage.tsx`): Full task view with quick status transition buttons (`Move to To Do`, `Move to In Progress`, `Move to Done`), inline editing with optimistic `version` locking, soft `Delete Task`, and per-task immutable `Tracker` history timeline.

---

## 4. Prerequisites

- **Python:** 3.12+ (CI runs 3.12)
- **Node.js:** 20+
- **npm:** 10+
- **PostgreSQL:** 16+ (via Docker Compose or local installation)

---

## 5. Setup & Local Development

### Step A: Start PostgreSQL

**Option 1 — Docker Compose (recommended):**
```bash
docker compose up -d
```
`compose.yaml` starts `postgres:16-alpine` (`apt_tracker_db`) on `localhost:5432` with `POSTGRES_DB=apt_tracker`, `POSTGRES_USER=postgres`, and `POSTGRES_PASSWORD=postgrespassword`.

> **Important:** `backend/config/settings.py` defaults `POSTGRES_PASSWORD` to `""`. When connecting to the Docker Compose database, export `POSTGRES_PASSWORD=postgrespassword` in your shell before running `manage.py` or `run_e2e.sh`.

**Option 2 — Local PostgreSQL:**
Ensure PostgreSQL 16+ is running on `localhost:5432` with database `apt_tracker` and user `postgres`. Set `POSTGRES_PASSWORD` in your environment if your local instance requires a password (leave unset/empty for local `trust` authentication). You may also override `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_HOST`, or `POSTGRES_PORT` via environment variables.

### Step B: Backend Setup & Seed

From the repository root:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# Required when using compose.yaml (omit or adjust for local trust/custom password)
export POSTGRES_PASSWORD=postgrespassword

python backend/manage.py migrate
python backend/manage.py seed
python backend/manage.py runserver
```
The Django API server listens on `http://127.0.0.1:8000` (port `8000`).

### Step C: Frontend Development Proxy

In a separate terminal:
```bash
cd frontend
npm install
npm run dev
```
Vite serves the SPA on `http://localhost:5173` and proxies `/api` requests to `http://127.0.0.1:8000` (`frontend/vite.config.ts`). Open `http://localhost:5173` in your browser.

---

## 6. Demo Accounts & Two-Person Handover Rehearsal

`python backend/manage.py seed` creates three demo accounts (password `demo12345`, configurable via `DEMO_PASSWORD`) and two sample projects (`University Portal` and `Campus Mobile App`):

| Username | Role in Sample Projects | Password |
|---|---|---|
| `owner` | Project Owner | `demo12345` |
| `teammate` | Project Collaborator (`member`) | `demo12345` |
| `outsider` | Unrelated User (no project access) | `demo12345` |

### Live Demo Flow
1. **Owner Setup:** Sign in at `http://localhost:5173/login` as `owner`. Click `+ New Project`, create `University Showcase` (starts at `0%` progress and `No tasks yet`).
2. **Add Collaborator:** Open the **Members** tab, enter `teammate`, and click **Add Member**.
3. **Assign Task:** Return to **Tasks**, click `+ New Task`, create `Prepare demo notes`, and assign it to `teammate`.
4. **Teammate Handover:** In a private/incognito window, sign in as `teammate`, open **My Tasks**, open `Prepare demo notes`, click **Move to In Progress**, then **Move to Done**.
5. **Owner Progress & Audit:** Back in `owner`'s window, refresh or wait for the 15s poll: progress shows `100%`, and the **Activity** tab logs `teammate`'s `TODO → IN_PROGRESS → DONE` transitions with actor snapshot.
6. **Outsider Isolation:** In a third window signed in as `outsider`, **Projects** and **My Tasks** are empty, and navigating directly to the owner's `/projects/<projectId>` URL returns a `404` (`Project not found`).

---

## 7. Verification, CI, and End-to-End Tests

Make sure PostgreSQL is running (and `POSTGRES_PASSWORD=postgrespassword` is exported if using `compose.yaml`).

### Backend Checks (matches CI `backend-checks`)
```bash
.venv/bin/python backend/manage.py check
.venv/bin/python backend/manage.py makemigrations --check --dry-run
.venv/bin/python backend/manage.py migrate --noinput
.venv/bin/python backend/manage.py test tracker.tests
```

### Frontend Checks (matches CI `frontend-checks`)
```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test:ci
npm --prefix frontend run build
```

### End-to-End Playwright Suite (matches CI `e2e-checks`)

First-time setup in `e2e/`:
```bash
npm --prefix e2e ci
npx --prefix e2e playwright install --with-deps chromium-headless-shell
```

Run the full-stack E2E acceptance journey (`e2e/two_person_handover.spec.ts`) from the repository root:
```bash
POSTGRES_PASSWORD=postgrespassword bash run_e2e.sh
```
`run_e2e.sh` runs migrations and `seed`, builds `frontend/dist`, starts Django on `http://127.0.0.1:8000` with `--noreload`, and runs Playwright across isolated browser contexts for `owner`, `teammate`, and `outsider`. Set `PYTHON_BIN` (defaults to `.venv/bin/python`) if using a different Python interpreter.

CI configuration is defined in `.github/workflows/ci.yml` (`backend-checks`, `frontend-checks`, and `e2e-checks`).

---

## 8. Member Contribution Breakdown

> **TODO (before final submission):** Replace the placeholder rows below with actual team member GitHub handles, owned components, verified test files, and real Git commit SHAs / PR numbers.

| Member / GitHub Handle | Owned Feature / Layer | Tests Added | Real Commits / PRs | Demo Segment |
|---|---|---|---|---|
| `TODO: @member-1` | `TODO: e.g., Backend ORM models, selectors & services` | `TODO: e.g., tracker.tests.*` | `TODO: <real-commit-sha>` | `TODO` |
| `TODO: @member-2` | `TODO: e.g., DRF API views, serializers & auth` | `TODO: e.g., tracker.tests.*` | `TODO: <real-commit-sha>` | `TODO` |
| `TODO: @member-3` | `TODO: e.g., React SPA pages, components & routing` | `TODO: e.g., frontend/tests/*` | `TODO: <real-commit-sha>` | `TODO` |
| `TODO: @member-4` | `TODO: e.g., CI workflow, Docker & Playwright E2E` | `TODO: e.g., e2e/two_person_handover.spec.ts` | `TODO: <real-commit-sha>` | `TODO` |
