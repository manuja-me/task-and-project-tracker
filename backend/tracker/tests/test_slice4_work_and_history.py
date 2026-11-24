import uuid
from unittest.mock import patch
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient
from tracker.models import Project, ProjectMembership, Task, Tracker, TaskStatus, TrackerKind

class Slice4WorkAndHistoryTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = User.objects.create_user(username="owner", password="password123")
        self.assignee = User.objects.create_user(username="assignee", password="password123")
        self.other_member = User.objects.create_user(username="other_member", password="password123")
        self.project = Project.objects.create(
            id=uuid.uuid4(),
            name="Sprint Project",
            owner=self.owner,
            version=1,
        )
        ProjectMembership.objects.create(project=self.project, user=self.assignee)
        ProjectMembership.objects.create(project=self.project, user=self.other_member)

        self.task = Task.objects.create(
            id=uuid.uuid4(),
            project=self.project,
            title="Implement feature",
            description="Detail",
            assignee=self.assignee,
            status=TaskStatus.TODO,
            version=2,
        )
        # Pre-seed version 1 and 2 events
        Tracker.objects.create(
            task=self.task,
            actor=self.owner,
            actor_username="owner",
            task_version=1,
            kind=TrackerKind.CREATED,
            changes={"title": {"old": None, "new": "Implement feature"}},
        )
        Tracker.objects.create(
            task=self.task,
            actor=self.owner,
            actor_username="owner",
            task_version=2,
            kind=TrackerKind.UPDATED,
            changes={"assignee": {"old": None, "new": {"id": self.assignee.id, "username": "assignee"}}},
        )

    def test_assignee_moves_todo_to_in_progress_writes_event_and_bumps_version(self):
        self.client.force_authenticate(user=self.assignee)

        resp = self.client.patch(
            f"/api/v1/projects/{self.project.id}/tasks/{self.task.id}/",
            {"status": "IN_PROGRESS"},
            format="json",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], "IN_PROGRESS")
        self.assertEqual(resp.data["version"], 3)
        self.assertEqual(resp.headers["X-Resource-Version"], "3")

        # Verify Tracker row
        newest_event = Tracker.objects.filter(task=self.task).order_by("-task_version").first()
        self.assertEqual(newest_event.task_version, 3)
        self.assertEqual(newest_event.kind, TrackerKind.UPDATED)
        self.assertEqual(newest_event.actor_id, self.assignee.id)
        self.assertEqual(newest_event.actor_username, "assignee")
        self.assertEqual(newest_event.changes, {"status": {"old": "TODO", "new": "IN_PROGRESS"}})

        # Competing editor with stale version 2 receives 412
        resp_stale = self.client.patch(
            f"/api/v1/projects/{self.project.id}/tasks/{self.task.id}/",
            {"status": "DONE"},
            format="json",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(resp_stale.status_code, 412)

    def test_illegal_status_moves(self):
        self.client.force_authenticate(user=self.assignee)

        # Illegal: TODO directly to DONE
        resp_illegal = self.client.patch(
            f"/api/v1/projects/{self.project.id}/tasks/{self.task.id}/",
            {"status": "DONE"},
            format="json",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(resp_illegal.status_code, 400)

    def test_other_member_cannot_change_status_or_modify_other_fields(self):
        # Non-assignee member tries to edit status
        self.client.force_authenticate(user=self.other_member)
        resp_forbidden = self.client.patch(
            f"/api/v1/projects/{self.project.id}/tasks/{self.task.id}/",
            {"status": "IN_PROGRESS"},
            format="json",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(resp_forbidden.status_code, 403)

        # Assignee member includes title in patch -> forbidden
        self.client.force_authenticate(user=self.assignee)
        resp_with_title = self.client.patch(
            f"/api/v1/projects/{self.project.id}/tasks/{self.task.id}/",
            {"status": "IN_PROGRESS", "title": "Implement feature"},
            format="json",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(resp_with_title.status_code, 403)

    def test_valid_noop_returns_200_without_version_bump_or_event(self):
        self.client.force_authenticate(user=self.assignee)

        event_count_before = Tracker.objects.filter(task=self.task).count()
        resp_noop = self.client.patch(
            f"/api/v1/projects/{self.project.id}/tasks/{self.task.id}/",
            {"status": "TODO"},
            format="json",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(resp_noop.status_code, 200)
        self.assertEqual(resp_noop.data["version"], 2)
        self.assertEqual(resp_noop.headers["X-Resource-Version"], "2")
        self.assertEqual(Tracker.objects.filter(task=self.task).count(), event_count_before)

    def test_rollback_on_tracker_insertion_failure(self):
        self.client.force_authenticate(user=self.assignee)

        # Force Tracker.objects.create to raise an exception
        with patch.object(Tracker.objects, "create", side_effect=RuntimeError("Forced DB error")):
            with self.assertRaises(RuntimeError):
                self.client.patch(
                    f"/api/v1/projects/{self.project.id}/tasks/{self.task.id}/",
                    {"status": "IN_PROGRESS"},
                    format="json",
                    HTTP_X_EXPECTED_VERSION="2",
                )

        self.task.refresh_from_db()
        self.assertEqual(self.task.status, TaskStatus.TODO)
        self.assertEqual(self.task.version, 2)
        self.assertFalse(Tracker.objects.filter(task=self.task, task_version=3).exists())
