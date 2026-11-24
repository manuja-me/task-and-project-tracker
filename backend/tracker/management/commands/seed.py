import os
import uuid
from datetime import timedelta
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from tracker.models import Project, ProjectMembership, Task, Tracker, TaskStatus, TrackerKind
from tracker.selectors import get_colombo_today

class Command(BaseCommand):
    help = "Seed database with reproducible demo accounts and projects."

    def handle(self, *args, **options):
        self.stdout.write("Seeding demo data...")

        default_password = os.getenv("DEMO_PASSWORD", "demo12345")

        owner, _ = User.objects.get_or_create(
            username="owner",
            defaults={"first_name": "Project", "last_name": "Owner", "email": "owner@example.com"},
        )
        owner.set_password(default_password)
        owner.is_active = True
        owner.save()

        teammate, _ = User.objects.get_or_create(
            username="teammate",
            defaults={"first_name": "Dev", "last_name": "Teammate", "email": "teammate@example.com"},
        )
        teammate.set_password(default_password)
        teammate.is_active = True
        teammate.save()

        outsider, _ = User.objects.get_or_create(
            username="outsider",
            defaults={"first_name": "Other", "last_name": "User", "email": "outsider@example.com"},
        )
        outsider.set_password(default_password)
        outsider.is_active = True
        outsider.save()

        # Project 1: Primary demo project
        p1, created1 = Project.objects.get_or_create(
            name="University Portal",
            defaults={
                "id": uuid.UUID("11111111-1111-1111-1111-111111111111"),
                "description": "Student task assignment and handover tracker",
                "owner": owner,
                "version": 1,
                "archived": False,
            },
        )
        ProjectMembership.objects.get_or_create(project=p1, user=teammate)

        today = get_colombo_today()

        # Prepopulate sample tasks if newly created
        if created1:
            t1 = Task.objects.create(
                id=uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
                project=p1,
                title="Write demo notes",
                description="Prepare the presentation slides and demo notes for week 15.",
                assignee=teammate,
                status=TaskStatus.TODO,
                due_date=today + timedelta(days=2),
                version=1,
            )
            Tracker.objects.create(
                task=t1,
                actor=owner,
                actor_username="owner",
                task_version=1,
                kind=TrackerKind.CREATED,
                changes={
                    "title": {"old": None, "new": "Write demo notes"},
                    "status": {"old": None, "new": "TODO"},
                    "assignee": {"old": None, "new": {"id": teammate.id, "username": "teammate"}},
                },
            )

            t2 = Task.objects.create(
                id=uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
                project=p1,
                title="Backend Architecture Review",
                description="Review Django ORM constraints and MVC isolation.",
                assignee=owner,
                status=TaskStatus.DONE,
                due_date=today - timedelta(days=1),
                version=2,
            )
            Tracker.objects.create(
                task=t2,
                actor=owner,
                actor_username="owner",
                task_version=1,
                kind=TrackerKind.CREATED,
                changes={"title": {"old": None, "new": "Backend Architecture Review"}},
            )
            Tracker.objects.create(
                task=t2,
                actor=owner,
                actor_username="owner",
                task_version=2,
                kind=TrackerKind.UPDATED,
                changes={"status": {"old": "TODO", "new": "DONE"}},
            )

        # Project 2: Secondary project
        p2, created2 = Project.objects.get_or_create(
            name="Campus Mobile App",
            defaults={
                "id": uuid.UUID("22222222-2222-2222-2222-222222222222"),
                "description": "Mobile companion client for university tasks",
                "owner": owner,
                "version": 1,
                "archived": False,
            },
        )
        ProjectMembership.objects.get_or_create(project=p2, user=teammate)

        self.stdout.write(self.style.SUCCESS("Demo accounts seeded successfully:"))
        self.stdout.write("  owner / demo12345")
        self.stdout.write("  teammate / demo12345")
        self.stdout.write("  outsider / demo12345")
