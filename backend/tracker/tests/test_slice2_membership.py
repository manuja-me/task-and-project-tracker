import uuid
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient
from tracker.models import Project, ProjectMembership, Task, TaskStatus

class Slice2MembershipTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = User.objects.create_user(username="owner", password="password123")
        self.teammate = User.objects.create_user(username="teammate", password="password123")
        self.outsider = User.objects.create_user(username="outsider", password="password123")
        self.inactive_user = User.objects.create_user(username="inactive", password="password123", is_active=False)
        self.project = Project.objects.create(
            id=uuid.uuid4(),
            name="Collab Project",
            description="Collaborative workspace",
            owner=self.owner,
            version=1,
        )

    def test_add_member_makes_project_visible_on_next_request(self):
        # 1. Teammate initially sees no projects
        self.client.force_authenticate(user=self.teammate)
        resp_before = self.client.get("/api/v1/projects/")
        self.assertEqual(resp_before.status_code, 200)
        self.assertEqual(resp_before.data["results"], [])

        # 2. Owner adds teammate by exact username
        self.client.force_authenticate(user=self.owner)
        resp_add = self.client.post(
            f"/api/v1/projects/{self.project.id}/members/",
            {"username": "teammate"},
            format="json",
            HTTP_X_EXPECTED_VERSION="1",
        )
        self.assertEqual(resp_add.status_code, 201)
        self.assertEqual(resp_add.headers["X-Resource-Version"], "2")

        # 3. Teammate's next request sees the project with role='member'
        self.client.force_authenticate(user=self.teammate)
        resp_after = self.client.get("/api/v1/projects/")
        self.assertEqual(resp_after.status_code, 200)
        self.assertEqual(len(resp_after.data["results"]), 1)
        self.assertEqual(resp_after.data["results"][0]["role"], "member")

        # Teammate can read project detail
        resp_detail = self.client.get(f"/api/v1/projects/{self.project.id}/")
        self.assertEqual(resp_detail.status_code, 200)
        self.assertEqual(resp_detail.data["role"], "member")

    def test_duplicate_and_invalid_membership(self):
        self.client.force_authenticate(user=self.owner)

        # Duplicate owner returns 409
        resp_add_owner = self.client.post(
            f"/api/v1/projects/{self.project.id}/members/",
            {"username": "owner"},
            format="json",
            HTTP_X_EXPECTED_VERSION="1",
        )
        self.assertEqual(resp_add_owner.status_code, 409)

        # Non-existent or inactive user share same generic error message
        resp_missing = self.client.post(
            f"/api/v1/projects/{self.project.id}/members/",
            {"username": "nonexistent_user"},
            format="json",
            HTTP_X_EXPECTED_VERSION="1",
        )
        self.assertEqual(resp_missing.status_code, 400)
        self.assertEqual(resp_missing.data["message"], "User not found or inactive.")

        resp_inactive = self.client.post(
            f"/api/v1/projects/{self.project.id}/members/",
            {"username": "inactive"},
            format="json",
            HTTP_X_EXPECTED_VERSION="1",
        )
        self.assertEqual(resp_inactive.status_code, 400)
        self.assertEqual(resp_inactive.data["message"], "User not found or inactive.")

    def test_member_removal_and_task_block(self):
        # Add teammate
        ProjectMembership.objects.create(project=self.project, user=self.teammate)
        self.project.version = 2
        self.project.save()

        # Create a task assigned to teammate
        Task.objects.create(
            project=self.project,
            title="Assigned Task",
            assignee=self.teammate,
            status=TaskStatus.TODO,
        )

        # Owner attempts to remove teammate who has assigned task -> 409 blocked
        self.client.force_authenticate(user=self.owner)
        resp_remove_blocked = self.client.delete(
            f"/api/v1/projects/{self.project.id}/members/{self.teammate.id}/",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(resp_remove_blocked.status_code, 409)
        self.assertEqual(resp_remove_blocked.data["code"], "member_has_assigned_tasks")
        self.assertEqual(resp_remove_blocked.data["assigned_task_count"], 1)
        self.assertEqual(
            resp_remove_blocked.data["filter_url"],
            f"/projects/{self.project.id}?assignee={self.teammate.id}",
        )

        # Reassign or delete task, then removal succeeds
        task = Task.objects.get(project=self.project)
        task.assignee = None
        task.save()

        resp_remove = self.client.delete(
            f"/api/v1/projects/{self.project.id}/members/{self.teammate.id}/",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(resp_remove.status_code, 204)
        self.project.refresh_from_db()
        self.assertEqual(self.project.version, 3)

        # Teammate can no longer access project (404)
        self.client.force_authenticate(user=self.teammate)
        resp_gone = self.client.get(f"/api/v1/projects/{self.project.id}/")
        self.assertEqual(resp_gone.status_code, 404)
