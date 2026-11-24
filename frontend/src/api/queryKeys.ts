export const queryKeys = {
  session: ["session"] as const,
  projects: (filters?: Record<string, any>) => ["projects", filters ?? {}] as const,
  project: (id: string) => ["project", id] as const,
  members: (projectId: string) => ["members", projectId] as const,
  tasks: (projectId: string, filters?: Record<string, any>) =>
    ["tasks", projectId, filters ?? {}] as const,
  task: (projectId: string, taskId: string) => ["task", projectId, taskId] as const,
  taskHistory: (projectId: string, taskId: string) =>
    ["taskHistory", projectId, taskId] as const,
  activity: (projectId: string, filters?: Record<string, any>) =>
    ["activity", projectId, filters ?? {}] as const,
  myTasks: (filters?: Record<string, any>) => ["myTasks", filters ?? {}] as const,
};
