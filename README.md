# Teardown

Teardown opens up the apps on your Mac and tells you what they're actually made of.

Pick any app and it reads the bundle on disk: which framework it's built on (Electron, SwiftUI, Qt, Flutter, Java and so on), how it's signed, what macOS lets it do, which privacy prompts it can show you and the developer's exact wording for each, the analytics and crash-reporting SDKs it ships, and every web address written into its code. The whole bundle is drawn as a radial map you can click into, so you can see where the bytes go.

The "Your Mac" view does this for every app you've installed at once. On my machine 28 of 73 apps turned out to be websites in a wrapper, carrying 23 separate copies of Chromium between them.

Everything runs locally. Teardown only reads files and runs Apple's own command line tools (`codesign`, `otool`, `lipo`, `plutil`, `spctl`). It never launches the apps it inspects and never sends anything anywhere.

## Running it

Needs macOS and Node 20 or newer. The Xcode command line tools provide `otool`.

```
npm install
npm run dev
```

Then open http://127.0.0.1:4711. The first pass over all your apps takes a minute; results are cached in `.cache/` and refreshed when an app updates.

## How it works

`server/analyze.ts` does the reading. Stack detection looks for concrete evidence, like `Electron Framework.framework`, a Chromium `icudtl.dat`, `FlutterMacOS.framework`, the Swift runtime in the main executable's linked libraries, or a Go build ID, and the UI shows that evidence next to every conclusion. Electron apps get their `app.asar` archive parsed directly to list the npm packages inside. SDKs are matched by bundled framework names, npm package names and known API hosts in `server/knowledge.ts`.

A web address showing up in the code means the app knows about it, not that it connects to it every time. Teardown says so in the interface.
