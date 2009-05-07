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

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let gWeaveAuthenticator = {
  //**************************************************************************//
  // Shortcuts

  // The Preferences service that is imported from the Preferences module below.
  get Preferences() {
    delete this.Preferences;
    Cu.import("resource://weave/ext/Preferences.js", this);
    return this.Preferences;
  },

  get _prefs() {
    delete this._prefs;
    return this._prefs = new this.Preferences("extensions.weave.");
  },

  get _state() {
    delete this._state;
    return this._state = document.getElementById("sync-auth-state");
  },

  get _icon() {
    delete this._icon;
    return this._icon = document.getElementById("sync-auth-icon");
  },

  get _popup() {
    delete this._popup;
    return this._popup = document.getElementById("sync-auth-popup");
  },

  get _list() {
    delete this._list;
    return this._list = document.getElementById("sync-auth-list");
  },

  get _auto() {
    delete this._auto;
    return this._auto = document.getElementById("sync-auth-auto");
  },

  get _signIn() {
    delete this._signIn;
    return this._signIn = document.getElementById("sync-auth-signIn");
  },

  get _autoDesc() {
    delete this._autoDesc;
    return this._autoDesc = document.getElementById("sync-auth-autoDesc");
  },

  get _disableAuto() {
    delete this._disableAuto;
    return this._disableAuto = document.getElementById("sync-auth-disableAuto");
  },

  // The times of automatic authentications, indexed by site.  We use this
  // to detect and suppress potential auto-auth loops.  We share this across
  // browser tabs in case the auth form submits to a new tab.
  // FIXME: share this across browser windows (perhaps by moving this code
  // into a module) in case the auth form submits to a new window.
  _autoAuths: {},


  //**************************************************************************//
  // XPCOM Glue

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener,
                                         Ci.nsIDOMEventListener,
                                         Ci.nsISupportsWeakReference]),


  //**************************************************************************//
  // Initialization/Destruction

  onLoad: function() {
    if (this._prefs.get("authenticator.enabled")) {
      Cu.import("resource://weave/LoginManager.js", this);
      this._icon.hidden = false;
      gBrowser.addProgressListener(this, Ci.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
      gBrowser.addEventListener("DOMContentLoaded", this, true);
    }
  },

  onUnload: function() {
    if (this._prefs.get("authenticator.enabled")) {
      gBrowser.removeProgressListener(this);
      gBrowser.removeEventListener("DOMContentLoaded", this, true);
    }
  },


  //**************************************************************************//
  // nsIWebProgressListener

  onLocationChange: function(progress, request, location) {
    // If there's a request, this is a page load or history traversal,
    // not a tab change, so we have to generate the model all over again.
    // (whereas on tab changes we can simply reuse the existing model
    // that we've cached in the browser).  Note that on page loads
    // we'll generate the model again on DOMContentLoaded, which is redundant,
    // but I don't know of a way to distinguish between page loads
    // and history traversals here so that we only do this on history
    // traversal (perhaps do this on pageshow/pagehide instead?).
    if (request) {
      let browser = gBrowser.mCurrentBrowser;
      let doc = browser.contentDocument;
      if (doc)
        this._updateModel(doc, browser);
    }

    this._updateView();
  },

  onStateChange: function() {},
  onProgressChange: function() {},
  onStatusChange: function() {},
  onSecurityChange: function() {},
  onLinkIconAvailable: function() {},


  //**************************************************************************//
  // nsIDOMEventListener

  handleEvent: function(event) {
    switch (event.type) {
      case "DOMContentLoaded":
        this.onDOMContentLoaded(event);
    }
  },

  onDOMContentLoaded: function(event) {
    let doc = event.target;
    let browser = gBrowser.getBrowserForDocument(doc);

    if (!browser)
      return;

    this._updateModel(doc, browser);
    if (browser == gBrowser.mCurrentBrowser)
      this._updateView();

    let host; try { host = browser.currentURI.host } catch(ex) {}

    if (host) {
      // Automatically authenticate the user if it's possible to do so
      // and the user has specified that we should do so for this site.
      let sessionHistory = browser.webNavigation.sessionHistory;
      let lastAuthed = (host in this._autoAuths) ? this._autoAuths[host] : 0;

      if (// the web page supports OpenID authentication (or we have form info)
          (browser.auth.openIDField || browser.auth.formInfo) &&

          // the user is authenticating on a page encrypted with SSL
          // (to protect against MITM attacks when a user has stored credentials
          // from a previous authentication against the encrypted version
          // of the site but then loads the unencrypted version on an insecure
          // network, f.e. by typing its domain name into the location bar,
          // and the request is intercepted by evil.com)
          browser.currentURI.scheme == "https" &&

          // the auto-authenticate pref is true for the site
          this._prefs.site(browser.currentURI).get("authenticator.auto") &&

          // the page is the last one in the session history, so users can
          // traverse history without losing control over their browser
          // and the history in front of the current page when they encounter
          // a page we can auto-authenticate
          sessionHistory.count == sessionHistory.index + 1 &&

          // auto-auth hasn't happened for this site in the last 60 seconds
          // (to suppress auto-auth loops when auto-auth fails)
          ((new Date() - lastAuthed) > 60000))
      {
        this._autoAuth(browser, host);
      }
    }
  },

  _autoAuth: function(browser, host) {
    this._autoAuths[host] = new Date();

    if (browser.auth.openIDField) {
      // Other code in Weave has already inserted the Weave ID into the field,
      // so the only thing we have to do here is submit the form.

      // Strangely, if submission goes to a file: URL that doesn't exist,
      // this throws NS_ERROR_FILE_NOT_FOUND, so we catch and ignore that error
      // (not that we support form submission to file: URLs, so it probably
      // doesn't matter; but what other events might throw exceptions here?).
      try {
        browser.auth.openIDField.form.submit();
      }
      catch(ex) {}
    }
    else { // browser.auth.formInfo
      let loginInfo = JSON.parse(this._prefs.site(browser.currentURI).
                                 get("authenticator.auto.loginInfo"));

      let autoLoginInfo;
      for each (let foundLogin in browser.auth.formInfo.foundLogins) {
        if (foundLogin.matches(loginInfo, true)) {
          autoLoginInfo = foundLogin;
          break;
        }
      }
    
      if (autoLoginInfo) {
        this._fillForm(browser.auth.formInfo, autoLoginInfo);
        browser.auth.formInfo.passwordField.form.submit();
      }
    }
  },

  onSelectItem: function() {
    let item = this._list.selectedItem;
    if (item.loginInfo)
      this._fillForm(item.formInfo, item.loginInfo);
  },

  onSignIn: function() {
    this._prefs.site(gBrowser.mCurrentBrowser.currentURI).
                set("authenticator.auto", this._auto.checked);
    if (!this._auto.checked)
      this._prefs.site(gBrowser.mCurrentBrowser.currentURI).
                  reset("authenticator.auto.loginInfo");

    let item = this._list.selectedItem;
    if (item.loginInfo) {
      // Fill out the form again in case it got changed somehow in the meantime.
      this._fillForm(item.formInfo, item.loginInfo);

      if (this._auto.checked) {
        // Remove the password from the login info before saving it to prefs
        // so we don't store it in the clear.
        item.loginInfo.password = null;
        this._prefs.site(gBrowser.mCurrentBrowser.currentURI).
                    set("authenticator.auto.loginInfo",
                        JSON.stringify(item.loginInfo));
      }

      item.formInfo.passwordField.form.submit();
    }
    else {
      try {
        gBrowser.mCurrentBrowser.auth.openIDField.form.submit();
      }
      catch(ex) {}
    }

    this._popup.hidePopup();
  },

  onPopupShowing: function(event) {
    // The popupshowing event fires for the menulist too, but we only want
    // to handle the events for the panel as a whole.
    if (event.target != this._popup)
      return;

    let browser = gBrowser.mCurrentBrowser;
    this._list.removeAllItems();

    // Add an item for the OpenID field, if any.
    if (this._prefs.get("openId.enabled") && browser.auth.openIDField)
      item = this._list.appendItem("Weave");

    // Add items for found logins, if any.
    if (browser.auth.formInfo) {
      let formInfo = browser.auth.formInfo;
      for each (let foundLogin in formInfo.foundLogins) {
        // FIXME: localize and improve label for logins without username.
        let label = foundLogin.username || "no name";
        let item = this._list.appendItem(label);
        item.formInfo = formInfo;
        item.loginInfo = foundLogin;
        if (formInfo.selectedLogin && foundLogin.equals(formInfo.selectedLogin))
          this._list.selectedItem = item;
      }
    }

    // Select the first item.
    if (this._list.itemCount > 0 && this._list.selectedIndex == -1)
      this._list.selectedIndex = 0;
  },

  _fillForm: function(formInfo, loginInfo) {
    if (formInfo.usernameField)
      formInfo.usernameField.value = loginInfo.username;
    formInfo.passwordField.value = loginInfo.password;
  },

  onDisableAutoAuth: function() {
    this._prefs.site(gBrowser.mCurrentBrowser.currentURI).
                set("authenticator.auto", false);
    this._popup.hidePopup();
    this._updateView();
  },


  //**************************************************************************//
  // Implementation

  _updateModel: function(doc, browser) {
    let inputs = doc.getElementsByTagName("input");
    browser.auth = {};

    // Find the first OpenID field.
    if (this._prefs.get("openId.enabled")) {
      for (let i = 0; i < inputs.length; i++) {
        let element = inputs.item(i);
        if (element.name == OPENID_FIELD_NAME) {
          browser.auth.openIDField = element;
          break;
        }
      }
    }

    // Get info about the first form that the login manager can fill.
    [browser.auth.formInfo] = this.WeaveLoginManager._fillDocument(doc);
  },

  _updateView: function() {
    let browser = gBrowser.mCurrentBrowser;

    // The user's preference for auto-auth on this site.
    let autoAuth =
      this._prefs.site(browser.currentURI).get("authenticator.auto");

    // Whether or not it's possible to authenticate automatically for this site.
    // Even if the user has enabled auto-auth, we still don't do it if the user
    // is on a non-encrypted version of the site, to protect against MITM
    // attacks (see comment in onDOMContentLoaded for more info).
    let autoAuthPossible = browser.currentURI.scheme == "https";

    this._auto.checked = autoAuth;
    this._auto.disabled = !autoAuthPossible;

    if (autoAuth && autoAuthPossible) {
      this._state.setAttribute("state", "auto");
      this._state.removeAttribute("message");
    }
    else if (browser.auth.openIDField || browser.auth.formInfo) {
      this._state.setAttribute("state", "enabled");
      if (autoAuth)
        this._state.setAttribute("message", "unencrypted");
    }
    else {
      this._state.setAttribute("state", "disabled");
      this._state.removeAttribute("message");
    }
  }

};

window.addEventListener("load",   function() { gWeaveAuthenticator.onLoad()   }, false);
window.addEventListener("unload", function() { gWeaveAuthenticator.onUnload() }, false);
