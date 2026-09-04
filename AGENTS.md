<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Emergenthealth

Read `docs/handoff.md` before starting — architecture, the Android half, the
correlation engine, standing guards, and the conventions this codebase is
written to. `docs/local-dev.md` covers running it locally.

The one fact worth knowing up front: **web and server changes reach the phone
with no new APK; anything under `android-widget/` needs one.**
