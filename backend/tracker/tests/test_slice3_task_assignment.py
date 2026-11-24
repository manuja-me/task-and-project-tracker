import uuid
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient
from tracker.models import Project, ProjectMembership, Task, Tracker, TaskStatus, TrackerKind

class Slice3TaskAssignmentTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = User.objects.create_user(username="owner", password="password123")
        self.teammate = User.objects.create_user(username="teammate", password="password123")
        self.outsider = User.objects.create_user(username="outsider", password="password123")
        self.project = Project.objects.create(
            id=uuid.uuid4(),
            name="Alpha Project",
            owner=self.owner,
            version=1,
        )
        ProjectMembership.objects.create(project=self.project, user=self.teammate)

    def test_assign_task_on_create_appears_in_my_tasks_and_writes_event(self):
        task_id = str(uuid.uuid4())
        self.client.force_authenticate(user=self.owner)

        # Owner creates task assigned to teammate
        resp_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/tasks/",
            {
                "id": task_id,
                "title": "Write demo notes",
                "description": "Prepare notes for presentation",
                "assignee_id": self.teammate.id,
            },
            format="json",
        )
        self.assertEqual(resp_create.status_code, 201)
        self.assertEqual(resp_create.data["id"], task_id)
        self.assertEqual(resp_create.data["assignee"]["id"], self.teammate.id)
        self.assertEqual(resp_create.data["status"], "TODO")
        self.assertEqual(resp_create.data["version"], 1)
        self.assertEqual(resp_create.headers["X-Resource-Version"], "1")

        # Verify exactly one Tracker event was written
        events = Tracker.objects.filter(task_id=task_id)
        self.assertEqual(events.count(), 1)
        event = events.first()
        self.assertEqual(event.task_version, 1)
        self.assertEqual(event.kind, TrackerKind.CREATED)
        self.assertEqual(event.actor_id, self.owner.id)
        self.assertEqual(event.actor_username, "owner")
        self.assertIn("title", event.changes)
        self.assertIn("assignee", event.changes)
        self.assertEqual(event.changes["assignee"]["new"]["id"], self.teammate.id)

        # Teammate logs in and queries /api/v1/me/tasks/
        self.client.force_authenticate(user=self.teammate)
        resp_my_tasks = self.client.get("/api/v1/me/tasks/")
        self.assertEqual(resp_my_tasks.status_code, 200)
        self.assertEqual(resp_my_tasks.data["count"], 1)
        self.assertEqual(resp_my_tasks.data["results"][0]["id"], task_id)
        self.assertEqual(resp_my_tasks.data["results"][0]["project"]["name"], "Alpha Project")

    def test_cross_project_and_inactive_assignees_rejected_with_no_partial_write(self):
        self.client.force_authenticate(user=self.owner)
        initial_task_count = Task.objects.count()
        initial_event_count = Tracker.objects.count()

        # Attempt to assign to outsider (not a member of this project)
        resp_outsider = self.client.post(
            f"/api/v1/projects/{self.project.id}/tasks/",
            {
                "title": "Invalid task",
                "assignee_id": self.outsider.id,
            },
            format="json",
        )
        self.assertEqual(resp_outsider.status_code, 400)
        self.assertEqual(Task.objects.count(), initial_task_count)
        self.assertEqual(Tracker.objects.count(), initial_event_count)

        # Attempt to assign to inactive user
        inactive_user = User.objects.create_user(username="inactive", password="pw", is_active=False)
        ProjectMembership.objects.create(project=self.project, user=inactive_user)

        resp_inactive = self.client.post(
            f"/api/v1/projects/{self.project.id}/tasks/",
            {
                "title": "Inactive assignee task",
                "assignee_id": inactive_user.id,
            },
            format="json",
        )
        self.assertEqual(resp_inactive.status_code, 400)
        self.assertEqual(Task.objects.count(), initial_task_count)
        self.assertEqual(Tracker.objects.count(), initial_event_count)

    def test_member_cannot_create_task(self):
        # Active member is forbidden from creating tasks
        self.client.force_authenticate(user=self.teammate)
        resp = self.client.post(
            f"/api/v1/projects/{self.project.id}/tasks/",
            {"title": "Member attempt"},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)
