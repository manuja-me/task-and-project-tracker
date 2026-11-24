import React from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useSession } from "./session";
import { Navbar } from "../components/Navbar";
import { LoginPage } from "../features/session/LoginPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { ProjectOverviewPage } from "../features/projects/ProjectOverviewPage";
import { TaskDetailPage } from "../features/tasks/TaskDetailPage";
import { MyTasksPage } from "../features/tasks/MyTasksPage";
import { ProjectMembersPage } from "../features/projects/ProjectMembersPage";
import { ProjectActivityPage } from "../features/projects/ProjectActivityPage";
import { LoadingSpinner } from "../components/Feedback";

const ProtectedLayout: React.FC = () => {
  const { user, isLoading } = useSession();

  if (isLoading) {
    return <LoadingSpinner message="Checking authentication..." />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app-container">
      <Navbar />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
};

const PublicLayout: React.FC = () => {
  return (
    <div className="app-container">
      <Navbar />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
};

export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>

        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectOverviewPage />} />
          <Route path="/projects/:projectId/tasks" element={<ProjectOverviewPage />} />
          <Route path="/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/projects/:projectId/members" element={<ProjectMembersPage />} />
          <Route path="/projects/:projectId/activity" element={<ProjectActivityPage />} />
          <Route path="/my-tasks" element={<MyTasksPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
