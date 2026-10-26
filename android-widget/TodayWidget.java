package app.emergenthealth;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Today at a glance: readiness, last night's sleep, steps, habits and the next
 * dose due — without opening anything.
 *
 * Same credentials as the other widgets: the per-device key the app writes into
 * Capacitor's SharedPreferences, so no session ever reaches native code and
 * revoking the key kills every widget at once.
 *
 * A metric with no reading shows a dash. This is the one surface where an
 * invented number would be believed without a second thought, so a ring that
 * was not worn must look like a ring that was not worn.
 */
public class TodayWidget extends AppWidgetProvider {

    private static final String PREFS_CAP   = "CapacitorStorage";
    private static final String CAP_API_KEY = "widget_api_key";
    private static final String CAP_APP_URL = "widget_app_url";

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) { periodicRefresh(context, "today", ids); }

    private static final String PREFS_WIDGETS = "emergy_widgets";
    private static final String PERIODIC_AT   = "periodic_at";
    /**
     * How often the widgets that read the server go to it on their own.
     *
     * Each of the three had its own half-hourly update, and Android fires
     * them independently, so with all three on a home screen the server's
     * database was woken up to six times an hour. It sleeps after five quiet
     * minutes and is billed for every minute awake, and between these and the
     * location uploads it never slept at all. One shared refresh an hour is
     * one wake-up an hour, and a tap on a widget still refreshes it at once.
     */
    private static final long PERIODIC_GAP_MS = 55 * 60_000L;

    /**
     * The periodic update for Today, Habits and Reminders, shared.
     *
     * Whichever update fires first once the gap has passed refreshes all
     * three; the rest skip. A widget id seen for the first time is drawn
     * regardless, since onUpdate is also how a newly placed widget gets its
     * first content, and skipping that would leave it blank for an hour.
     */
    static void periodicRefresh(Context ctx, String provider, int[] ids) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS_WIDGETS, Context.MODE_PRIVATE);
        String seenKey = "seen_" + provider;
        Set<String> seen = new HashSet<>(p.getStringSet(seenKey, new HashSet<String>()));
        boolean fresh = false;
        if (ids != null) for (int id : ids) fresh |= seen.add(String.valueOf(id));
        if (fresh) p.edit().putStringSet(seenKey, seen).apply();

        long now = System.currentTimeMillis();
        long last = p.getLong(PERIODIC_AT, 0L);
        // A clock set backwards would otherwise hold every refresh until it caught up.
        if (last == 0L || now < last || now - last >= PERIODIC_GAP_MS) {
            p.edit().putLong(PERIODIC_AT, now).apply();
            TodayWidget.refreshAll(ctx);
            HabitsWidget.refreshAll(ctx);
            RemindersWidget.refreshAll(ctx);
        } else if (fresh) {
            if ("today".equals(provider)) TodayWidget.refreshAll(ctx);
            else if ("habits".equals(provider)) HabitsWidget.refreshAll(ctx);
            else if ("reminders".equals(provider)) RemindersWidget.refreshAll(ctx);
        }
    }

    /** {apiKey, baseUrl} or null when the widget has not been set up yet. */
    private static String[] creds(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS_CAP, Context.MODE_PRIVATE);
        String key = p.getString(CAP_API_KEY, null);
        String url = p.getString(CAP_APP_URL, null);
        if (key == null || url == null) return null;
        return new String[]{ key, url.replaceAll("/+$", "") };
    }

    static void refreshAll(final Context context) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                AppWidgetManager mgr = AppWidgetManager.getInstance(context);
                int[] ids = mgr.getAppWidgetIds(new ComponentName(context, TodayWidget.class));
                if (ids == null || ids.length == 0) return;

                RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);

                Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    // Land on the screen this widget is about, not wherever
                    // the app happened to be left open.
                    launch.putExtra("eh_dest", "/dashboard");
                    views.setOnClickPendingIntent(R.id.today_root, PendingIntent.getActivity(
                            context, 920014, launch,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
                }

                String[] c = creds(context);
                if (c == null) {
                    // Nothing the user can act on in Settings any more — the app
                    // links the widgets itself on launch, so this is just "open me".
                    views.setTextViewText(R.id.today_status, "Open the app once");
                    pushAll(mgr, ids, views);
                    return;
                }

                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(c[1] + "/api/widget/today").openConnection();
                    conn.setRequestProperty("x-widget-key", c[0]);
                    conn.setRequestProperty("Accept", "application/json");
                    conn.setConnectTimeout(10000);
                    conn.setReadTimeout(10000);

                    int code = conn.getResponseCode();
                    if (code != 200) {
                        views.setTextViewText(R.id.today_status, code == 401 ? "Reconnect in app" : "Error " + code);
                        pushAll(mgr, ids, views);
                        return;
                    }

                    StringBuilder sb = new StringBuilder();
                    BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                    r.close();

                    JSONObject j = new JSONObject(sb.toString());

                    views.setTextViewText(R.id.today_readiness, intOrDash(j, "readiness"));
                    views.setTextViewText(R.id.today_sleep, sleepText(j));
                    views.setTextViewText(R.id.today_steps, stepsText(j));
                    views.setTextViewText(R.id.today_habits, habitsText(j));
                    views.setTextViewText(R.id.today_next, nextDoseText(j));
                    views.setTextViewText(R.id.today_status,
                            new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date()));
                    pushAll(mgr, ids, views);
                } catch (Exception e) {
                    views.setTextViewText(R.id.today_status, "Offline");
                    pushAll(mgr, ids, views);
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }

    private static void pushAll(AppWidgetManager mgr, int[] ids, RemoteViews views) {
        for (int id : ids) mgr.updateAppWidget(id, views);
    }

    private static String intOrDash(JSONObject j, String key) {
        if (j.isNull(key)) return "—";
        return String.valueOf(j.optInt(key));
    }

    private static String sleepText(JSONObject j) {
        if (j.isNull("sleepHours")) return "—";
        return String.format(Locale.getDefault(), "%.1fh", j.optDouble("sleepHours"));
    }

    private static String stepsText(JSONObject j) {
        if (j.isNull("steps")) return "—";
        int steps = j.optInt("steps");
        if (steps >= 1000) return String.format(Locale.getDefault(), "%.1fk", steps / 1000.0);
        return String.valueOf(steps);
    }

    private static String habitsText(JSONObject j) {
        int total = j.optInt("habitsTotal", 0);
        if (total <= 0) return "—";
        return j.optInt("habitsDone", 0) + "/" + total;
    }

    /** "20:00 Elicea", or a quiet line when nothing is due. */
    private static String nextDoseText(JSONObject j) {
        JSONObject next = j.optJSONObject("nextDose");
        if (next == null) return "No doses left today";
        return next.optString("time", "") + "  " + next.optString("name", "");
    }
}
