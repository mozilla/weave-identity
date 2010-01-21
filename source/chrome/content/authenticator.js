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
 * The Original Code is Weave.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Myk Melez <myk@mozilla.org>
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

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://weave-identity/ext/log4moz.js");
Components.utils.import("resource://weave-identity/service.js");
Components.utils.import("resource://weave-identity/ext/resource.js");

let gWeaveAuthenticator = {
  //**************************************************************************//
  // Shortcuts

  get Observers() {
    delete this.Observers;
    Components.utils.import("resource://weave-identity/ext/Observers.js", this);
    return this.Observers;
  },

  get _log() {
    delete this._log;
    this._log = Log4Moz.repository.getLogger("Authenticator");
    this._log.level = Log4Moz.Level[WeaveID.Svc.Prefs.get("log.logger.authenticator",
                                                    "Trace")];
    return this._log;
  },

  get _state() {
    delete this._state;
    return this._state = document.getElementById("acct-auth-state");
  },

  get _icon() {
    delete this._icon;
    return this._icon = document.getElementById("acct-auth-icon");
  },

  get _popup() {
    delete this._popup;
    return this._popup = document.getElementById("acct-auth-popup");
  },

  get _signedInDesc() {
    delete this._signedInDesc;
    return this._signedInDesc = document.getElementById("acct-auth-signed-in-desc");
  },

  get _tabCache() {
    if (!gBrowser.mCurrentBrowser.authCache)
      gBrowser.mCurrentBrowser.authCache = {baseUrl: null, amcdUrl: null};
    return gBrowser.mCurrentBrowser.authCache;
  },

  get _realm() {
    return WeaveID.Service.realms[this._tabCache.amcdUrl];
  },

  //**************************************************************************//
  // XPCOM Glue

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener,
                                         Ci.nsIDOMEventListener,
                                         Ci.nsISupportsWeakReference]),


  //**************************************************************************//
  // Initialization/Destruction

  onLoad: function() {
    if (WeaveID.Svc.Prefs.get("authenticator.enabled")) {
      this._icon.hidden = false;
      gBrowser.addProgressListener(this, Ci.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
      this.Observers.add("weaveid-realm-updated", this.onRealmUpdated, this);
    }
  },

  onUnload: function() {
    if (WeaveID.Svc.Prefs.get("authenticator.enabled")) {
      gBrowser.removeProgressListener(this);
      this.Observers.remove("weaveid-realm-updated", this.onRealmUpdated, this);
    }
  },


  //**************************************************************************//
  // nsIWebProgressListener

  // Note: on page loads we'll generate the model again on
  // DOMContentLoaded, which is redundant, but I don't know of a
  // way to distinguish between page loads and history traversals
  // here so that we only do this on history traversal (perhaps do
  // this on pageshow/pagehide instead?).
  // The login manager does this via a web progress listener
  // that listens for Ci.nsIWebProgressListener.STATE_RESTORING; we could
  // probably do the same, we should just make sure to do so before
  // the login manager so its notifications build up our model.

  onLocationChange: function(progress, request, location) {
    // FIXME: set view to 'loading' ?

    //
    // Step 1: make sure this is an actual http request
    //
    if (!request) {
      // this is a tab change, not a page/history load, so we can
      // simply update the view and reuse the existing model
      this._updateView();
    }

    try {
      request.QueryInterface(Ci.nsIHttpChannel);
    } catch (e) { return; } // we only care about http

    //
    // Step 2: figure out the amcd url
    //
    try {
      // if we have a header, that's the amcd url
      this._tabCache.amcdUrl = request.getResponseHeader('X-Account-Management');
      this._log.trace("Found X-Account-Management header");

    } catch (e) {
      if (this._tabCache.baseUrl != location.hostPort) {
        this._log.trace("Probing host-meta for AMCD");

        // the tab cache is no longer valid, get the host-meta and amcd url
        this._tabCache.baseUrl = location.hostPort;
        this._tabCache.amcdUrl = WeaveID.Service.realmUrlForLocation(location);

        // if we don't have an amcdUrl, this location doesn't support this feature
        if (!this._tabCache.amcdUrl) {
          this._updateView();
          this._log.trace("no AMCD for this page");
          return;
        }
      }
    }

    //
    // Step 3: get status change (if set) and update the realm
    //
    let statusChange;
    try {
      statusChange = request.getResponseHeader('X-Account-Management-Status');
      this._log.trace("Found X-Account-Management-Status header");
    } catch (e) { /* ok if not set */ }

    WeaveID.Service.updateRealm(this._tabCache.amcdUrl, statusChange);
  },

  onStateChange: function() {},
  onProgressChange: function() {},
  onStatusChange: function() {},
  onSecurityChange: function() {},
  onLinkIconAvailable: function() {},

  //**************************************************************************//
  // UI Callbacks

  onIconClick: function(event) {
    this._popup.openPopup(this._icon, "after_end", 27);
  },

  onPopupShowing: function(event) {
    // The popupshowing event fires for the menulist too, but we only want
    // to handle the events for the panel as a whole.
    if (event.target != this._popup)
      return;

    if (this._realm && this._realm.curId)
      this._signedInDesc.value =
        WeaveID.Str.overlay.get("signed-in-as", [this._realm.curId]);
  },

  onConnect: function() {
    this._log.debug("Attempting to connect");
    this._realm.connect();
    gBrowser.mCurrentBrowser.reload();
    this._popup.hidePopup();
  },

  onDisconnect: function() {
    this._log.debug("Attempting to disconnect");
    this._realm.disconnect();
    gBrowser.mCurrentBrowser.reload();
    this._popup.hidePopup();
  },

  //**************************************************************************//
  // View

  // gets called when the service updates the model for a realm
  onRealmUpdated: function(url) {
    this._log.trace("onRealmUpdated: " + url);
    if (this._tabCache.amcdUrl == url)
      this._updateView();
  },

  _updateView: function() {
    let realm = WeaveID.Service.realms[this._tabCache.amcdUrl];
    if (realm) {
      // AMCD supported, set view to current state
      this._log.debug("View state: " + realm.signinState);
      this._state.setAttribute("state", realm.signinState);
    } else {
      // this site does not support the AMCD
      this._log.debug("View state: no realm for this site");
      this._state.setAttribute("state", "disabled");
    }
  }
};

window.addEventListener("load",   function() { gWeaveAuthenticator.onLoad();   }, false);
window.addEventListener("unload", function() { gWeaveAuthenticator.onUnload(); }, false);
