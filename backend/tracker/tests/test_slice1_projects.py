import uuid
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient
from tracker.models import Project

class Slice1ProjectListVisibilityTest(TestCase):
    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.user_a = User.objects.create_user(username="user_a", password="password123")
        self.user_b = User.objects.create_user(username="user_b", password="password123")
        self.project_a = Project.objects.create(
            id=uuid.uuid4(),
            name="Project Alpha",
            description="Alpha description",
            owner=self.user_a,
        )

    def test_outsider_cannot_see_or_fetch_project(self):
        # Authenticate as User B (outsider)
        self.client.force_authenticate(user=self.user_b)

        # GET /api/v1/projects/ returns empty results
        resp_list = self.client.get("/api/v1/projects/")
        self.assertEqual(resp_list.status_code, 200)
        self.assertEqual(resp_list.data["results"], [])

        # GET /api/v1/projects/{id}/ returns 404 for outsider
        resp_detail = self.client.get(f"/api/v1/projects/{self.project_a.id}/")
        self.assertEqual(resp_detail.status_code, 404)

        # Authenticate as User A (owner)
        self.client.force_authenticate(user=self.user_a)

        # GET /api/v1/projects/ contains exactly the project ID
        resp_list_a = self.client.get("/api/v1/projects/")
        self.assertEqual(resp_list_a.status_code, 200)
        self.assertEqual(len(resp_list_a.data["results"]), 1)
        self.assertEqual(str(resp_list_a.data["results"][0]["id"]), str(self.project_a.id))

        # GET /api/v1/projects/{id}/ returns 200 for owner
        resp_detail_a = self.client.get(f"/api/v1/projects/{self.project_a.id}/")
        self.assertEqual(resp_detail_a.status_code, 200)
        self.assertEqual(str(resp_detail_a.data["id"]), str(self.project_a.id))
        self.assertEqual(resp_detail_a.headers["X-Resource-Version"], "1")

    def test_login_csrf_and_session_flow(self):
        # 1. Get session endpoint bootstraps CSRF
        resp_session = self.client.get("/api/v1/session/")
        self.assertEqual(resp_session.status_code, 200)
        self.assertIsNone(resp_session.data["user"])
        csrf_token = self.client.cookies["csrftoken"].value

        # 2. Login without CSRF token should fail
        resp_fail_csrf = self.client.post(
            "/api/v1/session/login/",
            {"username": "user_a", "password": "password123"},
            format="json",
        )
        self.assertEqual(resp_fail_csrf.status_code, 403)

        # 3. Login with CSRF token succeeds
        resp_login = self.client.post(
            "/api/v1/session/login/",
            {"username": "user_a", "password": "password123"},
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(resp_login.status_code, 200)
        self.assertEqual(resp_login.data["user"]["username"], "user_a")

        # Refresh CSRF token after login rotation if changed
        if "csrftoken" in self.client.cookies:
            csrf_token = self.client.cookies["csrftoken"].value

        # 4. User A creates a project with client-supplied UUID
        new_project_id = str(uuid.uuid4())
        resp_create = self.client.post(
            "/api/v1/projects/",
            {"id": new_project_id, "name": "Beta Project", "description": "Second project"},
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(resp_create.status_code, 201)
        self.assertEqual(resp_create.data["id"], new_project_id)
        self.assertEqual(resp_create.headers["X-Resource-Version"], "1")

        # 5. Refresh project list to verify
        resp_list = self.client.get("/api/v1/projects/")
        self.assertEqual(resp_list.status_code, 200)
        self.assertEqual(resp_list.data["count"], 2)

        # 6. Logout
        resp_logout = self.client.post(
            "/api/v1/session/logout/",
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(resp_logout.status_code, 204)

        # 7. Unauthenticated access now returns 403 not_authenticated
        resp_unauth = self.client.get("/api/v1/projects/")
        self.assertEqual(resp_unauth.status_code, 403)
        self.assertEqual(resp_unauth.data["code"], "not_authenticated")

    def test_project_versioning_and_validation(self):
        self.client.force_authenticate(user=self.user_a)

        # Patch without X-Expected-Version returns 428 Precondition Required
        resp_no_version = self.client.patch(
            f"/api/v1/projects/{self.project_a.id}/",
            {"name": "Renamed Alpha"},
            format="json",
        )
        self.assertEqual(resp_no_version.status_code, 428)

        # Patch with stale X-Expected-Version returns 412 Precondition Failed
        resp_stale = self.client.patch(
            f"/api/v1/projects/{self.project_a.id}/",
            {"name": "Renamed Alpha"},
            format="json",
            HTTP_X_EXPECTED_VERSION="99",
        )
        self.assertEqual(resp_stale.status_code, 412)

        # Successful patch with correct version advances version
        resp_patch = self.client.patch(
            f"/api/v1/projects/{self.project_a.id}/",
            {"name": "Renamed Alpha"},
            format="json",
            HTTP_X_EXPECTED_VERSION="1",
        )
        self.assertEqual(resp_patch.status_code, 200)
        self.assertEqual(resp_patch.data["name"], "Renamed Alpha")
        self.assertEqual(resp_patch.data["version"], 2)
        self.assertEqual(resp_patch.headers["X-Resource-Version"], "2")

        # Blank name validation returns 400
        resp_invalid = self.client.patch(
            f"/api/v1/projects/{self.project_a.id}/",
            {"name": "   "},
            format="json",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(resp_invalid.status_code, 400)
        self.assertEqual(resp_invalid.data["code"], "invalid_field")

        # Unknown field returns 400
        resp_unknown = self.client.patch(
            f"/api/v1/projects/{self.project_a.id}/",
            {"foo": "bar"},
            format="json",
            HTTP_X_EXPECTED_VERSION="2",
        )
        self.assertEqual(resp_unknown.status_code, 400)

    def test_spa_deep_refresh_and_unknown_api_404(self):
        # Unknown API route returns 404 JSON
        resp_unknown_api = self.client.get("/api/v1/nonexistent/")
        self.assertEqual(resp_unknown_api.status_code, 404)
        self.assertEqual(resp_unknown_api.json()["code"], "not_found")

        # Frontend deep link route returns SPA HTML 200
        resp_spa = self.client.get("/projects")
        self.assertEqual(resp_spa.status_code, 200)
