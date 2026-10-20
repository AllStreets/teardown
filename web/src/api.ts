import type { AppEntry, QuickReport, Report } from "../../shared/types";

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with ${r.status}`);
  }
  return r.json();
}

const q = (p: string) => encodeURIComponent(p);

export const api = {
  apps: () => get<AppEntry[]>("/api/apps"),
  quick: (path: string) => get<QuickReport>(`/api/quick?path=${q(path)}`),
  teardown: (path: string, fresh = false) => get<Report>(`/api/teardown?path=${q(path)}${fresh ? "&fresh=1" : ""}`),
  icon: (path: string) => `/api/icon?path=${q(path)}`,
  reveal: (path: string) => fetch(`/api/reveal?path=${q(path)}`, { method: "POST" }),
};
