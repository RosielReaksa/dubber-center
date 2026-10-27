export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const queryKeys = {
  models: (params?: Record<string, string>) => ["models", params ?? {}] as const,
  model: (id: string) => ["model", id] as const,
  modelStatus: (id: string) => ["model-status", id] as const,
  publicStatus: () => ["public-status"] as const,
  jobs: (params?: Record<string, string>) => ["jobs", params ?? {}] as const,
  job: (id: string) => ["job", id] as const,
  usage: (params?: Record<string, string>) => ["usage", params ?? {}] as const,
  me: () => ["me"] as const,
  keys: () => ["keys"] as const,
  creditsTransactions: () => ["credits-transactions"] as const,
  admin: (...parts: unknown[]) => ["admin", ...parts] as const,
};