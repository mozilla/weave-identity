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

const EXPORTED_SYMBOLS = ['Realm'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://weave-identity/ext/log4moz.js");
Cu.import("resource://weave-identity/ext/resource.js");
Cu.import("resource://weave-identity/constants.js");
Cu.import("resource://weave-identity/util.js");
Cu.import("resource://weave-identity/profilemanager.js");

function Realm(realmUrl, domainUrl) {
  this._init(realmUrl, domainUrl);
}
Realm.prototype = {
  _logName: "Realm",
  _logPref: "log.logger.realm",

  // Used for amcdState, connState
  STATE_UNKNOWN: "unknown",

  // AMCD states
  amcdState: null,
  AMCD_NOT_SUPPORTED: "amcd_not_supported",
  AMCD_DOWNLOADING: "amcd_downloading",
  AMCD_JSON_OK: "amcd_json_ok",
  AMCD_OK: "amcd_ok",
  AMCD_DOWNLOAD_ERROR: "amcd_download_error",
  AMCD_PARSE_ERROR: "amcd_parse_error",

  // User connection state
  connState: null,
  SIGNING_IN: "signing_in",
  SIGNED_IN: "signed_in",
  SIGNING_OUT: "signing_out",
  SIGNED_OUT: "signed_out",
  UNREGISTERED: "unregistered",
  REGISTERING: "registering",

  // used by profiles to prevent concurrency
  // fixme: doesn't time out or check for errors in any way
  lock: function(state) {
    switch (this.connState) {
    case this.SIGNING_IN:
    case this.SIGNING_OUT:
    case this.REGISTERING:
      return false;
    }
    this.connState = state;
    return true;
  },

  get realmUrl() {
    return this._realmUrl;
  },
  set realmUrl(value) {
    this._realmUrl = new String(value);
    this._realmUrl.obj = Utils.makeURL(value);
  },

  get domain() {
    if (!this._domain)
      this.domain = this.realmUrl.obj;
    return this._domain;
  },
  set domain(value) {
    if (typeof(value) == 'string')
      value = Utils.makeURL(value);
    this._domain = new String(value.scheme + '://' + value.hostPort);
    this._domain.obj = Utils.makeURL(this._domain);
  },

  get profile() {
    return this._profile;
  },

  get username() {
    return Svc.Prefs.get("preferred.username");
  },
  set username(value) {
    Svc.Prefs.set("preferred.username", value);
  },

  get email() {
    return Svc.Prefs.get("preferred.email");
  },
  set email(value) {
    Svc.Prefs.set("preferred.email", value);
  },

  _init: function(realmUrl, domainUrl) {
    this.amcdState = this.STATE_UNKNOWN;
    this.connState = this.STATE_UNKNOWN;
    if (realmUrl)
      this.realmUrl = realmUrl;
    if (domainUrl)
      this.domainUrl = domainUrl;
    this.curId = "";
    this._log = Log4Moz.repository.getLogger(this._logName);
    this._log.level = Log4Moz.Level[Svc.Prefs.get(this._logPref)];
  },

  refreshAmcd: function Realm_refreshAmcd() {
    this.amcdState = this.AMCD_DOWNLOADING;

    let res = new Resource(this.realmUrl.obj);
    let ret = res.get(); 

    if (ret.success) {
      try {
        this.amcd = ret.obj;
        this.amcdState = this.AMCD_JSON_OK;

        this._profile = this._chooseProfile();
        if (this._profile)
          this.amcdState = this.AMCD_OK;

        if (this.connState == this.STATE_UNKNOWN)
          this.execute('sessionstatus');

      } catch (e) {
        this.amcdState = this.AMCD_PARSE_ERROR;
      }
    } else {
      this.amcdState = this.AMCD_DOWNLOAD_ERROR;
      this._log.warn("could not download amcd: " + this.realmUrl + "\n"); // xxx
    }
  },

  // FIXME: this should take other data into consideration (e.g., if a
  // profile has been used before, stick with it)
  _chooseProfile: function() {
    if (this.amcdState != this.AMCD_JSON_OK)
      this._log.warn("Cannot access AMCD, not parsed (" + this.amcdState + ")");

    this._log.debug("Choosing matching AMCD profile");
    let profile;

    if (this.amcd.methods) {
      for (let name in this.amcd.methods) {
        profile = ProfileManager.Service.getProfile(name, this);
        if (profile)
          break;
      }
    }

    if (profile)
      this._log.debug("Profile chosen: " + profile.name);
    else
      this._log.warn("No profile in common");
    return profile;
  },

  _parseArgs: function(header) {
    let args = {};

    if (!header)
      return args;

    let keyRe = /^\s*([^=]+)=/;
    let valueRe = /^([^;]*)(?:;|$)/;
    let quotedValueRe = /^\s*"((?:\\"|[^\\])*)"\s*(?:;|$)/;

    function reHelper(re, string) {
      let out = re.exec(string);
      if (!out)
        return [null, string];
      return [out[1], string.replace(re, '')];
    }

    while (true) {
      let key;
      [key, header] = reHelper(keyRe, header);
      if (!key)
        break;

      let re = valueRe;
      if (/^\s*"/.test(header))
        re = quotedValueRe;

      let value;
      [value, header] = reHelper(re, header);
      if (value == null)
        break;

      args[key] = value;
    }
    return args;
  },

  updateStatus: function(progress, request, location) {
    let header; 
    try {
      header = request.getResponseHeader('X-Account-Management-Status');
      this._log.trace("X-Account-Management-Status: " + header);
    } catch (e) { /* ok if not set */ }
    if (header)
      this.statusChange(header);
  },

  statusChange: function(header) {
    if (!header)
      return;
    this._log.debug("changing status: " + header);

    let re = /^([^;]+)\s*(?:;|$)/;
    let event = re.exec(header);
    let args = this._parseArgs(header.replace(re, ''));

    if (args["token"])
      this.token = args["token"];

    switch (event[1]) {
    case "active":
      this.connState = Realm.SIGNED_IN;
      this.curId = args["name"];
      break;
    case "passive":
    case "none": {
      let logins = Utils.getLogins(this.domain, this.realmUrl, null, true);
      if (logins && logins.length > 0)
        this.connState = Realm.SIGNED_OUT;
      else
        this.connState = Realm.UNREGISTERED;
    } break;
    default:
      this.connState = Realm.STATE_UNKNOWN;
      this._log.warn("Unknown status change event: " + event[1]);
    }
  },

  execute: function(method) {
    if (['sessionstatus', 'connect', 'disconnect', 'register'].indexOf(method) < 0) {
      this._log.error("Unknown method: " + method);
      return;
    }
    if (this.amcdState != this.AMCD_OK) {
      this._log.error("Cannot execute method, no profile. AMCD state: " + this.amcdState);
      return;
    }

    this._log.debug("Executing profile method: " + method);
    this._profile[method]();
  }
};

Realm.__proto__ = Realm.prototype; // So that Realm.STATE_* work
