//! Keeps the panel scheduled while a game is in the foreground.
//!
//! Windows favours the foreground window. With a game focused, the panel and
//! the WebView2 processes that draw it run at normal priority, and Windows 11
//! can also put them in efficiency mode, which slows them down further. A
//! heavy game then takes the processor time they need, and the panel stops
//! updating.
//!
//! This raises the panel and every WebView2 process under it to above-normal
//! priority, and opts each one out of power throttling. WebView2 starts its
//! processes after the window opens and restarts them after a crash, so a
//! background thread repeats the pass every few seconds. Above normal, not
//! high: the game still comes first for anything it is actively doing.

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
