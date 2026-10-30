//! ezPDF desktop shell. The whole editor is the web app in ../dist; this
//! side only hands it PDF files given on the command line ("Open with
//! ezPDF" in Explorer, a double click once ezPDF is the default PDF app),
//! keeps a single window, and shares a finished PDF when the user asks
//! (share.rs). Printing is the web page's own (window.print in WebView2).

mod share;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_fs::FsExt;

/// PDFs received from outside and not yet taken by the page.
#[derive(Default)]
struct LaunchFiles(Mutex<Vec<PathBuf>>);

/// PDF and Word (.docx) files among command-line arguments, as absolute paths.
fn pdf_args<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .map(|p| if p.is_relative() { cwd.join(p) } else { p })
        .filter(|p| {
            p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf") || e.eq_ignore_ascii_case("docx")) && p.is_file()
        })
        .filter_map(|p| std::path::absolute(p).ok())
        .collect()
}

/// Let the page read exactly these files (nothing else outside the app's
/// own folder), queue them and tell the page.
fn accept(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let scope = app.fs_scope();
    for p in &paths {
        if let Err(e) = scope.allow_file(p) {
            eprintln!("ezPDF: cannot allow {}: {e}", p.display());
        }
    }
    app.state::<LaunchFiles>().0.lock().unwrap().extend(paths);
    let _ = app.emit("ezpdf://launch-files", ());
}

#[tauri::command]
fn take_launch_files(state: tauri::State<'_, LaunchFiles>) -> Vec<String> {
    state
        .0
        .lock()
        .unwrap()
        .drain(..)
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// The ways this desktop can share, in the order the share menu lists them.
#[tauri::command]
fn share_ways() -> Vec<&'static str> {
    if cfg!(windows) {
        vec!["copy", "sheet", "reveal"]
    } else {
        vec!["reveal"]
    }
}

/// Shares the PDF in the request body (raw bytes) as the file named in the
/// `x-ezpdf-name` header (percent-encoded), the way in `x-ezpdf-way`.
/// Not async: it runs on the main thread, which the clipboard and Windows'
/// share window need.
#[tauri::command]
fn share_file(window: tauri::WebviewWindow, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Thiếu nội dung tệp để chia sẻ.".into());
    };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let name = header("x-ezpdf-name").map(|n| share::percent_decode(&n)).unwrap_or_else(|| "tai-lieu.pdf".into());
    let way = header("x-ezpdf-way").unwrap_or_default();
    let path = share::write_copy(&share::share_root(), &name, bytes).map_err(|e| format!("Không ghi được tệp tạm: {e}"))?;
    match way.as_str() {
        "reveal" => share::reveal(&path).map_err(|e| format!("Không mở được thư mục: {e}")),
        #[cfg(windows)]
        "copy" => {
            let hwnd = window.hwnd().map_err(|e| e.to_string())?;
            share::win::copy_file(hwnd, &path).map_err(|e| format!("Không chép được vào bộ nhớ tạm: {e}"))
        }
        #[cfg(windows)]
        "sheet" => {
            let hwnd = window.hwnd().map_err(|e| e.to_string())?;
            let title = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            share::win::show_share_ui(hwnd, &path, &title).map_err(|e| format!("Không mở được cửa sổ chia sẻ của Windows: {e}"))
        }
        _ => {
            let _ = &window;
            Err(format!("Máy này không chia sẻ được theo cách “{way}”."))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // A second "Open with ezPDF" goes to the window that is already open.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            accept(app, pdf_args(argv.into_iter().skip(1), Path::new(&cwd)));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(LaunchFiles::default())
        .invoke_handler(tauri::generate_handler![take_launch_files, share_ways, share_file])
        .setup(|app| {
            // copies shared more than a day ago are not needed any more
            share::remove_older_than(&share::share_root(), std::time::Duration::from_secs(24 * 3600));
            let cwd = std::env::current_dir().unwrap_or_default();
            accept(app.handle(), pdf_args(std::env::args().skip(1), &cwd));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ezPDF could not start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_existing_pdfs() {
        let dir = std::env::temp_dir().join("ezpdf-args-test");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.PDF"), b"%PDF").unwrap();
        std::fs::write(dir.join("b.txt"), b"x").unwrap();
        std::fs::write(dir.join("c.docx"), b"PK").unwrap();
        let got = pdf_args(
            ["a.PDF", "b.txt", "missing.pdf", "c.docx", "--flag"].map(String::from),
            &dir,
        );
        assert_eq!(got, vec![dir.join("a.PDF"), dir.join("c.docx")]);
    }
}
