import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient, ApiError } from "../src/api/client";
import { SessionProvider } from "../src/app/session";
import { ProjectMembersPage } from "../src/features/projects/ProjectMembersPage";
import { ProjectActivityPage } from "../src/features/projects/ProjectActivityPage";
import { ProjectOverviewPage } from "../src/features/projects/ProjectOverviewPage";
import { TaskDetailPage } from "../src/features/tasks/TaskDetailPage";

const projectId = "11111111-1111-1111-1111-111111111111";
const task1Id = "22222222-2222-2222-2222-222222222222";
const task2Id = "33333333-3333-3333-3333-333333333333";

const sampleProject = {
  id: projectId,
  name: "Alpha Portal",
  description: "University project",
  owner: { id: 1, username: "owner", is_active: true },
  archived: false,
  version: 1,
  role: "owner" as const,
  progress: {
    total_tasks: 1,
    todo_count: 1,
    in_progress_count: 0,
    done_count: 0,
    percent_complete: 0,
    progress_label: "0%",
  },
  created_at: "2026-11-24T10:00:00Z",
  updated_at: "2026-11-24T10:00:00Z",
};

const sampleRoster = [
  { id: 1, username: "owner", role: "owner" as const, is_active: true, joined_at: "2026-11-24T10:00:00Z" },
  { id: 2, username: "teammate", role: "member" as const, is_active: true, joined_at: "2026-11-24T10:05:00Z" },
];

const jsonResponse = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? {} : { "Content-Type": "application/json" },
  });

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

describe("apiClient auth expiry events", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches auth:expired on 401 and 403 not_authenticated, but not on 403 forbidden", async () => {
    const expiredHandler = vi.fn();
    window.addEventListener("auth:expired", expiredHandler);

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ code: "not_authenticated", message: "Auth required" }, 403)
      )
      .mockResolvedValueOnce(jsonResponse({ code: "forbidden", message: "Forbidden" }, 403))
      .mockResolvedValueOnce(jsonResponse({ code: "unauthorized", message: "Unauthorized" }, 401));

    await expect(apiClient("/projects/")).rejects.toBeInstanceOf(ApiError);
    expect(expiredHandler).toHaveBeenCalledTimes(1);

    await expect(apiClient("/projects/")).rejects.toBeInstanceOf(ApiError);
    expect(expiredHandler).toHaveBeenCalledTimes(1);

    await expect(apiClient("/projects/")).rejects.toBeInstanceOf(ApiError);
    expect(expiredHandler).toHaveBeenCalledTimes(2);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    window.removeEventListener("auth:expired", expiredHandler);
  });
});

describe("ProjectMembersPage bug fixes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not flash error while project is still loading after roster resolves", async () => {
    let resolveProject!: (resp: Response) => void;
    const projectPromise = new Promise<Response>((resolve) => {
      resolveProject = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith(`/projects/${projectId}/members/`)) {
        return Promise.resolve(jsonResponse(sampleRoster));
      }
      if (url.endsWith(`/projects/${projectId}/`)) {
        return projectPromise;
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[`/projects/${projectId}/members`]}>
          <Routes>
            <Route path="/projects/:projectId/members" element={<ProjectMembersPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Wait a tick for roster to resolve while project is still pending
    await waitFor(() => {
      expect(screen.getByText("Loading team roster...")).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    resolveProject(jsonResponse(sampleProject));

    await waitFor(() => {
      expect(screen.getByText("Project Members")).toBeInTheDocument();
      expect(screen.getByText("teammate")).toBeInTheDocument();
    });
  });

  it("shows project error and normalizes 409 member_has_assigned_tasks filterUrl", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      if (url.endsWith(`/projects/${projectId}/`) && method === "GET") {
        return Promise.resolve(jsonResponse(sampleProject));
      }
      if (url.endsWith(`/projects/${projectId}/members/`) && method === "GET") {
        return Promise.resolve(jsonResponse(sampleRoster));
      }
      if (url.endsWith(`/projects/${projectId}/members/2/`) && method === "DELETE") {
        return Promise.resolve(
          jsonResponse(
            {
              code: "member_has_assigned_tasks",
              message: "Cannot remove member with assigned tasks.",
              assigned_task_count: 2,
              filter_url: `/projects/${projectId}/tasks/?assignee=2`,
            },
            409
          )
        );
      }
      return Promise.reject(new Error(`Unexpected ${method} ${url}`));
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[`/projects/${projectId}/members`]}>
          <Routes>
            <Route path="/projects/:projectId/members" element={<ProjectMembersPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("teammate")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByText(/Member Removal Blocked:/)).toBeInTheDocument();
    });

    const filterLink = screen.getByRole("link", { name: "Filter Member's Tasks" });
    expect(filterLink).toHaveAttribute("href", `/projects/${projectId}?assignee=2`);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("renders inline alert instead of window.alert on remove error", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      if (url.endsWith(`/projects/${projectId}/`) && method === "GET") {
        return Promise.resolve(jsonResponse(sampleProject));
      }
      if (url.endsWith(`/projects/${projectId}/members/`) && method === "GET") {
        return Promise.resolve(jsonResponse(sampleRoster));
      }
      if (url.endsWith(`/projects/${projectId}/members/2/`) && method === "DELETE") {
        return Promise.resolve(
          jsonResponse({ code: "stale_write", message: "Version mismatch" }, 412)
        );
      }
      return Promise.reject(new Error(`Unexpected ${method} ${url}`));
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[`/projects/${projectId}/members`]}>
          <Routes>
            <Route path="/projects/:projectId/members" element={<ProjectMembersPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("teammate")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Version mismatch");
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe("ProjectActivityPage bug fixes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces project 404 error instead of ignoring projectError", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith(`/projects/${projectId}/`)) {
        return Promise.resolve(jsonResponse({ code: "not_found", message: "Project not found." }, 404));
      }
      if (url.includes(`/projects/${projectId}/activity/`)) {
        return Promise.resolve(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[`/projects/${projectId}/activity`]}>
          <Routes>
            <Route path="/projects/:projectId/activity" element={<ProjectActivityPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Project not found.");
    });
  });
});

describe("ProjectOverviewPage bug fixes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("displays archive error on page instead of swallowing it in closed Edit modal", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      if (url.endsWith(`/projects/${projectId}/`) && method === "GET") {
        return Promise.resolve(jsonResponse(sampleProject));
      }
      if (url.endsWith(`/projects/${projectId}/members/`) && method === "GET") {
        return Promise.resolve(jsonResponse(sampleRoster));
      }
      if (url.includes(`/projects/${projectId}/tasks/`) && method === "GET") {
        return Promise.resolve(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
      }
      if (url.endsWith(`/projects/${projectId}/`) && method === "PATCH") {
        return Promise.resolve(
          jsonResponse({ code: "stale_write", message: "Stale project version." }, 412)
        );
      }
      return Promise.reject(new Error(`Unexpected ${method} ${url}`));
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
          <Routes>
            <Route path="/projects/:projectId" element={<ProjectOverviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Stale project version.");
    });
  });

  it("rejects whitespace-only task title without sending POST", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      if (url.endsWith(`/projects/${projectId}/`) && method === "GET") {
        return Promise.resolve(jsonResponse(sampleProject));
      }
      if (url.endsWith(`/projects/${projectId}/members/`) && method === "GET") {
        return Promise.resolve(jsonResponse(sampleRoster));
      }
      if (url.includes(`/projects/${projectId}/tasks/`) && method === "GET") {
        return Promise.resolve(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
      }
      return Promise.reject(new Error(`Unexpected ${method} ${url}`));
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
          <Routes>
            <Route path="/projects/:projectId" element={<ProjectOverviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "+ New Task" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "+ New Task" }));
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "   " } });
    fireEvent.submit(screen.getByRole("button", { name: "Create Task" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Task title cannot be blank.");
    });
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("TaskDetailPage bug fixes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resets dirty form state when navigating between tasks and handles 412 conflict", async () => {
    const task1 = {
      id: task1Id,
      project: { id: projectId, name: "Alpha Portal" },
      title: "Task One",
      description: "First desc",
      assignee: { id: 1, username: "owner", is_active: true },
      status: "TODO" as const,
      due_date: null,
      is_overdue: false,
      version: 1,
      created_at: "2026-11-24T10:00:00Z",
      updated_at: "2026-11-24T10:00:00Z",
    };
    const task2 = {
      ...task1,
      id: task2Id,
      title: "Task Two",
      description: "Second desc",
      version: 2,
    };

    let task2GetCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      if (url.endsWith("/session/")) {
        return Promise.resolve(jsonResponse({ user: { id: 1, username: "owner", is_active: true } }));
      }
      if (url.endsWith(`/projects/${projectId}/`)) {
        return Promise.resolve(jsonResponse(sampleProject));
      }
      if (url.endsWith(`/projects/${projectId}/members/`)) {
        return Promise.resolve(jsonResponse(sampleRoster));
      }
      if (url.endsWith(`/projects/${projectId}/tasks/${task1Id}/`) && method === "GET") {
        return Promise.resolve(jsonResponse(task1));
      }
      if (url.endsWith(`/projects/${projectId}/tasks/${task2Id}/`) && method === "GET") {
        task2GetCount += 1;
        return Promise.resolve(
          jsonResponse(task2GetCount === 1 ? task2 : { ...task2, title: "Server Updated Task Two", version: 3 })
        );
      }
      if (url.endsWith(`/projects/${projectId}/tasks/${task2Id}/`) && method === "PATCH") {
        return Promise.resolve(jsonResponse({ code: "stale_write", message: "Stale version" }, 412));
      }
      if (url.includes("/history/")) {
        return Promise.resolve(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
      }
      return Promise.reject(new Error(`Unexpected ${method} ${url}`));
    });

    const NavHelper = () => {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate(`/projects/${projectId}/tasks/${task2Id}`)}>
          Go Task 2
        </button>
      );
    };

    render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionProvider>
          <MemoryRouter initialEntries={[`/projects/${projectId}/tasks/${task1Id}`]}>
            <NavHelper />
            <Routes>
              <Route path="/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toHaveValue("Task One");
    });

    // Make task1 dirty
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Dirty Task One" } });
    expect(screen.getByLabelText("Title")).toHaveValue("Dirty Task One");

    // Navigate to task2: dirty state must reset so Task Two loads
    fireEvent.click(screen.getByRole("button", { name: "Go Task 2" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toHaveValue("Task Two");
    });

    // Edit task2 and hit 412 conflict: draft preserved, conflict banner shown, reset restores server value
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My Draft Two" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(screen.getByText(/Server Version Conflict:/)).toBeInTheDocument();
      expect(screen.getByLabelText("Title")).toHaveValue("My Draft Two");
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset to Server Values" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toHaveValue("Server Updated Task Two");
    });
  });
});
