package app.emergenthealth;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Puts the pop alarms back after the two events that wipe them.
 *
 * Android clears every alarm an app holds when the phone reboots, and again
 * when the package is replaced. Neither is unusual — one is a restart, the
 * other is installing a new build — and until this existed both silently
 * switched the feature off while the settings card went on saying how many
 * were armed.
 *
 * Nothing here decides what should pop. It re-arms exactly what was last
 * stored, dropping whatever has since gone past, and the app's own sync
 * replaces the list the next time it runs.
 */
public class HeadBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        // Revoked while the phone was off: re-arming would set alarms that can
        // only fail. The app's next sync will re-arm them if it is granted again.
        if (!android.provider.Settings.canDrawOverlays(ctx)) return;
        HeadPops.rearm(ctx);
    }
}
