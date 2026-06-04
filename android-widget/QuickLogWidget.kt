package app.emergenthealth

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class QuickLogWidget : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (widgetId in appWidgetIds) {
            Companion.updateAppWidget(context, appWidgetManager, widgetId)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        when (intent.action) {
            ACTION_LOG_WATER_250 -> Companion.logAndUpdate(context, "water", 250)
            ACTION_LOG_WATER_500 -> Companion.logAndUpdate(context, "water", 500)
            ACTION_LOG_COFFEE    -> Companion.logAndUpdate(context, "coffee", 240)
            ACTION_LOG_BEER      -> Companion.logAndUpdate(context, "beer", 330)
            ACTION_LOG_WINE      -> Companion.logAndUpdate(context, "wine", 150)
        }
    }

    companion object {
        const val ACTION_LOG_WATER_250 = "app.emergenthealth.LOG_WATER_250"
        const val ACTION_LOG_WATER_500 = "app.emergenthealth.LOG_WATER_500"
        const val ACTION_LOG_COFFEE    = "app.emergenthealth.LOG_COFFEE"
        const val ACTION_LOG_BEER      = "app.emergenthealth.LOG_BEER"
        const val ACTION_LOG_WINE      = "app.emergenthealth.LOG_WINE"

        private const val PREFS_WIDGET  = "EmergenthealthWidget"
        private const val PREFS_CAP     = "CapacitorStorage"

        private const val KEY_WATER_ML   = "waterMl"
        private const val KEY_COFFEE_ML  = "coffeeMl"
        private const val KEY_BEER_COUNT = "beerCount"
        private const val KEY_WINE_COUNT = "wineCount"
        private const val KEY_DATE       = "date"

        private const val CAP_API_KEY    = "widget_api_key"
        private const val CAP_APP_URL    = "widget_app_url"

        private fun todayString(): String =
            SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

        /** Reset daily totals in SharedPreferences if the stored date is not today. */
        private fun maybeResetDay(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_WIDGET, Context.MODE_PRIVATE)
            val stored = prefs.getString(KEY_DATE, "") ?: ""
            val today  = todayString()
            if (stored != today) {
                prefs.edit()
                    .putString(KEY_DATE, today)
                    .putInt(KEY_WATER_ML, 0)
                    .putInt(KEY_COFFEE_ML, 0)
                    .putInt(KEY_BEER_COUNT, 0)
                    .putInt(KEY_WINE_COUNT, 0)
                    .apply()
            }
        }

        fun updateAppWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            maybeResetDay(context)
            val prefs   = context.getSharedPreferences(PREFS_WIDGET, Context.MODE_PRIVATE)
            val waterMl  = prefs.getInt(KEY_WATER_ML, 0)
            val coffeeMl = prefs.getInt(KEY_COFFEE_ML, 0)
            val beerCount= prefs.getInt(KEY_BEER_COUNT, 0)
            val wineCount= prefs.getInt(KEY_WINE_COUNT, 0)

            val views = RemoteViews(context.packageName, R.layout.widget_quick_log)

            // Status text
            views.setTextViewText(R.id.water_status,  "💧 ${waterMl}ml")
            views.setTextViewText(R.id.coffee_status, "☕ ${coffeeMl}ml")
            views.setTextViewText(R.id.beer_status,   "🍺 $beerCount")

            // Open app intent
            val openIntent = context.packageManager
                .getLaunchIntentForPackage(context.packageName)
                ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (openIntent != null) {
                val openPi = PendingIntent.getActivity(
                    context, 0, openIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(R.id.btn_open_app, openPi)
            }

            // Log button intents
            views.setOnClickPendingIntent(
                R.id.btn_water_250,
                buildActionPendingIntent(context, ACTION_LOG_WATER_250, 1)
            )
            views.setOnClickPendingIntent(
                R.id.btn_water_500,
                buildActionPendingIntent(context, ACTION_LOG_WATER_500, 2)
            )
            views.setOnClickPendingIntent(
                R.id.btn_coffee,
                buildActionPendingIntent(context, ACTION_LOG_COFFEE, 3)
            )
            views.setOnClickPendingIntent(
                R.id.btn_beer,
                buildActionPendingIntent(context, ACTION_LOG_BEER, 4)
            )
            views.setOnClickPendingIntent(
                R.id.btn_wine,
                buildActionPendingIntent(context, ACTION_LOG_WINE, 5)
            )

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        private fun buildActionPendingIntent(
            context: Context,
            action: String,
            requestCode: Int
        ): PendingIntent {
            val intent = Intent(context, QuickLogWidget::class.java).apply {
                this.action = action
            }
            return PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        fun logAndUpdate(context: Context, type: String, amountMl: Int) {
            Thread {
                try {
                    val capPrefs = context.getSharedPreferences(PREFS_CAP, Context.MODE_PRIVATE)
                    val apiKey   = capPrefs.getString(CAP_API_KEY, null) ?: return@Thread
                    val appUrl   = capPrefs.getString(CAP_APP_URL, null) ?: return@Thread

                    val endpoint = appUrl.trimEnd('/') + "/api/widget/log"
                    val json     = """{"type":"$type","amountMl":$amountMl}"""

                    val conn = URL(endpoint).openConnection() as HttpURLConnection
                    conn.apply {
                        requestMethod = "POST"
                        connectTimeout = 8_000
                        readTimeout    = 8_000
                        doOutput       = true
                        setRequestProperty("Content-Type", "application/json")
                        setRequestProperty("x-widget-key", apiKey)
                    }

                    val writer = OutputStreamWriter(conn.outputStream, "UTF-8")
                    writer.write(json)
                    writer.flush()
                    writer.close()

                    val responseCode = conn.responseCode
                    conn.disconnect()

                    if (responseCode in 200..299) {
                        // Update cached totals
                        maybeResetDay(context)
                        val widgetPrefs = context.getSharedPreferences(PREFS_WIDGET, Context.MODE_PRIVATE)
                        val editor = widgetPrefs.edit()
                        when (type) {
                            "water"  -> editor.putInt(KEY_WATER_ML,   widgetPrefs.getInt(KEY_WATER_ML, 0)   + amountMl)
                            "coffee" -> editor.putInt(KEY_COFFEE_ML,  widgetPrefs.getInt(KEY_COFFEE_ML, 0)  + amountMl)
                            "beer"   -> editor.putInt(KEY_BEER_COUNT, widgetPrefs.getInt(KEY_BEER_COUNT, 0) + 1)
                            "wine"   -> editor.putInt(KEY_WINE_COUNT, widgetPrefs.getInt(KEY_WINE_COUNT, 0) + 1)
                        }
                        editor.apply()
                    }
                } catch (_: Exception) {
                    // Never crash the widget — silently fail
                }

                // Always refresh widget display
                val manager = AppWidgetManager.getInstance(context)
                val ids = manager.getAppWidgetIds(
                    ComponentName(context, QuickLogWidget::class.java)
                )
                for (id in ids) {
                    updateAppWidget(context, manager, id)
                }
            }.start()
        }
    }
}
