package app.ezpdf;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
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
                DocumentsContract.deleteDocument(getContext().getContentResolver(), uri);
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
