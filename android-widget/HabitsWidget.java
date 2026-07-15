package app.emergenthealth;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;

/** Home-screen Habits widget. Up to 5 of today's habits; tap a row to toggle
 *  completion via /api/widget/habits. Java for the Java-only app module. */
public class HabitsWidget extends AppWidgetProvider {

    static final String ACTION_TOGGLE  = "app.emergenthealth.TOGGLE_HABIT";
    static final String EXTRA_HABIT_ID = "habitId";
    static final String EXTRA_DONE     = "done";

    private static final String PREFS_CAP   = "CapacitorStorage";
    private static final String CAP_API_KEY = "widget_api_key";
    private static final String CAP_APP_URL = "widget_app_url";
    private static final int MAX_ROWS = 5;
    private static final int[] ROW_IDS   = { R.id.habit_row_0, R.id.habit_row_1, R.id.habit_row_2, R.id.habit_row_3, R.id.habit_row_4 };
    private static final int[] CHECK_IDS = { R.id.habit_check_0, R.id.habit_check_1, R.id.habit_check_2, R.id.habit_check_3, R.id.habit_check_4 };
    private static final int[] NAME_IDS  = { R.id.habit_name_0, R.id.habit_name_1, R.id.habit_name_2, R.id.habit_name_3, R.id.habit_name_4 };

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) { refreshAll(context); }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_TOGGLE.equals(intent.getAction())) {
            String id = intent.getStringExtra(EXTRA_HABIT_ID);
            if (id == null) return;
            toggleAndRefresh(context, id, intent.getBooleanExtra(EXTRA_DONE, true));
        }
    }

    /** {apiKey, baseUrl} or null if the widget hasn't been set up yet. */
    private static String[] creds(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS_CAP, Context.MODE_PRIVATE);
        String key = p.getString(CAP_API_KEY, null);
        String url = p.getString(CAP_APP_URL, null);
        if (key == null || url == null) return null;
        return new String[]{ key, url.replaceAll("/+$", "") };
    }

    static void refreshAll(final Context context) {
        new Thread(() -> {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_habits);

            Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (open != null) {
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                views.setOnClickPendingIntent(R.id.btn_habits_open, PendingIntent.getActivity(
                    context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            }

            String countText = "—";
            try {
                String[] c = creds(context);
                if (c == null) throw new Exception("no creds");
                HttpURLConnection conn = (HttpURLConnection) new URL(c[1] + "/api/widget/habits").openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setRequestProperty("x-widget-key", c[0]);
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();
                conn.disconnect();

                JSONObject json = new JSONObject(sb.toString());
                JSONArray habits = json.getJSONArray("habits");
                countText = json.optInt("done", 0) + "/" + json.optInt("total", 0);

                for (int i = 0; i < MAX_ROWS; i++) {
                    if (i < habits.length()) {
                        JSONObject h = habits.getJSONObject(i);
                        String id = h.getString("id");
                        String name = h.getString("name");
                        boolean done = h.optBoolean("done", false);
                        int streak = h.optInt("streak", 0);
                        views.setViewVisibility(ROW_IDS[i], View.VISIBLE);
                        views.setTextViewText(CHECK_IDS[i], done ? "✅" : "⬜");
                        views.setTextViewText(NAME_IDS[i], streak > 0 ? name + "  🔥" + streak : name);
                        Intent toggle = new Intent(context, HabitsWidget.class);
                        toggle.setAction(ACTION_TOGGLE);
                        toggle.setData(Uri.parse("emergenthealth://habit/" + id));
                        toggle.putExtra(EXTRA_HABIT_ID, id);
                        toggle.putExtra(EXTRA_DONE, !done);
                        views.setOnClickPendingIntent(ROW_IDS[i], PendingIntent.getBroadcast(
                            context, 100 + i, toggle, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
                    } else {
                        views.setViewVisibility(ROW_IDS[i], View.GONE);
                    }
                }
            } catch (Exception e) {
                for (int i = 0; i < MAX_ROWS; i++) views.setViewVisibility(ROW_IDS[i], View.GONE);
                views.setViewVisibility(ROW_IDS[0], View.VISIBLE);
                views.setTextViewText(CHECK_IDS[0], "⚠️");
                views.setTextViewText(NAME_IDS[0], "Tap to open app");
            }

            views.setTextViewText(R.id.habits_count, countText);
            AppWidgetManager mgr = AppWidgetManager.getInstance(context);
            for (int id : mgr.getAppWidgetIds(new ComponentName(context, HabitsWidget.class))) {
                mgr.updateAppWidget(id, views);
            }
        }).start();
    }

    static void toggleAndRefresh(final Context context, final String habitId, final boolean done) {
        new Thread(() -> {
            try {
                String[] c = creds(context);
                if (c != null) {
                    HttpURLConnection conn = (HttpURLConnection) new URL(c[1] + "/api/widget/habits").openConnection();
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("x-widget-key", c[0]);
                    OutputStreamWriter w = new OutputStreamWriter(conn.getOutputStream(), "UTF-8");
                    w.write("{\"habitId\":\"" + habitId + "\",\"done\":" + done + "}");
                    w.flush(); w.close();
                    conn.getResponseCode();
                    conn.disconnect();
                }
            } catch (Exception ignored) { /* never crash the widget */ }
            refreshAll(context);
        }).start();
    }
}
