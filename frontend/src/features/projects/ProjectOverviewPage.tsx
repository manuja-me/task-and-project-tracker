import React, { useState } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { Project, Task, Member, PaginatedResponse } from "../../api/types";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusBadge } from "../../components/StatusBadge";
import { LoadingSpinner, EmptyState, ErrorAlert } from "../../components/Feedback";
import { Modal } from "../../components/Modal";

export const ProjectOverviewPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const assignee = searchParams.get("assignee") || "";
  const overdue = searchParams.get("overdue") || "";

  // Modals state
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskUuid, setTaskUuid] = useState<string>(() => crypto.randomUUID());
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState<string>("");
  const [taskDueDate, setTaskDueDate] = useState<string>("");
  const [taskFormError, setTaskFormError] = useState<string | null>(null);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Fetch project detail
  const {
    data: project,
    isLoading: isProjectLoading,
    error: projectError,
    refetch: refetchProject,
  } = useQuery({
    queryKey: queryKeys.project(projectId!),
    queryFn: async () => {
      const resp = await apiClient<Project>(`/projects/${projectId}/`);
      return resp.data;
    },
    enabled: !!projectId,
    refetchInterval: 15000,
  });

  // Fetch project roster for assignee picker
  const { data: roster } = useQuery({
    queryKey: queryKeys.members(projectId!),
    queryFn: async () => {
      const resp = await apiClient<Member[]>(`/projects/${projectId}/members/`);
      return resp.data;
    },
    enabled: !!projectId,
  });

  // Fetch tasks
  const {
    data: tasksData,
    isLoading: isTasksLoading,
    error: tasksError,
    refetch: refetchTasks,
  } = useQuery({
    queryKey: queryKeys.tasks(projectId!, { search, status, assignee, overdue }),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (assignee) params.set("assignee", assignee);
      if (overdue) params.set("overdue", overdue);

      const resp = await apiClient<PaginatedResponse<Task>>(
        `/projects/${projectId}/tasks/?${params.toString()}`
      );
      return resp.data;
    },
    enabled: !!projectId,
    refetchInterval: 15000,
  });

  // Create Task Mutation
  const createTaskMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        id: taskUuid,
        title: taskTitle.trim(),
        description: taskDesc.trim(),
      };
      if (taskAssigneeId) payload.assignee_id = parseInt(taskAssigneeId, 10);
      if (taskDueDate) payload.due_date = taskDueDate;

      const resp = await apiClient<Task>(`/projects/${projectId}/tasks/`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return resp.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId!) });
      queryClient.invalidateQueries({ queryKey: ["activity", projectId] });
      setIsTaskModalOpen(false);
      setTaskTitle("");
      setTaskDesc("");
      setTaskAssigneeId("");
      setTaskDueDate("");
      setTaskFormError(null);
      setTaskUuid(crypto.randomUUID());
    },
    onError: (err: any) => {
      if (err instanceof ApiError) {
        setTaskFormError(err.data.message || "Failed to create task.");
      } else {
        setTaskFormError("An unexpected error occurred.");
      }
    },
  });

  // Update Project Mutation
  const updateProjectMutation = useMutation({
    mutationFn: async (payload: { name?: string; description?: string; archived?: boolean }) => {
      const resp = await apiClient<Project>(`/projects/${projectId}/`, {
        method: "PATCH",
        expectedVersion: project?.version,
        body: JSON.stringify(payload),
      });
      return resp.data;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.project(projectId!), updated);
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId!) });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setIsEditModalOpen(false);
      setEditError(null);
      setActionError(null);
    },
    onError: (err: any, variables) => {
      const msg =
        err instanceof ApiError
          ? err.data.message || "Failed to update project."
          : "Failed to update project.";
      if (err instanceof ApiError && err.status === 412) {
        queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId!) });
      }
      if (variables.archived !== undefined) {
        setActionError(msg);
      } else {
        setEditError(msg);
      }
    },
  });

  // Delete Project Mutation
  const deleteProjectMutation = useMutation({
    mutationFn: async () => {
      await apiClient<void>(`/projects/${projectId}/`, {
        method: "DELETE",
        expectedVersion: project?.version,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate("/projects");
    },
    onError: (err: any) => {
      if (err instanceof ApiError) {
        if (err.status === 412) {
          queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId!) });
        }
        setDeleteError(err.data.message || "Cannot delete project.");
      } else {
        setDeleteError("Failed to delete project.");
      }
    },
  });

  const handleFilterChange = (key: string, val: string) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val);
    else next.delete(key);
    setSearchParams(next);
  };

  if (isProjectLoading) return <LoadingSpinner message="Loading project details..." />;

  if (projectError) {
    return (
      <ErrorAlert
        message={(projectError as any)?.message || "Project not found or inaccessible."}
        onRetry={() => refetchProject()}
      />
    );
  }

  if (!project) return null;

  const isOwner = project.role === "owner";

  return (
    <div>
      {/* Breadcrumb & Navigation */}
      <div style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link to="/projects">← Back to Projects</Link>
      </div>

      {/* Project Header Card */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>{project.name}</h1>
              <span className={`badge ${isOwner ? "badge-done" : "badge-todo"}`} style={{ textTransform: "capitalize" }}>
                {project.role}
              </span>
              {project.archived && <span className="badge badge-archived">Archived</span>}
            </div>
            <p style={{ color: "var(--text-muted)", marginTop: "0.25rem", maxWidth: "700px" }}>
              {project.description || "No description provided."}
            </p>
          </div>

          {/* Owner Actions */}
          {isOwner && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {!project.archived ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setTaskFormError(null);
                      setIsTaskModalOpen(true);
                    }}
                  >
                    + New Task
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setEditName(project.name);
                      setEditDesc(project.description);
                      setEditError(null);
                      setIsEditModalOpen(true);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setActionError(null);
                      updateProjectMutation.mutate({ archived: true });
                    }}
                    disabled={updateProjectMutation.isPending}
                  >
                    Archive
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setActionError(null);
                    updateProjectMutation.mutate({ archived: false });
                  }}
                  disabled={updateProjectMutation.isPending}
                >
                  Restore Project
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                style={{ color: "var(--danger)" }}
                onClick={() => {
                  setDeleteConfirmName("");
                  setDeleteError(null);
                  setIsDeleteModalOpen(true);
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {/* Progress Display */}
        {actionError && (
          <div className="alert alert-danger" role="alert" style={{ marginTop: "1rem", marginBottom: 0 }}>
            {actionError}
          </div>
        )}
        <div style={{ marginTop: "1.25rem" }}>
          <ProgressBar progress={project.progress} />
        </div>

        {/* Sub-navigation tabs */}
        <div style={{ display: "flex", gap: "1rem", borderTop: "1px solid var(--border)", marginTop: "1rem", paddingTop: "0.75rem" }}>
          <Link to={`/projects/${project.id}`} style={{ fontWeight: 600 }}>
            Tasks
          </Link>
          <Link to={`/projects/${project.id}/members`}>
            Members
          </Link>
          <Link to={`/projects/${project.id}/activity`}>
            Activity
          </Link>
        </div>
      </div>

      {/* Task Filters */}
      <div className="card" style={{ padding: "0.75rem 1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", alignItems: "center" }}>
          <input
            type="search"
            className="form-control"
            placeholder="Search tasks..."
            aria-label="Search tasks"
            value={search}
            onChange={(e) => handleFilterChange("search", e.target.value)}
          />

          <select
            className="form-control"
            value={status}
            onChange={(e) => handleFilterChange("status", e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All Statuses</option>
            <option value="TODO">To Do</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="DONE">Done</option>
          </select>

          <select
            className="form-control"
            value={assignee}
            onChange={(e) => handleFilterChange("assignee", e.target.value)}
            aria-label="Filter by assignee"
          >
            <option value="">All Assignees</option>
            <option value="unassigned">Unassigned</option>
            {roster?.map((m) => (
              <option key={m.id} value={m.id.toString()}>
                {m.username} {m.role === "owner" ? "(Owner)" : ""}
              </option>
            ))}
          </select>

          <select
            className="form-control"
            value={overdue}
            onChange={(e) => handleFilterChange("overdue", e.target.value)}
            aria-label="Filter overdue"
          >
            <option value="">All Due Dates</option>
            <option value="true">Overdue only</option>
            <option value="false">Not overdue</option>
          </select>
        </div>
      </div>

      {/* Tasks Table */}
      {isTasksLoading && <LoadingSpinner message="Loading tasks..." />}

      {tasksError && (
        <ErrorAlert
          message={(tasksError as any)?.message || "Failed to load tasks."}
          onRetry={() => refetchTasks()}
        />
      )}

      {tasksData && tasksData.results.length === 0 && (
        <EmptyState
          title={search || status || assignee || overdue ? "No tasks match your filters" : "No tasks yet"}
          description={
            search || status || assignee || overdue
              ? "Try adjusting your filters above."
              : isOwner
              ? "Click '+ New Task' above to assign your first task."
              : "No tasks have been added to this project yet."
          }
        />
      )}

      {tasksData && tasksData.results.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Due Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasksData.results.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/projects/${project.id}/tasks/${t.id}`} style={{ fontWeight: 500 }}>
                      {t.title}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={t.status} isOverdue={t.is_overdue} />
                  </td>
                  <td style={{ color: t.assignee ? "inherit" : "var(--text-muted)" }}>
                    {t.assignee
                      ? t.assignee.is_active
                        ? t.assignee.username
                        : `${t.assignee.username} (Inactive)`
                      : "Unassigned"}
                  </td>
                  <td>
                    {t.due_date ? t.due_date : <span style={{ color: "var(--text-muted)" }}>No date</span>}
                  </td>
                  <td>
                    <Link to={`/projects/${project.id}/tasks/${t.id}`} className="btn btn-secondary" style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}>
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Task Modal */}
      <Modal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false);
          setTaskFormError(null);
        }}
        title="Create New Task"
        titleId="create-task-title"
      >
        {taskFormError && <div className="alert alert-danger" role="alert">{taskFormError}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTaskFormError(null);
            if (!taskTitle.trim()) {
              setTaskFormError("Task title cannot be blank.");
              return;
            }
            createTaskMutation.mutate();
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="task-title">
              Title <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input
              id="task-title"
              type="text"
              className="form-control"
              maxLength={160}
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="task-desc">
              Description
            </label>
            <textarea
              id="task-desc"
              className="form-control"
              rows={3}
              maxLength={4000}
              value={taskDesc}
              onChange={(e) => setTaskDesc(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="task-assignee">
              Assignee
            </label>
            <select
              id="task-assignee"
              className="form-control"
              value={taskAssigneeId}
              onChange={(e) => setTaskAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {roster?.map((m) => (
                <option key={m.id} value={m.id.toString()}>
                  {m.username} ({m.role}){m.is_active ? "" : " (Inactive)"}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="task-due-date">
              Due Date
            </label>
            <input
              id="task-due-date"
              type="date"
              className="form-control"
              value={taskDueDate}
              onChange={(e) => setTaskDueDate(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsTaskModalOpen(false)}
              disabled={createTaskMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createTaskMutation.isPending}
            >
              {createTaskMutation.isPending ? "Creating..." : "Create Task"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Project Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditError(null);
        }}
        title="Edit Project Settings"
        titleId="edit-project-title"
      >
        {editError && <div className="alert alert-danger" role="alert">{editError}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setEditError(null);
            if (!editName.trim()) {
              setEditError("Project name cannot be blank.");
              return;
            }
            updateProjectMutation.mutate({ name: editName.trim(), description: editDesc.trim() });
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="edit-proj-name">
              Project Name
            </label>
            <input
              id="edit-proj-name"
              type="text"
              className="form-control"
              maxLength={120}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="edit-proj-desc">
              Description
            </label>
            <textarea
              id="edit-proj-desc"
              className="form-control"
              rows={3}
              maxLength={2000}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsEditModalOpen(false)}
              disabled={updateProjectMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={updateProjectMutation.isPending}
            >
              {updateProjectMutation.isPending ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Project Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setDeleteError(null);
        }}
        title="Delete Project"
        titleId="delete-project-title"
      >
        <p style={{ fontSize: "0.875rem", marginBottom: "1rem" }}>
          Permanent deletion is only allowed if the project has <strong>never contained any task</strong>. Projects with historic tasks must be archived instead.
        </p>
        {deleteError && <div className="alert alert-danger" role="alert">{deleteError}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setDeleteError(null);
            if (deleteConfirmName !== project.name) {
              setDeleteError("Confirmation name does not match project name.");
              return;
            }
            deleteProjectMutation.mutate();
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="confirm-del-name">
              Type <strong>{project.name}</strong> to confirm:
            </label>
            <input
              id="confirm-del-name"
              type="text"
              className="form-control"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              required
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={deleteProjectMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={deleteProjectMutation.isPending || deleteConfirmName !== project.name}
            >
              {deleteProjectMutation.isPending ? "Deleting..." : "Permanently Delete"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
