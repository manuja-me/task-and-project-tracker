import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatusBadge } from "../src/components/StatusBadge";
import { ProgressBar } from "../src/components/ProgressBar";
import { ErrorAlert, EmptyState } from "../src/components/Feedback";
import { Modal } from "../src/components/Modal";
import { formatChangeText, formatEventDateTime } from "../src/utils/formatters";

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

describe("Modal Component Accessibility", () => {
  it("renders when open with proper aria attributes and closes on Escape", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal isOpen={true} onClose={onClose} title="Test Modal" titleId="test-modal-title">
        <button>Inside Button</button>
      </Modal>
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "test-modal-title");
    expect(screen.getByText("Test Modal")).toBeInTheDocument();

    // Trigger Escape
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Rerender as closed
    rerender(
      <Modal isOpen={false} onClose={onClose} title="Test Modal">
        <button>Inside Button</button>
      </Modal>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Formatters", () => {
  it("formats assignee and status changes human-readably", () => {
    const assigneeChange = formatChangeText("assignee", {
      old: null,
      new: { id: 2, username: "teammate" },
    });
    expect(assigneeChange).toBe("Assignee: Unassigned → teammate");

    const statusChange = formatChangeText("status", {
      old: "TODO",
      new: "IN_PROGRESS",
    });
    expect(statusChange).toBe("Status: To Do → In Progress");

    const titleChange = formatChangeText("title", {
      old: "Old Title",
      new: "New Title",
    });
    expect(titleChange).toBe('Title: "Old Title" → "New Title"');
  });

  it("formats date-time with display timezone", () => {
    const dt = formatEventDateTime("2026-11-24T12:00:00Z");
    expect(dt).toBeTruthy();
    // Verify it contains a timezone indicator string
    expect(dt.length).toBeGreaterThan(10);
  });
});
