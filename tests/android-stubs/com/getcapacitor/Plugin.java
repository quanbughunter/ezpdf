package com.getcapacitor;
import android.content.Context;
import android.content.Intent;
public class Plugin {
    public void load() {}
    public void startActivityForResult(PluginCall call, Intent intent, String callbackName) {}
    public Context getContext() { return null; }
    public androidx.appcompat.app.AppCompatActivity getActivity() { return null; }
    protected void notifyListeners(String eventName, JSObject data, boolean retainUntilConsumed) {}
    protected void notifyListeners(String eventName, JSObject data) {}
    protected void handleOnNewIntent(Intent intent) {}
    protected void handleOnDestroy() {}
}
