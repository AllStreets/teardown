import os from "node:os";
import path from "node:path";

// Where Teardown keeps everything it writes. The Mac app and the browser version share it.
export const DATA_DIR = process.env.TEARDOWN_DATA ?? path.join(os.homedir(), "Library", "Application Support", "Teardown");
export const REPORT_DIR = path.join(DATA_DIR, "reports");
export const ICON_DIR = path.join(DATA_DIR, "icons");
export const SNAPSHOT_DIR = path.join(DATA_DIR, "snapshots");
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
export const CHANGES_FILE = path.join(DATA_DIR, "changes.json");
export const CLEANUP_LOG = path.join(DATA_DIR, "cleanup-log.json");
export const VERSIONS_DIR = path.join(DATA_DIR, "versions");
export const NOTICES_FILE = path.join(DATA_DIR, "notifications.json");
export const ARRIVALS_FILE = path.join(DATA_DIR, "arrivals-seen.json");


export const DIST_DIR = process.env.TEARDOWN_DIST ?? path.resolve(process.cwd(), "dist");
export const PORT = Number(process.env.TEARDOWN_PORT ?? 4710);
export const VERSION = "0.3.0";
