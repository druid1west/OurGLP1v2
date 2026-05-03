package com.ourglp1.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

import com.ourglp1.app.plugins.DiskSpacePlugin;

public class MainActivity extends BridgeActivity {

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    registerPlugin(DiskSpacePlugin.class); // Register the DiskSpace plugin
    super.onCreate(savedInstanceState);

    // ✅ Allow Chrome DevTools to attach in internal testing (release build)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && shouldEnableWebviewDebugging()) {
      WebView.setWebContentsDebuggingEnabled(true);
    }

    createReminderChannel();
  }

  private boolean shouldEnableWebviewDebugging() {
    try {
      android.content.pm.ApplicationInfo ai =
              getPackageManager().getApplicationInfo(getPackageName(),
                      android.content.pm.PackageManager.GET_META_DATA);
      return ai.metaData != null
              && ai.metaData.getBoolean("pc.enable_webview_debugging", false);
    } catch (Exception e) {
      return false;
    }
  }

  private void createReminderChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      String channelId = "reminders";
      CharSequence name = "Reminders";
      String description = "GLP-1 injection & health reminders";
      int importance = NotificationManager.IMPORTANCE_HIGH;

      NotificationChannel channel = new NotificationChannel(channelId, name, importance);
      channel.setDescription(description);
      channel.enableVibration(true);
      channel.enableLights(true);

      NotificationManager nm = getSystemService(NotificationManager.class);
      if (nm != null) {
        nm.createNotificationChannel(channel);
        Log.i("PC-Channel", "Created channel: " + channelId);
      } else {
        Log.w("PC-Channel", "NotificationManager was null; channel not created");
      }
    } else {
      Log.i("PC-Channel", "SDK < 26; channels not supported");
    }
  }
}
