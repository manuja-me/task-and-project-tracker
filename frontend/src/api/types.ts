export interface User {
  id: number;
  username: string;
  is_active: boolean;
}

export interface ProgressCounts {
  total_tasks: number;
  todo_count: number;
  in_progress_count: number;
  done_count: number;
  percent_complete: number;
  progress_label: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  owner: User;
  archived: boolean;
  version: number;
  role: "owner" | "member";
  progress: ProgressCounts;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: number;
  username: string;
  role: "owner" | "member";
  is_active: boolean;
  joined_at: string;
}

export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

export interface Task {
  id: string;
  project: {
    id: string;
    name: string;
  };
  title: string;
  description: string;
  assignee: User | null;
  status: TaskStatus;
  due_date: string | null;
  is_overdue: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export type TrackerKind = "CREATED" | "UPDATED" | "DELETED";

export interface TrackerEvent {
  id: number;
  task_id: string;
  task_title: string;
  task_is_deleted: boolean;
  actor: {
    id: number;
    username: string;
  };
  task_version: number;
  kind: TrackerKind;
  changes: Record<string, { old: any; new: any }>;
  event_at: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
  assigned_task_count?: number;
  filter_url?: string;
}
