import zoneinfo
from decimal import Decimal, ROUND_HALF_UP
from django.utils import timezone
from django.db.models import Q, Count
from django.contrib.auth.models import User
from tracker.models import Project, Task, ProjectMembership, Tracker

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
        Q(owner=user) | Q(memberships__user=user)
    ).distinct()

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
        qs = qs.filter(status=status)

    if assignee is not None:
        if assignee == "unassigned":
            qs = qs.filter(assignee__isnull=True)
        else:
            try:
                assignee_id = int(assignee)
                qs = qs.filter(assignee_id=assignee_id)
            except (ValueError, TypeError):
                pass

    if overdue is not None:
        colombo_today = get_colombo_today()
        if overdue in (True, "true", "1"):
            qs = qs.exclude(status="DONE").filter(due_date__lt=colombo_today)
        elif overdue in (False, "false", "0"):
            qs = qs.filter(Q(status="DONE") | Q(due_date__isnull=True) | Q(due_date__gte=colombo_today))

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
        qs = qs.filter(task_id=task_id)
    if kind:
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
        )
        .select_related("assignee", "project")
        .order_by("-created_at", "-id")
    )

    if search:
        qs = qs.filter(title__icontains=search.strip())

    if status:
        qs = qs.filter(status=status)

    if overdue is not None:
        colombo_today = get_colombo_today()
        if overdue in (True, "true", "1"):
            qs = qs.exclude(status="DONE").filter(due_date__lt=colombo_today)
        elif overdue in (False, "false", "0"):
            qs = qs.filter(Q(status="DONE") | Q(due_date__isnull=True) | Q(due_date__gte=colombo_today))

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
        qs = qs.filter(task_id=task_id)
    if kind:
        qs = qs.filter(kind=kind)
    return qs


def compute_project_progress_and_counts(project):
    """
    Compute progress from active task rows as whole percent DONE / total, rounded half up.
    Zero tasks gives 0% and 'No tasks yet'. Include unassigned tasks in the denominator.
    """
    active_tasks = project.tasks.filter(deleted_at__isnull=True)
    total = active_tasks.count()
    if total == 0:
        return {
            "total_tasks": 0,
            "todo_count": 0,
            "in_progress_count": 0,
            "done_count": 0,
            "percent_complete": 0,
            "progress_label": "No tasks yet",
        }
    
    counts = active_tasks.aggregate(
        todo=Count("id", filter=Q(status="TODO")),
        in_progress=Count("id", filter=Q(status="IN_PROGRESS")),
        done=Count("id", filter=Q(status="DONE")),
    )
    done_count = counts["done"]
    # Round half-up
    ratio = (Decimal(done_count) * Decimal(100)) / Decimal(total)
    percent = int(ratio.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    
    return {
        "total_tasks": total,
        "todo_count": counts["todo"],
        "in_progress_count": counts["in_progress"],
        "done_count": done_count,
        "percent_complete": percent,
        "progress_label": f"{percent}%",
    }
