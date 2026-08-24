package app.emergenthealth;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Arrays;

/**
 * Emergy as a floating chat head.
 *
 * Android calls these Bubbles. They are not an overlay and deliberately do not
 * use SYSTEM_ALERT_WINDOW — that permission is the one that lets an app draw
 * over your banking screen, and asking for it to show a plant is not a trade
 * worth offering. A bubble is a notification the system chooses to float, so
 * the user keeps control of it through ordinary notification settings.
 *
 * The requirements are strict and all of them matter:
 *   - a long-lived dynamic shortcut, because Android 11+ only bubbles
 *     conversations, and a conversation is identified by its shortcut
 *   - MessagingStyle with a Person, for the same reason
 *   - BubbleMetadata pointing at an activity that is resizeable and
 *     embeddable, since the system hosts it in a small floating window
 *
 * Miss any one and the notification still posts — it simply never floats,
 * which is the failure this app keeps finding elsewhere: something that
 * works enough to look fine and never does the thing it was for.
 */
@CapacitorPlugin(name = "EmergyBubble")
public class EmergyBubblePlugin extends Plugin {

    private static final String CHANNEL_ID = "emergy_bubble";
    private static final String SHORTCUT_ID = "emergy_chat";
    private static final int NOTIFICATION_ID = 920001;

    /** Bubbles arrived in Android 11. Below that this is honestly unavailable. */
    private static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
    }

    @PluginMethod
    @android.annotation.SuppressLint("NewApi")
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", supported());
        ret.put("sdk", Build.VERSION.SDK_INT);
        if (supported()) {
            NotificationManager nm = getContext().getSystemService(NotificationManager.class);
            // areBubblesAllowed reflects the user's own choice; reporting it
            // lets the UI say "turn bubbles on for this app" rather than
            // silently doing nothing.
            ret.put("allowed", nm != null && nm.areBubblesAllowed());
        } else {
            ret.put("allowed", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    @androidx.annotation.RequiresApi(api = Build.VERSION_CODES.R)
    public void show(PluginCall call) {
        if (!supported()) {
            call.reject("Bubbles need Android 11 or newer");
            return;
        }
        String message = call.getString("message", "");
        if (message == null || message.trim().isEmpty()) {
            call.reject("A bubble needs something to say");
            return;
        }

        Context ctx = getContext();
        try {
            createChannel(ctx);
            pushShortcut(ctx);

            Intent target = new Intent(ctx, BubbleActivity.class);
            target.setAction(Intent.ACTION_VIEW);
            target.addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT);
            PendingIntent bubbleIntent = PendingIntent.getActivity(
                ctx, 0, target,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);

            Icon icon = Icon.createWithResource(ctx, R.mipmap.ic_launcher);
            // The platform Person, not the androidx one: Notification.Builder
            // and Notification.MessagingStyle take android.app.Person, and
            // mixing the two compiles into a notification that never bubbles.
            android.app.Person emergy = new android.app.Person.Builder()
                .setName("Emergy")
                .setKey(SHORTCUT_ID)
                .setBot(true)
                .setImportant(true)
                .build();

            Notification.BubbleMetadata bubble = new Notification.BubbleMetadata.Builder(bubbleIntent, icon)
                // Tall enough to read a couple of exchanges without expanding.
                .setDesiredHeight(640)
                // Not auto-expanded: a bubble that takes over the screen
                // uninvited is the behaviour people turn bubbles off over.
                .setAutoExpandBubble(false)
                .setSuppressNotification(false)
                .build();

            Notification.Builder builder = new Notification.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_emergy)
                .setContentTitle("Emergy")
                .setContentText(message)
                .setShortcutId(SHORTCUT_ID)
                .setBubbleMetadata(bubble)
                .addPerson(emergy)
                .setStyle(new Notification.MessagingStyle(emergy).addMessage(
                    message, System.currentTimeMillis(), emergy))
                .setAutoCancel(true)
                .setContentIntent(bubbleIntent);

            NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, builder.build());
            call.resolve();
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS not granted on Android 13+.
            call.reject("Notification permission is off");
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Couldn't show the bubble" : e.getMessage());
        }
    }

    @PluginMethod
    public void hide(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(NOTIFICATION_ID);
        call.resolve();
    }

    @androidx.annotation.RequiresApi(api = Build.VERSION_CODES.R)
    private void createChannel(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Emergy bubble", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Emergy floating over other apps");
        // Silent by default: a bubble is already visible, and a sound for
        // every one of them is how this becomes the feature you switch off.
        channel.setSound(null, null);
        channel.setVibrationPattern(null);
        nm.createNotificationChannel(channel);
    }

    /**
     * The conversation shortcut. Android 11+ refuses to bubble a notification
     * whose shortcut is not long-lived and dynamic, and refuses silently.
     */
    @androidx.annotation.RequiresApi(api = Build.VERSION_CODES.R)
    private void pushShortcut(Context ctx) {
        ShortcutManager sm = ctx.getSystemService(ShortcutManager.class);
        if (sm == null) return;

        Intent open = new Intent(ctx, BubbleActivity.class);
        open.setAction(Intent.ACTION_VIEW);

        ShortcutInfo shortcut = new ShortcutInfo.Builder(ctx, SHORTCUT_ID)
            .setLongLived(true)
            .setShortLabel("Emergy")
            .setLongLabel("Talk to Emergy")
            .setIcon(Icon.createWithResource(ctx, R.mipmap.ic_launcher))
            .setIntent(open)
            .setPerson(new android.app.Person.Builder()
                .setName("Emergy").setKey(SHORTCUT_ID).setBot(true).build())
            .build();
        sm.addDynamicShortcuts(Arrays.asList(shortcut));
    }
}
