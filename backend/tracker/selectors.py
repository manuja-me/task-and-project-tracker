import zoneinfo
import uuid
from decimal import Decimal, ROUND_HALF_UP
from django.utils import timezone
from django.db.models import Q, Count, Exists, OuterRef
from django.contrib.auth.models import User
from rest_framework.exceptions import ValidationError
from tracker.models import Project, Task, ProjectMembership, Tracker, TaskStatus, TrackerKind

PG_INT32_MIN = -2_147_483_648
PG_INT32_MAX = 2_147_483_647

def get_colombo_today():
    colombo_tz = zoneinfo.ZoneInfo("Asia/Colombo")
    return timezone.now().astimezone(colombo_tz).date()

def is_task_overdue(task):
    if task.deleted_at is not None or task.status == "DONE" or task.due_date is None:
        return False
    return task.due_date < get_colombo_today()

def get_visible_projects(user):
    if not user or not user.is_authenticated:
        return Project.objects.none()
    return Project.objects.filter(
        Q(owner=user)
        | Exists(ProjectMembership.objects.filter(project=OuterRef("pk"), user=user))
    )

def get_project_for_user(project_id, user):
    """Returns project if visible to user, else None."""
    qs = get_visible_projects(user)
    return qs.filter(id=project_id).first()

def get_user_role(project, user):
    if not user or not user.is_authenticated:
        return None
    if project.owner_id == user.id:
        return "owner"
    if ProjectMembership.objects.filter(project=project, user=user).exists():
        return "member"
    return None

def get_project_roster(project):
    """
    Returns the roster of members including the owner, ordered by owner first then join date.
    """
    roster = [
        {
            "id": project.owner.id,
            "username": project.owner.username,
            "role": "owner",
            "is_active": project.owner.is_active,
            "joined_at": project.created_at,
        }
    ]
    memberships = (
        ProjectMembership.objects.filter(project=project)
        .select_related("user")
        .order_by("joined_at")
    )
    for m in memberships:
        roster.append(
            {
                "id": m.user.id,
                "username": m.user.username,
                "role": "member",
                "is_active": m.user.is_active,
                "joined_at": m.joined_at,
            }
        )
    return roster

def get_tasks_for_project(project, *, search=None, status=None, assignee=None, overdue=None):
    qs = (
        Task.objects.filter(project=project, deleted_at__isnull=True)
        .select_related("assignee", "project")
        .order_by("-created_at", "-id")
    )

    if search:
        qs = qs.filter(title__icontains=search.strip())

    if status:
        if status not in TaskStatus.values:
            raise ValidationError({"status": [f"Invalid status filter value '{status}'."]})
        qs = qs.filter(status=status)

    if assignee is not None:
        if assignee == "unassigned":
            qs = qs.filter(assignee__isnull=True)
        else:
            try:
                assignee_id = int(assignee)
            except (ValueError, TypeError):
                raise ValidationError({"assignee": ["Invalid assignee filter. Must be an integer ID or 'unassigned'."]})
            if not (PG_INT32_MIN <= assignee_id <= PG_INT32_MAX):
                raise ValidationError({"assignee": ["Invalid assignee filter. Must be an integer ID or 'unassigned'."]})
            qs = qs.filter(assignee_id=assignee_id)

    if overdue is not None:
        colombo_today = get_colombo_today()
        if overdue in (True, "true", "1"):
            qs = qs.exclude(status="DONE").filter(due_date__lt=colombo_today)
        elif overdue in (False, "false", "0"):
            qs = qs.filter(Q(status="DONE") | Q(due_date__isnull=True) | Q(due_date__gte=colombo_today))
        else:
            raise ValidationError({"overdue": ["Invalid overdue filter. Must be 'true' or 'false'."]})

    return qs

def get_task_for_user(project_id, task_id, user):
    project = get_project_for_user(project_id, user)
    if not project:
        return None
    return Task.objects.filter(id=task_id, project=project, deleted_at__isnull=True).first()

def get_task_history(project_id, task_id, user):
    project = get_project_for_user(project_id, user)
    if not project:
        return None
    task = Task.objects.filter(id=task_id, project=project).first()
    if not task:
        return None
    return Tracker.objects.filter(task=task).select_related("actor", "task").order_by("-event_at", "-id")

def get_project_activity(project, *, task_id=None, kind=None):
    qs = (
        Tracker.objects.filter(task__project=project)
        .select_related("actor", "task")
        .order_by("-event_at", "-id")
    )
    if task_id:
        try:
            val_uuid = uuid.UUID(str(task_id))
            qs = qs.filter(task_id=val_uuid)
        except (ValueError, TypeError, AttributeError):
            raise ValidationError({"task": ["Invalid task ID. Must be a valid UUID."]})

    if kind:
        if kind not in TrackerKind.values:
            raise ValidationError({"kind": [f"Invalid kind filter value '{kind}'."]})
        qs = qs.filter(kind=kind)
    return qs

def get_my_tasks(user, *, search=None, status=None, overdue=None):
    if not user or not user.is_authenticated:
        return Task.objects.none()

    qs = (
        Task.objects.filter(
            assignee=user,
            deleted_at__isnull=True,
            project__archived=False,
            project__in=get_visible_projects(user),
        )
        .select_related("assignee", "project")
        .order_by("-created_at", "-id")
    )

    if search:
        qs = qs.filter(title__icontains=search.strip())

    if status:
        if status not in TaskStatus.values:
            raise ValidationError({"status": [f"Invalid status filter value '{status}'."]})
        qs = qs.filter(status=status)

    if overdue is not None:
        colombo_today = get_colombo_today()
        if overdue in (True, "true", "1"):
            qs = qs.exclude(status="DONE").filter(due_date__lt=colombo_today)
        elif overdue in (False, "false", "0"):
            qs = qs.filter(Q(status="DONE") | Q(due_date__isnull=True) | Q(due_date__gte=colombo_today))
        else:
            raise ValidationError({"overdue": ["Invalid overdue filter. Must be 'true' or 'false'."]})

    return qs

def _format_progress_counts(total, todo, in_progress, done):
    if total == 0:
        return {
            "total_tasks": 0,
            "todo_count": 0,
            "in_progress_count": 0,
            "done_count": 0,
            "percent_complete": 0,
            "progress_label": "No tasks yet",
        }

    ratio = (Decimal(done) * Decimal(100)) / Decimal(total)
    percent = int(ratio.quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    return {
        "total_tasks": total,
        "todo_count": todo,
        "in_progress_count": in_progress,
        "done_count": done,
        "percent_complete": percent,
        "progress_label": f"{percent}%",
    }


def get_project_progress_map(projects):
    if not projects:
        return {}
    rows = (
        Task.objects.filter(project__in=projects, deleted_at__isnull=True)
        .values("project_id")
        .annotate(
            total=Count("id"),
            todo=Count("id", filter=Q(status="TODO")),
            in_progress=Count("id", filter=Q(status="IN_PROGRESS")),
            done=Count("id", filter=Q(status="DONE")),
        )
    )
    progress_map = {
        row["project_id"]: _format_progress_counts(
            row["total"], row["todo"], row["in_progress"], row["done"]
        )
        for row in rows
    }
    empty_progress = _format_progress_counts(0, 0, 0, 0)
    for project in projects:
        progress_map.setdefault(project.id, empty_progress)
    return progress_map


def compute_project_progress_and_counts(project):
    """
    Compute progress from active task rows as whole percent DONE / total, rounded half up.
    Zero tasks gives 0% and 'No tasks yet'. Include unassigned tasks in the denominator.
    """
    active_tasks = project.tasks.filter(deleted_at__isnull=True)
    counts = active_tasks.aggregate(
        total=Count("id"),
        todo=Count("id", filter=Q(status="TODO")),
        in_progress=Count("id", filter=Q(status="IN_PROGRESS")),
        done=Count("id", filter=Q(status="DONE")),
    )
    return _format_progress_counts(
        counts["total"], counts["todo"], counts["in_progress"], counts["done"]
    )
