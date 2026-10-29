#!/usr/bin/env bash
# Cross-build the Windows desktop app from Linux, without an MSVC toolchain:
# Rust's x86_64-pc-windows-gnu target with MinGW-w64, the standard library
# built from source (-Zbuild-std). Produces a portable folder with
# ezPDF.exe and WebView2Loader.dll (no installer, so no file association;
# "Open with" still works by picking the exe). The proper installers come
# from `npx tauri build` on Windows or from CI (.github/workflows/build.yml).
#
# Needs (Ubuntu 24.04): rustc-1.91 cargo-1.91 rust-1.91-src
#   gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64, and the library sources at
#   /usr/lib/rust-1.91/lib/rustlib/src/rust/library. Debian strips the
#   Windows dependency from std's Cargo.toml: copy /usr/src/rustc-1.91.1/library,
#   add to its std/Cargo.toml
#     [target.'cfg(windows)'.dependencies.windows-targets]
#     path = "../windows_targets"
#   and link the copy there.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET=x86_64-pc-windows-gnu
export PATH="/usr/lib/rust-1.91/bin:$PATH"
export RUSTC_BOOTSTRAP=1
export CARGO_TARGET_DIR="$PWD/src-tauri/target-win"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc
export CC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-gcc
export CXX_x86_64_pc_windows_gnu=x86_64-w64-mingw32-g++
export AR_x86_64_pc_windows_gnu=x86_64-w64-mingw32-ar
export RC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-windres
cargo --version
# -Zbuild-std does not build the startup objects rustc links into every
# Windows image; build them from the same sources.
RT="$(rustc --print sysroot)/lib/rustlib/$TARGET/lib"
if [ ! -f "$RT/rsbegin.o" ]; then
  mkdir -p "$RT"
  SRC="$(rustc --print sysroot)/lib/rustlib/src/rust/library/rtstartup"
  for f in rsbegin rsend; do
    rustc --target "$TARGET" --emit=obj -C panic=abort -C overflow-checks=no -C opt-level=2 -o "$RT/$f.o" "$SRC/$f.rs"
  done
fi
npm run build:desktop
# what `tauri build` runs, minus its rustup check (this rustc has no rustup)
(cd src-tauri && cargo build --release --features tauri/custom-protocol --target "$TARGET" -Zbuild-std=std,panic_abort)
OUT=out/windows-portable/ezPDF
rm -rf "$OUT" && mkdir -p "$OUT"
cp "$CARGO_TARGET_DIR/$TARGET/release/ezpdf.exe" "$OUT/ezPDF.exe"
cp "$(find "$CARGO_TARGET_DIR/$TARGET/release/build" -path '*webview2-com-sys*/out/x64/WebView2Loader.dll' | head -1)" "$OUT/"
ls -la "$OUT"
