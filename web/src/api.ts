import type {
  AppEntry, ChangeEvent, CleanupScan, LiveSnapshot, QuickReport, Report, SelfConnections, Settings, StorageInfo, TrashResult, WatchStatus,
} from "../../shared/types";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with ${r.status}`);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

const q = (p: string) => encodeURIComponent(p);
const post = <T,>(url: string, body?: unknown) =>
  call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

export const api = {
  apps: (all = false) => call<AppEntry[]>(`/api/apps${all ? "?all=1" : ""}`),
  quick: (path: string) => call<QuickReport>(`/api/quick?path=${q(path)}`),
  teardown: (path: string, fresh = false) => call<Report>(`/api/teardown?path=${q(path)}${fresh ? "&fresh=1" : ""}`),
  history: (path: string) => call<{ snapshots: { version?: string; takenAt: number }[]; changes: ChangeEvent[] }>(`/api/history?path=${q(path)}`),
  changes: () => call<{ events: ChangeEvent[]; status: WatchStatus }>("/api/changes"),
  checkNow: () => post<WatchStatus>("/api/changes/check"),
  live: () => call<LiveSnapshot>("/api/live"),
  cleanup: (fresh = false) => call<CleanupScan>(`/api/cleanup${fresh ? "?fresh=1" : ""}`),
  trash: (ids: string[]) => post<TrashResult[]>("/api/cleanup/trash", { ids }),
  settings: () => call<Settings>("/api/settings"),
  saveSettings: (s: Partial<Settings>) => call<Settings>("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) }),
  storage: () => call<StorageInfo>("/api/storage"),
  clear: (what: "cache" | "history") => post<void>(`/api/storage/clear?what=${what}`),
  self: () => call<SelfConnections & { version: string }>("/api/self"),
  icon: (path: string) => `/api/icon?path=${q(path)}`,
  reveal: (path: string) => post<void>(`/api/reveal?path=${q(path)}`),
  openFolder: (target: "data" | "trash") => post<void>(`/api/reveal?target=${target}`),
};
