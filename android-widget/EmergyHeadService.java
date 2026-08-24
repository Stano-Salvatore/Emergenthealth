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
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
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

    private static final String CHANNEL_ID = "emergy_head";
    private static final int NOTIFICATION_ID = 920002;
    private static final String CHAT_URL = "https://emergenthealth.vercel.app/dashboard/chat";
    private static final String ALLOWED_PREFIX = "https://emergenthealth.vercel.app";

    /** Whether a head is on screen right now, so the UI can say so honestly. */
    private static boolean running = false;
    public static boolean isRunning() { return running; }

    private WindowManager windows;
    private View head;
    private View panel;
    private WebView web;
    private WindowManager.LayoutParams headParams;

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
            stopSelf();
            return START_NOT_STICKY;
        }
        // Not sticky: a floating window that reappears by itself after the
        // system killed the process is exactly the behaviour that makes people
        // revoke the overlay permission.
        return START_NOT_STICKY;
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
                    }
                    return true;
                }
                case MotionEvent.ACTION_UP:
                    if (!dragged) { v.performClick(); togglePanel(); }
                    return true;
                default:
                    return false;
            }
        }
    }

    // --------------------------------------------------------------- the panel

    private void togglePanel() {
        if (panel != null) { removePanel(); return; }

        // Focusable, so Back reaches this window rather than the app behind it.
        // Without handling it here Back would appear to do nothing, which is
        // the first thing anyone presses to get rid of a floating window.
        LinearLayout column = new LinearLayout(new android.view.ContextThemeWrapper(
                this, android.R.style.Theme_DeviceDefault)) {
            @Override
            public boolean dispatchKeyEvent(android.view.KeyEvent event) {
                if (event.getKeyCode() == android.view.KeyEvent.KEYCODE_BACK
                        && event.getAction() == android.view.KeyEvent.ACTION_UP) {
                    removePanel();
                    return true;
                }
                return super.dispatchKeyEvent(event);
            }
        };
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundResource(R.drawable.head_panel);
        column.setElevation(dp(10));

        // A close control, because a floating window with no visible way out is
        // the thing people uninstall an app over.
        TextView close = new TextView(this);
        close.setText("✕");
        close.setTextSize(16);
        // Set explicitly: the default text colour against this panel's #13122B
        // is near-invisible, and an invisible close button is not one.
        close.setTextColor(0xFFC7D2FE);
        close.setPadding(dp(14), dp(8), dp(14), dp(8));
        close.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { removePanel(); }
        });
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.END);
        header.addView(close);
        column.addView(header, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        web = buildWebView();
        column.addView(web, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            dp(330), dp(460),
            overlayType(),
            // Focusable, or the keyboard never opens and the chat cannot be
            // typed into. NOT_TOUCH_MODAL keeps taps outside going to the app
            // underneath instead of being swallowed by a transparent window.
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = Math.max(dp(8), Math.min(headParams.x, widthPx() - dp(338)));
        params.y = Math.max(dp(8), headParams.y - dp(470));
        params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;

        panel = column;
        windows.addView(panel, params);
        web.loadUrl(CHAT_URL);
    }

    private int widthPx() {
        return getResources().getDisplayMetrics().widthPixels;
    }

    private int heightPx() {
        return getResources().getDisplayMetrics().heightPixels;
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(value, Math.max(min, max)));
    }

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private WebView buildWebView() {
        WebView v = new WebView(new android.view.ContextThemeWrapper(
            this, android.R.style.Theme_DeviceDefault));
        WebSettings ws = v.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);

        // The same cookie jar as the app, so this opens signed in rather than
        // at a login screen inside a 330dp window.
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(v, true);

        // This window floats over other apps while holding our session. A link
        // to anywhere else belongs in a browser, not here.
        v.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                String url = request.getUrl() == null ? "" : request.getUrl().toString();
                return !url.startsWith(ALLOWED_PREFIX);
            }
        });
        return v;
    }

    private void removePanel() {
        if (panel == null) return;
        try { windows.removeView(panel); } catch (Exception ignored) {}
        if (web != null) {
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            // Destroyed every time, not hidden: a WebView left alive in a
            // service keeps the page — and its timers — running behind
            // everything else on the phone.
            web.destroy();
            web = null;
        }
        panel = null;
    }

    // -------------------------------------------------------- foreground notice

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

        Intent stop = new Intent(this, EmergyHeadService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(
            this, 0, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_emergy)
            .setContentTitle("Emergy is floating")
            .setContentText("Drag him anywhere, tap to talk.")
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "Stop", stopIntent).build())
            .build();

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
        removePanel();
        if (head != null) {
            try { windows.removeView(head); } catch (Exception ignored) {}
            head = null;
        }
        running = false;
        super.onDestroy();
    }
}
