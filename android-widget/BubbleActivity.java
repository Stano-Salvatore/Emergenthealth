package app.emergenthealth;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * What the floating bubble expands into: Emergy's chat, in a small window the
 * system hosts over whatever app is in front.
 *
 * A plain Activity rather than a second BridgeActivity. Capacitor's bridge is
 * built to be the app's single host, and running a second one here would mean
 * two bridges racing over the same plugins and the same WebView state for the
 * sake of a chat window. The session is what actually matters, and cookies are
 * process-wide — the same login the main app holds is already here.
 */
public class BubbleActivity extends Activity {

    private static final String CHAT_URL = "https://emergenthealth.vercel.app/dashboard/chat";

    private WebView web;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);

        // Same cookie jar as the main app, so this opens already signed in
        // rather than at a login screen inside a 300dp window.
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        // Keep this window on the app. A link to somewhere else belongs in a
        // browser, not floating over someone's banking app with our cookies.
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                String url = request.getUrl() == null ? "" : request.getUrl().toString();
                return !url.startsWith("https://emergenthealth.vercel.app");
            }
        });

        setContentView(web);
        web.loadUrl(CHAT_URL);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            // A WebView left attached leaks the activity, and this one is
            // created and destroyed every time the bubble is opened.
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
