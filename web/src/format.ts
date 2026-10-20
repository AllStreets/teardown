import type { NodeKind, Stack } from "../../shared/types";

export function bytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

export function pct(part: number, whole: number) {
  if (!whole) return "0%";
  const v = (part / whole) * 100;
  return v < 1 ? "<1%" : `${Math.round(v)}%`;
}

export const KIND_COLOR: Record<NodeKind, string> = {
  code: "#7FD3FF",
  framework: "#4F7CFF",
  library: "#8EA2FF",
  helper: "#C08BFF",
  extension: "#FF8FD1",
  web: "#58E1C1",
  model: "#FFE29A",
  assets: "#3E7397",
  localization: "#2C4C68",
  other: "#24394E",
};

export const KIND_LABEL: Record<NodeKind, string> = {
  code: "Main code",
  framework: "Frameworks",
  library: "Libraries",
  helper: "Helper apps",
  extension: "Extensions",
  web: "Web code",
  model: "ML models",
  assets: "Images, media, fonts",
  localization: "Translations",
  other: "Other",
};

export const STACK_COLOR: Record<Stack, string> = {
  electron: "#C08BFF",
  chromium: "#9B7BFF",
  webview: "#E5A3FF",
  swiftui: "#7FD3FF",
  swift: "#58B4F2",
  objc: "#4F7CFF",
  catalyst: "#7BE3E0",
  ios: "#58C9B5",
  qt: "#9EE37D",
  flutter: "#6FD6A8",
  java: "#E6C27A",
  dotnet: "#F2A7C3",
  python: "#F5D86E",
  "game-engine": "#FF8F8F",
  unknown: "#3A5068",
};

export const STACK_NAME: Record<Stack, string> = {
  electron: "Electron",
  chromium: "Built on Chromium",
  webview: "Web view",
  swiftui: "SwiftUI",
  swift: "Swift",
  objc: "AppKit",
  catalyst: "Mac Catalyst",
  ios: "iPhone app",
  qt: "Qt",
  flutter: "Flutter",
  java: "Java",
  dotnet: ".NET",
  python: "Python",
  "game-engine": "Game engine",
  unknown: "Unrecognized",
};

export const WEB_STACKS: Stack[] = ["electron", "chromium", "webview"];
