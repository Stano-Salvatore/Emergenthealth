package app.emergenthealth;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * What makes a reminder pop Emergy onto the screen.
 *
 * The app's reminders are Capacitor local notifications, and that plugin posts
 * them from inside itself — there is no callback to hang this off. So the head
 * gets its own alarms, set beside the notifications from the same list, and
 * this is where they land.
 *
 * Starting a foreground service from the background is normally refused on
 * Android 12+. An app holding SYSTEM_ALERT_WINDOW is exempt, which is exactly
 * the permission this feature already required — so the head can appear while
 * the app itself is nowhere. The permission is rechecked here anyway: it can
 * be revoked at any time from Settings, and an alarm set last week must not
 * try to draw over anything once it has been.
 */
public class HeadAlarmReceiver extends BroadcastReceiver {

    public static final String ACTION_POP = "app.emergenthealth.HEAD_POP";
    public static final String EXTRA_MESSAGE = "message";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !ACTION_POP.equals(intent.getAction())) return;
        // Revoked since this alarm was set: do nothing at all rather than
        // starting a service that would come up with an empty screen.
        if (!android.provider.Settings.canDrawOverlays(ctx)) return;

        String message = intent.getStringExtra(EXTRA_MESSAGE);
        Intent svc = new Intent(ctx, EmergyHeadService.class)
            .setAction(EmergyHeadService.ACTION_POP)
            .putExtra(EXTRA_MESSAGE, message);
        try {
            ctx.startForegroundService(svc);
        } catch (Exception ignored) {
            // Battery-restricted, or the exemption did not apply on this
            // build. The Capacitor notification for the same reminder still
            // arrives — the head is the extra, not the delivery.
        }
    }
}
