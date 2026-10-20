// Shapes shared by the analysis server and the web UI.

export type Stack =
  | "electron"
  | "chromium"
  | "webview"
  | "flutter"
  | "qt"
  | "java"
  | "dotnet"
  | "python"
  | "game-engine"
  | "catalyst"
  | "ios"
  | "swiftui"
  | "swift"
  | "objc"
  | "unknown";

export interface AppEntry {
  name: string;
  path: string;
  location: "applications" | "user" | "system";
}

export interface Detection {
  label: string;
  detail?: string;
  evidence: string[];
}

export interface QuickReport {
  path: string;
  name: string;
  bundleId?: string;
  version?: string;
  stack: Stack;
  stackLabel: string;
  archs: string[];
  sizeBytes: number;
  // Bytes spent on an embedded browser engine (Electron, CEF, Chromium).
  engineBytes: number;
  sandboxed: boolean;
}

export type NodeKind =
  | "code"
  | "framework"
  | "library"
  | "helper"
  | "extension"
  | "web"
  | "model"
  | "assets"
  | "localization"
  | "other";

export interface BundleNode {
  name: string;
  size: number;
  kind: NodeKind;
  children?: BundleNode[];
  // Set on a synthetic node that stands in for many small items.
  collapsed?: number;
}

export type Severity = "notable" | "info" | "good";

export interface Finding {
  severity: Severity;
  title: string;
  detail: string;
  evidence?: string;
}

export interface Permission {
  key: string;
  label: string;
  reason: string;
}

export interface Entitlement {
  key: string;
  label?: string;
  value: string;
  risky: boolean;
}

export interface Sdk {
  name: string;
  category: SdkCategory;
  evidence: string;
}

export type SdkCategory =
  | "analytics"
  | "session recording"
  | "crash reporting"
  | "attribution"
  | "ads"
  | "feature flags"
  | "payments"
  | "updates"
  | "messaging"
  | "monitoring";

export interface Domain {
  host: string;
  count: number;
  sdk?: string;
}

export interface NpmPackage {
  name: string;
  version?: string;
  native?: boolean;
}

export interface Signing {
  signed: boolean;
  adhoc: boolean;
  authority?: string;
  teamId?: string;
  hardenedRuntime: boolean;
  notarized?: boolean;
  gatekeeper?: string;
  timestamp?: string;
}

export interface Report extends QuickReport {
  minOS?: string;
  copyright?: string;
  verdict: string[];
  findings: Finding[];
  stackDetections: Detection[];
  languages: Detection[];
  signing: Signing;
  permissions: Permission[];
  entitlements: Entitlement[];
  urlSchemes: string[];
  documentTypes: string[];
  sdks: Sdk[];
  domains: Domain[];
  frameworks: { name: string; size: number; thirdParty: boolean }[];
  helpers: { name: string; kind: string }[];
  npm?: { app?: { name?: string; version?: string }; packages: NpmPackage[]; total: number };
  electron?: { version?: string; chromium?: string; node?: string };
  localizations: string[];
  tree: BundleNode;
  fileCount: number;
  analyzedMs: number;
}

// ---------- settings ----------

export interface Settings {
  watch: boolean;
  intervalMinutes: number;
  includeSystem: boolean;
  staleDays: number;
  // Apps Teardown leaves out of every page, by bundle path.
  hiddenApps: string[];
  keepVersions: boolean;
  notifyUpdates: "notable" | "all" | "off";
  notifyArrivals: boolean;
  launchAtLogin: boolean;
}

export interface StorageInfo {
  dataDir: string;
  reports: { files: number; bytes: number };
  snapshots: { files: number; bytes: number };
  icons: { files: number; bytes: number };
  cleanupLog: number;
  versions: { apps: number; copies: number };
}

export interface SelfConnections {
  pid: number;
  port: number;
  outbound: Connection[];
  listening: string[];
  checkedAt: number;
}

// ---------- watching for changes ----------

// The parts of a report worth comparing between two versions of an app.
export interface Fingerprint {
  // Which analysis produced this snapshot; snapshots from older engines are never compared.
  engine?: number;
  path: string;
  name: string;
  bundleId?: string;
  version?: string;
  stamp: number;
  takenAt: number;
  stack: Stack;
  stackLabel: string;
  archs: string[];
  sizeBytes: number;
  sandboxed: boolean;
  teamId?: string;
  authority?: string;
  notarized?: boolean;
  hardenedRuntime: boolean;
  electron?: string;
  chromium?: string;
  sdks: { name: string; category: SdkCategory }[];
  permissions: { label: string; reason: string }[];
  entitlements: { key: string; label?: string; risky: boolean }[];
  frameworks: { name: string; size: number }[];
  npm: { name: string; version?: string }[];
  domains: string[];
  tree?: BundleNode;
}

export interface Change {
  severity: Severity;
  title: string;
  detail?: string;
}

export interface ChangeEvent {
  id: string;
  path: string;
  name: string;
  bundleId?: string;
  from?: string;
  to?: string;
  detectedAt: number;
  changes: Change[];
}

export interface WatchStatus {
  watching: boolean;
  baselined: number;
  total: number;
  queue: number;
  lastCheck?: number;
  nextCheck?: number;
  current?: string;
}

// ---------- live connections ----------

export interface Connection {
  remote: string;
  port: number;
  host?: string;
  protocol: string;
  state?: string;
  process: string;
  mentioned?: boolean;
}

export interface LiveApp {
  path: string;
  name: string;
  pids: number[];
  connections: Connection[];
  listening: string[];
  mentionedTotal?: number;
}

export interface LiveSnapshot {
  apps: LiveApp[];
  at: number;
}

// ---------- cleanup ----------

export type CleanupCategory = "leftovers" | "caches" | "stale-apps" | "broken-login-items" | "intel-only";

export interface CleanupItem {
  id: string;
  category: CleanupCategory;
  path: string;
  label: string;
  detail: string;
  bytes: number;
  removable: boolean;
  owner?: string;
  lastUsed?: number;
}

export interface CleanupScan {
  items: CleanupItem[];
  scannedAt: number;
  ms: number;
}

export interface TrashResult {
  id: string;
  path: string;
  ok: boolean;
  error?: string;
  bytes: number;
}

// ---------- versions and rollback ----------

export interface SavedVersion {
  version?: string;
  savedAt: number;
  path: string;
  current: boolean;
}

// ---------- notifications ----------

export interface Notice {
  id: number;
  kind: "update" | "arrival" | "rollback";
  title: string;
  body: string;
  target: string;
  severity: Severity;
  at: number;
}

// ---------- apps not opened yet ----------

export interface Arrival {
  path: string;
  name: string;
  bundleId?: string;
  version?: string;
  source?: string;
  from?: string[];
  quarantinedAt?: number;
  stack?: Stack;
  stackLabel?: string;
  findings: Finding[];
  verdict?: string;
}

// ---------- permissions you've granted ----------

export interface Grant {
  service: string;
  label: string;
  client: string;
  app?: { name: string; path: string };
  allowed: boolean;
  since?: number;
  scope: "user" | "system";
  lastUsed?: number;
}

export interface GrantsReport {
  readable: boolean;
  reason?: string;
  grants: Grant[];
}

// ---------- startup items ----------

export interface StartupItem {
  label: string;
  plist: string;
  program?: string;
  scope: "user" | "system-agent" | "system-daemon";
  app?: { name: string; path: string };
  loaded: boolean;
  disabled: boolean;
  missing: boolean;
  runAtLoad: boolean;
  keepAlive: boolean;
}
