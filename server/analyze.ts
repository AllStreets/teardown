import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  BundleNode, Detection, Domain, Entitlement, Finding, NodeKind, NpmPackage, Permission,
  QuickReport, Report, Sdk, Signing, Stack,
} from "../shared/types.js";
import {
  ENTITLEMENTS, NOISE_DOMAINS, PRIVACY_LABELS, SDKS, STACK_LABELS, TRACKING,
} from "./knowledge.js";
import { parsePlistXml, readPlist, run } from "./run.js";

// ---------- bundle basics ----------

interface Basics {
  app: string;
  contents: string;
  name: string;
  info: Record<string, unknown>;
  exec?: string;
  frameworks: string[];
  links: string[];
  archs: string[];
  markers: Set<string>;
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function list(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

// Mac apps keep everything in Contents/. iPhone and iPad apps running on a Mac are wrapped:
// the real bundle sits in Wrapper/, with Info.plist and the executable at its root.
export async function layout(app: string) {
  const contents = path.join(app, "Contents");
  if (await exists(contents)) return { contents, execDir: path.join(contents, "MacOS"), info: path.join(contents, "Info.plist"), ios: false };
  const inner = await fs.realpath(path.join(app, "WrappedBundle")).catch(() => undefined);
  if (inner) return { contents: inner, execDir: inner, info: path.join(inner, "Info.plist"), ios: true };
  return { contents, execDir: path.join(contents, "MacOS"), info: path.join(contents, "Info.plist"), ios: false };
}

async function basics(app: string): Promise<Basics> {
  const lay = await layout(app);
  const contents = lay.contents;
  const info = (await readPlist(lay.info)) ?? {};
  const name = str(info.CFBundleDisplayName) ?? str(info.CFBundleName) ?? path.basename(app, ".app");
  const execName = str(info.CFBundleExecutable);
  let exec = execName ? path.join(lay.execDir, execName) : undefined;
  if (exec && !(await exists(exec))) exec = undefined;

  const frameworks = await list(path.join(contents, "Frameworks"));
  const [linkOut, archOut, langOut] = exec
    ? await Promise.all([
        run("otool", ["-L", exec], 8_000),
        run("lipo", ["-archs", exec], 5_000),
        run("grep", ["-a", "-o", "-m", "20", "-E", "Go build ID|/rustc/[0-9a-f]{8}|rust_begin_unwind|runtime\\.gopanic", exec], 8_000),
      ])
    : [undefined, undefined, undefined];

  const links = linkOut
    ? [...new Set(linkOut.stdout.split("\n").slice(1).map((l) => l.trim().split(" (compatibility")[0]).filter((l) => l && !l.startsWith(exec!) && !l.endsWith(":") && !l.startsWith("(architecture")))]
    : [];

  const markers = new Set<string>();
  for (const m of langOut?.stdout.split("\n") ?? []) {
    if (m.includes("Go build ID") || m.includes("gopanic")) markers.add("go");
    if (m.includes("rustc") || m.includes("rust_begin")) markers.add("rust");
  }

  return {
    app, contents, name, info, exec, frameworks, links,
    archs: [...new Set((archOut?.stdout.trim().split(/\s+/).filter(Boolean) ?? []).map((a) => (a === "arm64e" ? "arm64" : a)))],
    markers,
  };
}

// ---------- stack detection ----------

interface StackResult {
  stack: Stack;
  detections: Detection[];
  languages: Detection[];
  engineDir?: string;
}

async function findChromiumFramework(contents: string, frameworks: string[]) {
  for (const f of frameworks) {
    if (!f.endsWith(".framework")) continue;
    const res = path.join(contents, "Frameworks", f, "Versions", "Current", "Resources");
    if (await exists(path.join(res, "icudtl.dat")) || f.startsWith("Chromium Embedded Framework")) return f;
  }
  return undefined;
}

async function detectStack(b: Basics): Promise<StackResult> {
  const c = b.contents;
  const fw = (re: RegExp) => b.frameworks.find((f) => re.test(f));
  const link = (re: RegExp) => b.links.find((l) => re.test(l));
  const detections: Detection[] = [];
  const add = (stack: Stack, label: string, evidence: string[], detail?: string) => {
    detections.push({ label, detail, evidence });
    return stack;
  };

  const candidates: Stack[] = [];
  let engineDir: string | undefined;

  const electronFw = fw(/^Electron Framework\.framework$/);
  const asar = (await exists(path.join(c, "Resources", "app.asar"))) || (await exists(path.join(c, "Resources", "app", "package.json")));
  if (electronFw || asar) {
    candidates.push(add("electron", "Electron", [electronFw ? `Contents/Frameworks/${electronFw}` : "", asar ? "Contents/Resources/app.asar" : ""].filter(Boolean)));
    if (electronFw) engineDir = path.join(c, "Frameworks", electronFw);
  } else {
    const chromium = await findChromiumFramework(c, b.frameworks);
    if (chromium) {
      candidates.push(add("chromium", chromium.startsWith("Chromium Embedded") ? "Chromium Embedded Framework" : "Chromium", [`Contents/Frameworks/${chromium}`]));
      engineDir = path.join(c, "Frameworks", chromium);
    }
  }

  const flutter = fw(/^FlutterMacOS\.framework$/);
  if (flutter) candidates.push(add("flutter", "Flutter", [`Contents/Frameworks/${flutter}`]));

  const qt = fw(/^Qt\w*\.framework$|^libQt/) ?? link(/Qt\w*\.framework|libQt/);
  if (qt) candidates.push(add("qt", "Qt", [qt.includes("/") ? qt : `Contents/Frameworks/${qt}`]));

  const javaDirs = ["Java", "runtime", "Home", "Eclipse"];
  for (const d of javaDirs) {
    if (await exists(path.join(c, d))) {
      candidates.push(add("java", "Java", [`Contents/${d}`]));
      break;
    }
  }
  if (!candidates.includes("java")) {
    const jdk = (await list(path.join(c, "PlugIns"))).find((p) => /jdk|jre/i.test(p));
    if (jdk) candidates.push(add("java", "Java", [`Contents/PlugIns/${jdk}`]));
  }

  const macos = await list(path.join(c, "MacOS"));
  const dotnet = (await exists(path.join(c, "MonoBundle"))) ? "Contents/MonoBundle"
    : [...macos, ...b.frameworks].find((f) => /libcoreclr|libmonosgen|libhostfxr/.test(f));
  if (dotnet) candidates.push(add("dotnet", ".NET", [dotnet.startsWith("Contents") ? dotnet : `found ${dotnet}`]));

  const py = fw(/^Python(3)?\.framework$|^libpython|^base_library\.zip$/)
    ?? ((await exists(path.join(c, "Resources", "__boot__.py"))) ? "__boot__.py" : undefined)
    ?? (await list(path.join(c, "Resources", "lib"))).find((d) => /^python3/.test(d));
  if (py) candidates.push(add("python", "Python", [`bundled ${py}`]));

  const unity = fw(/^UnityPlayer\.dylib$/) ?? macos.find((f) => f === "UnityPlayer.dylib");
  const godot = (await list(path.join(c, "Resources"))).find((f) => f.endsWith(".pck"));
  if (unity) candidates.push(add("game-engine", "Unity", [`found ${unity}`]));
  else if (godot) candidates.push(add("game-engine", "Godot", [`Contents/Resources/${godot}`]));

  if (await exists(path.join(b.app, "Wrapper"))) candidates.push(add("ios", "iPhone or iPad app", ["Wrapper/ (wrapped iOS bundle)"]));
  const webkit = link(/WebKit\.framework/);
  if (webkit && (b.markers.has("rust") || b.markers.has("go")) && candidates.length === 0) {
    const rust = b.markers.has("rust");
    candidates.push(add("webview", rust ? "Web view with a Rust core" : "Web view with a Go core", [webkit, rust ? "Rust runtime symbols in main executable" : "Go build ID in main executable"], "Uses the system WebKit instead of shipping a browser"));
  }

  const catalyst = link(/iOSSupport|UIKit\.framework/);
  if (catalyst) candidates.push(add("catalyst", "Mac Catalyst", [catalyst]));

  const swiftui = link(/SwiftUI\.framework/);
  if (swiftui) candidates.push(add("swiftui", "SwiftUI", [swiftui]));
  const swift = link(/libswift|\/usr\/lib\/swift\//);
  if (swift) candidates.push(add("swift", "Swift", [swift]));
  const appkit = link(/AppKit\.framework|Cocoa\.framework/);
  if (appkit) candidates.push(add("objc", "AppKit", [appkit]));

  const languages: Detection[] = [];
  if (swift) languages.push({ label: "Swift", evidence: [swift] });
  const objc = link(/libobjc/);
  if (objc) languages.push({ label: "Objective-C", evidence: [objc] });
  const cpp = link(/libc\+\+/);
  if (cpp) languages.push({ label: "C++", evidence: [cpp] });
  if (b.markers.has("rust")) languages.push({ label: "Rust", evidence: ["Rust runtime symbols in main executable"] });
  if (b.markers.has("go")) languages.push({ label: "Go", evidence: ["Go build ID in main executable"] });
  if (candidates.includes("electron")) languages.push({ label: "JavaScript", evidence: ["app.asar holds the app's JavaScript"] });
  if (candidates.includes("python")) languages.push({ label: "Python", evidence: detections.find((d) => d.label === "Python")!.evidence });
  if (candidates.includes("java")) languages.push({ label: "Java", evidence: detections.find((d) => d.label === "Java")!.evidence });
  if (candidates.includes("dotnet")) languages.push({ label: "C#", evidence: detections.find((d) => d.label === ".NET")!.evidence });
  if (candidates.includes("flutter")) languages.push({ label: "Dart", evidence: ["FlutterMacOS.framework"] });

  return { stack: candidates[0] ?? "unknown", detections, languages, engineDir };
}

// ---------- signing ----------

async function entitlementsOf(app: string): Promise<Record<string, unknown>> {
  const r = await run("codesign", ["-d", "--entitlements", "-", "--xml", app], 8_000);
  return parsePlistXml(r.stdout) ?? {};
}

async function signingOf(app: string, deep: boolean): Promise<Signing> {
  const r = await run("codesign", ["-dv", "--verbose=4", app], 8_000);
  const out = r.stderr;
  const signed = !/not signed at all/.test(out) && /Identifier=/.test(out);
  const authority = out.match(/^Authority=(.+)$/m)?.[1];
  const signing: Signing = {
    signed,
    adhoc: /Signature=adhoc/.test(out),
    authority,
    teamId: out.match(/^TeamIdentifier=(.+)$/m)?.[1]?.replace("not set", "") || undefined,
    hardenedRuntime: /flags=0x[0-9a-f]+\([^)]*runtime/.test(out),
    timestamp: out.match(/^Timestamp=(.+)$/m)?.[1],
  };
  if (deep && signed) {
    const g = await run("spctl", ["-a", "-vv", "-t", "exec", app], 10_000);
    const source = g.stderr.match(/source=(.+)/)?.[1];
    signing.gatekeeper = source;
    signing.notarized = source ? /Notarized|Mac App Store|Apple System/.test(source) : undefined;
  }
  return signing;
}

// ---------- sizes ----------

async function duBytes(p: string): Promise<number> {
  const r = await run("du", ["-sk", p], 30_000);
  const kb = parseInt(r.stdout, 10);
  return Number.isFinite(kb) ? kb * 1024 : 0;
}

// ---------- quick report ----------

export async function quickReport(app: string): Promise<QuickReport> {
  const b = await basics(app);
  const [s, size, ents] = await Promise.all([detectStack(b), duBytes(app), entitlementsOf(app)]);
  return {
    path: app,
    name: b.name,
    bundleId: str(b.info.CFBundleIdentifier),
    version: str(b.info.CFBundleShortVersionString) ?? str(b.info.CFBundleVersion),
    stack: s.stack,
    stackLabel: s.detections[0]?.label ?? STACK_LABELS[s.stack],
    archs: b.archs,
    sizeBytes: size,
    engineBytes: s.engineDir ? await duBytes(s.engineDir) : 0,
    sandboxed: ents["com.apple.security.app-sandbox"] === true,
  };
}

// ---------- bundle tree ----------

const DIR_KINDS: [RegExp, NodeKind][] = [
  [/\.framework$/, "framework"],
  [/\.app$/, "helper"],
  [/\.(appex|xpc|plugin|bundle|qlgenerator|mdimporter|saver|prefPane|systemextension|kext)$/, "extension"],
  [/\.lproj$/, "localization"],
  [/\.(mlmodelc|mlpackage)$/, "model"],
  [/^node_modules$/, "web"],
  [/^app\.asar\.unpacked$/, "web"],
];

const FILE_KINDS: [RegExp, NodeKind][] = [
  [/\.(dylib|so|node)$/, "library"],
  [/\.(asar|js|mjs|cjs|html|css|wasm|map)$/, "web"],
  [/\.(onnx|gguf|safetensors|pt|pth|tflite|mlmodel|ggml|ckpt)$/, "model"],
  [/\.(car|png|jpe?g|gif|icns|tiff?|pdf|svg|heic|webp|mp4|mov|m4v|wav|caf|aiff?|mp3|m4a|ttf|otf|ttc|nib|storyboardc|metallib|ktx|exr|hdr)$/i, "assets"],
  [/\.(strings|stringsdict|loctable)$/, "localization"],
];

const SEALED: NodeKind[] = ["framework", "helper", "extension", "model", "localization", "web"];

interface Walk {
  helpers: { name: string; kind: string }[];
  localizations: Set<string>;
  files: number;
}

function helperKind(parent: string, name: string) {
  if (name.endsWith(".systemextension")) return "System extension";
  if (parent === "LoginItems") return "Login item";
  if (parent === "LaunchServices") return "Privileged helper";
  if (name.endsWith(".xpc")) return "Background service";
  if (name.endsWith(".appex")) return "App extension";
  if (name.endsWith(".app")) return "Helper app";
  if (name.endsWith(".qlgenerator")) return "Quick Look preview";
  if (name.endsWith(".mdimporter")) return "Spotlight importer";
  return "Plug-in";
}

async function walk(p: string, name: string, inherited: NodeKind | undefined, depth: number, w: Walk, parentName: string): Promise<BundleNode> {
  let st;
  try {
    st = await fs.lstat(p);
  } catch {
    return { name, size: 0, kind: "other" };
  }
  if (st.isSymbolicLink()) return { name, size: 0, kind: inherited ?? "other" };

  if (!st.isDirectory()) {
    w.files++;
    let kind: NodeKind = inherited ?? FILE_KINDS.find(([re]) => re.test(name))?.[1] ?? "other";
    if (!inherited && parentName === "MacOS") kind = "code";
    return { name, size: st.size, kind };
  }

  const own = depth === 0 ? undefined : DIR_KINDS.find(([re]) => re.test(name))?.[1];
  if (own && !inherited && (own === "helper" || own === "extension") && depth > 1) {
    w.helpers.push({ name, kind: helperKind(parentName, name) });
  }
  if (own === "localization" && parentName === "Resources" && depth === 3) w.localizations.add(name.replace(/\.lproj$/, ""));

  const ctx: NodeKind | undefined = inherited ?? (own && SEALED.includes(own) ? own : undefined);
  const names = await list(p);
  const children = await Promise.all(names.map((n) => walk(path.join(p, n), n, ctx, depth + 1, w, name)));
  const size = children.reduce((a, c) => a + c.size, 0);

  let kind: NodeKind = ctx ?? own ?? (name === "MacOS" ? "code" : "other");
  if (!ctx && !own && name !== "MacOS") {
    const bySize = new Map<NodeKind, number>();
    for (const ch of children) bySize.set(ch.kind, (bySize.get(ch.kind) ?? 0) + ch.size);
    kind = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
  }
  return { name, size, kind, children };
}

function prune(input: BundleNode, total: number, depth: number): BundleNode {
  // Fold single-folder chains like Versions/A into one ring.
  const real = (n: BundleNode) => n.children?.filter((c) => c.size > 0) ?? [];
  let node = { ...input, children: input.children && real(input) };
  while (depth > 0 && node.children?.length === 1 && node.children[0].children?.length) {
    const only = node.children[0];
    node = { ...only, name: `${node.name}/${only.name}`, kind: node.kind, children: real(only) };
  }
  if (!node.children?.length) return { ...node, children: undefined };
  if (depth >= 7) return { ...node, children: undefined };
  const sorted = [...node.children].sort((a, b) => b.size - a.size);
  const floor = total * 0.0015;
  const keep = sorted.filter((c, i) => c.size >= floor && i < 48);
  const rest = sorted.slice(keep.length).filter((c) => c.size > 0);
  const children = keep.map((c) => prune(c, total, depth + 1));
  const restSize = rest.reduce((a, c) => a + c.size, 0);
  if (rest.length && restSize > 0) {
    children.push({ name: `${rest.length} smaller item${rest.length === 1 ? "" : "s"}`, size: restSize, kind: rest[0].kind, collapsed: rest.length });
  }
  return { ...node, children: children.length ? children : undefined };
}

// ---------- strings: domains ----------

function hostAllowed(host: string) {
  if (!/\.[a-z]{2,}$/.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  if (/^(127\.|0\.0\.0\.0|10\.|192\.168\.)/.test(host)) return false;
  if (host.length > 80 || host.split(".").some((p) => !p)) return false;
  return !NOISE_DOMAINS.some((n) => {
    const h = n.split("/")[0];
    return host === h || host.endsWith("." + h);
  });
}

function sdkForHost(host: string) {
  // A docs or marketing link doesn't mean the SDK is bundled.
  if (/^(docs|www|blog|help|support|status)\./.test(host)) return undefined;
  return SDKS.find((s) => s.domains?.some((d) => host === d || host.endsWith("." + d)));
}

async function scanDomains(files: string[]): Promise<Domain[]> {
  const counts = new Map<string, number>();
  for (const f of files) {
    const r = await run("grep", ["-a", "-o", "-E", "(https?|wss?)://[A-Za-z0-9][A-Za-z0-9.-]{2,}", f], 30_000);
    for (const line of r.stdout.split("\n")) {
      const host = line.replace(/^[a-z]+:\/\//, "").toLowerCase().replace(/\.+$/, "");
      if (host && hostAllowed(host)) counts.set(host, (counts.get(host) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([host, count]) => ({ host, count, sdk: sdkForHost(host)?.name }))
    .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
    .slice(0, 400);
}

// ---------- Electron internals ----------

interface AsarEntry {
  files?: Record<string, AsarEntry>;
  size?: number;
  offset?: string;
  unpacked?: boolean;
}

async function readAsar(asarPath: string) {
  const fh = await fs.open(asarPath, "r");
  try {
    const head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
    const pickleSize = head.readUInt32LE(4);
    const jsonLen = head.readUInt32LE(12);
    const json = Buffer.alloc(jsonLen);
    await fh.read(json, 0, jsonLen, 16);
    const header = JSON.parse(json.toString("utf8")) as AsarEntry;
    const dataStart = 8 + pickleSize;
    const readFile = async (entry: AsarEntry, rel: string) => {
      if (entry.unpacked) return fs.readFile(path.join(asarPath + ".unpacked", rel), "utf8").catch(() => undefined);
      if (entry.offset === undefined || !entry.size || entry.size > 2_000_000) return undefined;
      const buf = Buffer.alloc(entry.size);
      await fh.read(buf, 0, entry.size, dataStart + Number(entry.offset));
      return buf.toString("utf8");
    };
    return { header, readFile, close: () => fh.close() };
  } catch (e) {
    await fh.close();
    throw e;
  }
}

function hasNative(entry: AsarEntry): boolean {
  if (!entry.files) return false;
  return Object.entries(entry.files).some(([n, e]) => n.endsWith(".node") || hasNative(e));
}

function countPackages(entry: AsarEntry): number {
  let n = 0;
  for (const [name, e] of Object.entries(entry.files ?? {})) {
    if (name === "node_modules") {
      for (const [pkg, pe] of Object.entries(e.files ?? {})) {
        if (pkg.startsWith("@")) {
          for (const sub of Object.values(pe.files ?? {})) n += 1 + countPackages(sub);
        } else if (!pkg.startsWith(".")) n += 1 + countPackages(pe);
      }
    }
  }
  return n;
}

async function electronPackages(app: string): Promise<Report["npm"]> {
  const asarPath = path.join(app, "Contents", "Resources", "app.asar");
  if (!(await exists(asarPath))) return undefined;
  const asar = await readAsar(asarPath);
  try {
    const root = asar.header;
    const parse = (s?: string) => {
      try {
        return s ? (JSON.parse(s) as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    };
    const appPkgEntry = root.files?.["package.json"];
    const appPkg = appPkgEntry ? parse(await asar.readFile(appPkgEntry, "package.json")) : undefined;
    const nm = root.files?.node_modules?.files ?? {};
    const dirs: [string, AsarEntry][] = [];
    for (const [n, e] of Object.entries(nm)) {
      if (n.startsWith(".")) continue;
      if (n.startsWith("@")) for (const [s, se] of Object.entries(e.files ?? {})) dirs.push([`${n}/${s}`, se]);
      else dirs.push([n, e]);
    }
    const packages: NpmPackage[] = [];
    for (const [name, e] of dirs) {
      const pj = e.files?.["package.json"];
      const meta = pj ? parse(await asar.readFile(pj, `node_modules/${name}/package.json`)) : undefined;
      packages.push({ name, version: str(meta?.version), native: hasNative(e) || undefined });
    }
    packages.sort((a, b) => a.name.localeCompare(b.name));
    return {
      app: appPkg ? { name: str(appPkg.productName) ?? str(appPkg.name), version: str(appPkg.version) } : undefined,
      packages,
      total: countPackages(root),
    };
  } finally {
    await asar.close();
  }
}

async function electronVersions(engineDir: string) {
  const info = await readPlist(path.join(engineDir, "Versions", "Current", "Resources", "Info.plist")) ?? await readPlist(path.join(engineDir, "Resources", "Info.plist"));
  const binName = path.basename(engineDir, ".framework");
  const bin = path.join(engineDir, "Versions", "Current", binName);
  const r = await run("grep", ["-a", "-o", "-m", "1", "-E", "Chrome/[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+", bin], 20_000);
  return {
    version: str(info?.CFBundleVersion) ?? str(info?.CFBundleShortVersionString),
    chromium: r.stdout.split("\n")[0]?.replace("Chrome/", "") || undefined,
  };
}

// ---------- full report ----------

const RISK_WHY: Record<string, string> = {
  "com.apple.security.cs.disable-library-validation": "It can load plug-ins and libraries signed by other developers. Plug-in hosts need this, but it weakens protection against injected code.",
  "com.apple.security.cs.allow-unsigned-executable-memory": "It can write and run code in memory that nobody signed. JavaScript engines often ask for this.",
  "com.apple.security.cs.allow-dyld-environment-variables": "Libraries can be injected into it through environment variables.",
  "com.apple.security.cs.disable-executable-page-protection": "One of the strongest code-injection protections is switched off.",
  "com.apple.security.get-task-allow": "Other processes can attach to it like a debugger. Release builds normally drop this.",
  "com.apple.security.cs.debugger": "It can attach to and inspect other processes.",
  "com.apple.security.automation.apple-events": "It can script and control other apps, after you approve the prompt.",
  "com.apple.security.files.all": "It asks for access to every file.",
  "com.apple.developer.endpoint-security.client": "It can observe every process and file event on the system. Security tools use this.",
  "com.apple.developer.system-extension.install": "It can install a system extension that runs below normal apps.",
};

const PERMISSION_ORDER = ["Camera", "Microphone", "Screen", "System audio", "Location", "Contacts", "Photos", "Calendars", "Other apps"];
const rank = (label: string) => {
  const i = PERMISSION_ORDER.findIndex((p) => label.startsWith(p));
  return i < 0 ? 99 : i;
};

function joinList(items: string[], max = 5) {
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  if (more > 0) shown.push(`${more} more`);
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

function formatBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

function sumKind(node: BundleNode, kind: NodeKind): number {
  if (node.kind === kind && (!node.children || SEALED.includes(kind))) return node.size;
  return (node.children ?? []).reduce((a, c) => a + sumKind(c, kind), 0);
}

export async function fullReport(app: string): Promise<Report> {
  const t0 = Date.now();
  const b = await basics(app);
  const contents = b.contents;
  const w: Walk = { helpers: [], localizations: new Set(), files: 0 };

  const [s, ents, signing, rawTree] = await Promise.all([
    detectStack(b),
    entitlementsOf(app),
    signingOf(app, true),
    walk(app, path.basename(app), undefined, 0, w, ""),
  ]);
  const tree = prune(rawTree, rawTree.size, 0);

  const electron = s.stack === "electron" || s.stack === "chromium";
  const [npm, versions] = await Promise.all([
    s.stack === "electron" ? electronPackages(app).catch(() => undefined) : Promise.resolve(undefined),
    electron && s.engineDir ? electronVersions(s.engineDir) : Promise.resolve(undefined),
  ]);

  // Frameworks with sizes.
  const fwDir = path.join(contents, "Frameworks");
  const fwNode = rawTree.children?.find((n) => n.name === "Contents")?.children?.find((n) => n.name === "Frameworks");
  const frameworks = (fwNode?.children ?? [])
    .filter((n) => n.size > 0)
    .map((n) => ({
      name: n.name,
      size: n.size,
      thirdParty: SDKS.some((r) => r.frameworks?.test(n.name)) || /^(Electron|Squirrel|Mantle|ReactiveObjC|Flutter|Qt|Chromium|libffmpeg)/.test(n.name),
    }))
    .sort((a, b2) => b2.size - a.size);

  // Domain scan targets: main executable, app JavaScript, first-party frameworks.
  const targets: string[] = [];
  if (b.exec) targets.push(b.exec);
  if (await exists(path.join(contents, "Resources", "app.asar"))) targets.push(path.join(contents, "Resources", "app.asar"));
  const engineName = s.engineDir ? path.basename(s.engineDir) : "";
  for (const f of frameworks.filter((f) => f.name.endsWith(".framework") && f.name !== engineName).slice(0, 8)) {
    const bin = path.join(fwDir, f.name, "Versions", "Current", f.name.replace(/\.framework$/, ""));
    if (await exists(bin)) targets.push(bin);
  }
  const domains = await scanDomains(targets);

  // SDKs.
  const sdks: Sdk[] = [];
  const seen = new Set<string>();
  const addSdk = (rule: (typeof SDKS)[number], evidence: string) => {
    if (seen.has(rule.name)) return;
    seen.add(rule.name);
    sdks.push({ name: rule.name, category: rule.category, evidence });
  };
  for (const rule of SDKS) {
    const f = rule.frameworks && b.frameworks.find((x) => rule.frameworks!.test(x));
    if (f) { addSdk(rule, `Contents/Frameworks/${f}`); continue; }
    const p = rule.npm && npm?.packages.find((x) => rule.npm!.test(x.name));
    if (p) { addSdk(rule, `npm package ${p.name}${p.version ? "@" + p.version : ""}`); continue; }
    const d = domains.find((x) => x.sdk === rule.name);
    if (d) addSdk(rule, `references ${d.host}`);
  }

  // Permissions and entitlements.
  const permissions: Permission[] = Object.entries(b.info)
    .filter(([k, v]) => k.endsWith("UsageDescription") && typeof v === "string")
    .map(([k, v]) => ({ key: k, label: PRIVACY_LABELS[k] ?? k.replace(/^NS|UsageDescription$/g, "").replace(/([a-z])([A-Z])/g, "$1 $2"), reason: v as string }))
    .sort((a, b2) => rank(a.label) - rank(b2.label));

  const entitlements: Entitlement[] = Object.entries(ents)
    .map(([key, v]) => ({
      key,
      label: ENTITLEMENTS[key]?.label,
      value: typeof v === "boolean" ? String(v) : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v),
      risky: !!ENTITLEMENTS[key]?.risky && v !== false,
    }))
    .sort((a, b2) => Number(b2.risky) - Number(a.risky) || a.key.localeCompare(b2.key));

  const urlSchemes = ((b.info.CFBundleURLTypes as { CFBundleURLSchemes?: string[] }[] | undefined) ?? [])
    .flatMap((t) => t.CFBundleURLSchemes ?? []);
  const documentTypes = ((b.info.CFBundleDocumentTypes as { CFBundleTypeName?: string }[] | undefined) ?? [])
    .map((t) => t.CFBundleTypeName ?? "").filter(Boolean);

  const sandboxed = ents["com.apple.security.app-sandbox"] === true;
  const engineBytes = s.engineDir ? sumDir(rawTree, s.engineDir, app) : 0;
  const quick: QuickReport = {
    path: app,
    name: b.name,
    bundleId: str(b.info.CFBundleIdentifier),
    version: str(b.info.CFBundleShortVersionString) ?? str(b.info.CFBundleVersion),
    stack: s.stack,
    stackLabel: s.detections[0]?.label ?? STACK_LABELS[s.stack],
    archs: b.archs,
    sizeBytes: rawTree.size,
    engineBytes,
    sandboxed,
  };

  const report: Report = {
    ...quick,
    minOS: str(b.info.LSMinimumSystemVersion),
    copyright: str(b.info.NSHumanReadableCopyright),
    verdict: [],
    findings: [],
    stackDetections: s.detections,
    languages: s.languages,
    signing,
    permissions,
    entitlements,
    urlSchemes: [...new Set(urlSchemes)],
    documentTypes: [...new Set(documentTypes)],
    sdks,
    domains,
    frameworks,
    helpers: w.helpers,
    npm,
    electron: versions,
    localizations: [...w.localizations].filter((l) => l !== "Base").sort(),
    tree,
    fileCount: w.files,
    analyzedMs: 0,
  };
  report.verdict = verdictFor(report, s);
  report.findings = findingsFor(report, rawTree);
  report.analyzedMs = Date.now() - t0;
  return report;
}

function sumDir(root: BundleNode, dir: string, app: string): number {
  const parts = path.relative(app, dir).split(path.sep);
  let node: BundleNode | undefined = root;
  for (const p of parts) node = node?.children?.find((c) => c.name === p);
  return node?.size ?? 0;
}

function verdictFor(r: Report, s: StackResult): string[] {
  const n = r.name;
  const v: string[] = [];
  const rust = s.languages.some((l) => l.label === "Rust");
  const chromiumMajor = r.electron?.chromium?.split(".")[0];
  switch (r.stack) {
    case "electron":
      v.push(`${n} is a web app packaged with Electron${r.electron?.version ? " " + r.electron.version : ""}${chromiumMajor ? `, carrying its own copy of Chromium ${chromiumMajor}` : ""}.`);
      break;
    case "chromium":
      v.push(`${n} is built on its own copy of Chromium${chromiumMajor ? " " + chromiumMajor : ""}.`);
      break;
    case "webview":
      v.push(`${n} is a web interface running in the Mac's built-in WebKit${rust ? ", with a Rust core underneath" : ", with a Go core underneath"}.`);
      break;
    case "swiftui": v.push(`${n} is a native Mac app written in Swift with SwiftUI.`); break;
    case "swift": v.push(`${n} is a native Mac app written in Swift.`); break;
    case "objc": v.push(`${n} is a native Mac app built on AppKit.`); break;
    case "catalyst": v.push(`${n} is an iPad app brought to the Mac with Mac Catalyst.`); break;
    case "ios": v.push(`${n} is an iPhone or iPad app running unmodified on the Mac.`); break;
    case "game-engine": v.push(`${n} is built with the ${r.stackLabel} game engine.`); break;
    case "unknown": v.push(`${n} doesn't match any stack Teardown recognizes.`); break;
    default: v.push(`${n} is a cross-platform app built with ${r.stackLabel}.`);
  }

  if (r.archs.includes("arm64") && r.archs.includes("x86_64")) v.push("It runs natively on both Apple silicon and Intel.");
  else if (r.archs.includes("arm64")) v.push("It runs natively on Apple silicon.");
  else if (r.archs.includes("x86_64") && process.arch === "arm64") v.push("It's Intel-only, so this Mac runs it through Rosetta translation.");

  const perms = [...new Set(r.permissions.map((p) => (/^(Bluetooth|Face ID|Home)/.test(p.label) ? p.label : p.label.toLowerCase())))];
  if (perms.length) v.push(`It can ask to use your ${joinList(perms)}.`);

  v.push(r.sandboxed ? "It runs inside Apple's App Sandbox." : "It isn't sandboxed, so only macOS permission prompts stand between it and your files.");

  const tracking = r.sdks.filter((x) => TRACKING.includes(x.category));
  if (tracking.length) v.push(`It ships ${tracking.length === 1 ? "one tracking SDK" : `${tracking.length} tracking SDKs`}: ${joinList(tracking.map((t) => t.name))}.`);
  if (r.domains.length) v.push(`Its code mentions ${r.domains.length} web address${r.domains.length === 1 ? "" : "es"}.`);
  return v;
}

function findingsFor(r: Report, raw: BundleNode): Finding[] {
  const f: Finding[] = [];
  const sg = r.signing;
  const appStore = /Mac App Store|Apple Mac OS Application Signing/.test(`${sg.gatekeeper} ${sg.authority}`);
  const system = /Apple System/.test(sg.gatekeeper ?? "");

  if (!sg.signed) f.push({ severity: "notable", title: "Not code signed", detail: "Nothing ties this app to a developer, and macOS can't tell if it was modified." });
  else if (sg.adhoc) f.push({ severity: "notable", title: "Signed ad hoc", detail: "The signature has no developer identity behind it." });

  if (sg.signed && !sg.adhoc && !sg.hardenedRuntime && !appStore && !system) {
    f.push({ severity: "notable", title: "Hardened runtime off", detail: "Other processes have an easier time injecting code into it." });
  }

  for (const e of r.entitlements.filter((e) => e.risky)) {
    f.push({ severity: "notable", title: e.label ?? e.key, detail: RISK_WHY[e.key] ?? "This entitlement loosens one of macOS's protections.", evidence: e.key });
  }

  if (r.archs.length && !r.archs.includes("arm64") && process.arch === "arm64") {
    f.push({ severity: "notable", title: "Intel-only", detail: "It runs through Rosetta translation on this Mac, which costs speed and battery.", evidence: `lipo: ${r.archs.join(", ")}` });
  }

  for (const sdk of r.sdks) {
    if (sdk.category === "session recording") f.push({ severity: "notable", title: `Session recording with ${sdk.name}`, detail: "This kind of SDK can capture what you do inside the app.", evidence: sdk.evidence });
    else if (TRACKING.includes(sdk.category)) f.push({ severity: "notable", title: `${sdk.category === "analytics" ? "Usage analytics" : sdk.category === "ads" ? "Ad SDK" : "Install attribution"} with ${sdk.name}`, detail: sdk.category === "analytics" ? "Reports how you use the app back to its developer." : sdk.category === "ads" ? "Code from an advertising network is bundled in." : "Tracks where installs came from.", evidence: sdk.evidence });
  }

  if (r.helpers.some((h) => h.kind === "System extension")) f.push({ severity: "notable", title: "Installs a system extension", detail: "Part of it runs below normal apps, with deeper access to the system." });
  const bg = r.helpers.filter((h) => h.kind === "Login item" || h.kind === "Privileged helper");
  if (bg.length) f.push({ severity: "info", title: "Can run in the background", detail: `It ships ${joinList(bg.map((h) => h.name))}, which can start without the app open.` });

  if (r.engineBytes > 0) {
    f.push({ severity: "info", title: "Brings its own browser engine", detail: `Chromium takes up ${formatBytes(r.engineBytes)}, ${Math.round((r.engineBytes / r.sizeBytes) * 100)}% of the app. Every app built this way carries a separate copy.` });
  }
  const modelBytes = sumKind(raw, "model");
  if (modelBytes > 20e6) f.push({ severity: "info", title: "Ships machine learning models", detail: `${formatBytes(modelBytes)} of model files run on this Mac.` });

  for (const sdk of r.sdks.filter((x) => x.category === "crash reporting")) {
    f.push({ severity: "info", title: `Crash reports go to ${sdk.name}`, detail: "When it crashes, diagnostic data is sent to this service.", evidence: sdk.evidence });
  }

  if (sg.notarized && !system) f.push({ severity: "good", title: appStore ? "From the Mac App Store" : "Notarized by Apple", detail: appStore ? "Apple reviewed this build before listing it." : "Apple scanned this build for known malware before it shipped.", evidence: sg.gatekeeper });
  if (system) f.push({ severity: "good", title: "Part of macOS", detail: "Apple ships and signs this app with the system.", evidence: sg.gatekeeper });
  if (sg.hardenedRuntime) f.push({ severity: "good", title: "Hardened runtime on", detail: "Code injection and memory tampering are blocked by default." });
  if (r.sandboxed) f.push({ severity: "good", title: "Sandboxed", detail: "It can only reach files and devices it was granted." });

  const order = { notable: 0, info: 1, good: 2 };
  return f.sort((a, b) => order[a.severity] - order[b.severity]);
}
