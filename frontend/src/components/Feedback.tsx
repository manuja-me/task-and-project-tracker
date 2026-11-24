import React from "react";

export const LoadingSpinner: React.FC<{ message?: string }> = ({ message = "Loading..." }) => (
  <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
    <div style={{ display: "inline-block", marginBottom: "0.5rem" }}>⏳</div>
    <div>{message}</div>
  </div>
);

export const EmptyState: React.FC<{
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ title, description, action }) => (
  <div
    style={{
      padding: "3rem 1.5rem",
      textAlign: "center",
      border: "1px dashed var(--border)",
      borderRadius: "var(--radius)",
      backgroundColor: "var(--bg-card)",
      margin: "1rem 0",
    }}
  >
    <h3 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>{title}</h3>
    {description && (
      <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>
        {description}
      </p>
    )}
    {action && <div>{action}</div>}
  </div>
);

export const ErrorAlert: React.FC<{
  message: string;
  onRetry?: () => void;
}> = ({ message, onRetry }) => (
  <div className="alert alert-danger" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
    <span>{message}</span>
    {onRetry && (
      <button type="button" className="btn btn-secondary" onClick={onRetry} style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}>
        Retry
      </button>
    )}
  </div>
);
