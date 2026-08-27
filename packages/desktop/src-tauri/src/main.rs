// Prevents a console window appearing alongside the panel on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The native shell for the chat panel.
//!
//! Everything visual lives in the web page this window loads. The only reason
//! this exists is the two things a browser cannot do:
//!
//!   1. a genuinely transparent window, so a game shows through the gaps
//!   2. staying above a borderless-fullscreen game
//!
//! A browser tab can do neither, and a Document Picture-in-Picture window —
//! which can at least float on top — is composited opaquely, so the desktop
//! never shows through no matter what CSS says.
//!
//! The window is undecorated, so it has no system title bar: dragging,
//! minimising, closing and resizing are drawn by the page and routed back
//! through the Tauri window API.
//!
//! It is an ordinary interactive window. There was a click-through mode here,
//! with a cursor-polling loop to keep the window controls clickable through
//! it — Windows makes click-through all-or-nothing, so carving out exceptions
//! meant watching the mouse and flipping the flag as it moved. All of that
//! bought the ability to click a game *underneath* the panel, which turns out
//! to be far less useful than simply moving the panel.

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // Must be registered first, per the plugin's own requirement.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Launched again while already running: surface the window that
            // exists rather than starting a second panel.
            if let Some(window) = app.get_webview_window("chat") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("failed to start the chat panel");
}
