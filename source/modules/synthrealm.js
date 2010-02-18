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
 * The Original Code is Account Manager.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Dan Mills <thunder@mozilla.com>
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

const EXPORTED_SYMBOLS = ['SynthRealmFactory'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://weave-identity/ext/log4moz.js");
Cu.import("resource://weave-identity/ext/resource.js");
Cu.import("resource://weave-identity/constants.js");
Cu.import("resource://weave-identity/util.js");
Cu.import("resource://weave-identity/realm.js");

function SynthRealmFactory() {
  this._log = Log4Moz.repository.getLogger("SynthRealmFactory");
  this._log.level = Log4Moz.Level[Svc.Prefs.get("log.logger.realm")];

  this._realms = {};

  // register bundled realms
  this.register(BasicSynthRealm);
}
SynthRealmFactory.prototype = {
  register: function(realm) {
    let domain = realm.prototype._amcd.domain; // xxx
    this._realms[domain] = realm;
  },
  realmUri: function(request, location) {
    this._log.trace("Attempting to find a synthrealm for " + location.hostPort);
    for (let uri in this._realms) {
      if (location.scheme + '://' + location.hostPort == uri)
        return uri;
    }
    return null;
  },
  makeRealm: function(url) {
    return new this._realms[url](url);
  }
};

function BasicSynthRealm(url) {
  // xxx url unused
  this._init();
  this.realmUrl = this._domainUrl = this._amcd.domain;
}
BasicSynthRealm.prototype = {
  __proto__: Realm.prototype,
  _amcd: {
    "domain": "http://localhost",
    "methods": {
      "connect": {
        "POST": {
          "path":"/signin/",
          "params": {
            "username":"unam",
            "password":"pwd"
          }
        }
      },
      "disconnect": {
        "POST": {
          "path":"/signout/",
          "params": {
            "username":"unam",
            "password":"pwd"
          }
        }
      },
      "query": {
        "GET": {
          "path":"/"
        }
      },
      "register": {
        "POST": {
          "path":"/user/",
          "schemas": {
            "poco":"http://portablecontacts/ns/1.0"
          },
          "params": {
            "username":"unam",
            "password":"pwd",
            "password_verify":"pwd2",
            "poco": {
              "givenName": "fname",
              "familyName": "lname"
            }
          }
        }
      },
      "changepassword": {
        "POST": {
          "path":"/changepass/",
          "params": {
            "username":"unam",
            "old_password":"old_pwd",
            "password":"pwd",
            "password_verify":"pwd2"
          }
        }
      }
    }
  },

  refreshAmcd: function() {
    this._log.trace("refreshAmcd");
    this.amcdState = this.AMCD_OK;
  },

  updateStatus: function(progress, request, location) {
    if (progress.isLoadingDocument)
      return; // need the full doc to scrape it
    let user = progress.DOMWindow.document.getElementById("username");
    if (user)
      this.statusChange('active; name="' + user.innerHTML + '"');
    else
      this.statusChange('none;');
  }
};
