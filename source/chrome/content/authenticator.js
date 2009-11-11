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
Components.utils.import("resource://weave-identity/ext/Observers.js");
Components.utils.import("resource://weave-identity/ext/log4moz.js");
Components.utils.import("resource://weave-identity/service.js");

let gWeaveAuthenticator = {
  //**************************************************************************//
  // Shortcuts

  get Observers() {
    delete this.Observers;
    Cu.import("resource://weave-identity/ext/Observers.js", this);
    return this.Observers;
  },

  get _log() {
    delete this._log;
    this._log = Log4Moz.repository.getLogger("Authenticator");
    this._log.level = Log4Moz.Level[WeaveID.Svc.Prefs.get("log.logger.authenticator",
                                                    "Debug")];
    return this._log;
  },

  get _loginManager() {
    delete this._loginManager;
    return this._loginManager = Cc["@mozilla.org/login-manager;1"].
                                getService(Ci.nsILoginManager);
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

  get _list() {
    delete this._list;
    return this._list = document.getElementById("acct-auth-list");
  },

  get _auto() {
    delete this._auto;
    return this._auto = document.getElementById("acct-auth-auto");
  },

  get _signIn() {
    delete this._signIn;
    return this._signIn = document.getElementById("acct-auth-signIn");
  },

  get _autoDesc() {
    delete this._autoDesc;
    return this._autoDesc = document.getElementById("acct-auth-autoDesc");
  },

  get _disableAuto() {
    delete this._disableAuto;
    return this._disableAuto = document.getElementById("acct-auth-disableAuto");
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
    if (WeaveID.Svc.Prefs.get("authenticator.enabled")) {
      this._icon.hidden = false;
      gBrowser.addProgressListener(this, Ci.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
      gBrowser.addEventListener("DOMContentLoaded", this, true);
      this.Observers.add("passwordmgr-found-logins", this.onPasswordMgrFoundLogins, this);
    }
  },

  onUnload: function() {
    if (WeaveID.Svc.Prefs.get("authenticator.enabled")) {
      gBrowser.removeProgressListener(this);
      gBrowser.removeEventListener("DOMContentLoaded", this, true);
      this.Observers.remove("passwordmgr-found-logins", this.onPasswordMgrFoundLogins, this);
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
    // Note: the login manager does this via a web progress listener
    // that listens for Ci.nsIWebProgressListener.STATE_RESTORING; we could
    // probably do the same, we should just make sure to do so before
    // the login manager so its notifications build up our model.
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

    this._autoAuth(browser);
  },

  onPasswordMgrFoundLogins: function(formInfo) {
    this._log.trace("onPasswordMgrFoundLogins");

    formInfo.QueryInterface(Ci.nsIPropertyBag2);

    let doc = formInfo.get("passwordField").ownerDocument;
    if (!doc)
      return;

    let browser = gBrowser.getBrowserForDocument(doc);
    if (!browser)
      return;

    // If this is the first form the login manager can fill, update the model,
    // update the view if on the active browser tab, and auto auth if possible.
    // FIXME: support all forms the login manager can fill.
    if (!browser.auth.formInfo) {
      browser.auth.formInfo = formInfo;
      if (browser == gBrowser.mCurrentBrowser)
        this._updateView();
      this._autoAuth(browser);
    }
  },

  _autoAuth: function(browser) {
    let host; try { host = browser.currentURI.host } catch(ex) {}

    if (!host)
      return;

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
        WeaveID.Svc.Prefs.site(browser.currentURI).get("authenticator.auto") &&

        // the page is the last one in the session history, so users can
        // traverse history without losing control over their browser
        // and the history in front of the current page when they encounter
        // a page we can auto-authenticate
        sessionHistory.count == sessionHistory.index + 1 &&

        // auto-auth hasn't happened for this site in the last 60 seconds
        // (to suppress auto-auth loops when auto-auth fails)
        ((new Date() - lastAuthed) > 60000))
    {
      this._autoAuths[host] = new Date();
  
      if (browser.auth.openIDField) {
        // Other code in Weave has already inserted the Weave ID into the field,
        // so the only thing we have to do here is submit the form.
        this._submitForm(browser.auth.openIDField.form);
      }
      else { // browser.auth.formInfo
        let loginInfo = JSON.parse(WeaveID.Svc.Prefs.site(browser.currentURI).
                                   get("authenticator.auto.loginInfo"));
  
        let autoLoginInfo;
        for each (let foundLogin in browser.auth.formInfo.get("foundLogins")) {
          if (foundLogin.matches(loginInfo, true)) {
            autoLoginInfo = foundLogin;
            break;
          }
        }
      
        if (autoLoginInfo) {
          this._fillForm(browser.auth.formInfo, autoLoginInfo);
          this._submitForm(browser.auth.formInfo.get("passwordField").form);
        }
      }
    }
  },

  onSelectItem: function() {
    let item = this._list.selectedItem;
    if (item.loginInfo)
      this._fillForm(item.formInfo, item.loginInfo);
  },

  onSignIn: function() {
    WeaveID.Svc.Prefs.site(gBrowser.mCurrentBrowser.currentURI).
                set("authenticator.auto", this._auto.checked);
    if (!this._auto.checked)
      WeaveID.Svc.Prefs.site(gBrowser.mCurrentBrowser.currentURI).
                  reset("authenticator.auto.loginInfo");

    let item = this._list.selectedItem;
    if (item.loginInfo) {
      // Fill out the form again in case it got changed somehow in the meantime.
      this._fillForm(item.formInfo, item.loginInfo);

      if (this._auto.checked) {
        // Remove the password from the login info before saving it to prefs
        // so we don't store it in the clear.
        item.loginInfo.password = null;
        WeaveID.Svc.Prefs.site(gBrowser.mCurrentBrowser.currentURI).
                    set("authenticator.auto.loginInfo",
                        JSON.stringify(item.loginInfo));
      }

      this._submitForm(item.formInfo.get("passwordField").form);
    }
    else {
      this._submitForm(gBrowser.mCurrentBrowser.auth.openIDField.form);
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
    if (WeaveID.Svc.Prefs.get("openId.enabled") && browser.auth.openIDField)
      item = this._list.appendItem("Weave");

    // Add items for found logins, if any.
    if (browser.auth.formInfo) {
      let formInfo = browser.auth.formInfo;
      for each (let foundLogin in formInfo.get("foundLogins")) {
        // FIXME: localize and improve label for logins without username.
        let label = foundLogin.username || "no name";
        let item = this._list.appendItem(label);
        item.formInfo = formInfo;
        item.loginInfo = foundLogin;
        if (formInfo.get("selectedLogin") && foundLogin.equals(formInfo.get("selectedLogin")))
          this._list.selectedItem = item;
      }
    }

    // Select the first item.
    if (this._list.itemCount > 0 && this._list.selectedIndex == -1)
      this._list.selectedIndex = 0;
  },

  _fillForm: function(formInfo, loginInfo) {
    if (formInfo.get("usernameField"))
      formInfo.get("usernameField").value = loginInfo.username;
    formInfo.get("passwordField").value = loginInfo.password;
  },

  onDisableAutoAuth: function() {
    WeaveID.Svc.Prefs.site(gBrowser.mCurrentBrowser.currentURI).
                set("authenticator.auto", false);
    this._popup.hidePopup();
    this._updateView();
  },


  //**************************************************************************//
  // Implementation

  _submitForm: function(form) {
    // Calling the submit() action on a form doesn't seem to do everything
    // that clicking the submit button does. We try simulating the click
    // first, but if we don't find a button with type=submit, fallback 
    // to calling the action.
    for (let i = 0; i < form.elements.length; i++) {
        if (form.elements[i].getAttribute('type') == 'submit') {
            form.elements[i].click();
            return;
        }
    }
    
    // Strangely, if submission goes to a file: URL that doesn't exist,
    // this throws NS_ERROR_FILE_NOT_FOUND, so we catch and ignore that error
    // (not that we support form submission to file: URLs, so it probably
    // doesn't matter; but what other events might throw exceptions here?).
    try {
      // The page might have a custom submit, so use it instead of native
      form.wrappedJSObject.submit();
    }
    catch(ex) {}
  },

  _updateModel: function(doc, browser) {
    this._log.trace("_updateModel\n");

    let inputs = doc.getElementsByTagName("input");
    browser.auth = {};

    // Find the first OpenID field.
    if (WeaveID.Svc.Prefs.get("openId.enabled")) {
      for (let i = 0; i < inputs.length; i++) {
        let element = inputs.item(i);
        if (element.type.search(/^hidden|text$/) == 0 &&
            element.name.search(/openid/i) != -1) {
          browser.auth.openIDField = element;
          break;
        }
      }
    }
  },

  _updateView: function() {
    let browser = gBrowser.mCurrentBrowser;
    let host; try { host = browser.currentURI.host } catch(ex) {}

    // The user's preference for auto-auth on this site.
    let autoAuth =
      WeaveID.Svc.Prefs.site(browser.currentURI).get("authenticator.auto");

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
    else if ("auth" in browser && (browser.auth.openIDField || browser.auth.formInfo)) {
      this._state.setAttribute("state", "enabled");
      if (autoAuth)
        this._state.setAttribute("message", "unencrypted");
    }
    // Once we support HTTP authentication, update this to count logins
    // from HTTP realms as well.
    // FIXME: figure out why this doesn't work (countLogins always returns 0).
    else if (host && this._loginManager.countLogins(host, "", null) > 0) {
      this._state.setAttribute("state", "disabled");
      this._state.removeAttribute("message");
    }
    else {
      this._state.setAttribute("state", "unavailable");
      this._state.removeAttribute("message");
    }
  }

};

window.addEventListener("load",   function() { gWeaveAuthenticator.onLoad()   }, false);
window.addEventListener("unload", function() { gWeaveAuthenticator.onUnload() }, false);
