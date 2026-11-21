package com.nova.roleplay;

import android.content.ComponentName;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/* The launcher icon follows the skin. Each icon is a launcher entry in the
   manifest (an activity-alias of NovaActivity); this leaves on only the one
   for the skin worn, so the home screen and app drawer show its icon. The
   app keeps running: DONT_KILL_APP. Some launchers take a few seconds to
   redraw, and an icon pinned to a home screen may need pinning again. */
@CapacitorPlugin(name = "NovaIcon")
public class NovaIconPlugin extends Plugin {

    /* skin id -> launcher entry; any other skin wears Nova's icon */
    private static final String[][] ICONS = {
        { "nova", ".MainActivity" },
        { "minimal", ".IconMinimal" },
        { "aero", ".IconAero" },
    };

    @PluginMethod
    public void set(PluginCall call) {
        String skin = call.getString("skin", "nova");
        String want = ICONS[0][1];
        for (String[] icon : ICONS) if (icon[0].equals(skin)) want = icon[1];
        PackageManager pm = getContext().getPackageManager();
        String pkg = getContext().getPackageName();
        boolean changed = false;
        /* the wanted one on first, so there is never a moment with none */
        for (int pass = 0; pass < 2; pass++) {
            for (String[] icon : ICONS) {
                boolean on = icon[1].equals(want);
                if (on != (pass == 0)) continue;
                ComponentName c = new ComponentName(pkg, pkg + icon[1]);
                int state = on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
                int now = pm.getComponentEnabledSetting(c);
                boolean isOn = now == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                    || (now == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && icon[1].equals(".MainActivity"));
                if (isOn == on) continue;
                pm.setComponentEnabledSetting(c, state, PackageManager.DONT_KILL_APP);
                changed = true;
            }
        }
        JSObject out = new JSObject();
        out.put("changed", changed);
        call.resolve(out);
    }
}
