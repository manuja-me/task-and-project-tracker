import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectsPage } from "../src/features/projects/ProjectsPage";
import * as client from "../src/api/client";

vi.mock("../src/api/client", () => {
  return {
    apiClient: vi.fn(),
    ApiError: class ApiError extends Error {
      status: number;
      data: any;
      constructor(status: number, data: any) {
        super(data.message);
        this.status = status;
        this.data = data;
      }
    },
  };
});

describe("ProjectsPage Component", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  it("renders project list from mocked API response", async () => {
    const mockProjects = {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          name: "Alpha Portal",
          description: "University project",
          owner: { id: 1, username: "owner", is_active: true },
          archived: false,
          version: 1,
          role: "owner",
          progress: {
            total_tasks: 2,
            todo_count: 1,
            in_progress_count: 0,
            done_count: 1,
            percent_complete: 50,
            progress_label: "50%",
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    };

    vi.mocked(client.apiClient).mockResolvedValueOnce({
      data: mockProjects,
      resourceVersion: 1,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ProjectsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByText("Loading projects...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Alpha Portal")).toBeInTheDocument();
      expect(screen.getByText("University project")).toBeInTheDocument();
      expect(screen.getByText("Progress: 50%")).toBeInTheDocument();
      expect(screen.getByText("owner")).toBeInTheDocument();
    });
  });
});
