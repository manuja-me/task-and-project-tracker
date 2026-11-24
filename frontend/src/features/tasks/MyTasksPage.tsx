import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { Task, PaginatedResponse } from "../../api/types";
import { StatusBadge } from "../../components/StatusBadge";
import { LoadingSpinner, EmptyState, ErrorAlert } from "../../components/Feedback";

export const MyTasksPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const overdue = searchParams.get("overdue") || "";

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.myTasks({ search, status, overdue }),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (overdue) params.set("overdue", overdue);

      const resp = await apiClient<PaginatedResponse<Task>>(`/me/tasks/?${params.toString()}`);
      return resp.data;
    },
    refetchInterval: 15000,
  });

  const handleFilterChange = (key: string, val: string) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val);
    else next.delete(key);
    setSearchParams(next);
  };

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>My Tasks</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Your assigned tasks across all active projects
        </p>
      </div>

      {/* Filter Card */}
      <div className="card" style={{ padding: "0.75rem 1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
          <input
            type="search"
            className="form-control"
            placeholder="Search my tasks..."
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

      {isLoading && <LoadingSpinner message="Loading your tasks..." />}

      {error && (
        <ErrorAlert
          message={(error as any)?.message || "Failed to load tasks."}
          onRetry={() => refetch()}
        />
      )}

      {data && data.results.length === 0 && (
        <EmptyState
          title={search || status || overdue ? "No tasks match your filters" : "You have no assigned tasks"}
          description={
            search || status || overdue
              ? "Try adjusting the filters above."
              : "When a project owner assigns work to you, it will appear here."
          }
        />
      )}

      {data && data.results.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Task Title</th>
                <th>Project</th>
                <th>Status</th>
                <th>Due Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/projects/${t.project.id}/tasks/${t.id}`} style={{ fontWeight: 500 }}>
                      {t.title}
                    </Link>
                  </td>
                  <td>
                    <Link to={`/projects/${t.project.id}`}>{t.project.name}</Link>
                  </td>
                  <td>
                    <StatusBadge status={t.status} isOverdue={t.is_overdue} />
                  </td>
                  <td>
                    {t.due_date ? t.due_date : <span style={{ color: "var(--text-muted)" }}>No date</span>}
                  </td>
                  <td>
                    <Link
                      to={`/projects/${t.project.id}/tasks/${t.id}`}
                      className="btn btn-secondary"
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
