package app.emergenthealth;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * When the screen went dark, when it came back, and when the phone went on
 * charge.
 *
 * This exists because usage access does not. Android lists an app under
 * Settings → Usage access only if it declares PACKAGE_USAGE_STATS, which
 * play-store/COMPLIANCE.md says not to declare and no commit ever has — so the
 * screen-time cards now tell the truth and read nothing. That was the right
 * call and this does not reopen it: SCREEN_ON, SCREEN_OFF, USER_PRESENT and
 * the two power actions need **no permission of any kind**, and they answer
 * most of what screen time was wanted for. Not "which app", which is the part
 * Play asks about — when the phone was put down for the night, when it was
 * first unlocked in the morning, how many times it was picked up, and how long
 * it spent on the charger.
 *
 * SCREEN_ON and SCREEN_OFF cannot be declared in a manifest. They are
 * protected broadcasts that the system delivers only to receivers registered
 * at runtime, which is why this is registered by the foreground services
 * rather than listed in manifest_additions.xml — and why it collects while
 * one of them is alive and not otherwise. That limit is real and is written
 * into the Settings card: a phone with nothing switched on records nothing.
 *
 * Raw moments, in the order they happened. Pairing them into nights and
 * counting them into days happens server-side, for the same reason the
 * activity receiver stores raw transitions: pairing here would be logic that
 * can only be debugged on a phone.
 */
public class EmergyPhoneEventReceiver extends BroadcastReceiver {

    static final String PREFS = "emergy_phone_events";
    static final String KEY_EVENTS = "events";

    /**
     * A heavy phone day is a few hundred of these. This is about a week of
     * one, and past it the OLDEST go — same call as everywhere else here.
     */
    private static final int MAX_EVENTS = 3000;

    /** Values are the `kind` column; anything reading them treats an unknown as skip. */
    private static final String SCREEN_ON = "screen_on";
    private static final String SCREEN_OFF = "screen_off";
    private static final String UNLOCK = "unlock";
    private static final String CHARGE_ON = "charge_on";
    private static final String CHARGE_OFF = "charge_off";

    /**
     * Register for what the manifest cannot carry.
     *
     * Called by each foreground service as it starts. Registering the same
     * receiver twice on one context throws nothing but leaks a registration,
     * so each caller keeps its own instance and unregisters it in onDestroy.
     */
    static EmergyPhoneEventReceiver register(Context ctx) {
        EmergyPhoneEventReceiver receiver = new EmergyPhoneEventReceiver();
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        filter.addAction(Intent.ACTION_POWER_CONNECTED);
        filter.addAction(Intent.ACTION_POWER_DISCONNECTED);
        try {
            // NOT_EXPORTED spelled out, exactly as EmergyWakeService does for
            // its power receiver: from Android 14 a runtime receiver must say,
            // and this app's targetSdk floor is 35. Plain registerReceiver()
            // throws there — and because the caller ignores the failure, it
            // would have collected nothing while looking entirely fine.
            androidx.core.content.ContextCompat.registerReceiver(
                ctx, receiver, filter, androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
            return receiver;
        } catch (Exception ignored) {
            // Nothing else in the service depends on this having worked.
            return null;
        }
    }

    /** Let go of one registered by {@link #register}. Safe with null. */
    static void unregister(Context ctx, EmergyPhoneEventReceiver receiver) {
        if (receiver == null) return;
        try { ctx.unregisterReceiver(receiver); } catch (Exception ignored) { }
    }

    static int queuedCount(Context ctx) {
        try {
            return new JSONArray(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_EVENTS, "[]")).length();
        } catch (Exception ignored) {
            return 0;
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        String kind;
        switch (intent.getAction()) {
            case Intent.ACTION_SCREEN_ON:          kind = SCREEN_ON;  break;
            case Intent.ACTION_SCREEN_OFF:         kind = SCREEN_OFF; break;
            // Not the same as SCREEN_ON: the screen lights up for every
            // notification. This one means a person got past the lock screen,
            // which is what "picked the phone up" actually means.
            case Intent.ACTION_USER_PRESENT:       kind = UNLOCK;     break;
            case Intent.ACTION_POWER_CONNECTED:    kind = CHARGE_ON;  break;
            case Intent.ACTION_POWER_DISCONNECTED: kind = CHARGE_OFF; break;
            default: return;
        }
        store(ctx.getApplicationContext(), kind, System.currentTimeMillis());

        // The screen going off is the cheapest moment there is to read the
        // room: the phone is usually out, and it is the reading that matters
        // most — light at the moment somebody stopped looking at their phone
        // is very nearly light at bedtime. The sampler's own floor decides
        // whether this one is actually taken.
        if (SCREEN_OFF.equals(kind)) {
            try { EmergyAmbientSampler.sample(ctx); } catch (Exception ignored) { }
        }
    }

    private static synchronized void store(Context ctx, String kind, long at) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray events = new JSONArray(p.getString(KEY_EVENTS, "[]"));
            JSONObject row = new JSONObject();
            row.put("k", kind);
            row.put("at", at);
            events.put(row);
            while (events.length() > MAX_EVENTS) events.remove(0);
            p.edit().putString(KEY_EVENTS, events.toString()).apply();
        } catch (Exception ignored) { }
    }
}
