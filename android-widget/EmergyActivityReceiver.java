package app.emergenthealth;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import com.google.android.gms.location.ActivityTransitionEvent;
import com.google.android.gms.location.ActivityTransitionResult;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Catches Activity Recognition transitions while the app is closed.
 *
 * The OS delivers "the phone ENTERED walking / EXITED a vehicle" moments to
 * this receiver whatever the WebView is doing, including not existing. Each
 * event is appended to SharedPreferences and sits there until the web layer
 * drains it on the next foreground — the same store-and-forward shape as the
 * head's pending message and the background location queue, and for the same
 * reason: anything held only in the page dies with the page.
 *
 * Events are stored raw ({t: activity type, e: 0 enter / 1 exit, at: ms}) and
 * paired into spans server-side, where the pairing logic is pure and tested.
 * Pairing here would mean logic that can only be debugged on a phone.
 */
public class EmergyActivityReceiver extends BroadcastReceiver {

    static final String PREFS = "emergy_activity";
    static final String KEY_EVENTS = "events";
    static final String KEY_TRACKING = "tracking";

    /** Same contract as EmergySleepReceiver.pendingIntent — one definition. */
    static PendingIntent pendingIntent(Context ctx) {
        Intent intent = new Intent(ctx, EmergyActivityReceiver.class);
        return PendingIntent.getBroadcast(
            ctx, 920010, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
    }

    /** The transition set the plugin subscribes to — the one definition. */
    static com.google.android.gms.location.ActivityTransitionRequest request() {
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
        return new com.google.android.gms.location.ActivityTransitionRequest(transitions);
    }

    /**
     * Put the subscription back after Android threw it away — see
     * EmergySleepReceiver.resubscribe for why, and for the flag-off rule.
     */
    static void resubscribe(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean(KEY_TRACKING, false)) return;
        if (ctx.checkSelfPermission(android.Manifest.permission.ACTIVITY_RECOGNITION)
                != PackageManager.PERMISSION_GRANTED) {
            p.edit().putBoolean(KEY_TRACKING, false).apply();
            return;
        }
        try {
            com.google.android.gms.location.ActivityRecognition.getClient(ctx)
                .requestActivityTransitionUpdates(request(), pendingIntent(ctx))
                .addOnFailureListener(e ->
                    p.edit().putBoolean(KEY_TRACKING, false).apply());
        } catch (Exception e) {
            p.edit().putBoolean(KEY_TRACKING, false).apply();
        }
    }

    /**
     * More than a week of dense transitions. Past this the OLDEST are dropped:
     * the newest describe days the user is about to look at, the oldest a
     * stretch the phone never got a chance to upload anyway.
     */
    private static final int MAX_EVENTS = 2000;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ActivityTransitionResult.hasResult(intent)) return;
        ActivityTransitionResult result = ActivityTransitionResult.extractResult(intent);
        if (result == null) return;

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray events;
        try {
            events = new JSONArray(prefs.getString(KEY_EVENTS, "[]"));
        } catch (Exception e) {
            events = new JSONArray();
        }

        // elapsedRealTimeNanos is time since BOOT, not the epoch — converting
        // via the current clock is what turns it into a timestamp the server
        // can line up against GPS points.
        long bootEpochMs = System.currentTimeMillis()
            - android.os.SystemClock.elapsedRealtime();

        try {
            for (ActivityTransitionEvent e : result.getTransitionEvents()) {
                JSONObject o = new JSONObject();
                o.put("t", e.getActivityType());
                o.put("e", e.getTransitionType());
                o.put("at", bootEpochMs + (e.getElapsedRealTimeNanos() / 1_000_000L));
                events.put(o);
            }
        } catch (Exception ignored) {
            // A single malformed event must not lose the batch.
        }

        while (events.length() > MAX_EVENTS) {
            events.remove(0);
        }

        prefs.edit().putString(KEY_EVENTS, events.toString()).apply();
    }
}
