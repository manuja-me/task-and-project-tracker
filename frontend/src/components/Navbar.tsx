import React from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useSession } from "../app/session";

export const Navbar: React.FC = () => {
  const { user, logout } = useSession();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/login");
    } catch {
      // ignore
    }
  };

  return (
    <header className="navbar">
      <div className="nav-brand">
        <Link to="/projects" style={{ color: "inherit", textDecoration: "none" }}>
          Task & Project Tracker
        </Link>
      </div>
      {user ? (
        <>
          <nav>
            <ul className="nav-links">
              <li>
                <NavLink to="/projects" end className={({ isActive }) => (isActive ? "active" : "")}>
                  Projects
                </NavLink>
              </li>
              <li>
                <NavLink to="/my-tasks" className={({ isActive }) => (isActive ? "active" : "")}>
                  My Tasks
                </NavLink>
              </li>
            </ul>
          </nav>
          <div className="nav-user">
            <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              Signed in as <strong>{user.username}</strong>
            </span>
            <button type="button" className="btn btn-secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </>
      ) : (
        <div className="nav-user">
          <Link to="/login" className="btn btn-primary">
            Login
          </Link>
        </div>
      )}
    </header>
  );
};
