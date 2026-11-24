import React from "react";
import { ProgressCounts } from "../api/types";

interface Props {
  progress?: ProgressCounts;
}

export const ProgressBar: React.FC<Props> = ({ progress }) => {
  if (!progress) return null;

  const percent = progress.percent_complete;

  return (
    <div style={{ margin: "0.5rem 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}>
        <span>Progress: {progress.progress_label}</span>
        <span>
          {progress.done_count} / {progress.total_tasks} completed
        </span>
      </div>
      <div
        className="progress-bar-container"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Project completion progress"
      >
        <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};
