// Teardown's Mac shell: starts the analysis engine as a sidecar, shows its UI in the system
// WebKit view, keeps watching from the menu bar when the window is closed, and turns the
// engine's alerts into macOS notifications. The same UI also works in any browser.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, Url, WindowEvent};

const PORT: u16 = 4710;
const BUNDLE_ID: &str = "com.allstreets.teardown";

struct Engine(Mutex<Option<Child>>);

fn engine_up() -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], PORT).into(), Duration::from_millis(200)).is_ok()
}

fn base() -> String {
    format!("http://127.0.0.1:{PORT}/")
}

// Brings the window back and, when given a route like "#/change/abc", opens that page.
fn show(app: &AppHandle, target: Option<&str>) {
    if let Some(w) = app.get_webview_window("main") {
        if let Some(t) = target {
            if let Ok(url) = Url::parse(&format!("{}{}", base(), t)) {
                let _ = w.navigate(url);
            }
        }
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn notify(app: AppHandle, title: String, body: String, target: String) {
    thread::spawn(move || {
        let response = mac_notification_sys::Notification::new()
            .title(&title)
            .message(&body)
            .wait_for_click(true)
            .send();
        if let Ok(mac_notification_sys::NotificationResponse::Click) = response {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || show(&handle, Some(&target)));
        }
    });
}

fn fetch_notices(since: i64) -> Option<Vec<serde_json::Value>> {
    let body = ureq::get(&format!("{}api/notifications?since={since}", base()))
        .timeout(Duration::from_secs(4))
        .call()
        .ok()?
        .into_string()
        .ok()?;
    serde_json::from_str::<Vec<serde_json::Value>>(&body).ok()
}

// Polls the engine for new alerts. The first poll only learns where the list ends, so old
// alerts are never replayed when the app starts.
fn watch_notices(app: AppHandle) {
    thread::spawn(move || {
        let _ = mac_notification_sys::set_application(BUNDLE_ID);
        let mut since: i64 = -1;
        loop {
            if let Some(list) = fetch_notices(since.max(0)) {
                let last = list.last().and_then(|n| n["id"].as_i64());
                if since < 0 {
                    since = last.unwrap_or(0);
                } else if !list.is_empty() {
                    since = last.unwrap_or(since);
                    if list.len() > 3 {
                        notify(app.clone(), format!("{} new alerts from Teardown", list.len()), "Updates and new apps are waiting in Changes.".into(), "#/changes".into());
                    } else {
                        for n in list {
                            notify(
                                app.clone(),
                                n["title"].as_str().unwrap_or("Teardown").to_string(),
                                n["body"].as_str().unwrap_or("").to_string(),
                                n["target"].as_str().unwrap_or("#/").to_string(),
                            );
                        }
                    }
                }
            }
            thread::sleep(Duration::from_secs(5));
        }
    });
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Engine(Mutex::new(None)))
        .setup(|app| {
            // Reuse an engine that is already running (for example `npm run dev`).
            if !engine_up() {
                let exe = std::env::current_exe()?;
                let dir = exe.parent().expect("app binary has a parent folder");
                let dist = app.path().resource_dir()?.join("dist");
                // Contents/MacOS/teardown -> the .app bundle, so the engine can set up launch at login.
                let bundle = dir.parent().and_then(|c| c.parent()).map(|b| b.to_path_buf()).unwrap_or_default();
                let child = Command::new(dir.join("teardown-engine"))
                    .env("TEARDOWN_PORT", PORT.to_string())
                    .env("TEARDOWN_DIST", dist)
                    .env("TEARDOWN_APP", bundle)
                    .spawn()?;
                *app.state::<Engine>().0.lock().unwrap() = Some(child);
            }

            let window = app.get_webview_window("main").expect("main window exists");
            // Opened at login: start quietly in the menu bar.
            if std::env::args().any(|a| a == "--hidden") {
                let _ = window.hide();
            }
            // Closing the window keeps Teardown watching from the menu bar.
            let w = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = w.hide();
                }
            });

            let open = MenuItem::with_id(app, "open", "Open Teardown", true, None::<&str>)?;
            let changes = MenuItem::with_id(app, "changes", "Recent changes", true, None::<&str>)?;
            let check = MenuItem::with_id(app, "check", "Check apps now", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Teardown", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &changes, &check, &sep, &quit])?;
            TrayIconBuilder::with_id("teardown")
                .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .icon_as_template(true)
                .tooltip("Teardown is watching your apps")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show(app, None),
                    "changes" => show(app, Some("#/changes")),
                    "check" => {
                        thread::spawn(|| {
                            let _ = ureq::post(&format!("{}api/changes/check", base())).timeout(Duration::from_secs(4)).call();
                        });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            thread::spawn(move || {
                let start = Instant::now();
                while !engine_up() && start.elapsed() < Duration::from_secs(20) {
                    thread::sleep(Duration::from_millis(100));
                }
                let _ = window.navigate(Url::parse(&base()).unwrap());
            });
            watch_notices(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Teardown");

    app.run(|handle, event| match event {
        // Clicking the Dock icon brings the window back.
        RunEvent::Reopen { .. } => show(handle, None),
        RunEvent::Exit => {
            if let Some(mut child) = handle.state::<Engine>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
        _ => {}
    });
}
