package app.emergenthealth;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The alarms that make Emergy pop out, and the record of them.
 *
 * Android drops every alarm an app holds when the phone reboots and when the
 * package is replaced. Nothing re-arms them: the list is computed in the web
 * layer from server data, and that only runs when the app is opened — and then
 * only every thirty minutes. So a reboot silently switched this feature off
 * while the settings card went on saying "20 armed", which is the exact shape
 * of failure this app keeps finding and this feature was already caught by
 * once.
 *
 * So the full list is stored, not just the ids, and re-armed from storage by a
 * receiver on boot and after an update. The web layer stays the only thing
 * that decides *what* pops; this only remembers what it decided.
 *
 * Shared by the plugin and the receiver on purpose. The boot path has to arm
 * alarms exactly the way the working path does, and the surest way to get that
 * is for there to be one path.
 */
final class HeadPops {

    private static final String PREFS = "emergy_head_pops";
    /** Full records: [{i:id, a:whenMillis, m:message}, …] */
    private static final String LIST = "list";
    /** The id-only format this replaced. Read once, for installs that predate it. */
    private static final String LEGACY_IDS = "ids";

    private HeadPops() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static PendingIntent intentFor(Context ctx, int id, String message) {
        Intent intent = new Intent(ctx, HeadAlarmReceiver.class)
            .setAction(HeadAlarmReceiver.ACTION_POP)
            .putExtra(HeadAlarmReceiver.EXTRA_MESSAGE, message);
        return PendingIntent.getBroadcast(
            ctx, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean canScheduleExact(AlarmManager am) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
    }

    /**
     * Set alarms for every record still in the future, and remember them.
     * Returns how many were actually set.
     */
    static int arm(Context ctx, JSONArray pops) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return 0;

        JSONArray kept = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < pops.length(); i++) {
            JSONObject pop = pops.optJSONObject(i);
            if (pop == null) continue;
            int id = pop.optInt("i", pop.optInt("id", 0));
            long at = pop.optLong("a", pop.optLong("at", 0L));
            String message = pop.optString("m", pop.optString("message", ""));
            // Already gone. Dropped rather than fired at once, which is what an
            // alarm set for a moment in the past would otherwise do — and after
            // a reboot most of the stored list is exactly that.
            if (id == 0 || at <= now || message.isEmpty()) continue;

            PendingIntent pi = intentFor(ctx, id, message);
            if (canScheduleExact(am)) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                // "Alarms & reminders" not granted: still delivered, just not
                // to the minute. A late pop beats no pop.
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
            JSONObject record = new JSONObject();
            try {
                record.put("i", id);
                record.put("a", at);
                record.put("m", message);
                kept.put(record);
            } catch (Exception ignored) {
                // A record that won't serialise is armed but unremembered; it
                // still fires, it just won't survive the next reboot.
            }
        }
        prefs(ctx).edit().putString(LIST, kept.toString()).remove(LEGACY_IDS).apply();
        return kept.length();
    }

    /** Cancel everything we last armed and forget it. */
    static void cancelAll(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        SharedPreferences p = prefs(ctx);
        if (am != null) {
            for (int id : storedIds(p)) {
                try { am.cancel(intentFor(ctx, id, "")); } catch (Exception ignored) {}
            }
        }
        p.edit().remove(LIST).remove(LEGACY_IDS).apply();
    }

    /** Re-arm from storage — what boot and a package replacement need. */
    static int rearm(Context ctx) {
        try {
            String raw = prefs(ctx).getString(LIST, "");
            if (raw == null || raw.isEmpty()) return 0;
            return arm(ctx, new JSONArray(raw));
        } catch (Exception e) {
            return 0;
        }
    }

    private static int[] storedIds(SharedPreferences p) {
        try {
            String raw = p.getString(LIST, "");
            if (raw != null && !raw.isEmpty()) {
                JSONArray list = new JSONArray(raw);
                int[] ids = new int[list.length()];
                for (int i = 0; i < list.length(); i++) {
                    JSONObject pop = list.optJSONObject(i);
                    ids[i] = pop == null ? 0 : pop.optInt("i", 0);
                }
                return ids;
            }
        } catch (Exception ignored) {
            // Fall through to the old format below.
        }
        // Installs from before the full list was stored still have ids to cancel.
        String legacy = p.getString(LEGACY_IDS, "");
        if (legacy == null || legacy.isEmpty()) return new int[0];
        String[] parts = legacy.split(",");
        int[] ids = new int[parts.length];
        for (int i = 0; i < parts.length; i++) {
            try { ids[i] = Integer.parseInt(parts[i].trim()); } catch (Exception ignored) { ids[i] = 0; }
        }
        return ids;
    }
}
