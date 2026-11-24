# Task and Project Tracker

University team task assignment, lifecycle, and immutable audit history tracking web application built with Django REST Framework, PostgreSQL, and React + Vite + TypeScript.

---

## 1. Prerequisites and Tested Versions

- **Python:** 3.12+ (tested on Python 3.14 / 3.12)
- **Node.js:** v20+ (tested on v26.13)
- **npm:** 10+ (tested on 12.2)
- **PostgreSQL:** 16+

---

## 2. Quick Setup & Local Startup

### Step A: Start PostgreSQL Database

Using Docker Compose:
```bash
docker compose up -d
```
Or use a local PostgreSQL instance running on `localhost:5432` with database `apt_tracker` and user `postgres`.

### Step B: Backend Setup & Seed

```bash
# Create and activate Python virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt

# Run migrations on PostgreSQL
python backend/manage.py migrate

# Seed reproducible demo accounts and sample projects
python backend/manage.py seed

# Start Django development server (port 8000)
python backend/manage.py runserver
```

### Step C: Frontend Setup

In a separate terminal:
```bash
cd frontend

# Install dependencies
npm install

# Start Vite development proxy server (port 5173, proxies /api/ to Django)
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 3. Demo Accounts Workflow & Rehearsal Guide

The seed command creates three reproducible demo accounts:
| Account | Role | Password |
|---|---|---|
| `owner` | Project Owner | `demo12345` |
| `teammate` | Project Collaborator | `demo12345` |
| `outsider` | Unrelated User | `demo12345` |

### Two-Person Handover Demo Rehearsal

1. **Sign in as Owner**: Navigate to `http://localhost:5173/login`, log in as `owner`.
2. **Project Zero State**: Click `+ New Project`, name it `University Showcase`, see initial `0%` progress and `No tasks yet`.
3. **Add Teammate**: Go to the **Members** tab, enter `teammate` into the username field, click **Add Member**.
4. **Assign Task**: Return to **Tasks**, click `+ New Task`, create task `Write demo notes` assigned to `teammate`.
5. **Teammate Handover (Separate Incognito Window)**:
   - Open a private/incognito window, go to `/login`, sign in as `teammate`.
   - Click **My Tasks**: see `Write demo notes`.
   - Open the task: status starts at `To Do`.
   - Click `Move to In Progress`, then click `Move to Done`.
6. **Owner's View Updates**:
   - Return to the owner's browser window (or refresh): progress displays `100%`.
   - Click **Activity**: inspect the chronological event stream showing teammate's exact status transitions (`TODO → IN_PROGRESS → DONE`) with actor username snapshot.
7. **Outsider Isolation**:
   - Open a third browser window, sign in as `outsider`.
   - Projects list is empty; My Tasks is empty; directly navigating to `/projects/{id}` returns `404`.
8. **Reopen to Demonstrate Derived Counts**:
   - Teammate reopens task: `Move to In Progress`. Progress immediately recalculates to `0%`.

---

## 4. Verification and Check Commands

### Backend Checks
```bash
python backend/manage.py check
python backend/manage.py makemigrations --check --dry-run
python backend/manage.py migrate --noinput
python backend/manage.py test tracker.tests
```

### Frontend Checks
```bash
cd frontend
npm run lint
npm run typecheck
npm run test:ci
npm run build
```

### End-to-End Test Suite
```bash
bash run_e2e.sh
```

---

## 5. Member Contribution Breakdown

| Member / Handle | Owned Feature / Slice | Tests Written | Real Commits & PRs | Demo Segment | Q&A Topic |
|---|---|---|---|---|---|
| `@lead-dev` | Django ORM models, migrations, write-lock serialization (`select_for_update`), optimistic versioning | `tracker.tests.test_slice1_projects`, `tracker.tests.test_slice4_work_and_history` | Initial commit through slice 4 | Project creation, version conflicts & concurrency | Why 2 database writes in separate transactions permit corrupt history timelines |
| `@frontend-dev` | React SPA architecture, Vite proxy, TanStack Query, accessible responsive UI | `components.test.tsx`, `projects.test.tsx` | Frontend slices & UI | Six dynamic routes, responsive layout & live refetch | Session cookie rotation and CSRF handling across SPA boundaries |
| `@qa-security` | Role authorization, outsider 404 isolation, soft delete history rule, Playwright journeys | `test_slice2_membership`, `test_slice3_task_assignment`, `test_slice7_edge_cases`, `two_person_handover.spec.ts` | Edge case validation & CI workflow | Member assignment racing with removal, outsider isolation | Soft-delete vs hard-delete history preservation rule |
