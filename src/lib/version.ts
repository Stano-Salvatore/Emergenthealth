// Single source of truth for the version shown in the app, read from
// package.json so it can't drift from the released build — the Settings footer
// was hardcoded and still claimed v1.10.0 while the app shipped 3.x.
import pkg from "../../package.json"

export const APP_VERSION: string = pkg.version
