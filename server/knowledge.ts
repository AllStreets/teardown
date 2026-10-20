import type { SdkCategory, Stack } from "../shared/types.js";

export const STACK_LABELS: Record<Stack, string> = {
  electron: "Electron",
  chromium: "Chromium",
  webview: "Web view",
  flutter: "Flutter",
  qt: "Qt",
  java: "Java",
  dotnet: ".NET",
  python: "Python",
  "game-engine": "Game engine",
  catalyst: "Mac Catalyst",
  ios: "iPhone app",
  swiftui: "SwiftUI",
  swift: "Swift",
  objc: "Objective-C",
  unknown: "Unknown",
};

// Stacks that ship their own copy of a browser engine.
export const WEB_STACKS: Stack[] = ["electron", "chromium", "webview"];

interface SdkRule {
  name: string;
  category: SdkCategory;
  frameworks?: RegExp;
  npm?: RegExp;
  domains?: string[];
}

export const SDKS: SdkRule[] = [
  { name: "Sentry", category: "crash reporting", frameworks: /^Sentry/, npm: /^@sentry\//, domains: ["sentry.io", "sentry-cdn.com"] },
  { name: "Crashlytics", category: "crash reporting", frameworks: /^(FirebaseCrashlytics|Crashlytics)/, domains: ["crashlytics.com"] },
  { name: "Bugsnag", category: "crash reporting", frameworks: /^Bugsnag/, npm: /^@bugsnag\//, domains: ["bugsnag.com"] },
  { name: "Rollbar", category: "crash reporting", npm: /^rollbar/, domains: ["rollbar.com"] },
  { name: "App Center", category: "crash reporting", frameworks: /^AppCenter/, domains: ["appcenter.ms"] },
  { name: "Google Analytics", category: "analytics", frameworks: /^(FirebaseAnalytics|GoogleAppMeasurement)/, domains: ["google-analytics.com", "app-measurement.com", "googletagmanager.com"] },
  { name: "Firebase", category: "analytics", frameworks: /^Firebase(Core|Installations)/, npm: /^firebase$/, domains: ["firebaseio.com", "firebaselogging.googleapis.com", "firebaseinstallations.googleapis.com"] },
  { name: "Segment", category: "analytics", frameworks: /^Segment/, npm: /^(@segment\/|analytics-node)/, domains: ["segment.io", "segment.com"] },
  { name: "Mixpanel", category: "analytics", frameworks: /^Mixpanel/, npm: /^mixpanel/, domains: ["mixpanel.com"] },
  { name: "Amplitude", category: "analytics", frameworks: /^Amplitude/, npm: /^(@amplitude\/|amplitude-js)/, domains: ["amplitude.com"] },
  { name: "PostHog", category: "analytics", frameworks: /^PostHog/, npm: /^posthog-/, domains: ["posthog.com"] },
  { name: "Heap", category: "analytics", npm: /^heap/, domains: ["heapanalytics.com", "heap.io"] },
  { name: "RudderStack", category: "analytics", npm: /^@?rudder/, domains: ["rudderstack.com", "rudderlabs.com"] },
  { name: "Statsig", category: "feature flags", npm: /^(@statsig\/|statsig-)/, domains: ["statsig.com", "statsigapi.net"] },
  { name: "LaunchDarkly", category: "feature flags", frameworks: /^LaunchDarkly/, npm: /^(launchdarkly|@launchdarkly\/)/, domains: ["launchdarkly.com"] },
  { name: "FullStory", category: "session recording", npm: /^@fullstory\//, domains: ["fullstory.com"] },
  { name: "LogRocket", category: "session recording", npm: /^logrocket/, domains: ["logrocket.com", "lr-ingest.io"] },
  { name: "Hotjar", category: "session recording", domains: ["hotjar.com"] },
  { name: "Datadog", category: "monitoring", frameworks: /^Datadog/, npm: /^@datadog\//, domains: ["datadoghq.com", "datadoghq.eu"] },
  { name: "New Relic", category: "monitoring", frameworks: /^NewRelic/, npm: /^newrelic/, domains: ["newrelic.com", "nr-data.net"] },
  { name: "AppsFlyer", category: "attribution", frameworks: /^AppsFlyer/, domains: ["appsflyer.com"] },
  { name: "Adjust", category: "attribution", frameworks: /^Adjust/, domains: ["adjust.com"] },
  { name: "Google Ads", category: "ads", domains: ["doubleclick.net", "googleadservices.com", "googlesyndication.com"] },
  { name: "Meta SDK", category: "ads", frameworks: /^FBSDK/, domains: ["graph.facebook.com", "connect.facebook.net"] },
  { name: "Intercom", category: "messaging", frameworks: /^Intercom/, npm: /^@intercom\//, domains: ["intercom.io", "intercomcdn.com"] },
  { name: "Braze", category: "messaging", frameworks: /^Braze/, npm: /^@braze\//, domains: ["braze.com", "appboy.com"] },
  { name: "Stripe", category: "payments", frameworks: /^Stripe/, npm: /^stripe/, domains: ["stripe.com"] },
  { name: "Paddle", category: "payments", frameworks: /^Paddle/, domains: ["paddle.com"] },
  { name: "RevenueCat", category: "payments", frameworks: /^(RevenueCat|Purchases)/, domains: ["revenuecat.com"] },
  { name: "Sparkle", category: "updates", frameworks: /^Sparkle/ },
  { name: "Squirrel", category: "updates", frameworks: /^Squirrel/ },
  { name: "electron-updater", category: "updates", npm: /^electron-updater$/ },
];

// Categories that collect data about the person using the app.
export const TRACKING: SdkCategory[] = ["analytics", "session recording", "attribution", "ads"];

// Domains that appear in binaries as schema or doc identifiers, not network calls.
export const NOISE_DOMAINS = [
  "w3.org", "www.w3.org", "apple.com/DTDs", "purl.org", "xml.org", "ns.adobe.com", "json-schema.org",
  "example.com", "example.org", "example.net", "localhost", "schemas.xmlsoap.org", "schemas.microsoft.com",
  "schemas.openxmlformats.org", "opensource.org", "www.apache.org", "apache.org", "gnu.org", "www.gnu.org",
  "xmlpull.org", "relaxng.org", "openoffice.org", "iptc.org", "unicode.org", "www.unicode.org",
  "mozilla.org/MPL", "creativecommons.org", "spdx.org", "ietf.org", "tools.ietf.org", "www.ietf.org",
  "www.iana.org", "iana.org", "stackoverflow.com", "developer.mozilla.org", "mathiasbynens.be", "mths.be",
  "web.dev", "nodejs.org", "code.google.com", "bugs.chromium.org", "crbug.com", "tc39.es", "whatwg.org",
  "npmjs.com", "npmjs.org", "wikipedia.org", "jsperf.com", "underscorejs.org", "lodash.com", "momentjs.com",
  "reactjs.org", "react.dev", "fb.me", "electronjs.org", "chromium.org", "developer.apple.com", "semver.org", "ocsp.apple.com", "crl.apple.com", "www.apple.com", "certs.apple.com",
];

export const PRIVACY_LABELS: Record<string, string> = {
  NSCameraUsageDescription: "Camera",
  NSMicrophoneUsageDescription: "Microphone",
  NSLocationUsageDescription: "Location",
  NSLocationWhenInUseUsageDescription: "Location",
  NSLocationAlwaysUsageDescription: "Location (always)",
  NSContactsUsageDescription: "Contacts",
  NSCalendarsUsageDescription: "Calendars",
  NSCalendarsFullAccessUsageDescription: "Calendars",
  NSRemindersUsageDescription: "Reminders",
  NSRemindersFullAccessUsageDescription: "Reminders",
  NSPhotoLibraryUsageDescription: "Photos",
  NSPhotoLibraryAddUsageDescription: "Photos (add only)",
  NSAppleEventsUsageDescription: "Other apps",
  NSBluetoothAlwaysUsageDescription: "Bluetooth",
  NSBluetoothPeripheralUsageDescription: "Bluetooth",
  NSSpeechRecognitionUsageDescription: "Speech recognition",
  NSDesktopFolderUsageDescription: "Desktop folder",
  NSDocumentsFolderUsageDescription: "Documents folder",
  NSDownloadsFolderUsageDescription: "Downloads folder",
  NSRemovableVolumesUsageDescription: "Removable drives",
  NSNetworkVolumesUsageDescription: "Network drives",
  NSSystemAdministrationUsageDescription: "Admin rights",
  NSLocalNetworkUsageDescription: "Local network",
  NSMotionUsageDescription: "Motion",
  NSHomeKitUsageDescription: "Home",
  NSFocusStatusUsageDescription: "Focus status",
  NSAudioCaptureUsageDescription: "System audio",
  NSScreenCaptureUsageDescription: "Screen",
  NSFaceIDUsageDescription: "Face ID",
};

interface EntitlementInfo {
  label: string;
  risky?: boolean;
}

export const ENTITLEMENTS: Record<string, EntitlementInfo> = {
  "com.apple.security.app-sandbox": { label: "Runs in the App Sandbox" },
  "com.apple.security.cs.disable-library-validation": { label: "Can load code signed by anyone", risky: true },
  "com.apple.security.cs.allow-unsigned-executable-memory": { label: "Can run unsigned code in memory", risky: true },
  "com.apple.security.cs.allow-jit": { label: "Can generate code at runtime (JIT)" },
  "com.apple.security.cs.allow-dyld-environment-variables": { label: "Accepts injected libraries via environment", risky: true },
  "com.apple.security.cs.disable-executable-page-protection": { label: "Executable memory protection off", risky: true },
  "com.apple.security.get-task-allow": { label: "Other processes can attach a debugger", risky: true },
  "com.apple.security.cs.debugger": { label: "Can debug other processes", risky: true },
  "com.apple.security.automation.apple-events": { label: "Can control other apps", risky: true },
  "com.apple.security.device.camera": { label: "Camera" },
  "com.apple.security.device.audio-input": { label: "Microphone" },
  "com.apple.security.device.microphone": { label: "Microphone" },
  "com.apple.security.device.usb": { label: "USB devices" },
  "com.apple.security.device.bluetooth": { label: "Bluetooth" },
  "com.apple.security.personal-information.location": { label: "Location" },
  "com.apple.security.personal-information.addressbook": { label: "Contacts" },
  "com.apple.security.personal-information.calendars": { label: "Calendars" },
  "com.apple.security.personal-information.photos-library": { label: "Photos" },
  "com.apple.security.network.client": { label: "Makes network connections" },
  "com.apple.security.network.server": { label: "Accepts network connections" },
  "com.apple.security.files.user-selected.read-write": { label: "Files you choose" },
  "com.apple.security.files.user-selected.read-only": { label: "Files you choose, read only" },
  "com.apple.security.files.downloads.read-write": { label: "Downloads folder" },
  "com.apple.security.files.all": { label: "All files", risky: true },
  "com.apple.security.temporary-exception.files.absolute-path.read-write": { label: "Sandbox exception: file paths", risky: true },
  "com.apple.security.temporary-exception.mach-lookup.global-name": { label: "Sandbox exception: system services", risky: true },
  "com.apple.security.temporary-exception.apple-events": { label: "Sandbox exception: control apps", risky: true },
  "com.apple.developer.endpoint-security.client": { label: "Watches every process on the system", risky: true },
  "com.apple.developer.system-extension.install": { label: "Installs system extensions", risky: true },
  "com.apple.developer.networking.networkextension": { label: "Network extension (VPN, filter)" },
  "com.apple.security.application-groups": { label: "Shares data with its other apps" },
  "keychain-access-groups": { label: "Keychain groups" },
  "com.apple.developer.icloud-container-identifiers": { label: "iCloud containers" },
  "com.apple.developer.team-identifier": { label: "Team identifier" },
  "com.apple.application-identifier": { label: "Application identifier" },
};
