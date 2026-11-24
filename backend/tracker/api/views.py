import uuid
from django.contrib.auth import authenticate, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_protect
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.exceptions import ValidationError, NotFound, PermissionDenied
from tracker.models import Task

from tracker.selectors import (
    get_visible_projects,
    get_project_for_user,
    get_user_role,
    compute_project_progress_and_counts,
    get_project_roster,
    get_tasks_for_project,
    get_my_tasks,
    get_task_for_user,
    get_task_history,
    get_project_activity,
)
from tracker.services import (
    create_project,
    update_project,
    delete_project,
    add_project_member,
    remove_project_member,
    create_task,
    update_task,
    delete_task,
)
from tracker.api.serializers import (
    UserSnapshotSerializer,
    LoginSerializer,
    ProjectListSerializer,
    ProjectDetailSerializer,
    ProjectCreateSerializer,
    ProjectUpdateSerializer,
    MemberItemSerializer,
    AddMemberSerializer,
    TaskSerializer,
    TaskCreateSerializer,
    TaskUpdateSerializer,
    TrackerSerializer,
)
from tracker.api.exceptions import PreconditionRequiredError
from tracker.api.pagination import StandardPagination

def get_expected_version(request) -> int:
    val = request.headers.get("X-Expected-Version")
    if val is None:
        raise PreconditionRequiredError("X-Expected-Version header is required.")
    try:
        v = int(val)
        if v <= 0:
            raise ValueError()
        return v
    except ValueError:
        raise ValidationError({"X-Expected-Version": ["Must be a positive integer."]})

class SessionView(APIView):
    permission_classes = [AllowAny]

    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        if request.user.is_authenticated:
            user_data = UserSnapshotSerializer(request.user).data
        else:
            user_data = None
        resp = Response({"user": user_data})
        resp["Cache-Control"] = "private, no-store"
        return resp

class LoginView(APIView):
    permission_classes = [AllowAny]

    @method_decorator(csrf_protect)
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        username = serializer.validated_data["username"]
        password = serializer.validated_data["password"]
        user = authenticate(request, username=username, password=password)
        if user is None or not user.is_active:
            return Response(
                {"code": "invalid_credentials", "message": "Invalid username or password.", "fields": {}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        login(request, user)
        return Response({"user": UserSnapshotSerializer(user).data}, status=status.HTTP_200_OK)

class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    @method_decorator(csrf_protect)
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)

class ProjectListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = get_visible_projects(request.user)
        search = request.query_params.get("search") or request.query_params.get("name")
        if search:
            qs = qs.filter(name__icontains=search.strip())

        archived = request.query_params.get("archived")
        if archived is not None:
            if archived.lower() in ("true", "1"):
                qs = qs.filter(archived=True)
            elif archived.lower() in ("false", "0"):
                qs = qs.filter(archived=False)
            else:
                raise ValidationError({"archived": ["Invalid archived filter. Must be 'true' or 'false'."]})

        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        serializer = ProjectListSerializer(page, many=True, context={"request": request})
        resp = paginator.get_paginated_response(serializer.data)
        resp["Cache-Control"] = "private, no-store"
        return resp

    def post(self, request):
        serializer = ProjectCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = create_project(
            project_id=serializer.validated_data.get("id"),
            name=serializer.validated_data["name"],
            description=serializer.validated_data.get("description", ""),
            owner=request.user,
        )
        data = ProjectDetailSerializer(project, context={"request": request}).data
        resp = Response(data, status=status.HTTP_201_CREATED)
        resp["X-Resource-Version"] = str(project.version)
        return resp

class ProjectDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        project = get_project_for_user(project_id, request.user)
        if not project:
            raise NotFound("Project not found.")
        data = ProjectDetailSerializer(project, context={"request": request}).data
        resp = Response(data, status=status.HTTP_200_OK)
        resp["X-Resource-Version"] = str(project.version)
        resp["Cache-Control"] = "private, no-store"
        return resp

    def patch(self, request, project_id):
        project = get_project_for_user(project_id, request.user)
        if not project:
            raise NotFound("Project not found.")
        if project.owner_id != request.user.id:
            raise PermissionDenied("Only the project owner can edit project settings.")
        expected_version = get_expected_version(request)
        serializer = ProjectUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = update_project(
            project_id=project_id,
            user=request.user,
            expected_version=expected_version,
            data=serializer.validated_data,
        )
        data = ProjectDetailSerializer(project, context={"request": request}).data
        resp = Response(data, status=status.HTTP_200_OK)
        resp["X-Resource-Version"] = str(project.version)
        return resp

    def delete(self, request, project_id):
        project = get_project_for_user(project_id, request.user)
        if not project:
            raise NotFound("Project not found.")
        if project.owner_id != request.user.id:
            raise PermissionDenied("Only the project owner can delete this project.")
        expected_version = get_expected_version(request)
        delete_project(
            project_id=project_id,
            user=request.user,
            expected_version=expected_version,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

class ProjectMembersView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        project = get_project_for_user(project_id, request.user)
        if not project:
            raise NotFound("Project not found.")
        roster = get_project_roster(project)
        serializer = MemberItemSerializer(roster, many=True)
        resp = Response(serializer.data, status=status.HTTP_200_OK)
        resp["X-Resource-Version"] = str(project.version)
        resp["Cache-Control"] = "private, no-store"
        return resp

    def post(self, request, project_id):
        project = get_project_for_user(project_id, request.user)
        if not project:
            raise NotFound("Project not found.")
        if project.owner_id != request.user.id:
            raise PermissionDenied("Only the project owner can add members.")
        expected_version = get_expected_version(request)
        serializer = AddMemberSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership, project = add_project_member(
            project_id=project_id,
            owner_user=request.user,
            username=serializer.validated_data["username"],
            expected_version=expected_version,
        )
        data = {
            "id": membership.user.id,
            "username": membership.user.username,
            "role": "member",
            "is_active": membership.user.is_active,
            "joined_at": membership.joined_at,
        }
        resp = Response(MemberItemSerializer(data).data, status=status.HTTP_201_CREATED)
        resp["X-Resource-Version"] = str(project.version)
        return resp

class ProjectMemberDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, project_id, user_id):
        project = get_project_for_user(project_id, request.user)
        if not project:
            raise NotFound("Project not found.")
        if project.owner_id != request.user.id:
            raise PermissionDenied("Only the project owner can remove members.")
        expected_version = get_expected_version(request)
        project = remove_project_member(
            project_id=project_id,
            owner_user=request.user,
            target_user_id=user_id,
            expected_version=expected_version,
        )
        resp = Response(status=status.HTTP_204_NO_CONTENT)
        resp["X-Resource-Version"] = str(project.version)
        return resp

class TaskListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        project = get_project_for_user(project_id, request.user)
        if not project:
            raise NotFound("Project not found.")

        search = request.query_params.get("search") or request.query_params.get("title")
        status_param = request.query_params.get("status")
        assignee_param = request.query_params.get("assignee")
        overdue_param = request.query_params.get("overdue")

        qs = get_tasks_for_project(
            project,
            search=search,
            status=status_param,
            assignee=assignee_param,
            overdue=overdue_param,
        )
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        serializer = TaskSerializer(page, many=True, context={"request": request})
        resp = paginator.get_paginated_response(serializer.data)
        resp["Cache-Control"] = "private, no-store"
        return resp

    def post(self, request, project_id):
        project = get_project_for_user(project_id, request.user)
        if not project:
            raise NotFound("Project not found.")
        if project.owner_id != request.user.id:
            raise PermissionDenied("Only the project owner can create tasks.")
        serializer = TaskCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = create_task(
            project_id=project_id,
            user=request.user,
            task_id=serializer.validated_data.get("id"),
            title=serializer.validated_data["title"],
            description=serializer.validated_data.get("description", ""),
            assignee_id=serializer.validated_data.get("assignee_id"),
            due_date=serializer.validated_data.get("due_date"),
        )
        data = TaskSerializer(task, context={"request": request}).data
        resp = Response(data, status=status.HTTP_201_CREATED)
        resp["X-Resource-Version"] = str(task.version)
        return resp

class MyTasksView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        search = request.query_params.get("search") or request.query_params.get("title")
        status_param = request.query_params.get("status")
        overdue_param = request.query_params.get("overdue")

        qs = get_my_tasks(
            request.user,
            search=search,
            status=status_param,
            overdue=overdue_param,
        )
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        serializer = TaskSerializer(page, many=True, context={"request": request})
        resp = paginator.get_paginated_response(serializer.data)
        resp["Cache-Control"] = "private, no-store"
        return resp

class TaskDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id, task_id):
        task = get_task_for_user(project_id, task_id, request.user)
        if not task:
            raise NotFound("Task not found.")
        data = TaskSerializer(task, context={"request": request}).data
        resp = Response(data, status=status.HTTP_200_OK)
        resp["X-Resource-Version"] = str(task.version)
        resp["Cache-Control"] = "private, no-store"
        return resp

    def patch(self, request, project_id, task_id):
        project = get_project_for_user(project_id, request.user)
        if not project:
            raise NotFound("Project not found.")
        task = Task.objects.filter(id=task_id, project=project, deleted_at__isnull=True).first()
        if not task:
            raise NotFound("Task not found.")
        is_owner = (project.owner_id == request.user.id)
        if not is_owner:
            if task.assignee_id != request.user.id:
                raise PermissionDenied("You can only change the status of tasks assigned to you.")
            raw_keys = set(request.data.keys())
            if raw_keys - {"status"}:
                raise PermissionDenied("Members can only update status.")
        expected_version = get_expected_version(request)
        serializer = TaskUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = update_task(
            project_id=project_id,
            task_id=task_id,
            user=request.user,
            expected_version=expected_version,
            data=serializer.validated_data,
            raw_payload_keys=set(request.data.keys()),
        )
        data = TaskSerializer(task, context={"request": request}).data
        resp = Response(data, status=status.HTTP_200_OK)
        resp["X-Resource-Version"] = str(task.version)
        return resp

    def delete(self, request, project_id, task_id):
        project = get_project_for_user(project_id, request.user)
        if not project:
            raise NotFound("Project not found.")
        task = Task.objects.filter(id=task_id, project=project, deleted_at__isnull=True).first()
        if not task:
            raise NotFound("Task not found.")
        if project.owner_id != request.user.id:
            raise PermissionDenied("Only the project owner can delete tasks.")
        expected_version = get_expected_version(request)
        delete_task(
            project_id=project_id,
            task_id=task_id,
            user=request.user,
            expected_version=expected_version,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

class TaskHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id, task_id):
        qs = get_task_history(project_id, task_id, request.user)
        if qs is None:
            raise NotFound("Task not found.")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        serializer = TrackerSerializer(page, many=True)
        resp = paginator.get_paginated_response(serializer.data)
        resp["Cache-Control"] = "private, no-store"
        return resp

class ProjectActivityView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        project = get_project_for_user(project_id, request.user)
        if not project:
            raise NotFound("Project not found.")

        task_id = request.query_params.get("task") or request.query_params.get("task_id")
        kind = request.query_params.get("kind")

        qs = get_project_activity(project, task_id=task_id, kind=kind)
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        serializer = TrackerSerializer(page, many=True)
        resp = paginator.get_paginated_response(serializer.data)
        resp["Cache-Control"] = "private, no-store"
        return resp
