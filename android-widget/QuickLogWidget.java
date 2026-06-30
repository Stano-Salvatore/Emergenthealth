package app.emergenthealth;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Home-screen quick-log widget: tap to log water / coffee / beer / wine without
 * opening the app. Posts to /api/widget/log using the per-device key stored by
 * the app in Capacitor's SharedPreferences. Daily totals are cached locally and
 * reset at midnight. Emoji are written as \u escapes so the source compiles
 * regardless of the CI file encoding.
 */
public class QuickLogWidget extends AppWidgetProvider {

    public static final String ACTION_LOG_WATER_250 = "app.emergenthealth.LOG_WATER_250";
    public static final String ACTION_LOG_WATER_500 = "app.emergenthealth.LOG_WATER_500";
    public static final String ACTION_LOG_COFFEE    = "app.emergenthealth.LOG_COFFEE";
    public static final String ACTION_LOG_BEER      = "app.emergenthealth.LOG_BEER";
    public static final String ACTION_LOG_WINE      = "app.emergenthealth.LOG_WINE";

    private static final String PREFS_WIDGET = "EmergenthealthWidget";
    private static final String PREFS_CAP    = "CapacitorStorage";

    private static final String KEY_WATER_ML   = "waterMl";
    private static final String KEY_COFFEE_ML  = "coffeeMl";
    private static final String KEY_BEER_COUNT = "beerCount";
    private static final String KEY_WINE_COUNT = "wineCount";
    private static final String KEY_DATE       = "date";

    private static final String CAP_API_KEY = "widget_api_key";
    private static final String CAP_APP_URL = "widget_app_url";

    private static final String EMOJI_WATER  = "💧"; // 💧
    private static final String EMOJI_COFFEE = "☕";       // ☕
    private static final String EMOJI_BEER   = "🍺"; // 🍺

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int widgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, widgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (action == null) return;
        switch (action) {
            case ACTION_LOG_WATER_250: logAndUpdate(context, "water", 250); break;
            case ACTION_LOG_WATER_500: logAndUpdate(context, "water", 500); break;
            case ACTION_LOG_COFFEE:    logAndUpdate(context, "coffee", 240); break;
            case ACTION_LOG_BEER:      logAndUpdate(context, "beer", 330); break;
            case ACTION_LOG_WINE:      logAndUpdate(context, "wine", 150); break;
            default: break;
        }
    }

    private static String todayString() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    /** Reset daily totals in SharedPreferences if the stored date is not today. */
    private static void maybeResetDay(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_WIDGET, Context.MODE_PRIVATE);
        String stored = prefs.getString(KEY_DATE, "");
        String today = todayString();
        if (!today.equals(stored)) {
            prefs.edit()
                .putString(KEY_DATE, today)
                .putInt(KEY_WATER_ML, 0)
                .putInt(KEY_COFFEE_ML, 0)
                .putInt(KEY_BEER_COUNT, 0)
                .putInt(KEY_WINE_COUNT, 0)
                .apply();
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        maybeResetDay(context);
        SharedPreferences prefs = context.getSharedPreferences(PREFS_WIDGET, Context.MODE_PRIVATE);
        int waterMl = prefs.getInt(KEY_WATER_ML, 0);
        int coffeeMl = prefs.getInt(KEY_COFFEE_ML, 0);
        int beerCount = prefs.getInt(KEY_BEER_COUNT, 0);

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_log);

        views.setTextViewText(R.id.water_status, EMOJI_WATER + " " + waterMl + "ml");
        views.setTextViewText(R.id.coffee_status, EMOJI_COFFEE + " " + coffeeMl + "ml");
        views.setTextViewText(R.id.beer_status, EMOJI_BEER + " " + beerCount);

        Intent openIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (openIntent != null) {
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent openPi = PendingIntent.getActivity(
                context, 0, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.btn_open_app, openPi);
        }

        views.setOnClickPendingIntent(R.id.btn_water_250, buildActionPendingIntent(context, ACTION_LOG_WATER_250, 1));
        views.setOnClickPendingIntent(R.id.btn_water_500, buildActionPendingIntent(context, ACTION_LOG_WATER_500, 2));
        views.setOnClickPendingIntent(R.id.btn_coffee, buildActionPendingIntent(context, ACTION_LOG_COFFEE, 3));
        views.setOnClickPendingIntent(R.id.btn_beer, buildActionPendingIntent(context, ACTION_LOG_BEER, 4));
        views.setOnClickPendingIntent(R.id.btn_wine, buildActionPendingIntent(context, ACTION_LOG_WINE, 5));

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static PendingIntent buildActionPendingIntent(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, QuickLogWidget.class);
        intent.setAction(action);
        return PendingIntent.getBroadcast(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void logAndUpdate(final Context context, final String type, final int amountMl) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    SharedPreferences capPrefs = context.getSharedPreferences(PREFS_CAP, Context.MODE_PRIVATE);
                    String apiKey = capPrefs.getString(CAP_API_KEY, null);
                    String appUrl = capPrefs.getString(CAP_APP_URL, null);
                    if (apiKey == null || appUrl == null) {
                        refreshAll(context);
                        return;
                    }

                    String base = appUrl;
                    while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
                    String endpoint = base + "/api/widget/log";
                    String json = "{\"type\":\"" + type + "\",\"amountMl\":" + amountMl + "}";

                    HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("x-widget-key", apiKey);

                    OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream(), "UTF-8");
                    writer.write(json);
                    writer.flush();
                    writer.close();

                    int responseCode = conn.getResponseCode();
                    conn.disconnect();

                    if (responseCode >= 200 && responseCode < 300) {
                        maybeResetDay(context);
                        SharedPreferences widgetPrefs = context.getSharedPreferences(PREFS_WIDGET, Context.MODE_PRIVATE);
                        SharedPreferences.Editor editor = widgetPrefs.edit();
                        switch (type) {
                            case "water":  editor.putInt(KEY_WATER_ML, widgetPrefs.getInt(KEY_WATER_ML, 0) + amountMl); break;
                            case "coffee": editor.putInt(KEY_COFFEE_ML, widgetPrefs.getInt(KEY_COFFEE_ML, 0) + amountMl); break;
                            case "beer":   editor.putInt(KEY_BEER_COUNT, widgetPrefs.getInt(KEY_BEER_COUNT, 0) + 1); break;
                            case "wine":   editor.putInt(KEY_WINE_COUNT, widgetPrefs.getInt(KEY_WINE_COUNT, 0) + 1); break;
                            default: break;
                        }
                        editor.apply();
                    }
                } catch (Exception e) {
                    // Never crash the widget — silently fail.
                }
                refreshAll(context);
            }
        }).start();
    }

    private static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, QuickLogWidget.class));
        for (int id : ids) {
            updateAppWidget(context, manager, id);
        }
    }
}
