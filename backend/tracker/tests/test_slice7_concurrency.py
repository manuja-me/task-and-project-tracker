import uuid
import threading
from django.contrib.auth.models import User
from django.test import TransactionTestCase
from django.db import connection
from tracker.models import Project, ProjectMembership, Task, Tracker, TaskStatus, TrackerKind
from tracker.services import (
    create_task,
    update_task,
    update_project,
    remove_project_member,
)
from tracker.api.exceptions import StaleWriteError, ConflictError, MemberHasAssignedTasksError
from rest_framework.exceptions import ValidationError

class ConcurrencyDatabaseLockingTest(TransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="conc_owner", password="password123")
        self.teammate = User.objects.create_user(username="conc_teammate", password="password123")
        self.project = Project.objects.create(
            id=uuid.uuid4(),
            name="Concurrent Project",
            owner=self.owner,
            version=1,
        )
        self.membership = ProjectMembership.objects.create(project=self.project, user=self.teammate)

    def test_assignment_races_with_membership_removal(self):
        barrier = threading.Barrier(2)
        results = {"assignment": None, "removal": None}
        errors = {"assignment": None, "removal": None}

        def worker_assignment():
            connection.close()
            barrier.wait()
            try:
                task = create_task(
                    project_id=self.project.id,
                    user=self.owner,
                    title="Concurrent Assigned Task",
                    assignee_id=self.teammate.id,
                )
                results["assignment"] = task
            except Exception as e:
                errors["assignment"] = e
            finally:
                connection.close()

        def worker_removal():
            connection.close()
            barrier.wait()
            try:
                proj = remove_project_member(
                    project_id=self.project.id,
                    owner_user=self.owner,
                    target_user_id=self.teammate.id,
                    expected_version=1,
                )
                results["removal"] = proj
            except Exception as e:
                errors["removal"] = e
            finally:
                connection.close()

        t1 = threading.Thread(target=worker_assignment)
        t2 = threading.Thread(target=worker_removal)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        # Either assignment commits and removal is blocked, or removal commits and assignment is rejected (§7)
        if results["assignment"] is not None:
            # Assignment won
            self.assertIsNone(results["removal"])
            self.assertIsInstance(errors["removal"], MemberHasAssignedTasksError)
            self.assertTrue(ProjectMembership.objects.filter(project=self.project, user=self.teammate).exists())
            self.assertEqual(Task.objects.filter(project=self.project, assignee=self.teammate).count(), 1)
        else:
            # Removal won
            self.assertIsNotNone(results["removal"])
            self.assertIsInstance(errors["assignment"], ValidationError)
            self.assertFalse(ProjectMembership.objects.filter(project=self.project, user=self.teammate).exists())
            self.assertEqual(Task.objects.filter(project=self.project, assignee=self.teammate).count(), 0)

    def test_two_competing_task_edits_on_same_version(self):
        task = Task.objects.create(
            id=uuid.uuid4(),
            project=self.project,
            title="Competing Edit Task",
            assignee=self.teammate,
            status=TaskStatus.TODO,
            version=1,
        )
        Tracker.objects.create(
            task=task,
            actor=self.owner,
            actor_username="conc_owner",
            task_version=1,
            kind=TrackerKind.CREATED,
            changes={"title": {"old": None, "new": "Competing Edit Task"}},
        )

        barrier = threading.Barrier(2)
        results = [None, None]
        errors = [None, None]

        def worker(idx):
            connection.close()
            barrier.wait()
            try:
                updated = update_task(
                    project_id=self.project.id,
                    task_id=task.id,
                    user=self.teammate,
                    expected_version=1,
                    data={"status": TaskStatus.IN_PROGRESS},
                    raw_payload_keys={"status"},
                )
                results[idx] = updated
            except Exception as e:
                errors[idx] = e
            finally:
                connection.close()

        t1 = threading.Thread(target=worker, args=(0,))
        t2 = threading.Thread(target=worker, args=(1,))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        successes = [r for r in results if r is not None]
        failures = [e for e in errors if e is not None]

        self.assertEqual(len(successes), 1)
        self.assertEqual(len(failures), 1)
        self.assertIsInstance(failures[0], StaleWriteError)

        # Database must have exactly one event for version 2
        events_v2 = Tracker.objects.filter(task=task, task_version=2)
        self.assertEqual(events_v2.count(), 1)
        task.refresh_from_db()
        self.assertEqual(task.version, 2)
        self.assertEqual(task.status, TaskStatus.IN_PROGRESS)

    def test_project_archive_races_with_task_creation(self):
        barrier = threading.Barrier(2)
        results = {"archive": None, "create": None}
        errors = {"archive": None, "create": None}

        def worker_archive():
            connection.close()
            barrier.wait()
            try:
                proj = update_project(
                    project_id=self.project.id,
                    user=self.owner,
                    expected_version=1,
                    data={"archived": True},
                )
                results["archive"] = proj
            except Exception as e:
                errors["archive"] = e
            finally:
                connection.close()

        def worker_create():
            connection.close()
            barrier.wait()
            try:
                task = create_task(
                    project_id=self.project.id,
                    user=self.owner,
                    title="Task racing archive",
                )
                results["create"] = task
            except Exception as e:
                errors["create"] = e
            finally:
                connection.close()

        t1 = threading.Thread(target=worker_archive)
        t2 = threading.Thread(target=worker_create)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        # Either write completes before archive, or fails after archive (§7)
        if results["create"] is not None:
            # Create happened before or alongside archive
            self.assertEqual(Task.objects.filter(project=self.project, title="Task racing archive").count(), 1)
        else:
            # Archive committed first, task create rejected with 409 Conflict
            self.assertIsInstance(errors["create"], ConflictError)
            self.assertEqual(Task.objects.filter(project=self.project, title="Task racing archive").count(), 0)
