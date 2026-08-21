package app.emergenthealth;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * One tap to Emergy.
 *
 * Deliberately the only widget that touches no network and needs no setup. The
 * other four read widget_api_key and show "Tap to open app" until it has been
 * activated; this one launches the app and nothing else, so it works the moment
 * it is placed and cannot show a stale or empty state.
 *
 * The mic button lands on the chat with dictation already starting, which is
 * the point: the cost of logging something is not the typing, it is the unlock,
 * the launch, the tab and the keyboard. Speaking removes all four.
 */
public class EmergyWidget extends AppWidgetProvider {

    private static final String DEST_LISTEN = "/dashboard/chat?listen=1";
    private static final String DEST_CHAT   = "/dashboard/chat";

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_emergy);
        views.setOnClickPendingIntent(R.id.emergy_mic,  launch(context, DEST_LISTEN, 1));
        views.setOnClickPendingIntent(R.id.emergy_type, launch(context, DEST_CHAT, 2));
        for (int id : ids) mgr.updateAppWidget(id, views);
    }

    /** Open the app straight at a screen. MainActivity accepts paths only. */
    private static PendingIntent launch(Context context, String dest, int requestCode) {
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) open = new Intent(Intent.ACTION_MAIN);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        open.putExtra("eh_dest", dest);
        // Distinct request codes, or the second PendingIntent would be handed
        // the first one's extras — they are matched ignoring extras.
        return PendingIntent.getActivity(
            context, requestCode, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void refreshAll(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(context, EmergyWidget.class));
        if (ids.length > 0) new EmergyWidget().onUpdate(context, mgr, ids);
    }
}
