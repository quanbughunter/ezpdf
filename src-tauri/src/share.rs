//! Sharing a finished PDF from the desktop app. The page sends the bytes of
//! the PDF the user asked to share (the same file "Xuất PDF" writes); they
//! are written to a temporary folder under the given name and then:
//!
//!  - copy:   the file goes on the clipboard (CF_HDROP, as Explorer's Copy
//!            does), so Ctrl V in Zalo, Telegram, Outlook or a mail web page
//!            attaches it                                           (Windows)
//!  - sheet:  Windows' share window (Outlook, Nearby Sharing, Phone Link and
//!            the apps that accept files)                           (Windows)
//!  - reveal: the folder opens with the file selected, to drag it anywhere
//!
//! Only the last few shared copies are kept (an e-mail draft may read its
//! attachment a while later, a paste may come later); copies older than a
//! day go when the app starts. Nothing is sent anywhere by ezPDF itself.

use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Where shared copies live: the system's temp folder, so Windows' own
/// clean-up applies too.
pub fn share_root() -> PathBuf {
    std::env::temp_dir().join("ezPDF-chia-se")
}

/// Copies kept in the share folder, the new one included.
const KEEP: usize = 3;

/// Copy folders (named by time in milliseconds), newest first.
fn copies(root: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(root)
        .map(|it| it.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    dirs.sort_by_key(|p| std::cmp::Reverse(p.file_name().and_then(|n| n.to_str()).and_then(|n| n.parse::<u128>().ok()).unwrap_or(0)));
    dirs
}

fn remove(p: &Path) {
    let _ = if p.is_dir() { std::fs::remove_dir_all(p) } else { std::fs::remove_file(p) };
}

/// Keeps the newest `keep` copies.
pub fn keep_newest(root: &Path, keep: usize) {
    for p in copies(root).into_iter().skip(keep) {
        remove(&p);
    }
}

/// At start-up: copies older than `age` are not needed any more.
pub fn remove_older_than(root: &Path, age: std::time::Duration) {
    let now = SystemTime::now();
    for p in copies(root) {
        let old = std::fs::metadata(&p).and_then(|m| m.modified()).map(|t| now.duration_since(t).unwrap_or_default() > age).unwrap_or(true);
        if old {
            remove(&p);
        }
    }
}

const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
    "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A file name every app accepts: no folder part, no character Windows
/// refuses, not a device name, ending in .pdf (or .docx: a Word file
/// shared from the Word screen), at most 120 characters.
pub fn safe_name(name: &str) -> String {
    let mut n: String = name
        .chars()
        .map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    n = n.trim().trim_end_matches(['.', ' ']).trim_start_matches('.').to_string();
    if n.is_empty() {
        n = "tai-lieu".into();
    }
    let ext = if n.to_lowercase().ends_with(".docx") { ".docx" } else { ".pdf" };
    if !n.to_lowercase().ends_with(ext) {
        n.push_str(ext);
    }
    let stem = &n[..n.len() - ext.len()];
    if RESERVED.iter().any(|r| stem.eq_ignore_ascii_case(r)) {
        n = format!("_{n}");
    }
    if n.chars().count() > 120 {
        let keep: String = n.chars().take(120 - ext.len()).collect();
        n = format!("{}{ext}", keep.trim_end_matches(['.', ' ']));
    }
    n
}

/// `%XX` escapes (the name travels in an HTTP header) back to UTF-8 text.
pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Writes `bytes` as `root/<time>/<name>`, keeping the last few earlier copies.
pub fn write_copy(root: &Path, name: &str, bytes: &[u8]) -> io::Result<PathBuf> {
    keep_newest(root, KEEP - 1);
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let dir = root.join(stamp.to_string());
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(safe_name(name));
    std::fs::write(&path, bytes)?;
    Ok(path)
}

/// Opens the folder with the file selected (Explorer), or the folder.
pub fn reveal(path: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer wants /select,"path" as one argument, quoted inside
        std::process::Command::new("explorer.exe").raw_arg(format!("/select,\"{}\"", path.display())).spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        let mut child = std::process::Command::new("open").arg("-R").arg(path).spawn()?;
        std::thread::spawn(move || child.wait());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut child = std::process::Command::new("xdg-open").arg(path.parent().unwrap_or(path)).spawn()?;
        std::thread::spawn(move || child.wait());
    }
    Ok(())
}

#[cfg(windows)]
pub mod win {
    use std::cell::Cell;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use windows::core::{w, AgileReference, Interface, HSTRING};
    use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
    use windows::Foundation::TypedEventHandler;
    use windows::Storage::{IStorageItem, StorageFile};
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HWND};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT};
    use windows::Win32::System::Ole::{CF_HDROP, DROPEFFECT_COPY};
    use windows::Win32::UI::Shell::{IDataTransferManagerInterop, DROPFILES};
    use windows_collections::IIterable;

    /// Puts `bytes` on the clipboard as a global memory block in `format`.
    unsafe fn set_global(format: u32, bytes: &[u8]) -> windows::core::Result<()> {
        unsafe {
            let h = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes.len())?;
            let p = GlobalLock(h) as *mut u8;
            if p.is_null() {
                let _ = GlobalFree(Some(h));
                return Err(windows::core::Error::from_thread());
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
            let _ = GlobalUnlock(h);
            // on success the clipboard owns the memory
            if let Err(e) = SetClipboardData(format, Some(HANDLE(h.0))) {
                let _ = GlobalFree(Some(h));
                return Err(e);
            }
            Ok(())
        }
    }

    /// The file on the clipboard the way Explorer's Copy puts it there.
    pub fn copy_file(hwnd: HWND, path: &Path) -> windows::core::Result<()> {
        // DROPFILES, then the path as UTF-16 ending in two NULs
        let header = std::mem::size_of::<DROPFILES>();
        let df = DROPFILES { pFiles: header as u32, fWide: true.into(), ..Default::default() };
        let mut block = vec![0u8; header];
        unsafe { std::ptr::copy_nonoverlapping(&df as *const DROPFILES as *const u8, block.as_mut_ptr(), header) };
        for u in path.as_os_str().encode_wide().chain([0u16, 0u16]) {
            block.extend_from_slice(&u.to_le_bytes());
        }
        unsafe {
            // another app may hold the clipboard for a moment
            let mut opened = OpenClipboard(Some(hwnd));
            for _ in 0..10 {
                if opened.is_ok() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(30));
                opened = OpenClipboard(Some(hwnd));
            }
            opened?;
            let result = (|| {
                EmptyClipboard()?;
                set_global(CF_HDROP.0 as u32, &block)?;
                // paste means copy, not move
                let effect = RegisterClipboardFormatW(w!("Preferred DropEffect"));
                if effect != 0 {
                    set_global(effect, &DROPEFFECT_COPY.0.to_le_bytes())?;
                }
                Ok(())
            })();
            let _ = CloseClipboard();
            result
        }
    }

    thread_local! {
        /// The DataRequested handler of the last share (UI thread only).
        static TOKEN: Cell<Option<i64>> = const { Cell::new(None) };
    }

    /// Windows' share window for the main window, offering this one file.
    /// Runs on the UI thread that owns `hwnd`.
    pub fn show_share_ui(hwnd: HWND, path: &Path, title: &str) -> windows::core::Result<()> {
        // Waiting on a WinRT operation must not happen on the UI thread (an STA:
        // the completion could need this very thread). Open the file on a helper
        // thread (MTA) and hand it back as an agile reference, which the
        // DataRequested handler (it must be Send) resolves when Windows asks.
        let owned = path.to_path_buf();
        let file: AgileReference<StorageFile> = std::thread::spawn(move || {
            let f = StorageFile::GetFileFromPathAsync(&HSTRING::from(owned.as_os_str()))?.join()?;
            AgileReference::new(&f)
        })
        .join()
        .map_err(|_| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))??;
        let interop = windows::core::factory::<DataTransferManager, IDataTransferManagerInterop>()?;
        let dtm: DataTransferManager = unsafe { interop.GetForWindow(hwnd)? };
        if let Some(t) = TOKEN.take() {
            let _ = dtm.RemoveDataRequested(t);
        }
        let title = HSTRING::from(title);
        let handler = TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(move |_, args| {
            let args = args.ok()?;
            let data = args.Request()?.Data()?;
            data.Properties()?.SetTitle(&title)?;
            let item: IStorageItem = file.resolve()?.cast()?;
            data.SetStorageItemsReadOnly(&IIterable::<IStorageItem>::from(vec![Some(item)]))?;
            Ok(())
        });
        TOKEN.set(Some(dtm.DataRequested(&handler)?));
        unsafe { interop.ShowShareUIForWindow(hwnd) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_safe() {
        assert_eq!(safe_name("Báo cáo 29/10: \"mới\"?.pdf"), "Báo cáo 29_10_ _mới__.pdf");
        assert_eq!(safe_name("..\\..\\x"), "_.._x.pdf");
        assert_eq!(safe_name("  "), "tai-lieu.pdf");
        assert_eq!(safe_name("con.pdf"), "_con.pdf");
        assert_eq!(safe_name("Отчёт. "), "Отчёт.pdf");
        let long = "Ă".repeat(300);
        let n = safe_name(&long);
        assert_eq!(n.chars().count(), 120);
        assert!(n.ends_with(".pdf"));
        assert_eq!(safe_name("Hợp đồng (ezPDF).docx"), "Hợp đồng (ezPDF).docx");
        assert_eq!(safe_name("nul.docx"), "_nul.docx");
        let w = safe_name(&format!("{}.docx", "Ơ".repeat(300)));
        assert_eq!(w.chars().count(), 120);
        assert!(w.ends_with(".docx"));
    }

    #[test]
    fn decodes_header_names() {
        assert_eq!(percent_decode("B%C3%A1o%20c%C3%A1o.pdf"), "Báo cáo.pdf");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn keeps_the_latest_copies() {
        let root = std::env::temp_dir().join("ezpdf-share-test");
        let _ = std::fs::remove_dir_all(&root);
        let mut made = vec![];
        for i in 0..5 {
            made.push(write_copy(&root, &format!("t{i}"), format!("%PDF-{i}").as_bytes()).unwrap());
            std::thread::sleep(std::time::Duration::from_millis(3));
        }
        assert!(!made[0].exists() && !made[1].exists());
        assert!(made[2].exists() && made[3].exists() && made[4].exists());
        assert_eq!(std::fs::read(&made[4]).unwrap(), b"%PDF-4");
        assert_eq!(made[4].file_name().unwrap(), "t4.pdf");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), KEEP);
        remove_older_than(&root, std::time::Duration::from_secs(3600));
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), KEEP, "recent copies stay at start-up");
        remove_older_than(&root, std::time::Duration::ZERO);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&root);
    }
}
