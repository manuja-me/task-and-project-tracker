import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { Project, PaginatedResponse } from "../../api/types";
import { ProgressBar } from "../../components/ProgressBar";
import { LoadingSpinner, EmptyState, ErrorAlert } from "../../components/Feedback";

export const ProjectsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get("search") || "";
  const archived = searchParams.get("archived") === "true";

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.projects({ search, archived }),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("archived", archived ? "true" : "false");
      const resp = await apiClient<PaginatedResponse<Project>>(`/projects/?${params.toString()}`);
      return resp.data;
    },
    refetchInterval: 15000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const resp = await apiClient<Project>("/projects/", {
        method: "POST",
        body: JSON.stringify({
          name: newProjectName.trim(),
          description: newProjectDesc.trim(),
        }),
      });
      return resp.data;
    },
    onSuccess: (newProj) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setIsModalOpen(false);
      setNewProjectName("");
      setNewProjectDesc("");
      setFormError(null);
    },
    onError: (err: any) => {
      if (err instanceof ApiError) {
        setFormError(err.data.message || "Failed to create project.");
      } else {
        setFormError("An unexpected error occurred.");
      }
    },
  });

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const next = new URLSearchParams(searchParams);
    if (val) next.set("search", val);
    else next.delete("search");
    setSearchParams(next);
  };

  const handleTabChange = (showArchived: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (showArchived) next.set("archived", "true");
    else next.delete("archived");
    setSearchParams(next);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!newProjectName.trim()) {
      setFormError("Project name cannot be blank.");
      return;
    }
    createMutation.mutate();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Projects</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            Manage and track university team projects
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setIsModalOpen(true)}
        >
          + New Project
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className={`btn ${!archived ? "btn-primary" : "btn-secondary"}`}
            onClick={() => handleTabChange(false)}
          >
            Active Projects
          </button>
          <button
            type="button"
            className={`btn ${archived ? "btn-primary" : "btn-secondary"}`}
            onClick={() => handleTabChange(true)}
          >
            Archived Projects
          </button>
        </div>
        <div style={{ maxWidth: "300px", width: "100%" }}>
          <input
            type="search"
            className="form-control"
            placeholder="Search projects..."
            value={search}
            onChange={handleSearchChange}
          />
        </div>
      </div>

      {isLoading && <LoadingSpinner message="Loading projects..." />}

      {error && (
        <ErrorAlert
          message={(error as any)?.message || "Failed to load projects."}
          onRetry={() => refetch()}
        />
      )}

      {data && data.results.length === 0 && (
        <EmptyState
          title={search ? "No projects match your search" : archived ? "No archived projects" : "No projects yet"}
          description={
            search
              ? "Try adjusting your search terms."
              : archived
              ? "Projects marked as archived will appear here."
              : "Create your first project to start assigning and tracking tasks."
          }
          action={
            !search && !archived ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsModalOpen(true)}
              >
                Create Project
              </button>
            ) : undefined
          }
        />
      )}

      {data && data.results.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
          {data.results.map((project) => (
            <div key={project.id} className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                  <h3 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
                    <Link to={`/projects/${project.id}`}>{project.name}</Link>
                  </h3>
                  <span
                    className={`badge ${project.role === "owner" ? "badge-done" : "badge-todo"}`}
                    style={{ textTransform: "capitalize" }}
                  >
                    {project.role}
                  </span>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem", minHeight: "2.5rem" }}>
                  {project.description || "No description provided."}
                </p>
              </div>

              <div>
                <ProgressBar progress={project.progress} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.75rem" }}>
                  <span>Owner: {project.owner.username}</span>
                  {project.archived && <span className="badge badge-archived">Archived</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      {isModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-content" role="dialog" aria-labelledby="create-project-title">
            <h2 id="create-project-title" style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
              Create New Project
            </h2>
            {formError && <div className="alert alert-danger">{formError}</div>}
            <form onSubmit={handleCreateSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="new-project-name">
                  Project Name <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  id="new-project-name"
                  type="text"
                  className="form-control"
                  maxLength={120}
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="new-project-desc">
                  Description
                </label>
                <textarea
                  id="new-project-desc"
                  className="form-control"
                  rows={3}
                  maxLength={2000}
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setIsModalOpen(false);
                    setFormError(null);
                  }}
                  disabled={createMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Creating..." : "Create Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
