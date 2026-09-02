package app.emergenthealth;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Background location that does not need the app to be alive.
 *
 * The first version of "Emergy follows along" used a Capacitor plugin whose
 * service handed every fix to the WebView, and the WebView uploaded it. That
 * works exactly as long as the app's process lives — and the process dies
 * when the app is swiped out of recents, when memory runs short, when the
 * phone restarts, and on Samsung whenever the "sleeping apps" logic decides.
 * Every one of those looked the same from the outside: the switch said
 * "following along" and the points simply stopped.
 *
 * This service owns the whole loop natively. It asks the fused provider for
 * fixes, applies the same thinning the web version did (one point per five
 * minutes while still, immediately after moving 200 m), keeps the queue on
 * disk, and POSTs it to the server with the home-screen widgets' key — the
 * same credentials the widgets already hold in the app's private storage.
 * No WebView, no session cookie, nothing that goes away with the app.
 *
 * It is sticky while the user has asked for it, restarts itself after the
 * app is swiped away, and the boot receiver starts it after a restart. The
 * notification it shows the whole time carries a Stop button; that, and the
 * switch in Settings, are the two ways to end it, and both clear the wish so
 * it never comes back uninvited.
 */
public class EmergyLocationService extends Service {

    public static final String ACTION_STOP = "app.emergenthealth.LOCATION_STOP";

    static final String PREFS = "emergy_location";
    private static final String KEEP_KEY = "keep";
    private static final String QUEUE_KEY = "queue";
    private static final String LAST_AT = "last_at";
    private static final String LAST_LAT = "last_lat";
    private static final String LAST_LNG = "last_lng";

    private static final String CHANNEL_ID = "emergy_location";
    private static final int NOTIFICATION_ID = 920004;
    private static final int RESTART_REQUEST = 920005;

    /** How often the provider is asked; it may deliver less often on its own. */
    private static final long INTERVAL_MS = 60_000;
    /** At most one stored point every five minutes while standing still. */
    private static final long MIN_UPLOAD_GAP_MS = 5 * 60_000;
    /** Moving this far stores a point at once, so a journey is a line. */
    private static final float MOVED_FAR_M = 200f;
    /** Points wait this long for company before going up together. */
    private static final long FLUSH_DELAY_MS = 20_000;
    /** Roughly a day of stationary tracking; beyond this the oldest go. */
    private static final int MAX_QUEUED = 200;

    private static volatile boolean running = false;
    public static boolean isRunning() { return running; }

    private FusedLocationProviderClient client;
    private LocationCallback callback;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable flushNow = new Runnable() { @Override public void run() { flush(); } };
    private volatile boolean uploading = false;

    // ------------------------------------------------------------ the wish

    static boolean keep(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEEP_KEY, false);
    }

    static void setKeep(Context ctx, boolean keep) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEEP_KEY, keep).apply();
    }

    static boolean hasFineLocation(Context ctx) {
        return ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** "Allow all the time" — what a restart from the background needs on Android 10+. */
    static boolean hasBackgroundLocation(Context ctx) {
        if (Build.VERSION.SDK_INT < 29) return true;
        return ctx.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Start if asked for, allowed, and not already up. Safe to call from anywhere. */
    static void ensureRunning(Context ctx) {
        if (!keep(ctx) || !hasFineLocation(ctx) || running) return;
        try {
            ctx.startForegroundService(new Intent(ctx, EmergyLocationService.class));
        } catch (Exception ignored) {
            // A background start the system refused. The next time the app is
            // opened it starts from the foreground, which is always allowed.
        }
    }

    // ---------------------------------------------------------- lifecycle

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        startForegroundNotice("Logging the places you spend time at");
        running = true;

        client = LocationServices.getFusedLocationProviderClient(this);
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, INTERVAL_MS)
            .setMinUpdateIntervalMillis(30_000)
            // No distance filter, on purpose: a visit is only counted when
            // points keep arriving INSIDE the place, and sitting still moves
            // you zero metres. The thinning happens in onFix, on time.
            .setMinUpdateDistanceMeters(0f)
            .build();
        callback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location last = result.getLastLocation();
                if (last != null) onFix(last);
            }
        };
        try {
            client.requestLocationUpdates(request, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            // Permission gone since the wish was stored. Nothing to track with.
            setKeep(this, false);
            stopSelf();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            setKeep(this, false);
            if (!EmergyWakeService.keep(this)) HeadAlarmReceiver.cancelWatchdog(this);
            stopSelf();
            return START_NOT_STICKY;
        }
        // Arm the next heartbeat every time the service starts. That covers the
        // first start, a sticky restart, and a restart the heartbeat itself
        // caused — so the chain re-arms from wherever it was picked up.
        if (keep(this)) HeadAlarmReceiver.scheduleWatchdog(this);
        // Anything left over from before the process last died goes up first.
        main.removeCallbacks(flushNow);
        main.postDelayed(flushNow, 2_000);
        return keep(this) ? START_STICKY : START_NOT_STICKY;
    }

    /**
     * The app was swiped out of recents. On many phones that takes this
     * service with it, sticky or not; an alarm a moment later starts it again
     * from outside the dying process.
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (keep(this)) {
            Intent restart = new Intent(this, HeadAlarmReceiver.class).setAction(HeadAlarmReceiver.ACTION_LOCATION_RESTART);
            PendingIntent pi = PendingIntent.getBroadcast(
                this, RESTART_REQUEST, restart, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            AlarmManager am = getSystemService(AlarmManager.class);
            if (am != null) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 1500, pi);
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(flushNow);
        if (client != null && callback != null) {
            try { client.removeLocationUpdates(callback); } catch (Exception ignored) {}
        }
        running = false;
        super.onDestroy();
    }

    // -------------------------------------------------------------- fixes

    private void onFix(Location loc) {
        long at = loc.getTime() > 0 ? loc.getTime() : System.currentTimeMillis();
        SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long lastAt = p.getLong(LAST_AT, 0L);
        boolean movedFar = true;
        if (lastAt != 0L) {
            float[] d = new float[1];
            Location.distanceBetween(p.getFloat(LAST_LAT, 0f), p.getFloat(LAST_LNG, 0f),
                loc.getLatitude(), loc.getLongitude(), d);
            movedFar = d[0] >= MOVED_FAR_M;
        }
        boolean dueByTime = lastAt == 0L || at - lastAt >= MIN_UPLOAD_GAP_MS;
        if (!movedFar && !dueByTime) return;

        p.edit()
            .putLong(LAST_AT, at)
            .putFloat(LAST_LAT, (float) loc.getLatitude())
            .putFloat(LAST_LNG, (float) loc.getLongitude())
            .apply();

        try {
            JSONObject point = new JSONObject();
            point.put("lat", loc.getLatitude());
            point.put("lng", loc.getLongitude());
            point.put("trackedAt", iso(at));
            if (loc.hasAccuracy()) point.put("accuracyM", Math.round(loc.getAccuracy()));
            if (loc.hasAltitude()) point.put("altitudeM", loc.getAltitude());
            // The provider reports metres per second; everything downstream stores km/h.
            if (loc.hasSpeed()) point.put("speedKmh", loc.getSpeed() * 3.6);
            JSONArray queue = queue();
            queue.put(point);
            while (queue.length() > MAX_QUEUED) queue.remove(0);
            saveQueue(queue);
            updateNotice(queue.length() + " waiting to upload");
        } catch (Exception ignored) {
            // One bad fix must not stop the next.
        }

        // Give a moving phone a moment to produce its next fix, so a journey
        // goes up as one request rather than one per point.
        main.removeCallbacks(flushNow);
        main.postDelayed(flushNow, FLUSH_DELAY_MS);
    }

    private static String iso(long millis) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(millis));
    }

    // -------------------------------------------------------------- queue

    private synchronized JSONArray queue() {
        String raw = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(QUEUE_KEY, "[]");
        try { return new JSONArray(raw == null ? "[]" : raw); } catch (Exception e) { return new JSONArray(); }
    }

    private synchronized void saveQueue(JSONArray queue) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(QUEUE_KEY, queue.toString()).apply();
    }

    /** Drop the first n entries — the ones a successful upload just carried. */
    private synchronized void dropSent(int n) {
        JSONArray queue = queue();
        JSONArray rest = new JSONArray();
        for (int i = n; i < queue.length(); i++) {
            try { rest.put(queue.getJSONObject(i)); } catch (Exception ignored) {}
        }
        saveQueue(rest);
    }

    /** {apiKey, baseUrl} from the widgets' storage, or null before activation. */
    private String[] creds() {
        SharedPreferences cap = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String key = cap.getString("widget_api_key", null);
        String url = cap.getString("widget_app_url", null);
        if (key == null || url == null) return null;
        return new String[]{ key, url.replaceAll("/+$", "") };
    }

    private void flush() {
        if (uploading) return;
        final JSONArray batch = queue();
        if (batch.length() == 0) return;
        final String[] c = creds();
        if (c == null) {
            // The app writes these on every launch (widget activation); until
            // then points are kept and the notification says why.
            updateNotice(batch.length() + " waiting — open the app once to link this phone");
            return;
        }
        uploading = true;
        final int count = batch.length();
        new Thread(new Runnable() {
            @Override
            public void run() {
                int code = 0;
                try {
                    HttpURLConnection conn = (HttpURLConnection) new URL(c[1] + "/api/widget/location").openConnection();
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(10_000);
                    conn.setReadTimeout(20_000);
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("x-widget-key", c[0]);
                    JSONObject body = new JSONObject();
                    body.put("points", batch);
                    byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                    OutputStream out = conn.getOutputStream();
                    out.write(bytes);
                    out.flush();
                    out.close();
                    code = conn.getResponseCode();
                    conn.disconnect();
                } catch (Exception ignored) {
                    code = 0;
                }
                final int result = code;
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        uploading = false;
                        if (result >= 200 && result < 300) {
                            dropSent(count);
                            updateNotice("Logging the places you spend time at · last upload " + clock());
                        } else if (result == 401 || result == 403) {
                            // A key the server no longer knows refuses every batch the
                            // same way; holding them would repost forever.
                            dropSent(count);
                            updateNotice("Not linked — open the app once to relink this phone");
                        } else {
                            // Offline or a server hiccup: keep the batch, try after the next fix.
                            updateNotice(queue().length() + " waiting to upload");
                        }
                    }
                });
            }
        }).start();
    }

    private static String clock() {
        return new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date());
    }

    // ------------------------------------------------------- notification

    private Notification notice(String text) {
        Intent stop = new Intent(this, EmergyLocationService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(
            this, 0, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_emergy)
            .setContentTitle("Emergy is following along")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(new Notification.Action.Builder(null, "Stop", stopIntent).build())
            .build();
    }

    private void updateNotice(String text) {
        if (!running) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(NOTIFICATION_ID, notice(text));
    }

    private void startForegroundNotice(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Emergy following along", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while your location is being logged for place check-ins");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            nm.createNotificationChannel(channel);
        }
        int type = Build.VERSION.SDK_INT >= 29
            ? android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            : 0;
        androidx.core.app.ServiceCompat.startForeground(this, NOTIFICATION_ID, notice(text), type);
    }
}
