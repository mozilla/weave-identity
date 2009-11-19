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
 *   Anant Narayanan <anant@kix.in>
 *   Jono S. Xia <jono@mozilla.com>
 *   
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
 
Components.utils.import("resource://weave-identity/service.js");
Components.utils.import("resource://weave-identity/ext/Preferences.js");

/* Look at incoming pages for OpenID forms and munge them.
   This is hacky and makes a lot of unjustified assumptions about forms. */

/* Listen for URLs that point to Weave OpenID provider and intercept */
var gOpenIDProviderListener = {
    QueryInterface: function(aIID) {
       if (aIID.equals(Components.interfaces.nsIWebProgressListener) ||
           aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
           aIID.equals(Components.interfaces.nsISupports))
         return this;
       throw Components.results.NS_NOINTERFACE;
      },

      onLocationChange: function(aProgress, aRequest, aURI) {
        if (aURI)
          gOpenIdMunger.processNewURL(aURI, aProgress.DOMWindow);
      },

      onStateChange: function() {},
      onProgressChange: function() {},
      onStatusChange: function() {},
      onSecurityChange: function() {},
      onLinkIconAvailable: function() {}
}

const PWDMGR_HOST = "chrome://weave";
const PWDMGR_REALM = "Mozilla Services Password";
const OPENID_SERVICE_URI = "services.mozilla.com/openid/";
const OPENID_PREF = "openId.enabled";
const OPENID_CUSTOM_PREF = "openId.custom";
const WEAVE_USERNAME = "extensions.weave.username";

/* When we find an openID field, grey it out and put the user's Weave-based openID URI into
 * it, while changing the submit button to say "Sign In with Weave".  But only do this if
 * OPENID_PREF is turned on.
 */

var gOpenIdMunger = {
  _logins: null,
  get _logins() {
    return Components.classes["@mozilla.org/login-manager;1"]
      .getService(Components.interfaces.nsILoginManager)
      .findLogins({}, PWDMGR_HOST, null, PWDMGR_REALM);
  },
  
  init: function() {
    /* Listen for webpage loads */
    if (WeaveID.Svc.Prefs.get(OPENID_PREF)) {
      if (typeof(gBrowser) != "undefined") {
        var appcontent = document.getElementById("appcontent");   // browser
        if (appcontent) {
          appcontent.addEventListener("DOMContentLoaded",
                                      gOpenIdMunger.detectForm, true);
        }
      }
    }

    /* Listen for redirects to Weave OpenID provider regardless of pref */
    if (typeof(gBrowser) != "undefined") {
      gBrowser.addProgressListener(gOpenIDProviderListener,
        Components.interfaces.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
    }
  },

  uninit: function() {
    if (WeaveID.Svc.Prefs.get(OPENID_PREF)) {
      if (typeof(gBrowser) != "undefined") {
        var appcontent = document.getElementById("appcontent");   // browser
        if (appcontent) {
          appcontent.removeEventListener("DOMContentLoaded",
                                      gOpenIdMunger.detectForm, true);
        }
      }
    }

    if (typeof(gBrowser) != "undefined")
      gBrowser.removeProgressListener(gOpenIDProviderListener);
  },
  
  detectForm: function(aEvent) {
    var theDoc = aEvent.originalTarget;
    let inputs = theDoc.getElementsByTagName("input");
    let i;

    // Make sure we have an endpoint. We need either a user-specified URL,
    // or a Weave username
    let openidEndpoint = WeaveID.Svc.Prefs.get(OPENID_CUSTOM_PREF);
    if (!openidEndpoint) {
      let weaveUser = Preferences.get(WEAVE_USERNAME);
      if (!weaveUser)
        return;
      openidEndpoint = OPENID_SERVICE_URI + weaveUser;
    }

    // Find text input fields for OpenID identifiers:
    for (i = 0; i < inputs.length; i++) {
      let elem = inputs.item(i);

      // OpenID 2.0 says inputs SHOULD be openid_identifier
      // http://openid.net/specs/openid-authentication-2_0.html#initiation
      // OpenID 1.1 says inputs SHOULD be openid_url
      // http://openid.net/specs/openid-authentication-1_1.html#anchor7
      // Open Web says sites don't follow that and use whatever they want
      // I say.. "I give up!"
      if (elem.type == "text" && elem.name.search(/openid/i) != -1) {
        /* Turn the text input field into a hidden field, and fill in the value with our
         * Weave-based OpenID identifier.  Trial and error shows that we have to set type
         * before we set value, because changing the type of a field seems to reset its value
         * to the one defined in the page.  Not sure if this is a DOM bug or purposeful
         * behavior but that seems to be how it works at least in firefox 3.5.
         */
        elem.type = "hidden";
        elem.value = openidEndpoint;

        let form = elem.form;
        let formChildren = form.getElementsByTagName("input");
        // Find the submit button in the same form and change the text on the button:
        for (let j=0; j < formChildren.length; j++) {
          if (formChildren[j].type == "submit") {
            let submit = formChildren[j];
            let oldvalue = submit.value;
            submit.value = "Sign In Using Weave";
            let foo = submit.ownerDocument.createElement("span");
            let links = '<a href="#" id="revert"><small>(revert)</small></a>';

            foo.innerHTML = links;            
            foo.addEventListener('click', function() {
              elem.value = "";
              elem.type = "text";
              submit.value = oldvalue;
              submit.parentNode.removeChild(foo);
            }, false);
            
            submit.parentNode.insertBefore(foo, submit.nextSibling);
          }
        }
      }
    }
  },

  processNewURL: function(aURI, domWin) {
    let spec = aURI.spec;
    if (spec.substr(0, 37) ==
        'https://services.mozilla.com/openid/?') {

      let loadUrl = function(url) domWin.location = url;
      if (domWin.location != spec) {
        Array.forEach(domWin.document.getElementsByTagName("iframe"), function(frame) {
          if (frame.src == spec)
            loadUrl = function(url) frame.src = url;
        });
      }

      let redirect = function(url) {
        window.stop();
        loadUrl(url);
      };

      /* Stop the redirect */
      redirect("chrome://weave-identity/content/openid-wait.xul");

      /* Parse tokens */
      let pstring = spec.substr(37);
      let params = pstring.split('&');
      let retURI = false;
      let rootURI = false;

      for (let i = 0; i < params.length; i++) {
        if (params[i].substr(0, 16)  == "openid.return_to") {
          retURI = params[i].split('=');
          retURI = decodeURIComponent(retURI[1]);
        }
        if (params[i].substr(0, 17)  == "openid.trust_root") {
          rootURI = params[i].split('=');
          rootURI = decodeURIComponent(rootURI[1]);
        }
      }

      if (!retURI) {
        /* No return_to was specified! */
        window.back();
      }

      /* Make the request */
      this.authorize(retURI, rootURI, redirect);
    }
  },

  authorize: function (rurl, root, cb) {
    let req = new XMLHttpRequest();
    let usr = Preferences.get(WEAVE_USERNAME);
    
    // Fetch password from LoginManager
    let pwd = null;
    for each (let login in this._logins)
      if (login.username == usr)
        pwd = login.password;

    usr = "https://services.mozilla.com/openid/" + usr;
    let params = 'openid_identity=' + encodeURIComponent(usr);
    params = params + '&weave_pwd=' + encodeURIComponent(pwd);
    params = params + '&openid_return_to=' + encodeURIComponent(rurl);

    if (root)
      params = params + '&openid_trust_root=' + encodeURIComponent(root);

    let uri = 'https://services.mozilla.com/openid/?openid.mode=authorize_site';
    req.onreadystatechange = function(e) {
      if (req.readyState == 4) {
        /* Our job is to just redirect,
         * else everything has been setup by the server.
         * We don't even know if the auth succeeded or not, the consumer
         * will be informing the user.
         */
        cb(req.responseText);
      }
    };
    req.open('POST', uri);
    req.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    req.setRequestHeader('Content-length', params.length);
    req.setRequestHeader('Connection', 'close');
    req.send(params);
  }
};

window.addEventListener("load", function() {gOpenIdMunger.init();}, false);
window.addEventListener("unload", function() {gOpenIdMunger.uninit();}, false);
