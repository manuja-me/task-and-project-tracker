import React, { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { Task, Project, Member, TrackerEvent, PaginatedResponse, TaskStatus } from "../../api/types";
import { useSession } from "../../app/session";
import { StatusBadge } from "../../components/StatusBadge";
import { LoadingSpinner, EmptyState, ErrorAlert } from "../../components/Feedback";
import { formatChangeText, formatEventDateTime } from "../../utils/formatters";

export const TaskDetailPage: React.FC = () => {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useSession();

  // Task form state
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [status, setStatus] = useState<TaskStatus>("TODO");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState<Task | null>(null);

  // Fetch Project
  const { data: project } = useQuery({
    queryKey: queryKeys.project(projectId!),
    queryFn: async () => {
      const resp = await apiClient<Project>(`/projects/${projectId}/`);
      return resp.data;
    },
    enabled: !!projectId,
  });

  // Fetch Roster
  const { data: roster } = useQuery({
    queryKey: queryKeys.members(projectId!),
    queryFn: async () => {
      const resp = await apiClient<Member[]>(`/projects/${projectId}/members/`);
      return resp.data;
    },
    enabled: !!projectId,
  });

  // Fetch Task Detail
  const {
    data: task,
    isLoading: isTaskLoading,
    error: taskError,
    refetch: refetchTask,
  } = useQuery({
    queryKey: queryKeys.task(projectId!, taskId!),
    queryFn: async () => {
      const resp = await apiClient<Task>(`/projects/${projectId}/tasks/${taskId}/`);
      return resp.data;
    },
    enabled: !!projectId && !!taskId,
    refetchInterval: isDirty ? false : 15000,
  });

  // Fetch Task History
  const {
    data: historyData,
    isLoading: isHistoryLoading,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: queryKeys.taskHistory(projectId!, taskId!),
    queryFn: async () => {
      const resp = await apiClient<PaginatedResponse<TrackerEvent>>(
        `/projects/${projectId}/tasks/${taskId}/history/`
      );
      return resp.data;
    },
    enabled: !!projectId && !!taskId,
    refetchInterval: 15000,
  });

  // Sync form with loaded task only when not dirty
  useEffect(() => {
    if (task && !isDirty) {
      setTitle(task.title);
      setDesc(task.description || "");
      setStatus(task.status);
      setAssigneeId(task.assignee ? task.assignee.id.toString() : "");
      setDueDate(task.due_date || "");
    }
  }, [task, isDirty]);

  // Update Task Mutation
  const updateMutation = useMutation({
    mutationFn: async (payload: any) => {
      const resp = await apiClient<Task>(`/projects/${projectId}/tasks/${taskId}/`, {
        method: "PATCH",
        expectedVersion: staleConflict ? staleConflict.version : task?.version,
        body: JSON.stringify(payload),
      });
      return resp.data;
    },
    onSuccess: (updated) => {
      setIsDirty(false);
      setStaleConflict(null);
      setFormError(null);
      queryClient.setQueryData(queryKeys.task(projectId!, taskId!), updated);
      queryClient.invalidateQueries({ queryKey: queryKeys.taskHistory(projectId!, taskId!) });
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId!) });
      queryClient.invalidateQueries({ queryKey: ["activity", projectId] });
    },
    onError: async (err: any) => {
      if (err instanceof ApiError) {
        if (err.status === 412) {
          // Stale write conflict: preserve draft, fetch latest server version
          const fresh = await apiClient<Task>(`/projects/${projectId}/tasks/${taskId}/`);
          setStaleConflict(fresh.data);
          setFormError(
            `Another user updated this task to version ${fresh.data.version}. Your draft has been preserved. Review the current saved values below and reapply your changes.`
          );
        } else {
          setFormError(err.data.message || "Failed to update task.");
        }
      } else {
        setFormError("Failed to update task.");
      }
    },
  });

  // Delete Task Mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiClient<void>(`/projects/${projectId}/tasks/${taskId}/`, {
        method: "DELETE",
        expectedVersion: task?.version,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId!) });
      queryClient.invalidateQueries({ queryKey: ["activity", projectId] });
      navigate(`/projects/${projectId}`);
    },
    onError: (err: any) => {
      if (err instanceof ApiError) {
        setFormError(err.data.message || "Failed to delete task.");
      }
    },
  });

  if (isTaskLoading) return <LoadingSpinner message="Loading task..." />;

  if (taskError) {
    return (
      <ErrorAlert
        message={(taskError as any)?.message || "Task not found or deleted."}
        onRetry={() => refetchTask()}
      />
    );
  }

  if (!task || !project) return null;

  const isOwner = project.role === "owner";
  const isAssignee = task.assignee?.id === user?.id;

  // Permitted status transitions
  const getPermittedMoves = (current: TaskStatus): TaskStatus[] => {
    switch (current) {
      case "TODO":
        return ["IN_PROGRESS"];
      case "IN_PROGRESS":
        return ["TODO", "DONE"];
      case "DONE":
        return ["IN_PROGRESS"];
      default:
        return [];
    }
  };

  const handleMemberStatusChange = (nextStatus: TaskStatus) => {
    setFormError(null);
    updateMutation.mutate({ status: nextStatus });
  };

  const handleOwnerSave = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const payload: any = {
      title: title.trim(),
      description: desc.trim(),
      status,
      assignee_id: assigneeId ? parseInt(assigneeId, 10) : null,
      due_date: dueDate || null,
    };
    updateMutation.mutate(payload);
  };

  return (
    <div>
      <div style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link to={`/projects/${projectId}`}>← Back to {project.name}</Link>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>{task.title}</h1>
              <StatusBadge status={task.status} isOverdue={task.is_overdue} />
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Version {task.version}
              </span>
            </div>
          </div>

          {isOwner && !project.archived && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ color: "var(--danger)" }}
              onClick={() => {
                if (window.confirm("Are you sure you want to delete this task?")) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
            >
              Delete Task
            </button>
          )}
        </div>

        {project.archived && (
          <div className="alert alert-warning" style={{ marginTop: "1rem" }}>
            This project is archived. All task details and statuses are read-only.
          </div>
        )}

        {formError && <div className="alert alert-danger" style={{ marginTop: "1rem" }}>{formError}</div>}

        {/* 412 Stale Conflict Banner */}
        {staleConflict && (
          <div className="alert alert-warning" style={{ marginTop: "1rem" }}>
            <strong>Server Version Conflict:</strong> The task on server was changed to:
            <ul style={{ margin: "0.5rem 0 0.5rem 1.5rem", fontSize: "0.875rem" }}>
              <li>Title: <em>{staleConflict.title}</em></li>
              <li>Status: <strong>{staleConflict.status}</strong></li>
              <li>Assignee: <em>{staleConflict.assignee?.username || "Unassigned"}</em></li>
            </ul>
            {isOwner && !project.archived
              ? "Click Save Changes to override with your draft, or "
              : "Review the updated values, or "}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
              onClick={() => {
                setIsDirty(false);
                setStaleConflict(null);
                setFormError(null);
                refetchTask();
              }}
            >
              Reset to Server Values
            </button>
          </div>
        )}

        {/* OWNER EDIT FORM */}
        {isOwner && !project.archived ? (
          <form onSubmit={handleOwnerSave} style={{ marginTop: "1.5rem" }}>
            <div className="form-group">
              <label className="form-label" htmlFor="edit-task-title">
                Title
              </label>
              <input
                id="edit-task-title"
                type="text"
                className="form-control"
                maxLength={160}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setIsDirty(true);
                }}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="edit-task-desc">
                Description
              </label>
              <textarea
                id="edit-task-desc"
                className="form-control"
                rows={4}
                maxLength={4000}
                value={desc}
                onChange={(e) => {
                  setDesc(e.target.value);
                  setIsDirty(true);
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <div className="form-group">
                <label className="form-label" htmlFor="edit-task-status">
                  Status
                </label>
                <select
                  id="edit-task-status"
                  className="form-control"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as TaskStatus);
                    setIsDirty(true);
                  }}
                >
                  <option value="TODO">To Do</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="DONE">Done</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="edit-task-assignee">
                  Assignee
                </label>
                <select
                  id="edit-task-assignee"
                  className="form-control"
                  value={assigneeId}
                  onChange={(e) => {
                    setAssigneeId(e.target.value);
                    setIsDirty(true);
                  }}
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
                <label className="form-label" htmlFor="edit-task-due">
                  Due Date
                </label>
                <input
                  id="edit-task-due"
                  type="date"
                  className="form-control"
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    setIsDirty(true);
                  }}
                />
              </div>
            </div>

            <div style={{ marginTop: "1rem" }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        ) : (
          /* READ-ONLY / MEMBER VIEW: Metadata + Assigned Status Controls */
          <div style={{ marginTop: "1.5rem" }}>
            <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
              {task.description || "No description provided."}
            </p>
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
              <div>
                <span style={{ color: "var(--text-muted)" }}>Assignee: </span>
                <strong>
                  {task.assignee
                    ? task.assignee.is_active
                      ? task.assignee.username
                      : `${task.assignee.username} (Inactive)`
                    : "Unassigned"}
                </strong>
              </div>
              <div>
                <span style={{ color: "var(--text-muted)" }}>Due Date: </span>
                <strong>{task.due_date || "None"}</strong>
              </div>
            </div>

            {/* If assigned to this member and project not archived, display permitted status controls */}
            {isAssignee && !project.archived && (
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
                  Update Status
                </h3>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {getPermittedMoves(task.status).map((nextStatus) => (
                    <button
                      key={nextStatus}
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleMemberStatusChange(nextStatus)}
                      disabled={updateMutation.isPending}
                    >
                      Move to {nextStatus === "IN_PROGRESS" ? "In Progress" : nextStatus === "DONE" ? "Done" : "To Do"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Task Chronological History */}
      <div className="card">
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
          Task History
        </h2>
        {isHistoryLoading && <LoadingSpinner message="Loading history..." />}
        {historyData && historyData.results.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>No history recorded yet.</p>
        )}
        {historyData && historyData.results.length > 0 && (
          <ul style={{ listStyle: "none" }}>
            {historyData.results.map((event) => (
              <li
                key={event.id}
                style={{
                  borderLeft: "2px solid var(--primary)",
                  paddingLeft: "1rem",
                  marginBottom: "1rem",
                  position: "relative",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem", flexWrap: "wrap" }}>
                  <span>
                    <strong>{event.actor.username}</strong> ({event.kind}) · Version {event.task_version}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>
                    {formatEventDateTime(event.event_at)}
                  </span>
                </div>
                <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  {Object.entries(event.changes).map(([field, delta]: [string, any]) => (
                    <div key={field}>
                      • {formatChangeText(field, delta)}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
