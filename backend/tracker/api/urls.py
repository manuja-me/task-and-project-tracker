from django.urls import path
from tracker.api.views import (
    SessionView,
    LoginView,
    LogoutView,
    ProjectListCreateView,
    ProjectDetailView,
    ProjectMembersView,
    ProjectMemberDetailView,
    TaskListCreateView,
    TaskDetailView,
    TaskHistoryView,
    ProjectActivityView,
    MyTasksView,
)

urlpatterns = [
    path("session/", SessionView.as_view(), name="session"),
    path("session/login/", LoginView.as_view(), name="session-login"),
    path("session/logout/", LogoutView.as_view(), name="session-logout"),
    path("projects/", ProjectListCreateView.as_view(), name="projects-list-create"),
    path("projects/<uuid:project_id>/", ProjectDetailView.as_view(), name="project-detail"),
    path("projects/<uuid:project_id>/members/", ProjectMembersView.as_view(), name="project-members"),
    path("projects/<uuid:project_id>/members/<int:user_id>/", ProjectMemberDetailView.as_view(), name="project-member-detail"),
    path("projects/<uuid:project_id>/tasks/", TaskListCreateView.as_view(), name="project-tasks-list-create"),
    path("projects/<uuid:project_id>/tasks/<uuid:task_id>/", TaskDetailView.as_view(), name="project-task-detail"),
    path("projects/<uuid:project_id>/tasks/<uuid:task_id>/history/", TaskHistoryView.as_view(), name="project-task-history"),
    path("projects/<uuid:project_id>/activity/", ProjectActivityView.as_view(), name="project-activity"),
    path("me/tasks/", MyTasksView.as_view(), name="my-tasks"),
]
