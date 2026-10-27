"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, type Me } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";

interface AuthValue {
  user: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<Me>;
  signup: (email: string, password: string, name?: string) => Promise<Me>;
  logout: () => Promise<void>;
  isStaff: boolean;
  canEdit: boolean;
  isOwner: boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

const RANK = { user: 0, support: 1, admin: 2, owner: 3 } as const;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [bootstrapped, setBootstrapped] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.me(),
    queryFn: () => api.me(),
    retry: false,
    staleTime: 60_000,
  });

  const [user, setUser] = useState<Me | null>(null);

  useEffect(() => {
    // `undefined` means "not fetched yet"; `null` from a failed request is handled below.
    if (!isLoading) {
      setUser(data ?? null);
      setBootstrapped(true);
    }
  }, [data, isLoading]);

  const login = useCallback(
    async (email: string, password: string) => {
      const me = await api.login(email, password);
      setUser(me);
      queryClient.setQueryData(queryKeys.me(), me);
      return me;
    },
    [queryClient],
  );

  const signup = useCallback(
    async (email: string, password: string, name?: string) => {
      const me = await api.signup(email, password, name);
      setUser(me);
      queryClient.setQueryData(queryKeys.me(), me);
      return me;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
    queryClient.setQueryData(queryKeys.me(), null);
    queryClient.clear();
  }, [queryClient]);

  const refresh = useCallback(async () => {
    const me = await refetch();
    setUser((me.data as Me | null) ?? null);
  }, [refetch]);

  const value = useMemo<AuthValue>(() => {
    const role = user?.role ?? "user";
    return {
      user,
      loading: !bootstrapped || isLoading,
      refresh,
      login,
      signup,
      logout,
      isStaff: !!user && RANK[role] >= RANK.support,
      canEdit: !!user && RANK[role] >= RANK.admin,
      isOwner: !!user && RANK[role] >= RANK.owner,
    };
  }, [user, bootstrapped, isLoading, refresh, login, signup, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}