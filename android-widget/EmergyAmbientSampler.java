package app.emergenthealth;

import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * One reading of the phone's own environment, taken and put down again.
 *
 * Two sensors, neither of which costs a permission and neither of which the
 * app has ever looked at:
 *
 *   TYPE_LIGHT — how much light is around the phone, in lux. The reason to
 *   want it is sleep: evening light exposure against time to fall asleep is
 *   the best-established relationship in the whole of this app's data, and
 *   sleep latency is already recorded on most nights.
 *
 *   TYPE_PRESSURE — station pressure in hPa. A weather cron already pulls
 *   pressure for the user's rough location from an API; this is the same
 *   quantity measured where the person actually is, at whatever resolution we
 *   care to sample. Pressure drops are a documented migraine trigger, and the
 *   engine cannot test that on somebody's behalf without the number.
 *
 * ONE-SHOT, deliberately. A registered listener delivers events continuously
 * and costs battery for a value that moves on the scale of hours; this
 * registers, keeps the first reading of each, and unregisters. The caller is
 * the fifteen-minute watchdog that already exists, plus the app's own
 * foreground — so sampling costs no new alarm, no new service and no new
 * notification.
 *
 * What it cannot do, which anything reading these rows has to know: the light
 * sensor is on the front of the phone. In a pocket it reads darkness, face
 * down on a desk it reads night. This is "how much light was around when the
 * phone could see", not an exposure measurement, and the difference matters
 * enough that the column comments say so too.
 */
final class EmergyAmbientSampler {

    static final String PREFS = "emergy_ambient";
    static final String KEY_SAMPLES = "samples";

    /**
     * Roughly a fortnight at four an hour. Past this the OLDEST go: the newest
     * describe days the user is about to look at, the oldest a stretch the
     * phone never got a chance to upload anyway — the same call the activity
     * receiver and the location queue both make.
     */
    private static final int MAX_SAMPLES = 1400;

    /**
     * How long to wait for a first reading before giving up.
     *
     * Light usually arrives in milliseconds. Pressure can be slower, and a
     * sensor that is present but asleep may never answer at all — so this
     * cannot be a wait without an end, and it runs on its own handler rather
     * than blocking whoever called.
     */
    private static final long TIMEOUT_MS = 2_000L;

    /**
     * Don't sample more often than this. The watchdog runs every fifteen
     * minutes and the app can foreground at any moment; without a floor, a
     * morning of opening and closing the app would write a hundred rows that
     * say the same thing.
     */
    private static final long MIN_GAP_MS = 5 * 60_000L;
    private static final String LAST_AT = "last_at";

    private EmergyAmbientSampler() { }

    /** True when this phone has at least one of the two sensors. */
    static boolean available(Context ctx) {
        SensorManager sm = ctx.getSystemService(SensorManager.class);
        if (sm == null) return false;
        return sm.getDefaultSensor(Sensor.TYPE_LIGHT) != null
            || sm.getDefaultSensor(Sensor.TYPE_PRESSURE) != null;
    }

    static int queuedCount(Context ctx) {
        try {
            return new JSONArray(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_SAMPLES, "[]")).length();
        } catch (Exception ignored) {
            return 0;
        }
    }

    /**
     * Take a reading, unless one was taken recently. Returns immediately; the
     * row is written when the sensors answer, or not at all.
     */
    static void sample(Context ctx) {
        final Context app = ctx.getApplicationContext();
        SensorManager sm = app.getSystemService(SensorManager.class);
        if (sm == null) return;

        Sensor light = sm.getDefaultSensor(Sensor.TYPE_LIGHT);
        Sensor pressure = sm.getDefaultSensor(Sensor.TYPE_PRESSURE);
        if (light == null && pressure == null) return;

        SharedPreferences p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        if (now - p.getLong(LAST_AT, 0L) < MIN_GAP_MS) return;
        // Claim the slot before the readings arrive, so two overlapping calls
        // cannot both decide they are the one taking this sample.
        p.edit().putLong(LAST_AT, now).apply();

        final Handler handler = new Handler(Looper.getMainLooper());
        final float[] readings = new float[]{ Float.NaN, Float.NaN };
        final boolean[] done = new boolean[]{ false };

        final SensorEventListener listener = new SensorEventListener() {
            @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }

            @Override
            public void onSensorChanged(SensorEvent event) {
                if (event.values == null || event.values.length == 0) return;
                if (event.sensor.getType() == Sensor.TYPE_LIGHT) readings[0] = event.values[0];
                else if (event.sensor.getType() == Sensor.TYPE_PRESSURE) readings[1] = event.values[0];
            }
        };

        final Runnable finish = new Runnable() {
            @Override
            public void run() {
                // Whichever of the timeout and an early finish gets here first
                // owns the unregister; the other must not write a second row.
                if (done[0]) return;
                done[0] = true;
                try { sm.unregisterListener(listener); } catch (Exception ignored) { }
                store(app, readings[0], readings[1], System.currentTimeMillis());
            }
        };

        try {
            if (light != null) sm.registerListener(listener, light, SensorManager.SENSOR_DELAY_NORMAL);
            if (pressure != null) sm.registerListener(listener, pressure, SensorManager.SENSOR_DELAY_NORMAL);
        } catch (Exception e) {
            try { sm.unregisterListener(listener); } catch (Exception ignored) { }
            return;
        }
        handler.postDelayed(finish, TIMEOUT_MS);
    }

    private static synchronized void store(Context ctx, float lux, float hpa, long at) {
        boolean hasLux = !Float.isNaN(lux);
        boolean hasHpa = !Float.isNaN(hpa);
        // A row saying nothing is worse than no row: it would read downstream
        // as "we looked and it was dark", which is a different claim.
        if (!hasLux && !hasHpa) return;

        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray samples = new JSONArray(p.getString(KEY_SAMPLES, "[]"));
            JSONObject row = new JSONObject();
            row.put("at", at);
            if (hasLux) row.put("lx", Math.round(lux * 100.0) / 100.0);
            if (hasHpa) row.put("hpa", Math.round(hpa * 100.0) / 100.0);
            samples.put(row);
            while (samples.length() > MAX_SAMPLES) samples.remove(0);
            p.edit().putString(KEY_SAMPLES, samples.toString()).apply();
        } catch (Exception ignored) {
            // One unreadable store must not stop the next reading.
        }
    }
}
