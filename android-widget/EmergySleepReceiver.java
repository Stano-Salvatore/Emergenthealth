package app.emergenthealth;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.google.android.gms.location.SleepSegmentEvent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * Sleep as the phone guessed it — for the nights the ring was not worn.
 *
 * Android's Sleep API fuses the light sensor and motion into "this person was
 * asleep from about here to about here", delivered once in the morning. It is
 * a worse instrument than the ring in every respect: it has no stages, no
 * heart rate and no real precision. On the nights the ring was on the finger
 * its segments are worth nothing.
 *
 * The nights it is worth something are the ones with a hole in them now — the
 * ring on the charger, the ring forgotten, the night away from home. Those
 * nights currently read as though sleep did not happen, which is the worst of
 * the three possible answers. Hence its own table, never HealthLog: a phone
 * guess must not be able to overwrite a measurement, and keeping them apart is
 * the only way to be sure it cannot.
 *
 * It costs NO new permission. SleepSegmentRequest runs on ACTIVITY_RECOGNITION,
 * which this app already declares and already asks for, for the travel-mode
 * transitions in EmergyActivityReceiver. That is the whole reason this is
 * worth doing now rather than later: everything about the Play submission
 * stays exactly as it was.
 *
 * Store-and-forward into SharedPreferences, drained by the web layer on the
 * next foreground — the same shape as the transitions beside it, and for the
 * same reason: segments arrive while the app does not exist.
 */
public class EmergySleepReceiver extends BroadcastReceiver {

    static final String PREFS = "emergy_sleep";
    static final String KEY_SEGMENTS = "segments";
    static final String KEY_TRACKING = "tracking";

    /** One or two a night. This is years, and the cap is a formality. */
    private static final int MAX_SEGMENTS = 400;

    static boolean tracking(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_TRACKING, false);
    }

    static int queuedCount(Context ctx) {
        try {
            return new JSONArray(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_SEGMENTS, "[]")).length();
        } catch (Exception ignored) {
            return 0;
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !SleepSegmentEvent.hasEvents(intent)) return;
        List<SleepSegmentEvent> events = SleepSegmentEvent.extractEvents(intent);
        if (events == null || events.isEmpty()) return;

        SharedPreferences p = ctx.getApplicationContext()
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray stored = new JSONArray(p.getString(KEY_SEGMENTS, "[]"));
            for (SleepSegmentEvent e : events) {
                long start = e.getStartTimeMillis();
                long end = e.getEndTimeMillis();
                // Status 1 is "missing data" and 2 is "not detected". Both are
                // kept rather than dropped: a night the phone looked at and
                // could not call is a different fact from a night nobody
                // asked about, and the server decides what to do with each.
                if (end <= start) continue;
                JSONObject row = new JSONObject();
                row.put("s", start);
                row.put("e", end);
                row.put("st", e.getStatus());
                stored.put(row);
            }
            while (stored.length() > MAX_SEGMENTS) stored.remove(0);
            p.edit().putString(KEY_SEGMENTS, stored.toString()).apply();
        } catch (Exception ignored) {
            // A malformed batch must not take the stored ones with it.
        }
    }
}
