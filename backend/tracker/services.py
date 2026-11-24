import uuid
from django.utils import timezone
from django.db import transaction, IntegrityError
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound
from tracker.models import Project, Task, ProjectMembership, Tracker, TaskStatus, TrackerKind
from tracker.api.exceptions import ConflictError, StaleWriteError, MemberHasAssignedTasksError
from django.contrib.auth.models import User

def create_project(*, project_id=None, name: str, description: str = "", owner) -> Project:
    name = (name or "").strip()
    if not name:
        raise ValidationError({"name": ["Project name is required."]})
    if len(name) > 120:
        raise ValidationError({"name": ["Project name cannot exceed 120 characters."]})
    
    description = (description or "").strip()
    if len(description) > 2000:
        raise ValidationError({"description": ["Project description cannot exceed 2000 characters."]})

    if project_id is None:
        project_id = uuid.uuid4()
    elif isinstance(project_id, str):
        try:
            project_id = uuid.UUID(project_id)
        except ValueError:
            raise ValidationError({"id": ["Invalid UUID format."]})

    try:
        project = Project.objects.create(
            id=project_id,
            name=name,
            description=description,
            owner=owner,
            version=1,
            archived=False,
        )
        return project
    except IntegrityError:
        raise ConflictError("A project with this ID already exists.")

def update_project(*, project_id, user, expected_version: int, data: dict) -> Project:
    with transaction.atomic():
        try:
            project = Project.objects.select_for_update().get(id=project_id)
        except Project.DoesNotExist:
            raise NotFound("Project not found.")

        # Check visibility & role
        if project.owner_id != user.id:
            # Check if user is a member
            if ProjectMembership.objects.filter(project=project, user=user).exists():
                raise PermissionDenied("Only the project owner can edit project settings.")
            raise NotFound("Project not found.")

        # Check version
        if project.version != expected_version:
            raise StaleWriteError(f"Version mismatch. Server is at version {project.version}.")

        # Check if project is archived
        is_archiving_or_restoring = "archived" in data and len(data) == 1
        if project.archived and not is_archiving_or_restoring:
            raise ConflictError("Cannot edit archived project unless restoring it.")

        # Validate and apply updates
        has_changes = False

        if "archived" in data:
            new_archived = bool(data["archived"])
            if new_archived != project.archived:
                project.archived = new_archived
                has_changes = True

        if "name" in data:
            new_name = (data["name"] or "").strip()
            if not new_name:
                raise ValidationError({"name": ["Project name is required."]})
            if len(new_name) > 120:
                raise ValidationError({"name": ["Project name cannot exceed 120 characters."]})
            if new_name != project.name:
                project.name = new_name
                has_changes = True

        if "description" in data:
            new_desc = (data["description"] or "").strip()
            if len(new_desc) > 2000:
                raise ValidationError({"description": ["Project description cannot exceed 2000 characters."]})
            if new_desc != project.description:
                project.description = new_desc
                has_changes = True

        if has_changes:
            project.version += 1
            project.save()

        return project

def delete_project(*, project_id, user, expected_version: int):
    with transaction.atomic():
        try:
            project = Project.objects.select_for_update().get(id=project_id)
        except Project.DoesNotExist:
            raise NotFound("Project not found.")

        # Check visibility & role
        if project.owner_id != user.id:
            if ProjectMembership.objects.filter(project=project, user=user).exists():
                raise PermissionDenied("Only the project owner can delete this project.")
            raise NotFound("Project not found.")

        if project.version != expected_version:
            raise StaleWriteError(f"Version mismatch. Server is at version {project.version}.")

        # History rule (§3):
        # "Project hard deletion is owner-only and allowed only if the project has never contained a task,
        # so it cannot erase history."
        if Task.objects.filter(project=project).exists():
            raise ConflictError("Projects that have ever contained tasks cannot be deleted. Archive it instead.")

        project.memberships.all().delete()
        project.delete()

def add_project_member(*, project_id, owner_user, username: str, expected_version: int):
    with transaction.atomic():
        try:
            project = Project.objects.select_for_update().get(id=project_id)
        except Project.DoesNotExist:
            raise NotFound("Project not found.")

        if project.owner_id != owner_user.id:
            if ProjectMembership.objects.filter(project=project, user=owner_user).exists():
                raise PermissionDenied("Only the project owner can add members.")
            raise NotFound("Project not found.")

        if project.version != expected_version:
            raise StaleWriteError(f"Version mismatch. Server is at version {project.version}.")

        if project.archived:
            raise ConflictError("Cannot modify members in an archived project.")

        username = (username or "").strip()
        if not username:
            raise ValidationError({"username": ["Username is required."], "message": "User not found or inactive."})

        try:
            target_user = User.objects.get(username=username)
        except User.DoesNotExist:
            raise ValidationError({"username": ["User not found or inactive."], "message": "User not found or inactive."})

        if not target_user.is_active:
            raise ValidationError({"username": ["User not found or inactive."], "message": "User not found or inactive."})

        if target_user.id == project.owner_id:
            raise ConflictError("The project owner is already a member.")

        if ProjectMembership.objects.filter(project=project, user=target_user).exists():
            raise ConflictError("User is already a member of this project.")

        membership = ProjectMembership.objects.create(project=project, user=target_user)
        project.version += 1
        project.save()

        return membership, project

def remove_project_member(*, project_id, owner_user, target_user_id: int, expected_version: int):
    with transaction.atomic():
        try:
            project = Project.objects.select_for_update().get(id=project_id)
        except Project.DoesNotExist:
            raise NotFound("Project not found.")

        if project.owner_id != owner_user.id:
            if ProjectMembership.objects.filter(project=project, user=owner_user).exists():
                raise PermissionDenied("Only the project owner can remove members.")
            raise NotFound("Project not found.")

        if project.version != expected_version:
            raise StaleWriteError(f"Version mismatch. Server is at version {project.version}.")

        if project.archived:
            raise ConflictError("Cannot modify members in an archived project.")

        if target_user_id == project.owner_id:
            raise ValidationError({"user_id": ["Cannot remove the project owner."]})

        membership = ProjectMembership.objects.filter(project=project, user_id=target_user_id).first()
        if not membership:
            raise NotFound("Member not found in this project.")

        # Block removing a member who has any nondeleted assignment, including DONE tasks.
        assigned_count = Task.objects.filter(
            project=project, assignee_id=target_user_id, deleted_at__isnull=True
        ).count()
        if assigned_count > 0:
            raise MemberHasAssignedTasksError(
                assigned_count=assigned_count,
                filter_url=f"/projects/{project.id}/tasks/?assignee={target_user_id}",
            )

        membership.delete()
        project.version += 1
        project.save()

        return project

def delete_task(*, project_id, task_id, user, expected_version: int) -> Task:
    with transaction.atomic():
        try:
            project = Project.objects.select_for_update().get(id=project_id)
        except Project.DoesNotExist:
            raise NotFound("Project not found.")

        try:
            task = Task.objects.select_for_update().get(id=task_id, project=project)
        except Task.DoesNotExist:
            raise NotFound("Task not found.")

        if task.deleted_at is not None:
            raise NotFound("Task not found.")

        if project.owner_id != user.id:
            if ProjectMembership.objects.filter(project=project, user=user).exists():
                raise PermissionDenied("Only the project owner can delete tasks.")
            raise NotFound("Project not found.")

        if project.archived:
            raise ConflictError("Cannot delete tasks in an archived project.")

        if task.version != expected_version:
            raise StaleWriteError(f"Version mismatch. Server is at version {task.version}.")

        task.deleted_at = timezone.now()
        task.version += 1
        task.save()

        Tracker.objects.create(
            task=task,
            actor=user,
            actor_username=user.username,
            task_version=task.version,
            kind=TrackerKind.DELETED,
            changes={"title": {"old": task.title, "new": None}},
        )

        return task

def update_task(*, project_id, task_id, user, expected_version: int, data: dict, raw_payload_keys: set) -> Task:
    with transaction.atomic():
        try:
            project = Project.objects.select_for_update().get(id=project_id)
        except Project.DoesNotExist:
            raise NotFound("Project not found.")

        try:
            task = Task.objects.select_for_update().get(id=task_id, project=project)
        except Task.DoesNotExist:
            raise NotFound("Task not found.")

        if task.deleted_at is not None:
            raise NotFound("Task not found.")

        is_owner = (project.owner_id == user.id)
        is_member = ProjectMembership.objects.filter(project=project, user=user).exists()
        if not (is_owner or is_member):
            raise NotFound("Project not found.")

        if not is_owner:
            # Members can only update status
            other_keys = raw_payload_keys - {"status"}
            if other_keys:
                raise PermissionDenied("Members can only update status.")
            if task.assignee_id != user.id:
                raise PermissionDenied("You can only change the status of tasks assigned to you.")

        if project.archived:
            raise ConflictError("Cannot edit tasks in an archived project.")

        if task.version != expected_version:
            raise StaleWriteError(f"Version mismatch. Server is at version {task.version}.")

        proposed_status = data.get("status", task.status)
        proposed_assignee = task.assignee

        if is_owner and "assignee_id" in raw_payload_keys:
            new_assignee_id = data.get("assignee_id")
            if new_assignee_id is None:
                proposed_assignee = None
            else:
                try:
                    target_user = User.objects.get(id=new_assignee_id)
                except User.DoesNotExist:
                    raise ValidationError({"assignee_id": ["Assignee must be the active owner or an active member of this project."]})
                if not target_user.is_active:
                    raise ValidationError({"assignee_id": ["Assignee must be the active owner or an active member of this project."]})
                is_target_owner = (target_user.id == project.owner_id)
                is_target_member = ProjectMembership.objects.filter(project=project, user=target_user).exists()
                if not (is_target_owner or is_target_member):
                    raise ValidationError({"assignee_id": ["Assignee must be the active owner or an active member of this project."]})
                proposed_assignee = target_user

        # Validate status transitions
        valid_transitions = {
            TaskStatus.TODO: {TaskStatus.TODO, TaskStatus.IN_PROGRESS},
            TaskStatus.IN_PROGRESS: {TaskStatus.IN_PROGRESS, TaskStatus.TODO, TaskStatus.DONE},
            TaskStatus.DONE: {TaskStatus.DONE, TaskStatus.IN_PROGRESS},
        }
        if proposed_status not in valid_transitions.get(task.status, set()):
            raise ValidationError({"status": [f"Illegal status transition from {task.status} to {proposed_status}."]})

        # Starting or reopening requires an active assignee
        if proposed_status == TaskStatus.IN_PROGRESS and task.status != TaskStatus.IN_PROGRESS:
            if proposed_assignee is None or not proposed_assignee.is_active:
                raise ValidationError({"status": ["Starting or reopening requires an active assignee."]})

        # Only TODO tasks can be unassigned
        if proposed_assignee is None and proposed_status != TaskStatus.TODO:
            raise ValidationError({"assignee_id": ["Only TODO tasks can be unassigned."]})

        # Proposed title/desc/due_date for owner
        proposed_title = task.title
        proposed_desc = task.description
        proposed_due_date = task.due_date

        if is_owner:
            if "title" in data:
                t = (data["title"] or "").strip()
                if not t:
                    raise ValidationError({"title": ["Task title cannot be blank."]})
                if len(t) > 160:
                    raise ValidationError({"title": ["Task title cannot exceed 160 characters."]})
                proposed_title = t

            if "description" in data:
                d = (data["description"] or "").strip()
                if len(d) > 4000:
                    raise ValidationError({"description": ["Task description cannot exceed 4000 characters."]})
                proposed_desc = d

            if "due_date" in raw_payload_keys:
                proposed_due_date = data.get("due_date")

        # Detect changes
        changes = {}
        if proposed_title != task.title:
            changes["title"] = {"old": task.title, "new": proposed_title}
            task.title = proposed_title

        if proposed_desc != task.description:
            changes["description"] = {"old": task.description, "new": proposed_desc}
            task.description = proposed_desc

        if proposed_status != task.status:
            changes["status"] = {"old": task.status, "new": proposed_status}
            task.status = proposed_status

        if proposed_due_date != task.due_date:
            changes["due_date"] = {
                "old": str(task.due_date) if task.due_date else None,
                "new": str(proposed_due_date) if proposed_due_date else None,
            }
            task.due_date = proposed_due_date

        old_assignee_id = task.assignee_id
        new_assignee_id = proposed_assignee.id if proposed_assignee else None
        if old_assignee_id != new_assignee_id:
            old_val = {"id": task.assignee.id, "username": task.assignee.username} if task.assignee else None
            new_val = {"id": proposed_assignee.id, "username": proposed_assignee.username} if proposed_assignee else None
            changes["assignee"] = {"old": old_val, "new": new_val}
            task.assignee = proposed_assignee

        if changes:
            task.version += 1
            task.save()

            Tracker.objects.create(
                task=task,
                actor=user,
                actor_username=user.username,
                task_version=task.version,
                kind=TrackerKind.UPDATED,
                changes=changes,
            )

        return task

def create_task(*, project_id, user, task_id=None, title: str, description: str = "", assignee_id=None, due_date=None) -> Task:
    with transaction.atomic():
        try:
            project = Project.objects.select_for_update().get(id=project_id)
        except Project.DoesNotExist:
            raise NotFound("Project not found.")

        # Check visibility & role (only owner can create tasks)
        if project.owner_id != user.id:
            if ProjectMembership.objects.filter(project=project, user=user).exists():
                raise PermissionDenied("Only the project owner can create tasks.")
            raise NotFound("Project not found.")

        if project.archived:
            raise ConflictError("Cannot create tasks in an archived project.")

        title = (title or "").strip()
        if not title:
            raise ValidationError({"title": ["Task title cannot be blank."]})
        if len(title) > 160:
            raise ValidationError({"title": ["Task title cannot exceed 160 characters."]})

        description = (description or "").strip()
        if len(description) > 4000:
            raise ValidationError({"description": ["Task description cannot exceed 4000 characters."]})

        assignee = None
        if assignee_id is not None:
            try:
                target_user = User.objects.get(id=assignee_id)
            except User.DoesNotExist:
                raise ValidationError({"assignee_id": ["Assignee must be the active owner or an active member of this project."]})

            if not target_user.is_active:
                raise ValidationError({"assignee_id": ["Assignee must be the active owner or an active member of this project."]})

            is_owner = (target_user.id == project.owner_id)
            is_member = ProjectMembership.objects.filter(project=project, user=target_user).exists()
            if not (is_owner or is_member):
                raise ValidationError({"assignee_id": ["Assignee must be the active owner or an active member of this project."]})
            assignee = target_user

        if task_id is None:
            task_id = uuid.uuid4()
        elif isinstance(task_id, str):
            try:
                task_id = uuid.UUID(task_id)
            except ValueError:
                raise ValidationError({"id": ["Invalid UUID format."]})

        try:
            task = Task.objects.create(
                id=task_id,
                project=project,
                title=title,
                description=description,
                assignee=assignee,
                status=TaskStatus.TODO,
                due_date=due_date,
                version=1,
            )
        except IntegrityError:
            raise ConflictError("A task with this ID already exists.")

        changes = {
            "title": {"old": None, "new": title},
            "status": {"old": None, "new": TaskStatus.TODO},
        }
        if description:
            changes["description"] = {"old": None, "new": description}
        if assignee:
            changes["assignee"] = {"old": None, "new": {"id": assignee.id, "username": assignee.username}}
        if due_date:
            changes["due_date"] = {"old": None, "new": str(due_date)}

        Tracker.objects.create(
            task=task,
            actor=user,
            actor_username=user.username,
            task_version=1,
            kind=TrackerKind.CREATED,
            changes=changes,
        )

        return task
