package app.emergenthealth;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * What the floating bubble expands into: the real app.
 *
 * This used to be a WebView of its own, loading the chat into the small window
 * the system hosts over whatever app is in front. Two things were wrong with
 * that. It was a 300dp-wide window for a conversation — and it opened on an
 * EMPTY chat, so the sentence you tapped in order to read was the one thing
 * not on screen and there was nothing there to reply to.
 *
 * So it hands off instead. The bubble is a doorway; the app is the room. What
 * Emergy said is waiting in the app's own storage (EmergyBubblePlugin's
 * pending say), and the web layer turns it into a real conversation and opens
 * it, so a reply lands in a thread where he has genuinely already spoken.
 *
 * A side benefit: this activity no longer runs a second WebView holding the
 * session cookie over other apps' windows.
 */
public class BubbleActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch != null) {
                // SINGLE_TOP rather than a fresh task: the app is usually
                // already running behind whatever is in front, and a second
                // copy would lose the session's drafts and open conversation.
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(launch);
            }
        } catch (Exception ignored) {
            // Nothing to launch, or the system refused. Falling through to
            // finish() leaves the bubble collapsed rather than showing a blank
            // window that does nothing.
        }
        finish();
    }
}
