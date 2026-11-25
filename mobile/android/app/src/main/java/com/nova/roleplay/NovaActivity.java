package com.nova.roleplay;

import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class NovaActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* finds Nova Bridge on the Wi-Fi; see NovaLanPlugin */
        registerPlugin(NovaLanPlugin.class);
        /* streams replies from services that refuse web pages; see NovaHttpPlugin */
        registerPlugin(NovaHttpPlugin.class);
        /* the back gesture, followed by the page as it happens; see NovaBackPlugin */
        registerPlugin(NovaBackPlugin.class);
        /* the launcher icon follows the skin; see NovaIconPlugin */
        registerPlugin(NovaIconPlugin.class);
        /* Update downloads the APK and opens the installer; see NovaUpdatePlugin */
        registerPlugin(NovaUpdatePlugin.class);
        super.onCreate(savedInstanceState);
        /* a new app icon chosen last time: switch it now, while nothing is
           open, and come back through the new launcher entry */
        if (savedInstanceState == null && NovaIconPlugin.applyOnStart(this)) return;
    }

    /* A new system font size arrives here rather than restarting the app
       (fontScale is in the manifest's configChanges, so a streaming reply is
       not cut off). The WebView only reads the size when it is created, so
       hand it the new one. */
    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        WebView web = bridge != null ? bridge.getWebView() : null;
        if (web != null) web.getSettings().setTextZoom(Math.round(config.fontScale * 100));
    }
}
