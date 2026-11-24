export function formatStatusLabel(status: string | null | undefined): string {
  if (!status) return "None";
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
}

export function formatChangeText(field: string, delta: { old: any; new: any }): string {
  if (field === "assignee") {
    const oldName = delta.old?.username || (delta.old ? "Assigned" : "Unassigned");
    const newName = delta.new?.username || (delta.new ? "Assigned" : "Unassigned");
    return `Assignee: ${oldName} → ${newName}`;
  }
  if (field === "status") {
    return `Status: ${formatStatusLabel(delta.old)} → ${formatStatusLabel(delta.new)}`;
  }
  if (field === "title") {
    const oldT = delta.old ? `"${delta.old}"` : "None";
    const newT = delta.new ? `"${delta.new}"` : "None";
    return `Title: ${oldT} → ${newT}`;
  }
  if (field === "due_date") {
    const oldDate = delta.old || "None";
    const newDate = delta.new || "None";
    return `Due Date: ${oldDate} → ${newDate}`;
  }
  if (field === "description") {
    return "Description updated";
  }
  return `${field}: ${JSON.stringify(delta.old)} → ${JSON.stringify(delta.new)}`;
}

export function formatEventDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZoneName: "short",
    });
  } catch {
    return isoString;
  }
}
