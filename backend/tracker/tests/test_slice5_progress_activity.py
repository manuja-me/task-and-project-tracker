import uuid
from datetime import timedelta
from django.contrib.auth.models import User
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.db import connection
from rest_framework.test import APIClient
from tracker.models import Project, ProjectMembership, Task, Tracker, TaskStatus, TrackerKind
from tracker.selectors import get_colombo_today

class Slice5ProgressFiltersActivityTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = User.objects.create_user(username="owner", password="password123")
        self.teammate = User.objects.create_user(username="teammate", password="password123")
        self.project = Project.objects.create(
            id=uuid.uuid4(),
            name="Metrics Project",
            owner=self.owner,
            version=1,
        )
        ProjectMembership.objects.create(project=self.project, user=self.teammate)

    def test_completing_task_changes_progress_and_reopen_lowers_it(self):
        self.client.force_authenticate(user=self.owner)

        # Create two tasks
        t1 = Task.objects.create(
            id=uuid.uuid4(),
            project=self.project,
            title="Task 1",
            assignee=self.teammate,
            status=TaskStatus.TODO,
            version=1,
        )
        Tracker.objects.create(
            task=t1, actor=self.owner, actor_username="owner", task_version=1,
            kind=TrackerKind.CREATED, changes={"title": {"old": None, "new": "Task 1"}},
        )

        t2 = Task.objects.create(
            id=uuid.uuid4(),
            project=self.project,
            title="Task 2",
            assignee=self.teammate,
            status=TaskStatus.TODO,
            version=1,
        )
        Tracker.objects.create(
            task=t2, actor=self.owner, actor_username="owner", task_version=1,
            kind=TrackerKind.CREATED, changes={"title": {"old": None, "new": "Task 2"}},
        )

        # Verify initial progress is 0%
        resp_p0 = self.client.get(f"/api/v1/projects/{self.project.id}/")
        self.assertEqual(resp_p0.status_code, 200)
        self.assertEqual(resp_p0.data["progress"]["percent_complete"], 0)
        self.assertEqual(resp_p0.data["progress"]["done_count"], 0)
        self.assertEqual(resp_p0.data["progress"]["total_tasks"], 2)

        # Teammate moves t1: TODO -> IN_PROGRESS -> DONE
        self.client.force_authenticate(user=self.teammate)
        resp_ip = self.client.patch(
            f"/api/v1/projects/{self.project.id}/tasks/{t1.id}/",
            {"status": "IN_PROGRESS"},
            format="json",
            HTTP_X_EXPECTED_VERSION="1",
        )
        self.assertEqual(resp_ip.status_code, 200)

        resp_done = self.client.patch(
            f"/api/v1/projects/{self.project.id}/tasks/{t1.id}/",
            {"status": "DONE"},
            format="json",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(resp_done.status_code, 200)

        # Check progress is now 50%
        resp_p50 = self.client.get(f"/api/v1/projects/{self.project.id}/")
        self.assertEqual(resp_p50.status_code, 200)
        self.assertEqual(resp_p50.data["progress"]["percent_complete"], 50)
        self.assertEqual(resp_p50.data["progress"]["done_count"], 1)

        # Project activity has the status change event
        resp_act = self.client.get(f"/api/v1/projects/{self.project.id}/activity/")
        self.assertEqual(resp_act.status_code, 200)
        self.assertTrue(any(e["kind"] == "UPDATED" and str(e["task_id"]) == str(t1.id) for e in resp_act.data["results"]))

        # Reopen t1: DONE -> IN_PROGRESS lowers progress back to 0%
        resp_reopen = self.client.patch(
            f"/api/v1/projects/{self.project.id}/tasks/{t1.id}/",
            {"status": "IN_PROGRESS"},
            format="json",
            HTTP_X_EXPECTED_VERSION="3",
        )
        self.assertEqual(resp_reopen.status_code, 200)

        resp_p_reopen = self.client.get(f"/api/v1/projects/{self.project.id}/")
        self.assertEqual(resp_p_reopen.data["progress"]["percent_complete"], 0)

    def test_due_date_and_overdue_boundaries(self):
        self.client.force_authenticate(user=self.owner)
        today = get_colombo_today()
        yesterday = today - timedelta(days=1)
        tomorrow = today + timedelta(days=1)

        # Overdue task (yesterday, TODO)
        t_overdue = Task.objects.create(
            project=self.project,
            title="Overdue task",
            assignee=self.teammate,
            due_date=yesterday,
            status=TaskStatus.TODO,
        )
        # Due today task (not overdue)
        t_today = Task.objects.create(
            project=self.project,
            title="Due today task",
            assignee=self.teammate,
            due_date=today,
            status=TaskStatus.TODO,
        )
        # Due yesterday but DONE (not overdue)
        t_done = Task.objects.create(
            project=self.project,
            title="Done past task",
            assignee=self.teammate,
            due_date=yesterday,
            status=TaskStatus.DONE,
        )
        # No due date (not overdue)
        t_nodate = Task.objects.create(
            project=self.project,
            title="No date task",
            assignee=self.teammate,
            due_date=None,
            status=TaskStatus.TODO,
        )

        # Filter overdue=true
        resp_overdue = self.client.get(f"/api/v1/projects/{self.project.id}/tasks/?overdue=true")
        self.assertEqual(resp_overdue.status_code, 200)
        self.assertEqual(resp_overdue.data["count"], 1)
        self.assertEqual(resp_overdue.data["results"][0]["id"], str(t_overdue.id))
        self.assertTrue(resp_overdue.data["results"][0]["is_overdue"])

        # Filter overdue=false
        resp_not_overdue = self.client.get(f"/api/v1/projects/{self.project.id}/tasks/?overdue=false")
        self.assertEqual(resp_not_overdue.status_code, 200)
        self.assertEqual(resp_not_overdue.data["count"], 3)

    def test_archived_project_lifecycle_and_rejection(self):
        self.client.force_authenticate(user=self.owner)

        # Archive the project
        resp_archive = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            {"archived": True},
            format="json",
            HTTP_X_EXPECTED_VERSION="1",
        )
        self.assertEqual(resp_archive.status_code, 200)
        self.assertTrue(resp_archive.data["archived"])
        self.assertEqual(resp_archive.data["version"], 2)

        # Attempt to create task in archived project is rejected with 409
        resp_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/tasks/",
            {"title": "Archived task"},
            format="json",
        )
        self.assertEqual(resp_create.status_code, 409)

        # Restore project
        resp_restore = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            {"archived": False},
            format="json",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(resp_restore.status_code, 200)
        self.assertFalse(resp_restore.data["archived"])
        self.assertEqual(resp_restore.data["version"], 3)

    def test_query_count_bounded_for_task_list(self):
        self.client.force_authenticate(user=self.owner)
        # Create 20 tasks
        tasks = [
            Task(
                project=self.project,
                title=f"Task {i}",
                assignee=self.teammate if i % 2 == 0 else None,
                status=TaskStatus.TODO,
            )
            for i in range(20)
        ]
        Task.objects.bulk_create(tasks)

        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get(f"/api/v1/projects/{self.project.id}/tasks/")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(len(resp.data["results"]), 20)

        # Must not be N+1 (20 tasks shouldn't take 25+ queries, typically 3-5 queries)
        self.assertLessEqual(len(ctx.captured_queries), 6)

    def test_query_count_bounded_for_project_list(self):
        other_owner = User.objects.create_user(username="other_owner", password="password123")
        for i in range(10):
            p = Project.objects.create(
                name=f"Proj {i}",
                owner=self.owner if i % 2 == 0 else other_owner,
            )
            if i % 2 == 1:
                ProjectMembership.objects.create(project=p, user=self.owner)
            Task.objects.create(project=p, title=f"T {i}", status=TaskStatus.DONE)

        self.client.force_authenticate(user=self.owner)
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get("/api/v1/projects/")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(len(resp.data["results"]), 11)

        # Must stay bounded instead of 1+4N queries per project
        self.assertLessEqual(len(ctx.captured_queries), 6)
