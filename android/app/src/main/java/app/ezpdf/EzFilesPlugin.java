package app.ezpdf;

import android.app.Activity;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * ezPDF's access to documents outside the app, all through Android's
 * Storage Access Framework, so the app needs no storage permission:
 *
 *  - openDocument    system picker (ACTION_OPEN_DOCUMENT) for one PDF
 *  - createDocument  system "save as" (ACTION_CREATE_DOCUMENT)
 *  - openWrite/write/closeWrite  stream the exported bytes into that document
 *  - takeIncoming + "incoming" event  PDFs opened with ezPDF (ACTION_VIEW)
 *                    or shared to it (ACTION_SEND)
 *  - clearCaptures   delete the photos the camera app wrote for a scan
 *                    (Capacitor's file chooser has it save JPEG_*.jpg into the
 *                    app's own Pictures folder; they are photos of documents)
 *  - openCacheWrite  a file in the app's cache for the finished PDF the user
 *                    shares or prints (written with write/closeWrite); only
 *                    the last few stay (an app may read a shared file late)
 *  - shareFile       Android's share sheet (Zalo, Telegram, Gmail, Bluetooth…)
 *                    with that file, read-only through the FileProvider
 *  - printFile       Android's print screen with that file: printers found by
 *                    the phone's print services (Wi-Fi, Mopria, brand plug-ins),
 *                    or "Save as PDF"; the PDF is printed as is (vector)
 *
 * Documents are returned as content:// URIs; the page reads them through the
 * WebView's local server (Capacitor.convertFileSrc), which streams the bytes.
 */
@CapacitorPlugin(name = "EzFiles")
public class EzFilesPlugin extends Plugin {

    private static final String PDF = "application/pdf";

    private final List<JSObject> incoming = new ArrayList<>();
    private final Map<String, OutputStream> writers = new HashMap<>();
    private final Map<String, Uri> writerUris = new HashMap<>();

    // ---- documents handed to the app -------------------------------------

    /** Called for the launch intent too (BridgeActivity.load forwards it). */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null) return;
        // Reopened from the recent apps list: the intent is the old one, already handled.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        Uri uri = null;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri == null || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) return;
        JSObject doc = describe(uri);
        synchronized (incoming) {
            incoming.add(doc);
        }
        // The page asks for the list itself (takeIncoming) so nothing is lost
        // when this fires before it listens.
        notifyListeners("incoming", new JSObject());
    }

    @PluginMethod
    public void takeIncoming(PluginCall call) {
        JSArray files = new JSArray();
        synchronized (incoming) {
            for (JSObject doc : incoming) files.put(doc);
            incoming.clear();
        }
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    // ---- open ---------------------------------------------------------------

    @PluginMethod
    public void openDocument(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(PDF);
        startActivityForResult(call, intent, "openDocumentResult");
    }

    @ActivityCallback
    private void openDocumentResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = picked(result);
        if (uri == null) {
            call.resolve(cancelled());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("cancelled", false);
        ret.put("file", describe(uri));
        call.resolve(ret);
    }

    // ---- save ---------------------------------------------------------------

    @PluginMethod
    public void createDocument(PluginCall call) {
        String name = call.getString("name", "tai-lieu.pdf");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", PDF));
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "createDocumentResult");
    }

    @ActivityCallback
    private void createDocumentResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = picked(result);
        if (uri == null) {
            call.resolve(cancelled());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("cancelled", false);
        ret.put("file", describe(uri));
        call.resolve(ret);
    }

    @PluginMethod
    public void openWrite(PluginCall call) {
        String uriString = call.getString("uri");
        if (uriString == null) {
            call.reject("Thiếu địa chỉ tệp để ghi.");
            return;
        }
        Uri uri = Uri.parse(uriString);
        try {
            OutputStream out = getContext().getContentResolver().openOutputStream(uri, "w");
            if (out == null) throw new IOException("openOutputStream returned null");
            String handle = UUID.randomUUID().toString();
            synchronized (writers) {
                writers.put(handle, out);
                writerUris.put(handle, uri);
            }
            JSObject ret = new JSObject();
            ret.put("handle", handle);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Không mở được tệp để ghi: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        OutputStream out;
        synchronized (writers) {
            out = writers.get(call.getString("handle", ""));
        }
        if (out == null) {
            call.reject("Tệp đang ghi đã đóng.");
            return;
        }
        try {
            out.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject("Ghi tệp thất bại: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void closeWrite(PluginCall call) {
        String handle = call.getString("handle", "");
        boolean abort = Boolean.TRUE.equals(call.getBoolean("abort", false));
        OutputStream out;
        Uri uri;
        synchronized (writers) {
            out = writers.remove(handle);
            uri = writerUris.remove(handle);
        }
        if (out == null) {
            call.resolve();
            return;
        }
        try {
            out.flush();
            out.close();
        } catch (IOException e) {
            if (!abort) {
                call.reject("Không hoàn tất được tệp: " + e.getMessage(), e);
                return;
            }
        }
        if (abort && uri != null) {
            // Do not leave a half-written PDF behind.
            try {
                if ("file".equals(uri.getScheme())) new File(uri.getPath()).delete();
                else DocumentsContract.deleteDocument(getContext().getContentResolver(), uri);
            } catch (Exception ignored) {}
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (writers) {
            for (OutputStream out : writers.values()) {
                try {
                    out.close();
                } catch (IOException ignored) {}
            }
            writers.clear();
            writerUris.clear();
        }
        super.handleOnDestroy();
    }

    // ---- scan photos ---------------------------------------------------------

    @PluginMethod
    public void clearCaptures(PluginCall call) {
        int removed = 0;
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        File[] files = dir == null ? null : dir.listFiles();
        if (files != null) {
            for (File f : files) {
                String n = f.getName();
                if (f.isFile() && n.startsWith("JPEG_") && n.endsWith(".jpg") && f.delete()) removed++;
            }
        }
        JSObject ret = new JSObject();
        ret.put("removed", removed);
        call.resolve(ret);
    }

    // ---- share and print -----------------------------------------------------

    private File shareRoot() {
        return new File(getContext().getCacheDir(), "share");
    }

    private static void deleteTree(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteTree(c);
        f.delete();
    }

    /** Shared or printed copies kept: a mail draft or Bluetooth may read one a while later. */
    private static final int KEEP_SHARED = 3;

    /** Keeps the newest `keep` copies (folders named by time) and deletes the rest. */
    private static void pruneShared(File root, int keep) {
        File[] dirs = root.listFiles();
        if (dirs == null || dirs.length <= keep) return;
        java.util.Arrays.sort(dirs, new java.util.Comparator<File>() {
            @Override
            public int compare(File a, File b) {
                return b.getName().compareTo(a.getName()); // same length, newest first
            }
        });
        for (int i = keep; i < dirs.length; i++) deleteTree(dirs[i]);
    }

    /** A file name that every app accepts: no path, no reserved characters, ends in .pdf. */
    static String safeName(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        if (n.isEmpty()) n = "tai-lieu.pdf";
        if (!n.toLowerCase().endsWith(".pdf")) n = n + ".pdf";
        if (n.length() > 120) n = n.substring(0, 116) + ".pdf";
        return n;
    }

    /** Only files this plugin wrote under cache/share can be shared or printed. */
    private File sharedFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null) return null;
        try {
            File f = new File(path).getCanonicalFile();
            String root = shareRoot().getCanonicalPath() + File.separator;
            return f.getPath().startsWith(root) && f.isFile() ? f : null;
        } catch (IOException e) {
            return null;
        }
    }

    @PluginMethod
    public void openCacheWrite(PluginCall call) {
        String name = safeName(call.getString("name", "tai-lieu.pdf"));
        File root = shareRoot();
        pruneShared(root, KEEP_SHARED - 1);
        File dir = new File(root, String.valueOf(System.currentTimeMillis()));
        if (!dir.mkdirs()) {
            call.reject("Không tạo được thư mục tạm để chia sẻ.");
            return;
        }
        File file = new File(dir, name);
        try {
            OutputStream out = new FileOutputStream(file);
            String handle = UUID.randomUUID().toString();
            synchronized (writers) {
                writers.put(handle, out);
                writerUris.put(handle, Uri.fromFile(file));
            }
            JSObject ret = new JSObject();
            ret.put("handle", handle);
            ret.put("path", file.getAbsolutePath());
            call.resolve(ret);
        } catch (IOException e) {
            call.reject("Không ghi được tệp tạm: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        File file = sharedFile(call);
        if (file == null) {
            call.reject("Không còn tệp để chia sẻ.");
            return;
        }
        Activity activity = getActivity();
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(PDF);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, file.getName());
            // the receiving app may only read this one file, and only through this share
            send.setClipData(ClipData.newRawUri(file.getName(), uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "Gửi PDF");
            // not back to ezPDF itself (it accepts shared PDFs); Intent.EXTRA_EXCLUDE_COMPONENTS, API 24
            chooser.putExtra("android.intent.extra.EXCLUDE_COMPONENTS", new ComponentName[] { new ComponentName(getContext(), MainActivity.class) });
            activity.startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Không mở được bảng chia sẻ: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void printFile(final PluginCall call) {
        final File file = sharedFile(call);
        if (file == null) {
            call.reject("Không còn tệp để in.");
            return;
        }
        final String name = call.getString("name", file.getName());
        Integer n = call.getInt("pages", 0);
        final int pages = n == null ? 0 : n;
        final Activity activity = getActivity();
        // the print screen is started from the activity, on its UI thread
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    PrintManager pm = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                    if (pm == null) {
                        call.reject("Máy này không có dịch vụ in.");
                        return;
                    }
                    pm.print(name, new PdfFileAdapter(file, name, pages), new PrintAttributes.Builder().build());
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Không mở được màn hình in: " + e.getMessage(), e);
                }
            }
        });
    }

    /** Hands the finished PDF to the print service as it is; the service picks the pages asked for. */
    static class PdfFileAdapter extends PrintDocumentAdapter {
        private final File file;
        private final String name;
        private final int pages;

        PdfFileAdapter(File file, String name, int pages) {
            this.file = file;
            this.name = name;
            this.pages = pages;
        }

        @Override
        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes, CancellationSignal cancel, LayoutResultCallback callback, Bundle extras) {
            if (cancel.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(name)
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(pages > 0 ? pages : PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                .build();
            // the PDF does not depend on the paper or printer chosen
            callback.onLayoutFinished(info, oldAttributes == null);
        }

        @Override
        public void onWrite(final PageRange[] range, final ParcelFileDescriptor destination, final CancellationSignal cancel, final WriteResultCallback callback) {
            // called on the main thread: copy on a worker thread, answer on the main thread
            final Handler main = new Handler(Looper.getMainLooper());
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String error = null;
                    boolean cancelled = false;
                    try (InputStream in = new FileInputStream(file); OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                        byte[] buf = new byte[64 * 1024];
                        int r;
                        while ((r = in.read(buf)) >= 0) {
                            if (cancel.isCanceled()) {
                                cancelled = true;
                                break;
                            }
                            out.write(buf, 0, r);
                        }
                    } catch (IOException e) {
                        error = e.getMessage() == null ? "IOException" : e.getMessage();
                    }
                    final String err = error;
                    final boolean stop = cancelled;
                    main.post(new Runnable() {
                        @Override
                        public void run() {
                            if (stop) callback.onWriteCancelled();
                            else if (err != null) callback.onWriteFailed(err);
                            // all pages written: Android keeps only the range the user chose
                            else callback.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
                        }
                    });
                }
            }, "ezpdf-print").start();
        }
    }

    // ---- helpers ------------------------------------------------------------

    private static Uri picked(ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK) return null;
        Intent data = result.getData();
        return data == null ? null : data.getData();
    }

    private static JSObject cancelled() {
        JSObject ret = new JSObject();
        ret.put("cancelled", true);
        return ret;
    }

    /** uri, display name and size (when the provider knows it) */
    private JSObject describe(Uri uri) {
        JSObject doc = new JSObject();
        doc.put("uri", uri.toString());
        String name = null;
        long size = -1;
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int s = c.getColumnIndex(OpenableColumns.SIZE);
                if (n >= 0 && !c.isNull(n)) name = c.getString(n);
                if (s >= 0 && !c.isNull(s)) size = c.getLong(s);
            }
        } catch (Exception ignored) {
            // some providers refuse queries; the name falls back below
        }
        if (name == null || name.isEmpty()) {
            String last = uri.getLastPathSegment();
            name = last != null && last.toLowerCase().endsWith(".pdf") ? last : "tai-lieu.pdf";
        }
        doc.put("name", name);
        if (size >= 0) doc.put("size", size);
        return doc;
    }
}
