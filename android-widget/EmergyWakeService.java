package app.emergenthealth;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;

/**
 * Listening for his name.
 *
 * The wake word itself is NOT here yet — this is everything around it, and
 * everything around it is where the risk lives. An always-on microphone
 * service has to survive the app being closed, survive a reboot, survive
 * Samsung's sleeping-apps logic, hold a foreground service of the one type
 * Android 14 will allow for a microphone, and hand over to the app when it
 * fires. None of that can be proved by reading code; all of it can be proved
 * by running this and watching.
 *
 * So the detector is an interface with a stub behind it. The service records,
 * frames the audio exactly as a detector would want it, and asks the stub —
 * which always says no. `testFire()` says yes on demand, which is how the
 * whole chain gets tested before a 30 MB model is anywhere near the APK.
 *
 * When it does fire, it does not try to be clever: it wakes the app into
 * dictation through the same private-storage mailbox the chat head uses for
 * what it said, and the dictation that opens sends itself after six seconds
 * of quiet. "Hey Emergi, log Elicea" — pause — done.
 */
public class EmergyWakeService extends Service {

    public static final String ACTION_STOP = "app.emergenthealth.WAKE_STOP";
    public static final String ACTION_TEST_FIRE = "app.emergenthealth.WAKE_TEST_FIRE";

    static final String PREFS = "emergy_wake";
    private static final String KEEP_KEY = "keep";
    /** Only listen while plugged in. On by default: the honest setting. */
    private static final String CHARGING_ONLY_KEY = "charging_only";
    /** What the service leaves for the app to find. Read via the plugin. */
    static final String PENDING_WAKE = "pending_wake";

    private static final String CHANNEL_ID = "emergy_wake";
    private static final int NOTIFICATION_ID = 920006;
    private static final int RESTART_REQUEST = 920007;

    /** What every wake-word model in this class expects: 16 kHz mono PCM16. */
    private static final int SAMPLE_RATE = 16_000;
    /** 100 ms of audio per frame — small enough to react, big enough to be cheap. */
    private static final int FRAME_SAMPLES = SAMPLE_RATE / 10;

    private static volatile boolean running = false;
    public static boolean isRunning() { return running; }
    private static volatile boolean listening = false;
    /** True only while the microphone is actually open — charging-only can pause it. */
    public static boolean isListening() { return listening; }

    private Thread audioThread;
    private volatile boolean stopRequested = false;
    private WakeDetector detector;
    private BroadcastReceiver powerReceiver;

    // ------------------------------------------------------------ the wish

    static boolean keep(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEEP_KEY, false);
    }

    static void setKeep(Context ctx, boolean keep) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEEP_KEY, keep).apply();
    }

    static boolean chargingOnly(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(CHARGING_ONLY_KEY, true);
    }

    static void setChargingOnly(Context ctx, boolean on) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(CHARGING_ONLY_KEY, on).apply();
    }

    static boolean hasMicPermission(Context ctx) {
        return ctx.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
    }

    static boolean isPluggedIn(Context ctx) {
        Intent status = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (status == null) return false;
        int plugged = status.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
        return plugged != 0;
    }

    /** Start if asked for and allowed. Safe to call from anywhere. */
    static void ensureRunning(Context ctx) {
        if (!keep(ctx) || !hasMicPermission(ctx) || running) return;
        try {
            ctx.startForegroundService(new Intent(ctx, EmergyWakeService.class));
        } catch (Exception ignored) {
            // A background start Android refused; the next app launch will do it.
        }
    }

    // ---------------------------------------------------------- the detector

    /**
     * Whatever decides that the name was spoken.
     *
     * One method, taking the same 16 kHz mono frames whatever is behind it, so
     * the real engine drops in without the service changing. Milestone two
     * replaces StubDetector with sherpa-onnx: Apache 2.0, open-vocabulary (the
     * keyword is configuration rather than a model somebody has to train), and
     * therefore shippable to other people — which the alternatives were not.
     */
    interface WakeDetector {
        /** @return true when the wake word was heard in or before this frame. */
        boolean accept(short[] frame, int length);
        void close();
    }

    /** Hears nothing, ever. Deliberate: see the class comment. */
    static class StubDetector implements WakeDetector {
        @Override public boolean accept(short[] frame, int length) { return false; }
        @Override public void close() { }
    }

    // ---------------------------------------------------------- lifecycle

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        detector = new StubDetector();
        startForegroundNotice(noticeText());

        // Plugged in or not decides whether the mic is open at all, and it can
        // change at any moment, so the service listens for it rather than
        // checking once and being wrong for the rest of the day.
        powerReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) { syncListening(); }
        };
        IntentFilter power = new IntentFilter();
        power.addAction(Intent.ACTION_POWER_CONNECTED);
        power.addAction(Intent.ACTION_POWER_DISCONNECTED);
        // NOT_EXPORTED spelled out: from Android 14 a runtime receiver has to
        // say. These are protected system broadcasts, so they arrive either
        // way — but "either way" is how a crash on one OS version gets
        // shipped, and ContextCompat handles the older ones.
        androidx.core.content.ContextCompat.registerReceiver(
            this, powerReceiver, power, androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);

        syncListening();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            setKeep(this, false);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_TEST_FIRE.equals(intent.getAction())) {
            // The whole chain, without a model: pretend the name was heard.
            fire();
            return keep(this) ? START_STICKY : START_NOT_STICKY;
        }
        syncListening();
        return keep(this) ? START_STICKY : START_NOT_STICKY;
    }

    /**
     * The app was swiped out of recents. Same trick as the location service:
     * an alarm a moment later starts this again from outside the dying process.
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (keep(this)) {
            Intent restart = new Intent(this, HeadAlarmReceiver.class)
                .setAction(HeadAlarmReceiver.ACTION_WAKE_RESTART);
            PendingIntent pi = PendingIntent.getBroadcast(
                this, RESTART_REQUEST, restart,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            android.app.AlarmManager am = getSystemService(android.app.AlarmManager.class);
            if (am != null) am.setAndAllowWhileIdle(
                android.app.AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 1500, pi);
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopListening();
        if (powerReceiver != null) {
            try { unregisterReceiver(powerReceiver); } catch (Exception ignored) {}
            powerReceiver = null;
        }
        if (detector != null) { detector.close(); detector = null; }
        running = false;
        super.onDestroy();
    }

    // ---------------------------------------------------------- the mic

    /** Open or close the microphone to match the charging rule. */
    private synchronized void syncListening() {
        boolean should = hasMicPermission(this) && (!chargingOnly(this) || isPluggedIn(this));
        if (should && audioThread == null) startListening();
        else if (!should && audioThread != null) stopListening();
        updateNotice(noticeText());
    }

    private synchronized void startListening() {
        stopRequested = false;
        audioThread = new Thread(this::recordLoop, "emergy-wake");
        audioThread.start();
    }

    private synchronized void stopListening() {
        stopRequested = true;
        Thread t = audioThread;
        audioThread = null;
        if (t != null) t.interrupt();
        listening = false;
    }

    private void recordLoop() {
        int minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minBuffer <= 0) minBuffer = FRAME_SAMPLES * 2;
        // Room for several frames, so a scheduling hiccup drops nothing.
        int bufferBytes = Math.max(minBuffer, FRAME_SAMPLES * 2 * 4);

        AudioRecord record = null;
        try {
            record = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, bufferBytes);
            if (record.getState() != AudioRecord.STATE_INITIALIZED) return;
            record.startRecording();
            listening = true;
            updateNotice(noticeText());

            short[] frame = new short[FRAME_SAMPLES];
            while (!stopRequested && !Thread.currentThread().isInterrupted()) {
                int read = record.read(frame, 0, frame.length);
                if (read <= 0) continue;
                WakeDetector d = detector;
                if (d != null && d.accept(frame, read)) {
                    fire();
                    // One wake per utterance: without a pause the same words
                    // would trigger again on the very next frame.
                    try { Thread.sleep(2000); } catch (InterruptedException e) { break; }
                }
            }
        } catch (SecurityException e) {
            // Permission withdrawn while running. Nothing to listen with.
            setKeep(this, false);
            stopSelf();
        } catch (Exception ignored) {
            // A mic another app has taken, or a device that refused the format.
        } finally {
            listening = false;
            if (record != null) {
                try { record.stop(); } catch (Exception ignored) {}
                record.release();
            }
        }
    }

    // ---------------------------------------------------------- the handoff

    /**
     * Heard. Leave it in the app's own private storage and open the app.
     *
     * A mailbox rather than an intent extra, for the same reason takePendingSay
     * is one: what the app does with this is start listening to the microphone,
     * and nothing outside the app should be able to ask it to do that.
     */
    void fire() {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putLong(PENDING_WAKE, System.currentTimeMillis()).apply();
        try {
            Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (open != null) {
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(open);
            }
        } catch (Exception ignored) {
            // Locked or restricted from background-starting an activity; the
            // mailbox is still set, so the next foreground picks it up.
        }
    }

    // ------------------------------------------------------- notification

    private String noticeText() {
        if (!hasMicPermission(this)) return "Microphone permission is off";
        if (chargingOnly(this) && !isPluggedIn(this)) return "Paused — only listens while charging";
        return listening ? "Listening for your wake word" : "Starting…";
    }

    private Notification notice(String text) {
        Intent stop = new Intent(this, EmergyWakeService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(
            this, 0, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_emergy)
            .setContentTitle("Emergy is listening")
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
                CHANNEL_ID, "Emergy listening", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown the whole time the wake word is being listened for");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            nm.createNotificationChannel(channel);
        }
        // MICROPHONE is the only type Android 14 accepts for this, and it is
        // also the honest one: the notification cannot be dismissed, so the
        // microphone is never open without something on screen saying so.
        int type = Build.VERSION.SDK_INT >= 30
            ? android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            : 0;
        androidx.core.app.ServiceCompat.startForeground(this, NOTIFICATION_ID, notice(text), type);
    }
}
