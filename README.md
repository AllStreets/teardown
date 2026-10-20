<p align="center">
  <img src="docs/banner.png" alt="Teardown: every app on your Mac, taken apart" />
</p>

<p align="center">
  <a href="#look-inside-any-app">Look inside</a>&nbsp;&nbsp;&nbsp;
  <a href="#your-whole-mac">Your Mac</a>&nbsp;&nbsp;&nbsp;
  <a href="#live">Live</a>&nbsp;&nbsp;&nbsp;
  <a href="#changes-and-rollback">Changes</a>&nbsp;&nbsp;&nbsp;
  <a href="#before-you-open-it">New apps</a>&nbsp;&nbsp;&nbsp;
  <a href="#permissions-youve-granted">Permissions</a>&nbsp;&nbsp;&nbsp;
  <a href="#startup">Startup</a>&nbsp;&nbsp;&nbsp;
  <a href="#clean-up">Clean up</a>&nbsp;&nbsp;&nbsp;
  <a href="#for-ai-agents">For agents</a>&nbsp;&nbsp;&nbsp;
  <a href="#privacy">Privacy</a>&nbsp;&nbsp;&nbsp;
  <a href="#build-it-yourself">Build it</a>
</p>

<br />

Most of the apps on your Mac are black boxes. You can't tell which ones are a website in a costume, which ones quietly ship three analytics SDKs, which ones can control your other apps, or what changed when one updated itself last night.

Teardown opens them up. It reads every installed app the way a reverse engineer would, then explains what it found in plain English, with the evidence beside every claim. Then it lets you act: roll back an update that added a tracker, take back a permission an app hasn't used in a year, stop a download before its first launch, or clear out what deleted apps left behind. It runs entirely on your Mac, with no account, no analytics and no server.

<p align="center">
  <img src="docs/demo.gif" alt="Teardown reading the Claude desktop app, exploring its bundle map, then opening Clean up" width="900" />
</p>

On the Mac in these screenshots, Teardown found that **20 of 74 apps are web pages in a wrapper**, carrying **21 separate copies of Chromium** (8.4 GB of them), and that **56 GB** could be freed without losing anything that matters.

<br />

## Look inside any app

<img src="docs/screens/teardown.png" alt="Teardown's view of the Claude desktop app" />

Pick an app and Teardown reads its bundle from the outside, without ever launching it. The first thing you see is a sentence, not a table: *Claude is a web app packaged with Electron 44.7.2, carrying its own copy of Chromium 152.*

The ring map shows where every byte goes, laid on a lightbox and labelled like an exploded-view diagram: leader lines run from the biggest parts out to their names, sizes and share of the app. Hover to see what any piece is, click to drill in, and the labels follow you down. Next to it, a short list of what actually matters about this app: a permission that loosens macOS's protections, an analytics SDK, a missing notarization, a login item that starts on its own.

Below that, four tabs go as deep as you want:

- **Built with:** the stack and languages, and the exact files that prove it.
- **Permissions:** every privacy prompt the app can show you, quoted in the developer's own words, and every entitlement Apple granted it.
- **Network:** each SDK that phones home, every web address written into the code, and what the app is connected to right now.
- **Inside:** frameworks by size, helper apps and extensions, and for Electron apps, every npm package in the archive.

## How it knows

<img src="docs/how-it-knows.svg" alt="Diagram: files and signatures in the app bundle lead to plain-language conclusions" />

Nothing is guessed from an app's name or reputation. Teardown looks for concrete evidence, like `Electron Framework.framework`, a Chromium `icudtl.dat`, `FlutterMacOS.framework`, the Swift runtime among the linked libraries, a Go build ID, or the hardened runtime flag in the code signature. Every conclusion in the interface links back to what it found.

## Your whole Mac

<img src="docs/screens/overview.png" alt="Every installed app grouped by how it's built" />

The home screen reads everything you've installed, filling in live as it goes, and groups the apps by how they're built. It's the fastest way to see how much of your Mac is native and how much is a browser in disguise.

## Live

<img src="docs/screens/live.png" alt="Apps with open network connections, matched against their own code" />

Live shows which apps are talking to the internet right now. Teardown resolves the addresses written into each app's code and matches them against its open connections, so you can see at a glance which traffic the app announced and which it didn't. It refreshes every few seconds.

## Changes and rollback

<img src="docs/screens/update-scene.png" alt="The update scene: the new version drawn over an outline of the old one, new parts labelled in amber, and a button to roll back" />
<p align="center"><sub>Shown with example data. The first real update Teardown caught on this Mac was its own, 0.2.0 to 0.3.0.</sub></p>

Teardown keeps a snapshot of every app. When one updates, it compares the new version with the last and shows what changed underneath: the new version is drawn over a dashed outline of the old one, and anything new glows amber with a label. It flags the changes that matter:

- a new analytics or session-recording SDK
- a new request for your camera, microphone, or location
- a different developer signing the app
- a dropped sandbox or a hardened runtime switched off
- Electron and Chromium upgrades, new frameworks, new npm packages, new web addresses

Release notes almost never mention any of that.

Every update can be undone. When Teardown records an app it keeps an APFS clone of it, which shares every block with the installed app and costs nothing until the app changes (an 8.8 GB app cloned in 35 MB of metadata). Roll back and the saved version takes the app's place, while the newer one goes to the Trash.

## Before you open it

<img src="docs/screens/arrivals.png" alt="Apps that arrived but were never opened, each with a verdict and buttons to open or trash it" />

macOS tags every downloaded app until it's opened once. Teardown watches for apps that arrived but never ran, reads them first, and tells you where they came from and what's inside. Open it, read the full teardown, or move it to the Trash before it does anything.

## Permissions you've granted

<img src="docs/screens/permissions.png" alt="Permissions page listing which apps can use the screen, microphone and camera, with buttons to take each back" />

What an app *can* ask for is in its bundle. What you actually *said yes to* is in macOS's own permission records, and Teardown reads those too: screen recording, microphone, camera, input monitoring, Full Disk Access, automation, and the rest, with when each app was last active. Take any permission back with one click, or all the ones belonging to apps you haven't touched in six months. Teardown uses Apple's `tccutil`, so the app simply has to ask again. Reading the records needs Full Disk Access; changing nothing needs you to press a button.

## Startup

<img src="docs/screens/startup.png" alt="Startup page listing background services with the app each belongs to and a switch to turn it off" />

Apps quietly install helpers that start at login or run before anyone logs in: updaters, license checkers, background daemons. Teardown lists every one, says which app it belongs to, whether it's running, whether it restarts itself, and flags the ones whose program was deleted long ago. Switch any of them off and it stays off after a restart; switch it back on and both steps are reversed. Nothing is deleted. Machine-wide items go through macOS's own password prompt.

## Notifications and the menu bar

Close the window and Teardown keeps watching from the menu bar. When an app updates with something notable, or a new app lands that you haven't opened, you get a macOS notification. Click it and Teardown opens on exactly that change.

## Clean up

<img src="docs/screens/cleanup.png" alt="Clean up page with caches, unused apps and leftovers" />

Clean up compares what's on disk with what's actually installed and shows the space you can get back:

- **Caches that rebuild themselves**, like npm, Homebrew, Xcode and Simulator caches.
- **Apps you've stopped using**, judged by when each app last touched its own data.
- **Leftovers** from apps you deleted long ago: settings, caches, web data.
- **Broken login items** that point at programs that no longer exist.

Nothing is ever deleted. Teardown moves what you pick to the Trash, so anything can go straight back, and apps that are open are skipped.

## For AI agents

Teardown ships an MCP server, so an assistant like Claude can use it as a tool: "which of my apps can record my screen?", "what changed in the last Slack update?", "what's talking to the internet right now?". It can also take a permission back or roll an app back, but only when you've agreed.

```sh
npm run build:mcp
claude mcp add teardown -- node "$(pwd)/build/teardown-mcp.mjs"
```

The server reads everything from the running Teardown engine, so open the app first. Tools: `list_apps`, `get_app`, `granted_permissions`, `recent_changes`, `live_connections`, `not_yet_opened`, `cleanup_summary`, `revoke_permission`, `rollback_app`.

## Where the data comes from

There is no AI inside Teardown. No model runs and nothing is generated. Every fact comes from reading files on your disk and running Apple's own command line tools, and the plain-English sentences are templates filled in with the measured values. You can check any of it yourself:

| Teardown says | Where it comes from | Check it yourself |
| --- | --- | --- |
| Built with Electron 44 | `Electron Framework.framework` in the bundle, version from its `Info.plist` | `ls "/Applications/Claude.app/Contents/Frameworks"` |
| Carries Chromium 152 | the `Chrome/…` version string inside that framework | `grep -a -o -m1 "Chrome/[0-9.]*" ".../Electron Framework"` |
| Hardened runtime on, notarized | the code signature | `codesign -dv --verbose=4 /Applications/Slack.app` and `spctl -a -vv /Applications/Slack.app` |
| Can ask for your microphone | `NSMicrophoneUsageDescription` in `Info.plist` | `plutil -p /Applications/Discord.app/Contents/Info.plist` |
| You allowed its microphone | macOS's TCC permission database | `sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db "select * from access"` |
| Talking to these servers now | open sockets | `lsof -i -n -P` |
| Not opened yet | the `com.apple.quarantine` flag | `xattr -p com.apple.quarantine <app>` |

## Privacy

<img src="docs/screens/settings.png" alt="Settings with the privacy policy, local data, and connection audit" />

Teardown reads files and runs Apple's own command line tools: `codesign`, `spctl`, `otool`, `lipo`, `plutil`, `mdls`, `lsof`, `xattr` and `tccutil`. It never launches or modifies the apps it inspects unless you press a button, and anything it removes goes to the Trash. Everything it keeps lives in `~/Library/Application Support/Teardown`, and Settings has buttons to clear it.

It also audits itself. The Connections section runs Teardown's own engine against its own process and shows that it holds no connections to the internet. You can hide any app from Teardown entirely, and it will leave that app and its data alone on every page.

## Build it yourself

There's no signed download, on purpose. Teardown is meant to be built from source you can read, so you never have to trust a binary from anyone, including me.

You'll need macOS 12 or later on Apple silicon, Node 22, Rust, and the Xcode command line tools.

```sh
git clone https://github.com/AllStreets/teardown.git
cd teardown
npm install
npm run app
```

That builds `Teardown.app` into `src-tauri/target/release/bundle/macos/`. Drag it to Applications. Because you built it yourself, macOS opens it without asking about the developer.

### Or run it in a browser

The same interface works in any browser, no Rust needed:

```sh
npm install
npm run dev
```

Then open http://127.0.0.1:4711. The first pass over every app takes about a minute. After that, only apps that changed are read again.

## How it's put together

| Part | What it does |
| --- | --- |
| `server/analyze.ts` | Reads a bundle: stack, signing, entitlements, privacy prompts, SDKs, web addresses, the size map |
| `server/history.ts` | Snapshots each app and compares versions when it updates |
| `server/network.ts` | Maps open sockets to apps and matches them against each app's code |
| `server/cleanup.ts` | Finds reclaimable space and moves things to the Trash |
| `server/versions.ts` | Keeps APFS clones of each app and rolls updates back |
| `server/arrivals.ts` | Finds downloaded apps that have never been opened |
| `server/permissions.ts` | Reads granted permissions and takes them back with `tccutil` |
| `server/startup.ts` | Lists launch agents and daemons and switches them with `launchctl` |
| `server/mcp.ts` | The MCP server for AI agents |
| `server/knowledge.ts` | Known SDKs, entitlements and privacy keys |
| `web/` | The React interface; the ring map is SVG laid out with `d3-hierarchy` |
| `src-tauri/` | The Mac app: a small Rust shell that runs the engine beside it, shows the interface in the system WebKit, lives in the menu bar and sends notifications |

The Mac app doesn't ship its own browser engine. Point Teardown at itself and it says so: *Teardown is a web interface running in the Mac's built-in WebKit, with a Rust core underneath.*

## License

MIT. Take it apart.
