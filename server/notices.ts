import type { Notice } from "../shared/types.js";
import { NOTICES_FILE } from "./paths.js";
import { readJson, writeJson } from "./store.js";

// Notices are what the Mac app turns into system notifications and the window shows as alerts.
let cache: Notice[] | undefined;

async function load() {
  cache ??= await readJson<Notice[]>(NOTICES_FILE, []);
  return cache;
}

export async function notify(n: Omit<Notice, "id" | "at">) {
  const all = await load();
  const id = (all[0]?.id ?? 0) + 1;
  all.unshift({ ...n, id, at: Date.now() });
  cache = all.slice(0, 200);
  await writeJson(NOTICES_FILE, cache);
}

export async function noticesSince(since: number) {
  return (await load()).filter((n) => n.id > since).reverse();
}

export async function latestNoticeId() {
  return (await load())[0]?.id ?? 0;
}
