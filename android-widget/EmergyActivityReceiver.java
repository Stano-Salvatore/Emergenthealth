package app.emergenthealth;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
