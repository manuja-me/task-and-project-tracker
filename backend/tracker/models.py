import uuid
from django.db import models
from django.contrib.auth.models import User

class TaskStatus(models.TextChoices):
    TODO = "TODO", "TODO"
    IN_PROGRESS = "IN_PROGRESS", "IN_PROGRESS"
    DONE = "DONE", "DONE"

class TrackerKind(models.TextChoices):
    CREATED = "CREATED", "CREATED"
    UPDATED = "UPDATED", "UPDATED"
    DELETED = "DELETED", "DELETED"

class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=2000, blank=True, default="")
    owner = models.ForeignKey(User, on_delete=models.PROTECT, related_name="owned_projects")
    archived = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["-created_at", "-id"]),
        ]

    def __str__(self):
        return self.name

class ProjectMembership(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="project_memberships")
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("project", "user")
        indexes = [
            models.Index(fields=["project", "user"]),
        ]

    def __str__(self):
        return f"{self.user.username} in {self.project.name}"

class Task(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="tasks")
    title = models.CharField(max_length=160)
    description = models.CharField(max_length=4000, blank=True, default="")
    assignee = models.ForeignKey(
        User, on_delete=models.PROTECT, null=True, blank=True, related_name="assigned_tasks"
    )
    status = models.CharField(
        max_length=20, choices=TaskStatus.choices, default=TaskStatus.TODO
    )
    due_date = models.DateField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["project", "status"]),
            models.Index(fields=["assignee", "status"]),
            models.Index(fields=["-created_at", "-id"]),
        ]

    def __str__(self):
        return self.title

class Tracker(models.Model):
    task = models.ForeignKey(Task, on_delete=models.PROTECT, related_name="events")
    actor = models.ForeignKey(User, on_delete=models.PROTECT, related_name="tracker_events")
    actor_username = models.CharField(max_length=150)
    task_version = models.PositiveIntegerField()
    kind = models.CharField(max_length=20, choices=TrackerKind.choices)
    changes = models.JSONField(default=dict)
    event_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("task", "task_version")
        ordering = ["-event_at", "-id"]
        indexes = [
            models.Index(fields=["task", "task_version"]),
            models.Index(fields=["-event_at", "-id"]),
        ]

    def __str__(self):
        return f"Event {self.id} on Task {self.task_id} v{self.task_version} ({self.kind})"
