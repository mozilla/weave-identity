/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Bookmarks Sync.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Dan Mills <thunder@mozilla.com>
 *  Myk Melez <myk@mozilla.org>
 *  Anant Narayanan <anant@kix.in>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const EXPORTED_SYMBOLS = ['WeaveID'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// how long we should wait before actually syncing on idle
const IDLE_TIME = 5; // xxxmpc: in seconds, should be preffable

// How long before refreshing the cluster
const CLUSTER_BACKOFF = 5 * 60 * 1000; // 5 minutes

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://weave-identity/ext/log4moz.js");
Cu.import("resource://weave-identity/constants.js");
Cu.import("resource://weave-identity/util.js");

// for export
let WeaveID = {};
Cu.import("resource://weave-identity/constants.js", WeaveID);
Cu.import("resource://weave-identity/util.js", WeaveID);

Utils.lazy(WeaveID, 'Service', WeaveIDSvc);

/*
 * Service singleton
 * Main entry point into Weave's sync framework
 */

function WeaveIDSvc() {
  this._notify = Utils.notify("weave-id:service:");
}
WeaveIDSvc.prototype = {

  _lock: Utils.lock,
  _catch: Utils.catch,
  _isQuitting: false,

  get enabled() { return Svc.Prefs.get("enabled"); },
  set enabled(value) { Svc.Prefs.set("enabled", value); },

  get locked() { return this._locked; },
  lock: function Svc_lock() {
    if (this._locked)
      return false;
    this._locked = true;
    return true;
  },
  unlock: function Svc_unlock() {
    this._locked = false;
  },

  onWindowOpened: function WeaveID__onWindowOpened() {
  },

  /**
   * Startup stuff.
   * Note: Beware of adding more here, put as much as possible in _delayedStartup
   */
  onStartup: function onStartup() {
    // Figure out how many seconds to delay loading Weave based on the app
    let wait = 0;
    switch (Svc.AppInfo.ID) {
      case FIREFOX_ID:
        // Add one second delay for each tab in every window
        let enum = Svc.WinMediator.getEnumerator("navigator:browser");
        while (enum.hasMoreElements())
          wait += enum.getNext().gBrowser.mTabs.length;
    }

    // Make sure we wait a little but but not too long in the worst case
    wait = Math.ceil(Math.max(5, Math.min(20, wait)));
    Utils.delay(this._delayedStartup, wait * 1000, this, "_startupTimer");
  },

  // delayed startup
  _delayedStartup: function _delayedStartup() {
    Utils.prefs.addObserver("", this, false);
    Svc.Observer.addObserver(this, "network:offline-status-changed", true);
    Svc.Observer.addObserver(this, "private-browsing", true);
    Svc.Observer.addObserver(this, "quit-application", true);

    let ua = Cc["@mozilla.org/network/protocol;1?name=http"].
      getService(Ci.nsIHttpProtocolHandler).userAgent;

    this._initLogs();
    this._log.info("Loading Weave Identity component");
    this._log.info(ua);
  },

  _initLogs: function WeaveID__initLogs() {
    this._log = Log4Moz.repository.getLogger("Service");
    this._log.level =
      Log4Moz.Level[Svc.Prefs.get("log.logger.service")];

    let formatter = new Log4Moz.BasicFormatter();
    let root = Log4Moz.repository.rootLogger;
    root.level = Log4Moz.Level[Svc.Prefs.get("log.rootLogger")];

    let capp = new Log4Moz.ConsoleAppender(formatter);
    capp.level = Log4Moz.Level[Svc.Prefs.get("log.appender.console")];
    root.addAppender(capp);

    let dapp = new Log4Moz.DumpAppender(formatter);
    dapp.level = Log4Moz.Level[Svc.Prefs.get("log.appender.dump")];
    root.addAppender(dapp);

    let verbose = Svc.Directory.get("ProfD", Ci.nsIFile);
    verbose.QueryInterface(Ci.nsILocalFile);
    verbose.append("weave-id-log.txt");
    if (!verbose.exists())
      verbose.create(verbose.NORMAL_FILE_TYPE, PERMS_FILE);

    this._debugApp = new Log4Moz.RotatingFileAppender(verbose, formatter);
    this._debugApp.level = Log4Moz.Level[Svc.Prefs.get("log.appender.debugLog")];
    root.addAppender(this._debugApp);
  },

  clearLogs: function WeaveID_clearLogs() {
    this._debugApp.clear();
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver,
                                         Ci.nsISupportsWeakReference]),

  // nsIObserver

  observe: function WeaveID__observe(subject, topic, data) {
    switch (topic) {
      case "nsPref:changed":
        switch (data) {
          case "enabled":
            break;
        }
        break;
      case "network:offline-status-changed":
        break;
      case "private-browsing":
        break;
      case "quit-application":
        this._onQuitApplication();
        break;
    }
  },

  _onQuitApplication: function WeaveID__onQuitApplication() {
  }
};
