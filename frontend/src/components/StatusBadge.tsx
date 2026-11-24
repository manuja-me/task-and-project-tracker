import React from "react";
import { TaskStatus } from "../api/types";

interface Props {
  status: TaskStatus;
  isOverdue?: boolean;
}

export const StatusBadge: React.FC<Props> = ({ status, isOverdue }) => {
  const getBadgeClass = () => {
    switch (status) {
      case "TODO":
        return "badge badge-todo";
      case "IN_PROGRESS":
        return "badge badge-inprogress";
      case "DONE":
        return "badge badge-done";
      default:
        return "badge";
    }
  };

  const getLabel = () => {
    switch (status) {
      case "TODO":
        return "To Do";
      case "IN_PROGRESS":
        return "In Progress";
      case "DONE":
        return "Done";
      default:
        return status;
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
      <span className={getBadgeClass()} aria-label={`Status: ${getLabel()}`}>
        {getLabel()}
      </span>
      {isOverdue && status !== "DONE" && (
        <span className="badge badge-overdue" aria-label="Task is overdue">
          Overdue
        </span>
      )}
    </span>
  );
};
