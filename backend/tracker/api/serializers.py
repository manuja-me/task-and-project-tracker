from collections.abc import Mapping
from rest_framework import serializers
from django.contrib.auth.models import User
from tracker.models import Project, Task, ProjectMembership, Tracker, TaskStatus
from tracker.selectors import (
    compute_project_progress_and_counts,
    get_user_role,
    is_task_overdue,
)

class StrictFieldsMixin:
    def to_internal_value(self, data):
        if isinstance(data, Mapping):
            unknown = set(data.keys()) - set(self.fields.keys())
            if unknown:
                raise serializers.ValidationError({field: ["Unknown field."] for field in unknown})
        return super().to_internal_value(data)

class StrictModelSerializer(StrictFieldsMixin, serializers.ModelSerializer):
    pass

class UserSnapshotSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "is_active"]

class ProjectListSerializer(serializers.ModelSerializer):
    owner = UserSnapshotSerializer(read_only=True)
    role = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id",
            "name",
            "description",
            "owner",
            "archived",
            "version",
            "created_at",
            "updated_at",
            "role",
            "progress",
        ]

    def get_role(self, obj):
        request = self.context.get("request")
        user = request.user if request else None
        member_project_ids = self.context.get("member_project_ids")
        if member_project_ids is not None and user and user.is_authenticated:
            if obj.owner_id == user.id:
                return "owner"
            return "member" if obj.id in member_project_ids else None
        return get_user_role(obj, user)

    def get_progress(self, obj):
        progress_map = self.context.get("progress_map")
        if progress_map is not None:
            return progress_map[obj.id]
        return compute_project_progress_and_counts(obj)

class ProjectDetailSerializer(ProjectListSerializer):
    pass

class ProjectCreateSerializer(StrictFieldsMixin, serializers.Serializer):
    id = serializers.UUIDField(required=False)
    name = serializers.CharField(max_length=120, trim_whitespace=True)
    description = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="", trim_whitespace=True)

    def validate_name(self, value):
        val = value.strip()
        if not val:
            raise serializers.ValidationError("Project name cannot be blank.")
        return val

class ProjectUpdateSerializer(StrictFieldsMixin, serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False, trim_whitespace=True)
    description = serializers.CharField(max_length=2000, required=False, allow_blank=True, trim_whitespace=True)
    archived = serializers.BooleanField(required=False)

    def validate_name(self, value):
        val = value.strip()
        if not val:
            raise serializers.ValidationError("Project name cannot be blank.")
        return val

class TaskProjectSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ["id", "name"]

class TaskSerializer(serializers.ModelSerializer):
    project = TaskProjectSummarySerializer(read_only=True)
    assignee = UserSnapshotSerializer(read_only=True)
    is_overdue = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "project",
            "title",
            "description",
            "assignee",
            "status",
            "due_date",
            "is_overdue",
            "version",
            "created_at",
            "updated_at",
        ]

    def get_is_overdue(self, obj):
        return is_task_overdue(obj)

class TaskCreateSerializer(StrictFieldsMixin, serializers.Serializer):
    id = serializers.UUIDField(required=False)
    title = serializers.CharField(max_length=160, trim_whitespace=True)
    description = serializers.CharField(max_length=4000, required=False, allow_blank=True, default="", trim_whitespace=True)
    assignee_id = serializers.IntegerField(required=False, allow_null=True)
    due_date = serializers.DateField(required=False, allow_null=True)

    def validate_title(self, value):
        val = value.strip()
        if not val:
            raise serializers.ValidationError("Task title cannot be blank.")
        return val

class TaskUpdateSerializer(StrictFieldsMixin, serializers.Serializer):
    title = serializers.CharField(max_length=160, required=False, trim_whitespace=True)
    description = serializers.CharField(max_length=4000, required=False, allow_blank=True, trim_whitespace=True)
    assignee_id = serializers.IntegerField(required=False, allow_null=True)
    due_date = serializers.DateField(required=False, allow_null=True)
    status = serializers.ChoiceField(choices=TaskStatus.choices, required=False)

    def validate_title(self, value):
        val = value.strip()
        if not val:
            raise serializers.ValidationError("Task title cannot be blank.")
        return val

class TrackerSerializer(serializers.ModelSerializer):
    task_id = serializers.UUIDField(source="task.id", read_only=True)
    task_title = serializers.CharField(source="task.title", read_only=True)
    task_is_deleted = serializers.SerializerMethodField()
    actor = serializers.SerializerMethodField()

    class Meta:
        model = Tracker
        fields = [
            "id",
            "task_id",
            "task_title",
            "task_is_deleted",
            "actor",
            "task_version",
            "kind",
            "changes",
            "event_at",
        ]

    def get_task_is_deleted(self, obj):
        return obj.task.deleted_at is not None

    def get_actor(self, obj):
        return {
            "id": obj.actor_id,
            "username": obj.actor_username,
        }

class MemberItemSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    role = serializers.CharField()
    is_active = serializers.BooleanField()
    joined_at = serializers.DateTimeField()

class AddMemberSerializer(StrictFieldsMixin, serializers.Serializer):
    username = serializers.CharField(max_length=150, trim_whitespace=True)

class LoginSerializer(StrictFieldsMixin, serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)
