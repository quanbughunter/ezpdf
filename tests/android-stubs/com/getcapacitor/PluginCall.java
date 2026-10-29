package com.getcapacitor;
public class PluginCall {
    public void resolve(JSObject data) {}
    public void resolve() {}
    public void reject(String msg, Exception ex) {}
    public void reject(String msg) {}
    public JSObject getData() { return null; }
    public String getString(String name) { return null; }
    public String getString(String name, String defaultValue) { return null; }
    public Boolean getBoolean(String name) { return null; }
    public Boolean getBoolean(String name, Boolean defaultValue) { return null; }
}
