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

    // v2 deliberately. A NotificationChannel's settings are fixed once it has
    // been created — createNotificationChannel on an existing id changes
    // nothing but its name. The first version was created without
    // setAllowBubbles, so correcting the code is not enough on a phone that
    // already has it: the channel has to be a new one.
    private static final String CHANNEL_ID = "emergy_bubble_v2";
    private static final String OLD_CHANNEL_ID = "emergy_bubble";
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
        ret.put("allowed", false);
        ret.put("preference", "unknown");
        if (supported()) {
            NotificationManager nm = getContext().getSystemService(NotificationManager.class);
            if (nm != null) {
                // areBubblesAllowed is the API 30 answer and it is a yes/no,
                // which on Android 12+ is the wrong shape: there the setting
                // has three values and the middle one is the default. Reading
                // it as a boolean makes "you must pick this conversation once"
                // indistinguishable from "bubbles are switched off", and those
                // need opposite instructions.
                ret.put("allowed", nm.areBubblesAllowed());
                ret.put("preference", bubblePreference(nm));
            }
        }
        call.resolve(ret);
    }

    /**
     * none / selected / all.
     *
     * "selected" is Android's default from 12 onwards and is why a correctly
     * built bubble still arrives as an ordinary notification the first time:
     * the system posts it and waits for the user to promote that one
     * conversation. Nothing is broken at that point, but nothing floats
     * either, and only the user can move it along.
     */
    @android.annotation.SuppressLint("NewApi")
    private static String bubblePreference(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            // API 30 has no tri-state; the boolean is the whole answer.
            return nm.areBubblesAllowed() ? "all" : "none";
        }
        int pref = nm.getBubblePreference();
        if (pref == NotificationManager.BUBBLE_PREFERENCE_ALL) return "all";
        if (pref == NotificationManager.BUBBLE_PREFERENCE_SELECTED) return "selected";
        if (pref == NotificationManager.BUBBLE_PREFERENCE_NONE) return "none";
        return "unknown";
    }

    /**
     * Open the phone's bubble setting for this app.
     *
     * The path is five taps deep and the OEMs all name the steps differently,
     * so written directions are a guess about someone else's phone. The
     * system will open the exact screen if asked.
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                intent = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_BUBBLE_SETTINGS);
            } else {
                intent = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            }
            intent.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // Some builds do not carry that screen. Fall back to the app's
            // notification settings rather than reporting a dead end.
            try {
                Intent fallback = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                fallback.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Couldn't open Android's bubble settings");
            }
        }
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
                // Same reason as the shortcut category: without this the
                // system does not treat it as a conversation, and only
                // conversations bubble.
                .setCategory(Notification.CATEGORY_MESSAGE)
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

    /**
     * Did the last one actually float?
     *
     * The system sets FLAG_BUBBLE on a notification it chose to bubble, so
     * this is the phone's own answer rather than ours. Everything else in this
     * plugin is a request; this is the only part that can say what happened,
     * and without it "Sent." is a claim about a screen nobody here can see.
     */
    @PluginMethod
    @androidx.annotation.RequiresApi(api = Build.VERSION_CODES.R)
    public void didBubble(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("posted", false);
        ret.put("bubbled", false);
        if (!supported()) { call.resolve(ret); return; }
        NotificationManager nm = getContext().getSystemService(NotificationManager.class);
        if (nm == null) { call.resolve(ret); return; }
        try {
            for (android.service.notification.StatusBarNotification sbn : nm.getActiveNotifications()) {
                if (sbn.getId() != NOTIFICATION_ID) continue;
                ret.put("posted", true);
                ret.put("bubbled", (sbn.getNotification().flags & Notification.FLAG_BUBBLE) != 0);
                break;
            }
        } catch (Exception ignored) {
            // Reading our own notifications back is best-effort; a failure
            // here means we don't know, not that it failed.
        }
        call.resolve(ret);
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
        // Tidy up the version that could never bubble.
        try { nm.deleteNotificationChannel(OLD_CHANNEL_ID); } catch (Exception ignored) {}

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Emergy bubble", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Emergy floating over other apps");
        // The requirement that was missing. Without it Android posts the
        // notification and simply declines to float it — no error, no warning,
        // exactly the silent no-op this whole feature was meant to avoid.
        channel.setAllowBubbles(true);
        // Silent: a bubble is already visible, and a sound for every one of
        // them is how this becomes the feature you switch off.
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
            // Android 11+ bubbles conversations, and this is how a shortcut
            // declares itself to be one.
            .setCategories(java.util.Collections.singleton(
                "android.shortcut.conversation"))
            .setLongLived(true)
            .build();
        sm.addDynamicShortcuts(Arrays.asList(shortcut));
    }
}
