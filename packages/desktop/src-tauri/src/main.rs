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
    #[cfg(windows)]
    scheduling::keep_responsive();

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

/// Keeps the panel scheduled while a game is in the foreground.
///
/// Windows favours the foreground window. With a game focused, the panel and
/// the WebView2 processes that draw it run at normal priority, and Windows 11
/// can also put them in efficiency mode, which slows them down further. A
/// heavy game then takes the processor time they need, and the panel stops
/// updating.
///
/// This raises the panel and every WebView2 process under it to above-normal
/// priority, and opts each one out of power throttling. WebView2 starts its
/// processes after the window opens and restarts them after a crash, so a
/// background thread repeats the pass every few seconds. Above normal, not
/// high: the game still comes first for anything it is actively doing.
#[cfg(windows)]
mod scheduling {
    use std::{collections::HashMap, mem::size_of, thread, time::Duration};

    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcessId, OpenProcess, ProcessPowerThrottling, SetPriorityClass,
        SetProcessInformation, ABOVE_NORMAL_PRIORITY_CLASS, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
        PROCESS_POWER_THROTTLING_STATE, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION,
    };

    const REPEAT: Duration = Duration::from_secs(5);

    pub fn keep_responsive() {
        let own = unsafe { GetCurrentProcessId() };
        boost(own);
        let _ = thread::Builder::new()
            .name("panel-scheduling".into())
            .spawn(move || loop {
                for pid in descendants(own) {
                    boost(pid);
                }
                thread::sleep(REPEAT);
            });
    }

    /// Every process started, directly or indirectly, by `root`.
    fn descendants(root: u32) -> Vec<u32> {
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return Vec::new();
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    children
                        .entry(entry.th32ParentProcessID)
                        .or_default()
                        .push(entry.th32ProcessID);
                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);
        }

        let mut found = Vec::new();
        let mut queue = vec![root];
        while let Some(pid) = queue.pop() {
            for &child in children.get(&pid).map(Vec::as_slice).unwrap_or(&[]) {
                // A process id can be reused by an unrelated process whose
                // recorded parent is a long-gone id matching ours, so guard
                // against walking in circles.
                if child != root && !found.contains(&child) {
                    found.push(child);
                    queue.push(child);
                }
            }
        }
        found
    }

    /// Raises one process's priority and turns off its power throttling.
    /// Failures are ignored: a process can exit between the snapshot and here.
    fn boost(pid: u32) {
        unsafe {
            let handle = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return;
            }
            SetPriorityClass(handle, ABOVE_NORMAL_PRIORITY_CLASS);

            // Control mask names the throttles being decided; a state mask of
            // zero says "off" for each of them.
            let state = PROCESS_POWER_THROTTLING_STATE {
                Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
                ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED
                    | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
                StateMask: 0,
            };
            SetProcessInformation(
                handle,
                ProcessPowerThrottling,
                &state as *const _ as *const core::ffi::c_void,
                size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
            );
            CloseHandle(handle);
        }
    }
}
