#[cfg(target_os = "windows")]
mod platform {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex, OnceLock,
        },
        thread::JoinHandle,
        time::Duration,
    };
    use tauri::{AppHandle, Manager};
    use windows_sys::Win32::{
        Foundation::{GetLastError, TRUE},
        UI::WindowsAndMessaging::{
            LoadCursorFromFileW, SetSystemCursor, SystemParametersInfoW, HCURSOR, SPIF_SENDCHANGE,
            SPIF_UPDATEINIFILE, SPI_SETCURSORS,
        },
    };

    const CURSOR_SIZE: u16 = 384;
    const HOTSPOT: u16 = 192;

    const CURSOR_SLOTS: [(&str, u32); 13] = [
        ("normal", 32512),      // OCR_NORMAL
        ("ibeam", 32513),       // OCR_IBEAM
        ("wait", 32514),        // OCR_WAIT
        ("cross", 32515),       // OCR_CROSS
        ("up", 32516),          // OCR_UP
        ("sizenwse", 32642),    // OCR_SIZENWSE
        ("sizenesw", 32643),    // OCR_SIZENESW
        ("sizewe", 32644),      // OCR_SIZEWE
        ("sizens", 32645),      // OCR_SIZENS
        ("sizeall", 32646),     // OCR_SIZEALL
        ("no", 32648),          // OCR_NO
        ("hand", 32649),        // OCR_HAND
        ("appstarting", 32650), // OCR_APPSTARTING
    ];

    struct CursorState {
        timer_stop: Option<Arc<AtomicBool>>,
        timer_thread: Option<JoinHandle<()>>,
        active: bool,
    }

    static CURSOR_STATE: OnceLock<Mutex<CursorState>> = OnceLock::new();

    pub fn enable(
        app: &AppHandle,
        cursor_theme_id_or_path: String,
        duration_ms: u64,
    ) -> Result<(), String> {
        let _ = restore();

        let theme_dir = resolve_theme_dir(app, &cursor_theme_id_or_path)?;
        ensure_lime_square_theme(&theme_dir)?;

        for (slot_name, cursor_id) in CURSOR_SLOTS {
            let cursor_path = theme_dir.join(format!("{slot_name}.cur"));
            let cursor = load_cursor_from_file(&cursor_path)?;
            let ok = unsafe { SetSystemCursor(cursor, cursor_id) };
            if ok != TRUE {
                return Err(format!(
                    "SetSystemCursor failed for {slot_name}: {}",
                    unsafe { GetLastError() }
                ));
            }
        }

        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let timer_thread = std::thread::spawn(move || {
            let mut elapsed = 0;
            while elapsed < duration_ms {
                if thread_stop.load(Ordering::Relaxed) {
                    return;
                }
                let step = 250.min(duration_ms - elapsed);
                std::thread::sleep(Duration::from_millis(step));
                elapsed += step;
            }
            let _ = restore();
        });

        let state = cursor_state();
        let mut state = state
            .lock()
            .map_err(|_| "cursor state poisoned".to_string())?;
        state.timer_stop = Some(stop);
        state.timer_thread = Some(timer_thread);
        state.active = true;
        Ok(())
    }

    pub fn restore() -> Result<(), String> {
        if let Some(state) = CURSOR_STATE.get() {
            let mut state = state
                .lock()
                .map_err(|_| "cursor state poisoned".to_string())?;
            if let Some(stop) = state.timer_stop.take() {
                stop.store(true, Ordering::Relaxed);
            }
            if let Some(handle) = state.timer_thread.take() {
                if handle.thread().id() != std::thread::current().id() {
                    let _ = handle.join();
                }
            }
            state.active = false;
        }

        let ok = unsafe {
            SystemParametersInfoW(
                SPI_SETCURSORS,
                0,
                std::ptr::null_mut(),
                SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
            )
        };
        if ok != TRUE {
            let error_code = unsafe { GetLastError() };
            if error_code != 0 {
                return Err(format!("SPI_SETCURSORS restore failed: {error_code}"));
            }
        }
        Ok(())
    }

    fn cursor_state() -> &'static Mutex<CursorState> {
        CURSOR_STATE.get_or_init(|| {
            Mutex::new(CursorState {
                timer_stop: None,
                timer_thread: None,
                active: false,
            })
        })
    }

    fn resolve_theme_dir(
        app: &AppHandle,
        cursor_theme_id_or_path: &str,
    ) -> Result<PathBuf, String> {
        let explicit_path = PathBuf::from(cursor_theme_id_or_path);
        if explicit_path.exists() {
            return Ok(explicit_path);
        }

        let base_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("app_data_dir failed: {error}"))?
            .join("cursor-themes");
        Ok(base_dir.join(cursor_theme_id_or_path))
    }

    fn ensure_lime_square_theme(theme_dir: &Path) -> Result<(), String> {
        fs::create_dir_all(theme_dir)
            .map_err(|error| format!("create cursor theme dir failed: {error}"))?;
        let cursor_bytes = build_lime_square_cur();
        for (slot_name, _) in CURSOR_SLOTS {
            let path = theme_dir.join(format!("{slot_name}.cur"));
            fs::write(&path, &cursor_bytes)
                .map_err(|error| format!("write cursor file failed: {error}"))?;
        }
        Ok(())
    }

    fn load_cursor_from_file(path: &Path) -> Result<HCURSOR, String> {
        let wide_path: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let cursor = unsafe { LoadCursorFromFileW(wide_path.as_ptr()) };
        if cursor.is_null() {
            return Err(format!(
                "LoadCursorFromFileW failed for {}: {}",
                path.display(),
                unsafe { GetLastError() }
            ));
        }
        Ok(cursor)
    }

    fn build_lime_square_cur() -> Vec<u8> {
        let width = CURSOR_SIZE as usize;
        let height = CURSOR_SIZE as usize;
        let xor_size = width * height * 4;
        let mask_stride = width.div_ceil(32) * 4;
        let mask_size = mask_stride * height;
        let bitmap_size = 40 + xor_size + mask_size;
        let image_offset = 6 + 16;
        let mut out = Vec::with_capacity(image_offset + bitmap_size);

        push_u16(&mut out, 0);
        push_u16(&mut out, 2);
        push_u16(&mut out, 1);
        out.push(0);
        out.push(0);
        out.push(0);
        out.push(0);
        push_u16(&mut out, HOTSPOT);
        push_u16(&mut out, HOTSPOT);
        push_u32(&mut out, bitmap_size as u32);
        push_u32(&mut out, image_offset as u32);

        push_u32(&mut out, 40);
        push_i32(&mut out, CURSOR_SIZE as i32);
        push_i32(&mut out, (CURSOR_SIZE * 2) as i32);
        push_u16(&mut out, 1);
        push_u16(&mut out, 32);
        push_u32(&mut out, 0);
        push_u32(&mut out, (xor_size + mask_size) as u32);
        push_i32(&mut out, 0);
        push_i32(&mut out, 0);
        push_u32(&mut out, 0);
        push_u32(&mut out, 0);

        for y in (0..height).rev() {
            for x in 0..width {
                let border = x < 9 || y < 9 || x >= width - 9 || y >= height - 9;
                if border {
                    out.extend_from_slice(&[255, 255, 255, 255]);
                } else {
                    out.extend_from_slice(&[132, 204, 22, 255]);
                }
            }
        }
        out.resize(out.len() + mask_size, 0);
        out
    }

    fn push_u16(out: &mut Vec<u8>, value: u16) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn push_u32(out: &mut Vec<u8>, value: u32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn push_i32(out: &mut Vec<u8>, value: i32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    trait EncodeWide {
        fn encode_wide(&self) -> std::os::windows::ffi::EncodeWide<'_>;
    }

    impl EncodeWide for std::ffi::OsStr {
        fn encode_wide(&self) -> std::os::windows::ffi::EncodeWide<'_> {
            use std::os::windows::ffi::OsStrExt;
            OsStrExt::encode_wide(self)
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use tauri::AppHandle;

    pub fn enable(
        _app: &AppHandle,
        _cursor_theme_id_or_path: String,
        _duration_ms: u64,
    ) -> Result<(), String> {
        Err("System cursor modifier is available only on Windows.".to_string())
    }

    pub fn restore() -> Result<(), String> {
        Ok(())
    }
}

pub fn enable(
    app: &tauri::AppHandle,
    cursor_theme_id_or_path: String,
    duration_ms: u64,
) -> Result<(), String> {
    platform::enable(app, cursor_theme_id_or_path, duration_ms)
}

pub fn restore_system_cursors() -> Result<(), String> {
    platform::restore()
}
