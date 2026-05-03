package com.ourglp1.app.plugins;

import android.os.Environment;
import android.os.StatFs;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DiskSpace")
public class DiskSpacePlugin extends Plugin {

  @PluginMethod
  public void getInfo(PluginCall call) {
    try {
      StatFs stat = new StatFs(Environment.getDataDirectory().getPath());

      JSObject ret = new JSObject();
      ret.put("availableBytes", stat.getAvailableBytes());
      ret.put("totalBytes", stat.getTotalBytes());

      call.resolve(ret);
    } catch (Exception e) {
      call.reject("Failed to read disk space", e);
    }
  }
}
