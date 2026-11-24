import React from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { Project, TrackerEvent, PaginatedResponse } from "../../api/types";
import { LoadingSpinner, EmptyState, ErrorAlert } from "../../components/Feedback";

export const ProjectActivityPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const kind = searchParams.get("kind") || "";
  const taskId = searchParams.get("task") || "";

  // Fetch Project
  const { data: project } = useQuery({
    queryKey: queryKeys.project(projectId!),
    queryFn: async () => {
      const resp = await apiClient<Project>(`/projects/${projectId}/`);
      return resp.data;
    },
    enabled: !!projectId,
  });

  // Fetch Activity
  const {
    data: activityData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.activity(projectId!, { kind, task: taskId }),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (kind) params.set("kind", kind);
      if (taskId) params.set("task", taskId);

      const resp = await apiClient<PaginatedResponse<TrackerEvent>>(
        `/projects/${projectId}/activity/?${params.toString()}`
      );
      return resp.data;
    },
    enabled: !!projectId,
    refetchInterval: 15000,
  });

  const handleFilterChange = (key: string, val: string) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val);
    else next.delete(key);
    setSearchParams(next);
  };

  if (isLoading) return <LoadingSpinner message="Loading activity log..." />;

  if (error || !project) {
    return (
      <ErrorAlert
        message={(error as any)?.message || "Failed to load project activity."}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link to={`/projects/${projectId}`}>← Back to {project.name}</Link>
      </div>

      <div className="card">
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}>
          Project Activity
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>
          Chronological record of every change made to tasks in <strong>{project.name}</strong>
        </p>

        {/* Sub-navigation tabs */}
        <div style={{ display: "flex", gap: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginBottom: "1.5rem" }}>
          <Link to={`/projects/${project.id}`}>Tasks</Link>
          <Link to={`/projects/${project.id}/members`}>Members</Link>
          <Link to={`/projects/${project.id}/activity`} style={{ fontWeight: 600 }}>Activity</Link>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <select
            className="form-control"
            style={{ maxWidth: "200px" }}
            value={kind}
            onChange={(e) => handleFilterChange("kind", e.target.value)}
            aria-label="Filter by event kind"
          >
            <option value="">All Event Kinds</option>
            <option value="CREATED">Created</option>
            <option value="UPDATED">Updated</option>
            <option value="DELETED">Deleted</option>
          </select>
        </div>

        {/* Event List */}
        {activityData && activityData.results.length === 0 && (
          <EmptyState
            title="No activity recorded"
            description="When tasks are created, updated, or deleted, events will appear here."
          />
        )}

        {activityData && activityData.results.length > 0 && (
          <ul style={{ listStyle: "none" }}>
            {activityData.results.map((event) => (
              <li
                key={event.id}
                style={{
                  borderLeft: `3px solid ${
                    event.kind === "CREATED"
                      ? "var(--success)"
                      : event.kind === "DELETED"
                      ? "var(--danger)"
                      : "var(--primary)"
                  }`,
                  paddingLeft: "1rem",
                  marginBottom: "1.25rem",
                  position: "relative",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>{event.actor.username}</span>{" "}
                    <span style={{ color: "var(--text-muted)" }}>
                      {event.kind === "CREATED"
                        ? "created task"
                        : event.kind === "DELETED"
                        ? "deleted task"
                        : "updated task"}{" "}
                    </span>
                    {/* If deleted, render label without broken detail link (§3) */}
                    {event.task_is_deleted ? (
                      <span style={{ textDecoration: "line-through", color: "var(--text-muted)" }}>
                        {event.task_title || "Deleted Task"}
                      </span>
                    ) : (
                      <Link to={`/projects/${projectId}/tasks/${event.task_id}`} style={{ fontWeight: 500 }}>
                        {event.task_title}
                      </Link>
                    )}
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                      (v{event.task_version})
                    </span>
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {new Date(event.event_at).toLocaleString()}
                  </span>
                </div>

                {/* Changes delta */}
                <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>
                  {Object.entries(event.changes).map(([field, delta]: [string, any]) => (
                    <div key={field}>
                      • <strong>{field}</strong>:{" "}
                      <code>{JSON.stringify(delta.old)}</code> → <code>{JSON.stringify(delta.new)}</code>
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
