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
