package com.nova.roleplay;

import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* finds Nova Bridge on the Wi-Fi; see NovaLanPlugin */
        registerPlugin(NovaLanPlugin.class);
        /* streams replies from services that refuse web pages; see NovaHttpPlugin */
        registerPlugin(NovaHttpPlugin.class);
        /* the back gesture, followed by the page as it happens; see NovaBackPlugin */
        registerPlugin(NovaBackPlugin.class);
        super.onCreate(savedInstanceState);
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
