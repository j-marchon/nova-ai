package com.nova.roleplay;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/* Update (src/lib/updates.js): downloads the release's APK into the cache and
   opens Android's installer on it, so updating is one tap on Install. The
   first time, Android asks to allow Nova to install apps; then Update is
   tapped again. Only Nova's own public releases are downloaded. */
@CapacitorPlugin(name = "NovaUpdate")
public class NovaUpdatePlugin extends Plugin {
    private static final String RELEASES = "https://github.com/j-marchon/nova-ai/releases/download/";

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith(RELEASES) || !url.endsWith(".apk")) {
            call.reject("Not a Nova release");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            allow.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(allow);
            JSObject out = new JSObject();
            out.put("permission", true);
            call.resolve(out);
            return;
        }
        new Thread(() -> {
            HttpURLConnection http = null;
            try {
                File dir = new File(getContext().getCacheDir(), "update");
                if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("no room to save the update");
                File apk = new File(dir, "Nova.apk");
                /* GitHub answers with a redirect to its file host, also https */
                http = (HttpURLConnection) new URL(url).openConnection();
                http.setInstanceFollowRedirects(true);
                http.setConnectTimeout(20000);
                http.setReadTimeout(30000);
                if (http.getResponseCode() != 200) throw new Exception("GitHub answered " + http.getResponseCode());
                long total = http.getContentLengthLong();
                long got = 0;
                int shown = -1;
                try (InputStream in = http.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[65536];
                    for (int n; (n = in.read(buf)) > 0; ) {
                        out.write(buf, 0, n);
                        got += n;
                        int percent = total > 0 ? (int) (got * 100 / total) : 0;
                        if (percent != shown) {
                            shown = percent;
                            JSObject p = new JSObject();
                            p.put("percent", percent);
                            notifyListeners("progress", p);
                        }
                    }
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent open = new Intent(Intent.ACTION_VIEW);
                open.setDataAndType(uri, "application/vnd.android.package-archive");
                open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(open);
                call.resolve(new JSObject());
            } catch (Exception e) {
                call.reject("Download failed: " + e.getMessage());
            } finally {
                if (http != null) http.disconnect();
            }
        }).start();
    }
}
