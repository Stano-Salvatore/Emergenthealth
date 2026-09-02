package app.emergenthealth;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

/**
 * Emergy as a real floating chat head — the Messenger kind.
 *
 * This is not the Bubbles API. Bubbles are a notification the system may
 * choose to float, Samsung's One UI does not implement them at all, and even
 * where they exist the user has to promote each conversation by hand. What
 * people mean by "chat head" is an overlay window, which is what Messenger has
 * always drawn and what this draws.
 *
 * That costs SYSTEM_ALERT_WINDOW — the permission that lets an app paint over
 * any other app, including a banking screen. It is not granted at install: the
 * user has to walk into Settings and turn it on for this app specifically, and
 * this service refuses to start without it rather than failing quietly. The
 * head is only ever shown because someone asked for it, and the notification
 * below carries a Stop button so it can always be taken back.
 */
public class EmergyHeadService extends Service {

    public static final String ACTION_STOP = "app.emergenthealth.HEAD_STOP";
    public static final String ACTION_POP = "app.emergenthealth.HEAD_POP_SHOW";

    private static final String CHANNEL_ID = "emergy_head";
    private static final int NOTIFICATION_ID = 920002;

    /** Whether a head is on screen right now, so the UI can say so honestly. */
    private static boolean running = false;
    public static boolean isRunning() { return running; }

    private WindowManager windows;
    private View head;
    /**
     * The sentence currently on screen beside the head, or null.
     *
     * Handed to the app when the head is tapped, so the chat opens on what was
     * actually said rather than on a blank thread.
     */
    private String spokenMessage;
    private WindowManager.LayoutParams headParams;
    private View speech;
    private View dropTarget;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable hideSpeech = new Runnable() {
        @Override public void run() { removeSpeech(); }
    };

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        windows = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        startForegroundNotice();
        addHead();
        running = true;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            // The Stop button: an explicit "put him away", so he must not come back.
            EmergyBubblePlugin.setKeepHead(this, false);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_POP.equals(intent.getAction())) {
            // A reminder came due. The head is already on screen by now —
            // onCreate ran before this if the service was not up — so all that
            // is left is to let him say the thing.
            String message = intent.getStringExtra(HeadAlarmReceiver.EXTRA_MESSAGE);
            if (message != null && !message.trim().isEmpty()) showSpeech(message.trim());
        }
        // Sticky only while the user has asked for him to stay. A floating
        // window that reappears by itself when nobody asked is what makes
        // people revoke the overlay permission; one that vanishes when they
        // DID ask is what made "Emergy doesn't follow me" a complaint.
        return EmergyBubblePlugin.keepHead(this) ? START_STICKY : START_NOT_STICKY;
    }

    /**
     * The app was swiped out of recents. On many phones that ends this
     * service with it, sticky or not. If the head was asked to stay, an alarm
     * a moment later starts it again from outside the dying process.
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (EmergyBubblePlugin.keepHead(this)) {
            Intent restart = new Intent(this, HeadAlarmReceiver.class).setAction(HeadAlarmReceiver.ACTION_RESTART);
            PendingIntent pi = PendingIntent.getBroadcast(
                this, 920003, restart, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            android.app.AlarmManager am = getSystemService(android.app.AlarmManager.class);
            if (am != null) {
                am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 1500, pi);
            }
        }
        super.onTaskRemoved(rootIntent);
    }

    // ---------------------------------------------------------------- the head

    private void addHead() {
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.mipmap.ic_launcher);
        icon.setContentDescription("Emergy");

        FrameLayout wrap = new FrameLayout(this);
        wrap.setBackgroundResource(R.drawable.head_circle);
        int pad = dp(6);
        wrap.setPadding(pad, pad, pad, pad);
        wrap.addView(icon, new FrameLayout.LayoutParams(dp(44), dp(44)));
        wrap.setElevation(dp(6));

        headParams = new WindowManager.LayoutParams(
            dp(56), dp(56),
            overlayType(),
            // NOT_FOCUSABLE so the head never steals the keyboard from the app
            // underneath; it only needs to be dragged and tapped.
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT);
        headParams.gravity = Gravity.TOP | Gravity.START;
        headParams.x = dp(12);
        headParams.y = dp(160);

        wrap.setOnTouchListener(new HeadTouch());
        head = wrap;
        windows.addView(head, headParams);
    }

    /** Drag to move, tap to open. Told apart by distance, not by guesswork. */
    @android.annotation.SuppressLint("ClickableViewAccessibility")
    private class HeadTouch implements View.OnTouchListener {
        private int startX, startY;
        private float touchX, touchY;
        private boolean dragged;

        @Override
        public boolean onTouch(View v, MotionEvent event) {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    startX = headParams.x;
                    startY = headParams.y;
                    touchX = event.getRawX();
                    touchY = event.getRawY();
                    dragged = false;
                    return true;

                case MotionEvent.ACTION_MOVE: {
                    int dx = Math.round(event.getRawX() - touchX);
                    int dy = Math.round(event.getRawY() - touchY);
                    // A finger never holds perfectly still, so a few pixels of
                    // travel is still a tap. Past the touch slop it's a drag.
                    if (Math.abs(dx) > dp(8) || Math.abs(dy) > dp(8)) dragged = true;
                    if (dragged) {
                        // Clamped to the screen. Dragged past the edge the head
                        // would sit under the status bar or off the side with
                        // no way to get it back except killing the app.
                        headParams.x = clamp(startX + dx, 0, widthPx() - dp(56));
                        headParams.y = clamp(startY + dy, 0, heightPx() - dp(56));
                        windows.updateViewLayout(head, headParams);
                        removeSpeech();
                        showDropTarget();
                        dropTarget.setAlpha(overDropTarget() ? 1f : 0.6f);
                    }
                    return true;
                }
                case MotionEvent.ACTION_UP: {
                    boolean drop = dragged && overDropTarget();
                    hideDropTarget();
                    if (drop) {
                        // Dragged onto the ✕ — the Messenger gesture, and the
                        // one people try first. Put him away for real rather
                        // than snapping him back to an edge.
                        EmergyBubblePlugin.setKeepHead(EmergyHeadService.this, false);
                        stopSelf();
                        return true;
                    }
                    if (!dragged) { v.performClick(); openApp(); }
                    return true;
                }
                default:
                    return false;
            }
        }
    }

    /** Where the head has to be let go for it to be dismissed. */
    private void showDropTarget() {
        if (dropTarget != null) return;
        TextView x = new TextView(this);
        x.setText("✕");
        x.setTextSize(24);
        x.setTextColor(0xFFC7D2FE);
        x.setGravity(Gravity.CENTER);
        x.setBackgroundResource(R.drawable.head_circle);

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            dp(64), dp(64),
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = (widthPx() - dp(64)) / 2;
        params.y = heightPx() - dp(140);
        dropTarget = x;
        windows.addView(dropTarget, params);
    }

    private void hideDropTarget() {
        if (dropTarget == null) return;
        try { windows.removeView(dropTarget); } catch (Exception ignored) {}
        dropTarget = null;
    }

    /** Is the head sitting on the ✕ right now? */
    private boolean overDropTarget() {
        int headCx = headParams.x + dp(28);
        int headCy = headParams.y + dp(28);
        int targetCx = widthPx() / 2;
        int targetCy = heightPx() - dp(140) + dp(32);
        int dx = headCx - targetCx;
        int dy = headCy - targetCy;
        // Generous: a drag ending near the ✕ means the same thing as one
        // ending exactly on it, and missing by 10px should not keep him.
        return Math.sqrt(dx * (double) dx + dy * (double) dy) < dp(80);
    }

    // -------------------------------------------------------------- he speaks

    /**
     * Emergy says something next to his own head.
     *
     * The point of the whole feature: a reminder that arrives as a line of
     * text over whatever is on screen, rather than as one more notification in
     * a shade nobody pulls down. It clears itself after a few seconds, and a
     * tap opens the chat where the reminder came from.
     */
    private void showSpeech(String message) {
        if (head == null) return;
        removeSpeech();

        TextView bubble = new TextView(new android.view.ContextThemeWrapper(
            this, android.R.style.Theme_DeviceDefault));
        bubble.setText(message);
        bubble.setTextSize(13);
        bubble.setTextColor(0xFFE8E8F5);
        bubble.setBackgroundResource(R.drawable.head_panel);
        bubble.setPadding(dp(12), dp(10), dp(12), dp(10));
        bubble.setMaxLines(4);
        bubble.setElevation(dp(8));
        bubble.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { openApp(); }
        });

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            dp(220), WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        // Beside the head, flipping to its other side when there is no room —
        // otherwise the text runs off the screen on a head parked at the right.
        boolean rightSide = headParams.x + dp(60) + dp(220) <= widthPx();
        params.x = rightSide ? headParams.x + dp(60) : Math.max(dp(8), headParams.x - dp(228));
        params.y = clamp(headParams.y, dp(8), heightPx() - dp(120));

        speech = bubble;
        spokenMessage = message;
        windows.addView(speech, params);
        // Also written onto the ongoing notification. The speech clears itself
        // after half a minute, so without this a pop that happened while the
        // phone was in a pocket leaves no evidence it ever did — which is
        // exactly what made the first live one impossible to confirm.
        updateNotice("Said: " + message);
        // Half a minute, not nine seconds. Nine is enough to read a line you
        // are already looking at and nowhere near enough to catch one you
        // weren't — the first real reminder this fired on was missed entirely
        // for that reason, which makes a reminder you can miss no reminder.
        // Still bounded: something that sits over another app until dismissed
        // by hand is the thing people revoke the permission over.
        main.removeCallbacks(hideSpeech);
        main.postDelayed(hideSpeech, 30_000);
    }

    private void removeSpeech() {
        main.removeCallbacks(hideSpeech);
        // Cleared with the bubble: tapping the bare head half an hour after a
        // pop has faded should open the app, not reopen a conversation about
        // something said and forgotten. openApp() reads this before calling in.
        spokenMessage = null;
        if (speech == null) return;
        try { windows.removeView(speech); } catch (Exception ignored) {}
        speech = null;
    }

    // ------------------------------------------------------------------ geometry
    //
    // These sat among the panel's own code and went out with it, which broke the
    // head's positioning: it is the thing that has to stay on screen while being
    // dragged, and it clamps against both.

    private int widthPx() {
        return getResources().getDisplayMetrics().widthPixels;
    }


    private int heightPx() {
        return getResources().getDisplayMetrics().heightPixels;
    }


    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(value, Math.max(min, max)));
    }

    // ----------------------------------------------------------- opening the app

    /**
     * Open the real app, on what Emergy just said.
     *
     * This used to expand into a panel the service drew itself: a 220dp window
     * with its own WebView, loading the chat. It was the wrong size for a
     * conversation and, worse, it opened on an EMPTY one — the single sentence
     * you had tapped in order to read was the one thing not on screen, and
     * there was nothing there to reply to.
     *
     * So the head is a doorway now rather than a room. The sentence is handed
     * over through the app's own storage (EmergyBubblePlugin.takePendingSay),
     * and the web layer turns it into a real conversation and opens it, so the
     * reply lands in a thread where Emergy has genuinely already spoken.
     */
    private void openApp() {
        String message = spokenMessage;
        removeSpeech();

        if (message != null && !message.trim().isEmpty()) {
            getSharedPreferences("emergy_head_pops", Context.MODE_PRIVATE)
                .edit().putString(EmergyBubblePlugin.PENDING_SAY, message.trim()).apply();
        }

        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch == null) return;
            // SINGLE_TOP rather than a fresh task: the app is usually already
            // running behind whatever is in front, and a second copy of it
            // would lose the session's scroll, drafts and open conversation.
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(launch);
        } catch (Exception ignored) {
            // Nothing to launch, or the system refused. The head stays put and
            // the message stays pending, so the next open still collects it.
        }
    }


    // -------------------------------------------------------- foreground notice

    private Notification notice(String text) {
        Intent stop = new Intent(this, EmergyHeadService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(
            this, 0, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_emergy)
            .setContentTitle("Emergy is floating")
            .setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(new Notification.Action.Builder(null, "Stop", stopIntent).build())
            .build();
    }

    /** Rewrite the ongoing notice — only if we are already showing one. */
    private void updateNotice(String text) {
        if (!running) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(NOTIFICATION_ID, notice(text));
    }

    private void startForegroundNotice() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Emergy floating", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while Emergy is floating over other apps");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            nm.createNotificationChannel(channel);
        }

        Notification notification = notice("Drag him anywhere, tap to talk.");

        // Android 14 requires a declared type. specialUse is the honest one:
        // this is a user-invoked floating window, not location or media.
        int type = Build.VERSION.SDK_INT >= 34
            ? android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            : 0;
        androidx.core.app.ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
    }

    private static int overlayType() {
        // minSdk is 26, so TYPE_APPLICATION_OVERLAY always exists — the old
        // TYPE_PHONE it replaced is unusable from Oreo on.
        return WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
    }

    @Override
    public void onDestroy() {
        removeSpeech();
        hideDropTarget();
        if (head != null) {
            try { windows.removeView(head); } catch (Exception ignored) {}
            head = null;
        }
        running = false;
        super.onDestroy();
    }
}
