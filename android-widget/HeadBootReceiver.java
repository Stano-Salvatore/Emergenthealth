package app.emergenthealth;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Puts the pop-out alarms back after the system throws them away.
 *
 * Android clears every alarm an app holds on reboot, and again when the app is
 * updated. Nothing in the app notices: the settings card would go on saying
 * "20 armed" while the answer was zero, because from its side nothing changed.
 * A feature that quietly stops and still reports success is the failure this
 * project keeps finding, and a phone restart is not an exotic event.
 *
 * Re-arming happens from what was stored when the alarms were first set, not
 * from the server: this runs at boot, possibly with no network and certainly
 * with no session.
 */
public class HeadBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        boolean relevant =
            Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                // Some OEM builds send this one instead after a quick restart.
                || "android.intent.action.QUICKBOOT_POWERON".equals(action);
        if (!relevant) return;

        try {
            EmergyBubblePlugin.rearmStoredPops(ctx);
            // And the head itself, if it was floating before the restart.
            EmergyBubblePlugin.ensureHeadRunning(ctx);
            // And location tracking, if it was on. Needs "Allow all the time"
            // to get fixes from here; otherwise the next app open starts it.
            EmergyLocationService.ensureRunning(ctx);
            EmergyWakeService.ensureRunning(ctx);
            // A reboot throws away every alarm this app holds, and the
            // heartbeat is one of them. Without this line the watchdog dies
            // at the first restart and nothing says so.
            if (EmergyLocationService.keep(ctx) || EmergyWakeService.keep(ctx)) {
                HeadAlarmReceiver.scheduleWatchdog(ctx);
            }
            // Play Services drops its subscriptions on reboot and app update
            // while the stored flags keep saying "On" — the Settings card
            // then claims a dead subscription is alive, and the first
            // ring-off night quietly records nothing. Each re-subscribe
            // checks its own flag and permission, and turns the flag off
            // when it cannot succeed, so the card tells the truth either way.
            EmergySleepReceiver.resubscribe(ctx);
            EmergyActivityReceiver.resubscribe(ctx);
        } catch (Exception ignored) {
            // Best effort. The notifications for the same reminders are
            // rescheduled by the app itself; the head popping out is the
            // extra, and losing it must not crash the boot receiver.
        }
    }
}
