import uuid
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient
from tracker.models import Project, ProjectMembership, Task, Tracker, TaskStatus, TrackerKind
from tracker.services import delete_project

class EdgeCasesAcceptanceTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = User.objects.create_user(username="owner", password="password123")
        self.teammate = User.objects.create_user(username="teammate", password="password123")
        self.outsider = User.objects.create_user(username="outsider", password="password123")
        self.project = Project.objects.create(
            id=uuid.uuid4(),
            name="Edge Project",
            owner=self.owner,
            version=1,
        )
        ProjectMembership.objects.create(project=self.project, user=self.teammate)

    def test_outsider_isolation_across_all_endpoints(self):
        self.client.force_authenticate(user=self.outsider)
        t = Task.objects.create(
            project=self.project,
            title="Private Task",
            assignee=self.teammate,
            status=TaskStatus.TODO,
        )

        # Outsider project detail
        self.assertEqual(self.client.get(f"/api/v1/projects/{self.project.id}/").status_code, 404)
        # Outsider task list
        self.assertEqual(self.client.get(f"/api/v1/projects/{self.project.id}/tasks/").status_code, 404)
        # Outsider task detail
        self.assertEqual(self.client.get(f"/api/v1/projects/{self.project.id}/tasks/{t.id}/").status_code, 404)
        # Outsider roster
        self.assertEqual(self.client.get(f"/api/v1/projects/{self.project.id}/members/").status_code, 404)
        # Outsider activity
        self.assertEqual(self.client.get(f"/api/v1/projects/{self.project.id}/activity/").status_code, 404)

    def test_project_hard_deletion_history_rule(self):
        self.client.force_authenticate(user=self.owner)

        # Empty project can be deleted
        empty_project = Project.objects.create(
            name="Empty Project",
            owner=self.owner,
            version=1,
        )
        resp_del_empty = self.client.delete(
            f"/api/v1/projects/{empty_project.id}/",
            HTTP_X_EXPECTED_VERSION="1",
        )
        self.assertEqual(resp_del_empty.status_code, 204)
        self.assertFalse(Project.objects.filter(id=empty_project.id).exists())

        # Project with even a soft-deleted task CANNOT be deleted
        t = Task.objects.create(
            project=self.project,
            title="History Task",
            status=TaskStatus.TODO,
            version=1,
        )
        # Soft delete the task
        self.client.delete(
            f"/api/v1/projects/{self.project.id}/tasks/{t.id}/",
            HTTP_X_EXPECTED_VERSION="1",
        )
        self.project.refresh_from_db()

        # Attempt to delete project -> 409 conflict
        resp_del_proj = self.client.delete(
            f"/api/v1/projects/{self.project.id}/",
            HTTP_X_EXPECTED_VERSION=str(self.project.version),
        )
        self.assertEqual(resp_del_proj.status_code, 409)
        self.assertTrue(Project.objects.filter(id=self.project.id).exists())

    def test_repeated_task_delete_returns_404(self):
        self.client.force_authenticate(user=self.owner)
        t = Task.objects.create(
            project=self.project,
            title="To be deleted",
            status=TaskStatus.TODO,
            version=1,
        )
        # First delete succeeds
        r1 = self.client.delete(
            f"/api/v1/projects/{self.project.id}/tasks/{t.id}/",
            HTTP_X_EXPECTED_VERSION="1",
        )
        self.assertEqual(r1.status_code, 204)

        # Repeated delete returns 404
        r2 = self.client.delete(
            f"/api/v1/projects/{self.project.id}/tasks/{t.id}/",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(r2.status_code, 404)

    def test_duplicate_uuid_returns_generic_409(self):
        self.client.force_authenticate(user=self.owner)
        pid = str(uuid.uuid4())
        r1 = self.client.post("/api/v1/projects/", {"id": pid, "name": "Project 1"}, format="json")
        self.assertEqual(r1.status_code, 201)

        # Duplicate ID submission
        r2 = self.client.post("/api/v1/projects/", {"id": pid, "name": "Project Duplicate"}, format="json")
        self.assertEqual(r2.status_code, 409)

    def test_mismatched_project_task_pair_returns_404(self):
        # Create second project
        project2 = Project.objects.create(name="Project 2", owner=self.owner, version=1)
        t1 = Task.objects.create(project=self.project, title="T1", status=TaskStatus.TODO, version=1)

        self.client.force_authenticate(user=self.owner)
        # Requesting t1 under project2 must return 404
        resp = self.client.get(f"/api/v1/projects/{project2.id}/tasks/{t1.id}/")
        self.assertEqual(resp.status_code, 404)

    def test_outsider_and_member_visibility_before_preconditions(self):
        # 1. Outsider PATCH on project without X-Expected-Version returns 404 (not 428)
        self.client.force_authenticate(user=self.outsider)
        r_out_patch = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            {"name": "Attempt rename"},
            format="json",
        )
        self.assertEqual(r_out_patch.status_code, 404)

        # 2. Member PATCH on project without X-Expected-Version returns 403 (not 428)
        self.client.force_authenticate(user=self.teammate)
        r_mem_patch = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            {"name": "Attempt rename"},
            format="json",
        )
        self.assertEqual(r_mem_patch.status_code, 403)

        # 3. Outsider POST task with invalid body returns 404 (not 400)
        self.client.force_authenticate(user=self.outsider)
        r_out_post_task = self.client.post(
            f"/api/v1/projects/{self.project.id}/tasks/",
            {},
            format="json",
        )
        self.assertEqual(r_out_post_task.status_code, 404)

    def test_malformed_query_filters_rejected_with_400(self):
        self.client.force_authenticate(user=self.owner)

        # Malformed status filter
        r_status = self.client.get(f"/api/v1/projects/{self.project.id}/tasks/?status=INVALID_STATUS")
        self.assertEqual(r_status.status_code, 400)
        self.assertEqual(r_status.data["code"], "invalid_field")

        # Malformed assignee filter
        r_assignee = self.client.get(f"/api/v1/projects/{self.project.id}/tasks/?assignee=notanumber")
        self.assertEqual(r_assignee.status_code, 400)

        # Malformed overdue filter
        r_overdue = self.client.get(f"/api/v1/projects/{self.project.id}/tasks/?overdue=maybe")
        self.assertEqual(r_overdue.status_code, 400)

        # Malformed archived filter on projects
        r_arch = self.client.get("/api/v1/projects/?archived=unknown")
        self.assertEqual(r_arch.status_code, 400)

        # Malformed kind filter on activity
        r_kind = self.client.get(f"/api/v1/projects/{self.project.id}/activity/?kind=NONEXISTENT")
        self.assertEqual(r_kind.status_code, 400)

        # Malformed task UUID filter on activity
        r_task_uuid = self.client.get(f"/api/v1/projects/{self.project.id}/activity/?task_id=not-a-uuid")
        self.assertEqual(r_task_uuid.status_code, 400)
