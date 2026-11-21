package com.nova.roleplay;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/* The launcher icon follows the skin. Each icon is a launcher entry in the
   manifest (an activity-alias of NovaActivity), and only the one for the
   skin is left on. Android closes a task whose entry is switched off, so
   the switch never happens while Nova is open: the skin's icon is noted
   here, and applied the next time Nova starts (NovaActivity.onCreate calls
   applyOnStart), which reopens Nova through the new entry before anything
   is drawn. */
@CapacitorPlugin(name = "NovaIcon")
public class NovaIconPlugin extends Plugin {

    /* skin id -> launcher entry; any other skin wears Nova's icon */
    private static final String[][] ICONS = {
        { "nova", ".MainActivity" },
        { "minimal", ".IconMinimal" },
        { "aero", ".IconAero" },
    };
    private static final String PREFS = "nova-icon";

    static String entryFor(String skin) {
        for (String[] icon : ICONS) if (icon[0].equals(skin)) return icon[1];
        return ICONS[0][1];
    }

    /* the launcher entry switched on now */
    static String current(Context ctx) {
        PackageManager pm = ctx.getPackageManager();
        String pkg = ctx.getPackageName();
        for (String[] icon : ICONS) {
            int s = pm.getComponentEnabledSetting(new ComponentName(pkg, pkg + icon[1]));
            if (s == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return icon[1];
            if (s == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && icon[1].equals(".MainActivity")) return icon[1];
        }
        return ICONS[0][1];
    }

    @PluginMethod
    public void set(PluginCall call) {
        String want = entryFor(call.getString("skin", "nova"));
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("entry", want).apply();
        JSObject out = new JSObject();
        out.put("pending", !want.equals(current(getContext())));
        call.resolve(out);
    }

    /* At a cold start: if the icon noted differs from the one on, switch the
       entries and reopen Nova through the new one. Returns true when this
       activity is finishing for that. */
    static boolean applyOnStart(Activity activity) {
        String want = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("entry", null);
        if (want == null || want.equals(current(activity))) return false;
        PackageManager pm = activity.getPackageManager();
        String pkg = activity.getPackageName();
        ComponentName next = new ComponentName(pkg, pkg + want);
        pm.setComponentEnabledSetting(next, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
        activity.finish();
        activity.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setComponent(next)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        for (String[] icon : ICONS) {
            if (icon[1].equals(want)) continue;
            pm.setComponentEnabledSetting(new ComponentName(pkg, pkg + icon[1]), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        }
        return true;
    }
}
