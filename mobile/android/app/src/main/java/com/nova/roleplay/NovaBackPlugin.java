package com.nova.roleplay;

import androidx.activity.BackEventCompat;
import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/* Predictive back. Android 14+ shows the back gesture as it happens, and
   lets an app follow the finger with its own screens: this hands the gesture
   to the page as "start" (with the edge it came from), "progress" (0 to 1),
   "cancel" or "commit", and the page moves whatever is on top - a sheet, an
   editor, the chat - and reveals what is underneath. On older Android, and
   with three-button navigation, there is no gesture to follow and back
   arrives as a "commit" alone.

   The page turns it on only while there is something to go back to. Off,
   back goes on to Capacitor's own handling (and leaving the app). The
   callback is added on first use rather than at load, so it sits above the
   one Capacitor's App plugin adds and is asked first. */
@CapacitorPlugin(name = "NovaBack")
public class NovaBackPlugin extends Plugin {

    private OnBackPressedCallback callback;

    @PluginMethod
    public void setEnabled(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            if (callback == null) {
                callback = new OnBackPressedCallback(on) {
                    @Override
                    public void handleOnBackStarted(BackEventCompat e) {
                        JSObject o = new JSObject();
                        o.put("edge", e.getSwipeEdge() == BackEventCompat.EDGE_LEFT ? "left" : "right");
                        o.put("progress", e.getProgress());
                        notifyListeners("start", o);
                    }

                    @Override
                    public void handleOnBackProgressed(BackEventCompat e) {
                        JSObject o = new JSObject();
                        o.put("progress", e.getProgress());
                        notifyListeners("progress", o);
                    }

                    @Override
                    public void handleOnBackCancelled() {
                        notifyListeners("cancel", new JSObject());
                    }

                    @Override
                    public void handleOnBackPressed() {
                        notifyListeners("commit", new JSObject());
                    }
                };
                getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), callback);
            } else {
                callback.setEnabled(on);
            }
            call.resolve();
        });
    }
}
