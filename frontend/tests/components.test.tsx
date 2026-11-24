import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatusBadge } from "../src/components/StatusBadge";
import { ProgressBar } from "../src/components/ProgressBar";
import { ErrorAlert, EmptyState } from "../src/components/Feedback";

describe("StatusBadge", () => {
  it("renders status label correctly for TODO", () => {
    render(<StatusBadge status="TODO" />);
    expect(screen.getByText("To Do")).toBeInTheDocument();
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("renders status label and Overdue tag when overdue and not done", () => {
    render(<StatusBadge status="IN_PROGRESS" isOverdue={true} />);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("does not render Overdue tag when status is DONE even if isOverdue is true", () => {
    render(<StatusBadge status="DONE" isOverdue={true} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });
});

describe("ProgressBar", () => {
  it("renders completion ratio and progress bar accurately", () => {
    const progress = {
      total_tasks: 4,
      todo_count: 2,
      in_progress_count: 0,
      done_count: 2,
      percent_complete: 50,
      progress_label: "50%",
    };
    render(<ProgressBar progress={progress} />);
    expect(screen.getByText("Progress: 50%")).toBeInTheDocument();
    expect(screen.getByText("2 / 4 completed")).toBeInTheDocument();

    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "50");
  });
});

describe("Feedback Components", () => {
  it("renders ErrorAlert with retry button and handles click", () => {
    const onRetry = vi.fn();
    render(<ErrorAlert message="Something broke" onRetry={onRetry} />);
    expect(screen.getByText("Something broke")).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders EmptyState title and action", () => {
    render(
      <EmptyState
        title="No items found"
        description="Try searching again."
        action={<button>Create item</button>}
      />
    );
    expect(screen.getByText("No items found")).toBeInTheDocument();
    expect(screen.getByText("Try searching again.")).toBeInTheDocument();
    expect(screen.getByText("Create item")).toBeInTheDocument();
  });
});
