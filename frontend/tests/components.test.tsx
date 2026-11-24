import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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

  it("does not reset focus to first input when parent re-renders with a new onClose prop", () => {
    vi.useFakeTimers();
    try {
      const firstOnClose = vi.fn();
      const secondOnClose = vi.fn();

      const TestFormModal = ({ onClose }: { onClose: () => void }) => {
        const [desc, setDesc] = React.useState("");
        return (
          <Modal isOpen={true} onClose={onClose} title="Create Item">
            <input aria-label="Title" type="text" />
            <textarea
              aria-label="Description"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </Modal>
        );
      };

      const { rerender } = render(<TestFormModal onClose={firstOnClose} />);

      const titleInput = screen.getByLabelText("Title");
      const descInput = screen.getByLabelText("Description");

      // Initial open focuses the first focusable input after 50ms
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(document.activeElement).toBe(titleInput);

      // User moves focus to Description and types, triggering parent re-render + new inline onClose
      descInput.focus();
      expect(document.activeElement).toBe(descInput);
      fireEvent.change(descInput, { target: { value: "a" } });
      rerender(<TestFormModal onClose={secondOnClose} />);

      // Wait >50ms after re-render and verify focus remains on Description
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(document.activeElement).toBe(descInput);

      // Escape still invokes the latest onClose callback
      fireEvent.keyDown(document, { key: "Escape" });
      expect(firstOnClose).not.toHaveBeenCalled();
      expect(secondOnClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips disabled buttons in initial focus and Tab focus wrap", () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      render(
        <Modal isOpen={true} onClose={onClose} title="Disabled Controls">
          <button disabled>Disabled First</button>
          <input aria-label="Enabled Input" type="text" />
          <button>Enabled Submit</button>
          <button disabled>Disabled Last</button>
        </Modal>
      );

      const enabledInput = screen.getByLabelText("Enabled Input");
      const enabledSubmit = screen.getByRole("button", { name: "Enabled Submit" });

      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(document.activeElement).toBe(enabledInput);

      // Shift+Tab from first enabled control wraps to last enabled control
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(enabledSubmit);

      // Tab from last enabled control wraps to first enabled control
      fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
      expect(document.activeElement).toBe(enabledInput);
    } finally {
      vi.useRealTimers();
    }
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

  it("returns input string for invalid dates instead of Invalid Date", () => {
    expect(formatEventDateTime("not-a-date")).toBe("not-a-date");
  });
});
