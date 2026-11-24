import React, { createContext, useContext, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { queryKeys } from "../api/queryKeys";
import { User } from "../api/types";

interface SessionContextType {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | null>(null);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.session,
    queryFn: async () => {
      const resp = await apiClient<{ user: User | null }>("/session/");
      return resp.data.user;
    },
    staleTime: Infinity,
    retry: false,
  });

  const user = data ?? null;

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const resp = await apiClient<{ user: User }>("/session/login/", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      return resp.data.user;
    },
    onSuccess: (newUser) => {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session, newUser);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiClient<void>("/session/logout/", {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session, null);
    },
  });

  const login = async (username: string, password: string) => {
    return loginMutation.mutateAsync({ username, password });
  };

  const logout = async () => {
    return logoutMutation.mutateAsync();
  };

  return (
    <SessionContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </SessionContext.Provider>
  );
};

export function useSession(): SessionContextType {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
}
