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

/** Home-screen Reminders widget. Up to 5 active reminders; tap a row to mark it
 *  done via /api/widget/reminders. Java for the Java-only app module. */
public class RemindersWidget extends AppWidgetProvider {

    static final String ACTION_DONE       = "app.emergenthealth.COMPLETE_REMINDER";
    static final String EXTRA_REMINDER_ID = "reminderId";

    private static final String PREFS_CAP   = "CapacitorStorage";
    private static final String CAP_API_KEY = "widget_api_key";
    private static final String CAP_APP_URL = "widget_app_url";
    private static final int MAX_ROWS = 5;
    private static final int[] ROW_IDS   = { R.id.rem_row_0, R.id.rem_row_1, R.id.rem_row_2, R.id.rem_row_3, R.id.rem_row_4 };
    private static final int[] DOT_IDS   = { R.id.rem_dot_0, R.id.rem_dot_1, R.id.rem_dot_2, R.id.rem_dot_3, R.id.rem_dot_4 };
    private static final int[] TITLE_IDS = { R.id.rem_title_0, R.id.rem_title_1, R.id.rem_title_2, R.id.rem_title_3, R.id.rem_title_4 };

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) { refreshAll(context); }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_DONE.equals(intent.getAction())) {
            String id = intent.getStringExtra(EXTRA_REMINDER_ID);
            if (id == null) return;
            completeAndRefresh(context, id);
        }
    }

    private static String[] creds(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS_CAP, Context.MODE_PRIVATE);
        String key = p.getString(CAP_API_KEY, null);
        String url = p.getString(CAP_APP_URL, null);
        if (key == null || url == null) return null;
        return new String[]{ key, url.replaceAll("/+$", "") };
    }

    static void refreshAll(final Context context) {
        new Thread(() -> {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_reminders);

            Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (open != null) {
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                views.setOnClickPendingIntent(R.id.btn_rem_open, PendingIntent.getActivity(
                    context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            }

            String countText = "—";
            try {
                String[] c = creds(context);
                if (c == null) throw new Exception("no creds");
                HttpURLConnection conn = (HttpURLConnection) new URL(c[1] + "/api/widget/reminders").openConnection();
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
                JSONArray rems = json.getJSONArray("reminders");
                int overdue = json.getJSONObject("counts").optInt("overdue", 0);
                countText = overdue > 0 ? overdue + " overdue" : String.valueOf(rems.length());

                for (int i = 0; i < MAX_ROWS; i++) {
                    if (i < rems.length()) {
                        JSONObject r = rems.getJSONObject(i);
                        String id = r.getString("id");
                        String title = r.getString("title");
                        String state = r.optString("state", "upcoming");
                        views.setViewVisibility(ROW_IDS[i], View.VISIBLE);
                        views.setTextViewText(DOT_IDS[i], "overdue".equals(state) ? "🔴" : "today".equals(state) ? "🟡" : "⚪");
                        views.setTextViewText(TITLE_IDS[i], title);
                        Intent done = new Intent(context, RemindersWidget.class);
                        done.setAction(ACTION_DONE);
                        done.setData(Uri.parse("emergenthealth://reminder/" + id));
                        done.putExtra(EXTRA_REMINDER_ID, id);
                        views.setOnClickPendingIntent(ROW_IDS[i], PendingIntent.getBroadcast(
                            context, 200 + i, done, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
                    } else {
                        views.setViewVisibility(ROW_IDS[i], View.GONE);
                    }
                }
                if (rems.length() == 0) {
                    views.setViewVisibility(ROW_IDS[0], View.VISIBLE);
                    views.setTextViewText(DOT_IDS[0], "✓");
                    views.setTextViewText(TITLE_IDS[0], "All clear!");
                }
            } catch (Exception e) {
                for (int i = 0; i < MAX_ROWS; i++) views.setViewVisibility(ROW_IDS[i], View.GONE);
                views.setViewVisibility(ROW_IDS[0], View.VISIBLE);
                views.setTextViewText(DOT_IDS[0], "⚠️");
                views.setTextViewText(TITLE_IDS[0], "Tap to open app");
            }

            views.setTextViewText(R.id.rem_count, countText);
            AppWidgetManager mgr = AppWidgetManager.getInstance(context);
            for (int id : mgr.getAppWidgetIds(new ComponentName(context, RemindersWidget.class))) {
                mgr.updateAppWidget(id, views);
            }
        }).start();
    }

    static void completeAndRefresh(final Context context, final String reminderId) {
        new Thread(() -> {
            try {
                String[] c = creds(context);
                if (c != null) {
                    HttpURLConnection conn = (HttpURLConnection) new URL(c[1] + "/api/widget/reminders").openConnection();
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("x-widget-key", c[0]);
                    OutputStreamWriter w = new OutputStreamWriter(conn.getOutputStream(), "UTF-8");
                    w.write("{\"reminderId\":\"" + reminderId + "\"}");
                    w.flush(); w.close();
                    conn.getResponseCode();
                    conn.disconnect();
                }
            } catch (Exception ignored) { /* never crash the widget */ }
            refreshAll(context);
        }).start();
    }
}
