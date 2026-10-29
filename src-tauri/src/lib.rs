//! ezPDF desktop shell. The whole editor is the web app in ../dist; this
//! side only hands it PDF files given on the command line ("Open with
//! ezPDF" in Explorer, a double click once ezPDF is the default PDF app)
//! and keeps a single window.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_fs::FsExt;

/// PDFs received from outside and not yet taken by the page.
#[derive(Default)]
struct LaunchFiles(Mutex<Vec<PathBuf>>);

/// PDF files among command-line arguments, as absolute paths.
fn pdf_args<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .map(|p| if p.is_relative() { cwd.join(p) } else { p })
        .filter(|p| {
            p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) && p.is_file()
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
        .invoke_handler(tauri::generate_handler![take_launch_files])
        .setup(|app| {
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
        let got = pdf_args(
            ["a.PDF", "b.txt", "missing.pdf", "--flag"].map(String::from),
            &dir,
        );
        assert_eq!(got, vec![dir.join("a.PDF")]);
    }
}
