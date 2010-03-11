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
    this._log = Log4Moz.repository.getLogger("AccountMgrWin");
    this._log.level = 
      Log4Moz.Level[WeaveID.Svc.Prefs.get("log.logger.authenticator", "Trace")];
    return this._log;
  },

  get _state() {
    delete this._state;
    return this._state = document.getElementById("acct-auth-state");
  },

  get _navbar() {
    delete this._navbar;
    return this._navbar = document.getElementById("nav-bar");
  },

  get _button() {
    delete this._button;
    return this._button = document.getElementById("acct-auth-button");
  },

  get _popup() {
    delete this._popup;
    return this._popup = document.getElementById("acct-auth-popup");
  },

  get _signedInDesc() {
    delete this._signedInDesc;
    return this._signedInDesc = document.getElementById("acct-auth-signed-in-desc");
  },

  get _curRealmUrl() {
    return gBrowser.mCurrentBrowser.realm;
  },

  get _curRealm() {
    if (!this._curRealmUrl)
      return null;
    return WeaveID.Service.realms[this._curRealmUrl];
  },

  //**************************************************************************//
  // XPCOM Glue

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener,
                                         Ci.nsIDOMEventListener,
                                         Ci.nsISupportsWeakReference]),


  //**************************************************************************//
  // Initialization/Destruction

  onLoad: function() {
    if (!WeaveID.Svc.Prefs.get("toolbar-item-added"))
      setTimeout(WeaveID.Utils.bind2(this, this.addToolbarItem), 0);

    if (WeaveID.Svc.Prefs.get("authenticator.enabled")) {
      gBrowser.addProgressListener(this, Ci.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
      this.Observers.add("weaveid-realm-updated", this.onRealmUpdated, this);
    }

    if (WeaveID.Svc.Prefs.get("lastversion") == "firstrun")
      this._openFirstRun();
    else if (WeaveID.Svc.Prefs.get("lastversion") != WeaveID.WEAVE_ID_VERSION)
      this._openUpdated();
    WeaveID.Svc.Prefs.set("lastversion", WeaveID.WEAVE_ID_VERSION);
  },

  onUnload: function() {
    if (WeaveID.Svc.Prefs.get("authenticator.enabled")) {
      gBrowser.removeProgressListener(this);
      this.Observers.remove("weaveid-realm-updated", this.onRealmUpdated, this);
    }
  },

  _openFirstRun: function() {
    let url = "http://mozillalabs.com/conceptseries/identity/account-manager/?version=" +
      WeaveID.WEAVE_ID_VERSION;
    setTimeout(function() { window.openUILinkIn(url, "tab"); }, 500);
  },

  _openUpdated: function() {
    let url = "http://mozillalabs.com/conceptseries/identity/account-manager/?version=" +
      WeaveID.WEAVE_ID_VERSION;
    setTimeout(function() { window.openUILinkIn(url, "tab"); }, 500);
  },

  addToolbarItem: function() {
    // we only want to add it once
    if (WeaveID.Svc.Prefs.get("toolbar-item-added"))
      return;

    let set = this._navbar.currentSet.split(',');

    // don't try to add again if it's already there somehow
    if (set.indexOf('acct-auth-button') >= 0) {
      WeaveId.Svc.Prefs.set("toolbar-item-added", true);
      return;
    }

    this._log.debug("Adding toolbar item");

    try {
      let urlbar = set.indexOf('urlbar-container');
      if (urlbar >= 0) {
        set.splice(urlbar, 0, 'acct-auth-button');
      } else {
        set.push("acct-auth-button");
      }
      set = set.join(',');
      this._navbar.setAttribute('currentset', set);
      this._navbar.currentSet = set;
      document.persist('nav-bar', 'currentset');
    } catch (e) {
      this._log.error(e);
    }
    WeaveID.Svc.Prefs.set("toolbar-item-added", true);
  },

  //**************************************************************************//
  // nsIWebProgressListener

  // FIXME: not getting events for background tabs?
  onLocationChange: function(progress, request, location) {
    // FIXME: update view to set to 'loading' ?
    // if there's no request, this is a tab switch, not a page load
    if (request) {
      let doc = progress.DOMWindow.document;
      let browser = gBrowser.getBrowserForDocument(doc);
      browser.realm = WeaveID.Service.updateRealm(progress, request, location);
    }
    this._updateView();
  },

  onStateChange: function() {},
  onProgressChange: function() {},
  onStatusChange: function() {},
  onSecurityChange: function() {},
  onLinkIconAvailable: function() {},

  //**************************************************************************//
  // UI Callbacks

  onButtonCommand: function(event) {
    this._popup.openPopup(this._button, "after_end", 25, -10);
  },

  onPopupShowing: function(event) {
    // The popupshowing event fires for the menulist too, but we only want
    // to handle the events for the panel as a whole.
    if (event.target != this._popup)
      return;

    if (this._curRealm && this._curRealm.curId)
      this._signedInDesc.value =
        WeaveID.Str.overlay.get("signed-in-as", [this._curRealm.curId]);
  },

  onConnect: function() {
    this._log.debug("Attempting to connect");
    this._curRealm.connect();
    gBrowser.mCurrentBrowser.reload();
    this._popup.hidePopup();
  },

  onDisconnect: function() {
    this._log.debug("Attempting to disconnect");
    this._curRealm.disconnect();
    gBrowser.mCurrentBrowser.reload();
    this._popup.hidePopup();
  },

  //**************************************************************************//
  // View

  // gets called when the service updates the model for a realm
  onRealmUpdated: function(url) {
    this._log.debug("onRealmUpdated");
    if (this._curRealmUrl == url)
      this._updateView();
  },

  _updateView: function() {
    if (this._curRealm) {
      // AMCD supported, set view to current state
      if (this._state.getAttribute("state") == this._curRealm.signinState)
        return;
      this._log.debug("View state: " + this._curRealm.signinState);
      this._state.setAttribute("state", this._curRealm.signinState);
    } else {
      // this site does not support the AMCD
      if (this._state.getAttribute("state") == "disabled")
        return;
      this._log.debug("View state: no realm for this site");
      this._state.setAttribute("state", "disabled");
    }
  }
};

window.addEventListener("load",   function() { gWeaveAuthenticator.onLoad();   }, false);
window.addEventListener("unload", function() { gWeaveAuthenticator.onUnload(); }, false);
