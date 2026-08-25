package app.emergenthealth;

import android.content.Context;
import android.content.Intent;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Emergy's own messages, arriving in the app's process so they can raise him.
 *
 * The server already sends these as web push. That reaches a browser, and a
 * service worker has no bridge to native code — so nothing web push delivers
 * can ever raise the chat head, even when the subscription belongs to this
 * app. FCM is the only path that lands somewhere a service can act on.
 *
 * This service does exactly one thing: pop the head. It deliberately posts no
 * notification of its own, because the same message is already arriving as web
 * push and a second copy is worse than none. If the head cannot be shown, this
 * does nothing at all and the web push notification stands on its own.
 *
 * The messages are data-only. A `notification` block would be drawn by the
 * system tray while the app is backgrounded and never reach onMessageReceived,
 * which is exactly the case this exists for.
 */
public class EmergyFcmService extends FirebaseMessagingService {

    /** Set when the settings toggle is switched on; read here, where JS cannot reach. */
    static final String PREFS = "emergy_head_pops";
    static final String POPS_ENABLED = "pops_enabled";

    static boolean popsEnabled(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(POPS_ENABLED, false);
    }

    @Override
    public void onNewToken(String token) {
        // Nothing to do here. Registration happens from the web layer, which is
        // the only side that knows who is signed in — a token posted from here
        // would have no user to attach to.
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        if (!popsEnabled(this)) return;
        // Revoked since the message was sent. Starting the service would bring
        // up a foreground notification and draw nothing.
        if (!android.provider.Settings.canDrawOverlays(this)) return;

        String title = message.getData().get("title");
        String body = message.getData().get("body");
        String text = body != null && !body.trim().isEmpty() ? body : title;
        if (text == null || text.trim().isEmpty()) return;

        try {
            startForegroundService(new Intent(this, EmergyHeadService.class)
                .setAction(EmergyHeadService.ACTION_POP)
                .putExtra(HeadAlarmReceiver.EXTRA_MESSAGE, text.trim()));
        } catch (Exception ignored) {
            // Battery-restricted, or the background-start exemption did not
            // apply. The web push notification for the same message still
            // arrives — the head is the extra, not the delivery.
        }
    }
}
