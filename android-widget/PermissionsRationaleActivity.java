package app.emergenthealth;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;

/**
 * The screen Health Connect opens when someone asks why this app wants their
 * health data.
 *
 * Health Connect requires an app that reads health records to declare an
 * activity handling ACTION_SHOW_PERMISSIONS_RATIONALE (and, from Android 14,
 * VIEW_PERMISSION_USAGE with the HEALTH_PERMISSIONS category), and to put the
 * privacy policy behind it. Without that declaration Health Connect's
 * permission sheet simply has no privacy link, and the Health apps
 * declaration is reviewed against exactly that.
 *
 * The manifest used to carry the action only inside <queries> — which lets
 * this app FIND Health Connect, and does nothing at all to let Health Connect
 * find this screen. It reads as declared to a grep, and to the compliance note
 * that claimed it was.
 *
 * There is nothing to draw: this opens the policy and finishes. It can be
 * launched when the app has never run, so the URL is the one the app stores on
 * each launch, and failing that the build-time default — injected by
 * .ci/customize-android.py from capacitor.config.ts, so there is no second
 * copy of the address to drift.
 */
public class PermissionsRationaleActivity extends Activity {

    /** Replaced at build time. The build fails if it is not. */
    private static final String FALLBACK_URL = "__APP_URL__";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(privacyUrl()));
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(view);
        } catch (Exception ignored) {
            // No browser, or a URL the device cannot open. Finishing quietly is
            // right: this activity exists to answer a question, and a crash on
            // the way to Health Connect's permission sheet would be worse than
            // an unanswered one.
        }
        finish();
    }

    private String privacyUrl() {
        String base = FALLBACK_URL;
        try {
            SharedPreferences cap = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            String stored = cap.getString("widget_app_url", null);
            if (stored != null && stored.startsWith("http")) base = stored;
        } catch (Exception ignored) {
            // Fall back to the build-time address.
        }
        return base.replaceAll("/+$", "") + "/privacy";
    }
}
