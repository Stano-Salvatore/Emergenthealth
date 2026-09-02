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
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
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
@CapacitorPlugin(
    name = "EmergyBubble",
    permissions = {
        @Permission(alias = "activity", strings = { android.Manifest.permission.ACTIVITY_RECOGNITION }),
        @Permission(alias = "location", strings = {
            android.Manifest.permission.ACCESS_FINE_LOCATION,
            android.Manifest.permission.ACCESS_COARSE_LOCATION
        }),
        @Permission(alias = "microphone", strings = { android.Manifest.permission.RECORD_AUDIO })
    })
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

    // ------------------------------------------------------------ the chat head
    //
    // Separate from everything above on purpose. The bubble is a notification
    // the system may float; the head is a window this app draws. They look the
    // same in a screenshot and share nothing, and on a phone whose Android
    // build has no Bubbles support — Samsung's, for one — only the second one
    // can work at all.

    /** Can we float a head, and are we floating one right now? */
    @PluginMethod
    public void headStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", android.provider.Settings.canDrawOverlays(getContext()));
        ret.put("running", EmergyHeadService.isRunning());
        ret.put("keep", keepHead(getContext()));
        ret.put("batteryUnrestricted", batteryUnrestricted(getContext()));
        call.resolve(ret);
    }

    /**
     * Open the phone's "Display over other apps" screen for this app.
     *
     * There is no runtime prompt for this permission — it cannot be requested
     * in a dialog, only granted by hand in Settings — so sending the user
     * straight to the right screen is the whole of what an app can do.
     */
    @PluginMethod
    public void requestOverlay(PluginCall call) {
        try {
            Intent intent = new Intent(
                android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                android.net.Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open the overlay permission screen");
        }
    }

    @PluginMethod
    public void startHead(PluginCall call) {
        Context ctx = getContext();
        if (!android.provider.Settings.canDrawOverlays(ctx)) {
            // Refused rather than started-and-silently-empty: without the
            // permission the service would come up, add nothing to the screen
            // and look identical to a bug.
            call.reject("Emergenthealth needs permission to display over other apps");
            return;
        }
        try {
            // Asked for by the user: from here on he is meant to stay, and the
            // service, the boot receiver and every app foreground act on that.
            setKeepHead(ctx, true);
            ctx.startForegroundService(new Intent(ctx, EmergyHeadService.class));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Couldn't start the chat head" : e.getMessage());
        }
    }

    /**
     * Set the alarms that make reminders pop the head onto the screen.
     *
     * Replaces the whole set every time, the same way the notification
     * scheduler does: the app re-syncs from the server's list rather than
     * patching, so a reminder deleted on the web must not survive as an alarm
     * on the phone. The ids that were laid down are kept in a preference,
     * because an alarm can only be cancelled by rebuilding the PendingIntent
     * that made it and there is no way to ask Android what is pending.
     */
    @PluginMethod
    public void scheduleHeadPops(PluginCall call) {
        Context ctx = getContext();
        cancelAllPops(ctx);

        com.getcapacitor.JSArray pops = call.getArray("pops");
        if (pops == null) { call.resolve(new JSObject().put("scheduled", 0)); return; }

        android.app.AlarmManager am = ctx.getSystemService(android.app.AlarmManager.class);
        if (am == null) { call.reject("No alarm manager"); return; }

        org.json.JSONArray laid = new org.json.JSONArray();
        int count = 0;
        try {
            for (int i = 0; i < pops.length(); i++) {
                org.json.JSONObject pop = pops.getJSONObject(i);
                int id = pop.optInt("id", 0);
                long at = pop.optLong("at", 0L);
                String message = pop.optString("message", "");
                // In the past by the time we got here: skipped rather than
                // fired immediately, which is what an alarm set for a moment
                // already gone would otherwise do.
                if (id == 0 || at <= System.currentTimeMillis() || message.isEmpty()) continue;

                android.app.PendingIntent pi = popIntent(ctx, id, message);
                if (canScheduleExact(am)) {
                    am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
                } else {
                    // Not granted "Alarms & reminders": still delivered, just
                    // not to the minute. Silently downgrading beats not firing.
                    am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
                }
                // The whole record, not just the id. Android drops every alarm
                // on reboot and on app update, and the list that produced them
                // lives on a server this receiver cannot reach — so it has to
                // be able to re-arm from what it kept.
                laid.put(new org.json.JSONObject()
                    .put("id", id).put("at", at).put("message", message));
                count++;
            }
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Couldn't set the alarms" : e.getMessage());
            return;
        }

        ctx.getSharedPreferences(POP_PREFS, Context.MODE_PRIVATE)
            .edit().putString(POP_LIST, laid.toString()).apply();
        call.resolve(new JSObject().put("scheduled", count));
    }

    @PluginMethod
    public void cancelHeadPops(PluginCall call) {
        cancelAllPops(getContext());
        call.resolve();
    }

    /**
     * One pop a few seconds out, to prove the path works without waiting for
     * a real reminder.
     *
     * It goes through the alarm and the receiver like any other, because that
     * is the part nobody can verify by reading code: whether Android lets this
     * app raise a window from the background at all, and whether the phone's
     * battery manager sat on the alarm. Calling the service directly would
     * prove none of it.
     *
     * Its id is reserved and outside the sequential range the real pops use,
     * and it is not added to the stored list, so a test neither cancels the
     * armed set nor survives in it.
     */
    @PluginMethod
    public void testHeadPop(PluginCall call) {
        Context ctx = getContext();
        if (!android.provider.Settings.canDrawOverlays(ctx)) {
            call.reject("Emergenthealth needs permission to display over other apps");
            return;
        }
        android.app.AlarmManager am = ctx.getSystemService(android.app.AlarmManager.class);
        if (am == null) { call.reject("No alarm manager"); return; }

        int seconds = call.getInt("seconds", 12);
        long at = System.currentTimeMillis() + Math.max(3, seconds) * 1000L;
        android.app.PendingIntent pi = popIntent(
            ctx, TEST_POP_ID, "Test — if you can read this over another app, it works 🌱");
        if (canScheduleExact(am)) {
            am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
        } else {
            am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
        }
        JSObject ret = new JSObject();
        ret.put("at", at);
        ret.put("exact", canScheduleExact(am));
        call.resolve(ret);
    }

    /**
     * This device's FCM token, so the web layer can register it against the
     * signed-in account.
     *
     * Fetched here rather than pushed from onNewToken: only the web side knows
     * who is signed in, and a token sent from a background callback would have
     * no user to attach to.
     *
     * Reflection, because the Firebase SDK is only in the build when the
     * project is configured. Without it this reports unavailable instead of
     * failing to compile — the APK has to keep building for everyone who has
     * not set Firebase up.
     */
    @PluginMethod
    public void fcmToken(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Class<?> messaging = Class.forName("com.google.firebase.messaging.FirebaseMessaging");
            Object instance = messaging.getMethod("getInstance").invoke(null);
            Object task = messaging.getMethod("getToken").invoke(instance);
            Object token = Class.forName("com.google.android.gms.tasks.Tasks")
                .getMethod("await", Class.forName("com.google.android.gms.tasks.Task"))
                .invoke(null, task);
            ret.put("token", token == null ? null : token.toString());
            ret.put("available", token != null);
        } catch (Throwable t) {
            // Not built with Firebase, or the token could not be minted.
            ret.put("token", (String) null);
            ret.put("available", false);
        }
        call.resolve(ret);
    }

    /**
     * Mirror the pop-out toggle where native code can read it.
     *
     * The web side keeps this in localStorage, which a FirebaseMessagingService
     * waking with no WebView cannot see.
     */
    @PluginMethod
    public void setPopsEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getContext().getSharedPreferences("emergy_head_pops", Context.MODE_PRIVATE)
            .edit().putBoolean("pops_enabled", enabled).apply();
        call.resolve();
    }

    // ------------------------------------------------------ keeping the head

    /**
     * Whether the user asked for the head to stay.
     *
     * "Float Emergy" used to mean "until the process dies" — and on a phone the
     * process dies whenever the app is swiped away, memory runs short, or the
     * phone restarts. The service was deliberately not sticky and nothing
     * restarted it, so he vanished silently and the card went on saying he was
     * floating. Now the wish is stored, and three things act on it: the
     * service restarts itself if killed, the boot receiver starts it after a
     * restart, and the app re-checks on every foreground.
     */
    static final String HEAD_PREFS = "emergy_head";
    private static final String KEEP_KEY = "keep";

    static boolean keepHead(Context ctx) {
        return ctx.getSharedPreferences(HEAD_PREFS, Context.MODE_PRIVATE).getBoolean(KEEP_KEY, false);
    }

    static void setKeepHead(Context ctx, boolean keep) {
        ctx.getSharedPreferences(HEAD_PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEEP_KEY, keep).apply();
    }

    /** Start the head if it was asked for, is allowed, and is not already up. */
    static void ensureHeadRunning(Context ctx) {
        if (!keepHead(ctx)) return;
        if (!android.provider.Settings.canDrawOverlays(ctx)) return;
        if (EmergyHeadService.isRunning()) return;
        try {
            ctx.startForegroundService(new Intent(ctx, EmergyHeadService.class));
        } catch (Exception ignored) {
            // Background start refused on this build. The next app foreground
            // tries again from the foreground, where it is always allowed.
        }
    }

    /**
     * Is this app exempt from battery optimisation?
     *
     * A foreground service is allowed to run, and is still killed by the
     * "sleeping apps" logic on many phones (Samsung above all) unless the app
     * is exempt. This is the single most common reason a floating head dies.
     */
    static boolean batteryUnrestricted(Context ctx) {
        android.os.PowerManager pm = (android.os.PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        return pm == null || pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
    }

    /** Ask the system to exempt this app — its own dialog, nothing to await. */
    @PluginMethod
    public void requestBatteryUnrestricted(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                android.net.Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            call.resolve();
        } catch (Exception first) {
            try {
                Intent list = new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                list.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(list);
                call.resolve();
            } catch (Exception e) {
                call.reject("Couldn't open the battery settings");
            }
        }
    }

    // ------------------------------------------------- background location
    //
    // The native tracker (EmergyLocationService). The Capacitor plugin the app
    // used first handed every fix to the WebView to upload, so tracking lived
    // and died with the app's process. This one does not.

    @PluginMethod
    public void locationStatus(PluginCall call) {
        Context ctx = getContext();
        JSObject out = new JSObject();
        out.put("available", true);
        out.put("running", EmergyLocationService.isRunning());
        out.put("keep", EmergyLocationService.keep(ctx));
        out.put("fine", EmergyLocationService.hasFineLocation(ctx));
        out.put("background", EmergyLocationService.hasBackgroundLocation(ctx));
        out.put("batteryUnrestricted", batteryUnrestricted(ctx));
        call.resolve(out);
    }

    @PluginMethod
    public void startLocationService(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationPermissionDone");
            return;
        }
        beginLocation(call);
    }

    @PermissionCallback
    private void locationPermissionDone(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("NOT_AUTHORIZED");
            return;
        }
        beginLocation(call);
    }

    private void beginLocation(PluginCall call) {
        Context ctx = getContext();
        EmergyLocationService.setKeep(ctx, true);
        try {
            ctx.startForegroundService(new Intent(ctx, EmergyLocationService.class));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Couldn't start location tracking" : e.getMessage());
        }
    }

    @PluginMethod
    public void stopLocationService(PluginCall call) {
        Context ctx = getContext();
        EmergyLocationService.setKeep(ctx, false);
        ctx.stopService(new Intent(ctx, EmergyLocationService.class));
        call.resolve();
    }

    /** The app's own settings page — where "Allow all the time" lives on Android 11+. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                android.net.Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open the app's settings");
        }
    }

    // ------------------------------------------------------- the wake word
    //
    // Milestone one: everything except the detector. See EmergyWakeService —
    // the platform risk is the service surviving at all, not the model, so
    // that is what ships first and what testFire exercises.

    @PluginMethod
    public void wakeStatus(PluginCall call) {
        Context ctx = getContext();
        JSObject out = new JSObject();
        out.put("available", true);
        // No model yet, and the card says so rather than implying it works.
        out.put("hasDetector", false);
        out.put("running", EmergyWakeService.isRunning());
        out.put("listening", EmergyWakeService.isListening());
        out.put("keep", EmergyWakeService.keep(ctx));
        out.put("chargingOnly", EmergyWakeService.chargingOnly(ctx));
        out.put("pluggedIn", EmergyWakeService.isPluggedIn(ctx));
        out.put("microphone", EmergyWakeService.hasMicPermission(ctx));
        out.put("batteryUnrestricted", batteryUnrestricted(ctx));
        call.resolve(out);
    }

    @PluginMethod
    public void startWake(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionDone");
            return;
        }
        beginWake(call);
    }

    @PermissionCallback
    private void microphonePermissionDone(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("NOT_AUTHORIZED");
            return;
        }
        beginWake(call);
    }

    private void beginWake(PluginCall call) {
        Context ctx = getContext();
        EmergyWakeService.setKeep(ctx, true);
        try {
            ctx.startForegroundService(new Intent(ctx, EmergyWakeService.class));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Couldn't start listening" : e.getMessage());
        }
    }

    @PluginMethod
    public void stopWake(PluginCall call) {
        Context ctx = getContext();
        EmergyWakeService.setKeep(ctx, false);
        ctx.stopService(new Intent(ctx, EmergyWakeService.class));
        call.resolve();
    }

    @PluginMethod
    public void setWakeChargingOnly(PluginCall call) {
        Context ctx = getContext();
        EmergyWakeService.setChargingOnly(ctx, Boolean.TRUE.equals(call.getBoolean("enabled", false)));
        // Nudge the service so the microphone opens or closes to match now,
        // rather than at whatever moment the charger is next touched.
        if (EmergyWakeService.isRunning()) {
            try { ctx.startForegroundService(new Intent(ctx, EmergyWakeService.class)); } catch (Exception ignored) {}
        }
        call.resolve();
    }

    /** Pretend the wake word was heard, so the handoff can be tested with no model. */
    @PluginMethod
    public void testWakeFire(PluginCall call) {
        Context ctx = getContext();
        try {
            ctx.startForegroundService(new Intent(ctx, EmergyWakeService.class)
                .setAction(EmergyWakeService.ACTION_TEST_FIRE));
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't reach the listening service");
        }
    }

    /**
     * Drained once, like takePendingSay — and private for the same reason,
     * doubled: what the app does with this is open the microphone.
     */
    @PluginMethod
    public void takePendingWake(PluginCall call) {
        android.content.SharedPreferences prefs =
            getContext().getSharedPreferences(EmergyWakeService.PREFS, Context.MODE_PRIVATE);
        long at = prefs.getLong(EmergyWakeService.PENDING_WAKE, 0L);
        if (at != 0L) prefs.edit().remove(EmergyWakeService.PENDING_WAKE).apply();
        JSObject out = new JSObject();
        // Stale mailboxes are ignored: waking the mic because of something
        // said an hour ago would be alarming rather than helpful.
        out.put("heard", at != 0L && System.currentTimeMillis() - at < 60_000);
        call.resolve(out);
    }

    // ------------------------------------------------ activity recognition

    /**
     * Motion classification from the phone's own sensors, via the OS.
     *
     * Not the raw gyroscope: Android's Activity Recognition fuses
     * accelerometer, gyro and step counter at system level and answers the
     * question the journey view guesses at from GPS speed — walking, running,
     * cycling, or in a vehicle. Transition events land in
     * EmergyActivityReceiver whatever the app is doing; the web layer drains
     * them on foreground and the server pairs them into spans.
     *
     * Registration does not survive a reboot, so the web layer re-registers
     * on every foreground — FLAG_UPDATE_CURRENT makes that a no-op when the
     * registration is already live.
     */
    @PluginMethod
    public void activityStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", Build.VERSION.SDK_INT >= 29);
        out.put("permitted", getPermissionState("activity") == PermissionState.GRANTED);
        out.put("tracking", getContext()
            .getSharedPreferences(EmergyActivityReceiver.PREFS, Context.MODE_PRIVATE)
            .getBoolean("tracking", false));
        call.resolve(out);
    }

    @PluginMethod
    public void requestActivityPermission(PluginCall call) {
        if (getPermissionState("activity") == PermissionState.GRANTED) {
            activityPermissionDone(call);
            return;
        }
        requestPermissionForAlias("activity", call, "activityPermissionDone");
    }

    @PermissionCallback
    private void activityPermissionDone(PluginCall call) {
        JSObject out = new JSObject();
        out.put("granted", getPermissionState("activity") == PermissionState.GRANTED);
        call.resolve(out);
    }

    @PluginMethod
    public void startActivityTransitions(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29) {
            call.reject("Activity recognition needs Android 10 or newer.");
            return;
        }
        if (getPermissionState("activity") != PermissionState.GRANTED) {
            call.reject("Motion permission not granted yet.");
            return;
        }
        try {
            java.util.List<com.google.android.gms.location.ActivityTransition> transitions =
                new java.util.ArrayList<>();
            int[] types = {
                com.google.android.gms.location.DetectedActivity.WALKING,
                com.google.android.gms.location.DetectedActivity.RUNNING,
                com.google.android.gms.location.DetectedActivity.ON_BICYCLE,
                com.google.android.gms.location.DetectedActivity.IN_VEHICLE,
            };
            for (int type : types) {
                transitions.add(new com.google.android.gms.location.ActivityTransition.Builder()
                    .setActivityType(type)
                    .setActivityTransition(
                        com.google.android.gms.location.ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                    .build());
                transitions.add(new com.google.android.gms.location.ActivityTransition.Builder()
                    .setActivityType(type)
                    .setActivityTransition(
                        com.google.android.gms.location.ActivityTransition.ACTIVITY_TRANSITION_EXIT)
                    .build());
            }

            Context ctx = getContext();
            Intent intent = new Intent(ctx, EmergyActivityReceiver.class);
            // MUTABLE, required for activity recognition PendingIntents on 31+:
            // the system writes the transition result into the intent.
            PendingIntent pi = PendingIntent.getBroadcast(
                ctx, 920010, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);

            com.google.android.gms.location.ActivityRecognition.getClient(ctx)
                .requestActivityTransitionUpdates(
                    new com.google.android.gms.location.ActivityTransitionRequest(transitions), pi)
                .addOnSuccessListener(unused -> {
                    ctx.getSharedPreferences(EmergyActivityReceiver.PREFS, Context.MODE_PRIVATE)
                        .edit().putBoolean("tracking", true).apply();
                    call.resolve();
                })
                .addOnFailureListener(e ->
                    call.reject(e.getMessage() == null ? "Couldn't start motion tracking" : e.getMessage()));
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Couldn't start motion tracking" : e.getMessage());
        }
    }

    @PluginMethod
    public void stopActivityTransitions(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent intent = new Intent(ctx, EmergyActivityReceiver.class);
            PendingIntent pi = PendingIntent.getBroadcast(
                ctx, 920010, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
            com.google.android.gms.location.ActivityRecognition.getClient(ctx)
                .removeActivityTransitionUpdates(pi);
            ctx.getSharedPreferences(EmergyActivityReceiver.PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean("tracking", false).apply();
        } catch (Exception ignored) { }
        call.resolve();
    }

    /**
     * Hand over the queued transition events and clear them — a handover, not
     * a mailbox, like takePendingSay: an event drained twice would become the
     * same journey twice.
     */
    @PluginMethod
    public void drainActivityEvents(PluginCall call) {
        android.content.SharedPreferences prefs = getContext()
            .getSharedPreferences(EmergyActivityReceiver.PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(EmergyActivityReceiver.KEY_EVENTS, "[]");
        prefs.edit().remove(EmergyActivityReceiver.KEY_EVENTS).apply();
        JSObject out = new JSObject();
        out.put("events", raw);
        call.resolve(out);
    }

    /**
     * What the chat head last said, handed to the web layer once and then
     * forgotten.
     *
     * The head speaks while the app is closed, so the sentence has to wait
     * somewhere until something opens and asks for it. Reading it clears it:
     * this is a handover, not a mailbox, and a message collected twice would
     * start the same conversation twice.
     *
     * Deliberately not passed as a URL parameter. The web layer renders this
     * as something Emergy said, in an app that talks about medication — a
     * `?say=` link would let anyone who could get this user to tap a link put
     * words in his mouth. Out of the app's own private storage, nothing can.
     */
    @PluginMethod
    public void takePendingSay(PluginCall call) {
        android.content.SharedPreferences prefs =
            getContext().getSharedPreferences(POP_PREFS, Context.MODE_PRIVATE);
        String message = prefs.getString(PENDING_SAY, null);
        if (message != null) prefs.edit().remove(PENDING_SAY).apply();
        JSObject out = new JSObject();
        out.put("message", message);
        call.resolve(out);
    }

    /** Reserved, well clear of the sequential ids the real pops are given. */
    private static final int TEST_POP_ID = 999_999;

    private static final String POP_PREFS = "emergy_head_pops";
    /** Shared with EmergyHeadService, which is what writes it. */
    static final String PENDING_SAY = "pending_say";
    private static final String POP_LIST = "pops";

    private static boolean canScheduleExact(android.app.AlarmManager am) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
    }

    private static android.app.PendingIntent popIntent(Context ctx, int id, String message) {
        Intent intent = new Intent(ctx, HeadAlarmReceiver.class)
            .setAction(HeadAlarmReceiver.ACTION_POP)
            .putExtra(HeadAlarmReceiver.EXTRA_MESSAGE, message);
        return android.app.PendingIntent.getBroadcast(
            ctx, id, intent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
    }

    private static org.json.JSONArray storedPops(Context ctx) {
        String raw = ctx.getSharedPreferences(POP_PREFS, Context.MODE_PRIVATE)
            .getString(POP_LIST, "[]");
        try {
            return new org.json.JSONArray(raw == null ? "[]" : raw);
        } catch (Exception e) {
            return new org.json.JSONArray();
        }
    }

    private static void cancelAllPops(Context ctx) {
        android.app.AlarmManager am = ctx.getSystemService(android.app.AlarmManager.class);
        org.json.JSONArray stored = storedPops(ctx);
        if (am != null) {
            for (int i = 0; i < stored.length(); i++) {
                try {
                    am.cancel(popIntent(ctx, stored.getJSONObject(i).optInt("id"), ""));
                } catch (Exception ignored) {
                    // A malformed entry cancels nothing; it must not stop the rest.
                }
            }
        }
        ctx.getSharedPreferences(POP_PREFS, Context.MODE_PRIVATE)
            .edit().remove(POP_LIST).apply();
    }

    /**
     * Put the stored alarms back after the system threw them away.
     *
     * Android clears every alarm an app holds when the phone reboots and when
     * the app is updated. Nothing here notices, so without this the pop-outs
     * simply stop — and the settings card would go on saying "20 armed",
     * because from its side nothing changed. That is the exact failure this
     * whole feature keeps being rebuilt to avoid.
     *
     * Occurrences already past are dropped rather than fired late; a nudge
     * from before a reboot is not news.
     */
    static int rearmStoredPops(Context ctx) {
        if (!android.provider.Settings.canDrawOverlays(ctx)) return 0;
        android.app.AlarmManager am = ctx.getSystemService(android.app.AlarmManager.class);
        if (am == null) return 0;

        org.json.JSONArray stored = storedPops(ctx);
        org.json.JSONArray kept = new org.json.JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < stored.length(); i++) {
            try {
                org.json.JSONObject pop = stored.getJSONObject(i);
                long at = pop.optLong("at", 0L);
                String message = pop.optString("message", "");
                int id = pop.optInt("id", 0);
                if (id == 0 || at <= now || message.isEmpty()) continue;
                android.app.PendingIntent pi = popIntent(ctx, id, message);
                if (canScheduleExact(am)) {
                    am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
                } else {
                    am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
                }
                kept.put(pop);
            } catch (Exception ignored) {
                // One bad record must not cost the rest of the list.
            }
        }
        ctx.getSharedPreferences(POP_PREFS, Context.MODE_PRIVATE)
            .edit().putString(POP_LIST, kept.toString()).apply();
        return kept.length();
    }

    @PluginMethod
    public void stopHead(PluginCall call) {
        Context ctx = getContext();
        setKeepHead(ctx, false);
        ctx.stopService(new Intent(ctx, EmergyHeadService.class));
        call.resolve();
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
