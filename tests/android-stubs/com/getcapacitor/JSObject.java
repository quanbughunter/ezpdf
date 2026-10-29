package com.getcapacitor;
// Signatures copied from @capacitor/android 8.5.3 JSObject.java
public class JSObject extends org.json.JSONObject {
    public JSObject() { super(); }
    public JSObject put(String key, boolean value) { return this; }
    public JSObject put(String key, int value) { return this; }
    public JSObject put(String key, long value) { return this; }
    public JSObject put(String key, double value) { return this; }
    public JSObject put(String key, Object value) { return this; }
    public JSObject put(String key, String value) { return this; }
}
