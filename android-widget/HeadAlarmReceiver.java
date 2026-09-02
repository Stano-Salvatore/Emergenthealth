package app.emergenthealth;

import android.app.AlarmManager;
import android.app.PendingIntent;
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
    /** Put the head back after the process died with the app (see EmergyHeadService.onTaskRemoved). */
    public static final String ACTION_RESTART = "app.emergenthealth.HEAD_RESTART";
    /** Same again for the location tracker (see EmergyLocationService.onTaskRemoved). */
    public static final String ACTION_LOCATION_RESTART = "app.emergenthealth.LOCATION_RESTART";
    /** And for the wake-word listener (see EmergyWakeService.onTaskRemoved). */
    public static final String ACTION_WAKE_RESTART = "app.emergenthealth.WAKE_RESTART";
    /** The heartbeat that notices a service the system killed quietly. */
    public static final String ACTION_WATCHDOG = "app.emergenthealth.WATCHDOG";
    public static final String EXTRA_MESSAGE = "message";

    private static final int WATCHDOG_REQUEST = 920007;
    /**
     * How often to check that what should be running still is.
     *
     * Every restart path this app had was event-driven: sticky restart, the
     * alarm set when the app is swiped away, and the boot receiver. None of
     * them fires for the case that actually happens on a Samsung — the system
     * decides the app is "sleeping", ends the service, and tells nobody.
     * onTaskRemoved is not called, START_STICKY is not honoured, and there is
     * no reboot. So tracking stopped at lunchtime and stayed stopped until the
     * app was next opened: a whole day of "Emergy isn't following me".
     *
     * A quarter of an hour is the shortest interval worth asking for: in Doze
     * setAndAllowWhileIdle is throttled to roughly nine minutes anyway, so a
     * tighter one would only lie about how often it runs. The gap it can leave
     * is fifteen minutes of fixes, against the several hours it replaces.
     */
    private static final long WATCHDOG_INTERVAL_MS = 15 * 60_000L;

    private static PendingIntent watchdogIntent(Context ctx) {
        Intent i = new Intent(ctx, HeadAlarmReceiver.class).setAction(ACTION_WATCHDOG);
        return PendingIntent.getBroadcast(
            ctx, WATCHDOG_REQUEST, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * Arm the next heartbeat. Safe to call as often as you like — the same
     * request code means re-arming replaces rather than accumulates.
     *
     * Deliberately one-shot-and-re-armed rather than setRepeating: only
     * setAndAllowWhileIdle survives Doze, and it has no repeating form. It is
     * also inexact, so it needs no SCHEDULE_EXACT_ALARM — an alarm the user
     * can revoke is not something to hang tracking on.
     */
    static void scheduleWatchdog(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return;
        try {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + WATCHDOG_INTERVAL_MS, watchdogIntent(ctx));
        } catch (Exception ignored) {
            // Nothing to do: the app-open path still restarts what it can.
        }
    }

    /** Stop the heartbeat once nothing wants keeping. */
    static void cancelWatchdog(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return;
        try { am.cancel(watchdogIntent(ctx)); } catch (Exception ignored) {}
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null) return;
        if (ACTION_RESTART.equals(intent.getAction())) {
            EmergyBubblePlugin.ensureHeadRunning(ctx);
            return;
        }
        if (ACTION_LOCATION_RESTART.equals(intent.getAction())) {
            EmergyLocationService.ensureRunning(ctx);
            return;
        }
        if (ACTION_WAKE_RESTART.equals(intent.getAction())) {
            EmergyWakeService.ensureRunning(ctx);
            return;
        }
        if (ACTION_WATCHDOG.equals(intent.getAction())) {
            // Re-arm FIRST. Whatever ensureRunning does or throws below, the
            // heartbeat has to outlive it — a watchdog that stops watching
            // after one bad tick is the failure it was written to prevent.
            boolean wanted = EmergyLocationService.keep(ctx) || EmergyWakeService.keep(ctx);
            if (wanted) scheduleWatchdog(ctx); else cancelWatchdog(ctx);
            if (!wanted) return;
            try { EmergyLocationService.ensureRunning(ctx); } catch (Exception ignored) {}
            try { EmergyWakeService.ensureRunning(ctx); } catch (Exception ignored) {}
            return;
        }
        if (!ACTION_POP.equals(intent.getAction())) return;
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
