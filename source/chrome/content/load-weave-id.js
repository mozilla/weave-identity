// = load-weave =

// These are the only ones we *really* need in this file.
// We import them into the global namespace because the symbols they export
// are carefully named to minimize the risk of conflicts.
Components.utils.import("resource://weave/ext/Observers.js");
Components.utils.import("resource://weave/log4moz.js");
Components.utils.import("resource://weave/service.js");
