import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { Project, Member } from "../../api/types";
import { LoadingSpinner, ErrorAlert } from "../../components/Feedback";

export const ProjectMembersPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [usernameInput, setUsernameInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [removeConflict, setRemoveConflict] = useState<{
    message: string;
    count: number;
    filterUrl: string;
  } | null>(null);

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
  const {
    data: roster,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.members(projectId!),
    queryFn: async () => {
      const resp = await apiClient<Member[]>(`/projects/${projectId}/members/`);
      return resp.data;
    },
    enabled: !!projectId,
    refetchInterval: 15000,
  });

  // Add Member Mutation
  const addMutation = useMutation({
    mutationFn: async () => {
      const resp = await apiClient<Member>(`/projects/${projectId}/members/`, {
        method: "POST",
        expectedVersion: project?.version,
        body: JSON.stringify({ username: usernameInput.trim() }),
      });
      return resp.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(projectId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId!) });
      setUsernameInput("");
      setAddError(null);
    },
    onError: (err: any) => {
      if (err instanceof ApiError) {
        setAddError(err.data.message || "Failed to add member.");
      } else {
        setAddError("Failed to add member.");
      }
    },
  });

  // Remove Member Mutation
  const removeMutation = useMutation({
    mutationFn: async (userId: number) => {
      await apiClient<void>(`/projects/${projectId}/members/${userId}/`, {
        method: "DELETE",
        expectedVersion: project?.version,
      });
    },
    onSuccess: () => {
      setRemoveConflict(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.members(projectId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId!) });
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.data.code === "member_has_assigned_tasks") {
        setRemoveConflict({
          message: err.data.message,
          count: err.data.assigned_task_count || 1,
          filterUrl: err.data.filter_url || `/projects/${projectId}?assignee=assigned`,
        });
      } else if (err instanceof ApiError) {
        alert(err.data.message || "Failed to remove member.");
      }
    },
  });

  if (isLoading) return <LoadingSpinner message="Loading team roster..." />;

  if (error || !project) {
    return (
      <ErrorAlert
        message={(error as any)?.message || "Failed to load project roster."}
        onRetry={() => refetch()}
      />
    );
  }

  const isOwner = project.role === "owner";

  return (
    <div>
      <div style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link to={`/projects/${projectId}`}>← Back to {project.name}</Link>
      </div>

      <div className="card">
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}>
          Project Members
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>
          Team members collaborating on <strong>{project.name}</strong>
        </p>

        {/* Sub-navigation tabs */}
        <div style={{ display: "flex", gap: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginBottom: "1.5rem" }}>
          <Link to={`/projects/${project.id}`}>Tasks</Link>
          <Link to={`/projects/${project.id}/members`} style={{ fontWeight: 600 }}>Members</Link>
          <Link to={`/projects/${project.id}/activity`}>Activity</Link>
        </div>

        {removeConflict && (
          <div className="alert alert-warning" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
            <div>
              <strong>Member Removal Blocked:</strong> {removeConflict.message} (
              {removeConflict.count} task{removeConflict.count > 1 ? "s" : ""})
            </div>
            <Link to={removeConflict.filterUrl} className="btn btn-secondary" style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}>
              Filter Member's Tasks
            </Link>
          </div>
        )}

        {/* Add Member (Owner only) */}
        {isOwner && !project.archived && (
          <div style={{ marginBottom: "1.5rem", padding: "1rem", backgroundColor: "var(--bg-hover)", borderRadius: "var(--radius)" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Add Team Member
            </h3>
            {addError && <div className="alert alert-danger">{addError}</div>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setAddError(null);
                addMutation.mutate();
              }}
              style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
            >
              <input
                type="text"
                className="form-control"
                placeholder="Exact username (e.g. teammate)"
                style={{ maxWidth: "300px" }}
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                required
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={addMutation.isPending || !usernameInput.trim()}
              >
                {addMutation.isPending ? "Adding..." : "Add Member"}
              </button>
            </form>
          </div>
        )}

        {/* Roster Table */}
        <table className="table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined At</th>
              {isOwner && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {roster?.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.username}</strong>
                </td>
                <td>
                  <span className={`badge ${m.role === "owner" ? "badge-done" : "badge-todo"}`} style={{ textTransform: "capitalize" }}>
                    {m.role}
                  </span>
                </td>
                <td>
                  {m.is_active ? (
                    <span style={{ color: "var(--success)" }}>Active</span>
                  ) : (
                    <span style={{ color: "var(--danger)" }}>Inactive</span>
                  )}
                </td>
                <td style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                  {new Date(m.joined_at).toLocaleDateString()}
                </td>
                {isOwner && (
                  <td>
                    {m.role !== "owner" && !project.archived && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ color: "var(--danger)", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                        onClick={() => {
                          if (window.confirm(`Remove ${m.username} from this project?`)) {
                            removeMutation.mutate(m.id);
                          }
                        }}
                        disabled={removeMutation.isPending}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
