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

function Realm(realmUrl, domainUrl) {
  this._init(realmUrl, domainUrl);
}
Realm.prototype = {
  _logName: "Realm",
  _logPref: "log.logger.realm",

  // Used for amcdState, signinState
  STATE_UNKNOWN: "unknown",

  // AMCD states
  amcdState: null,
  AMCD_NOT_SUPPORTED: "amcd_not_supported",
  AMCD_DOWNLOADING: "amcd_downloading",
  AMCD_OK: "amcd_ok",
  AMCD_DOWNLOAD_ERROR: "amcd_download_error",
  AMCD_PARSE_ERROR: "amcd_parse_error",

  // User connection state
  signinState: null,
  SIGNING_IN: "signing_in",
  SIGNED_IN: "signed_in",
  SIGNING_OUT: "signing_out",
  SIGNED_OUT: "signed_out",

  // FIXME: don't get the domain from the AMCD
  get domain() {
    if (this._domain)
      return this._domain;

    let domain = new String(this._domainUrl);
    domain.obj = Utils.makeURL(domain);
    if (domain[domain.length - 1] == '/')
      domain.noslash = domain.slice(0, domain.length - 1);
    else
      domain.noslash = this._amcd.domain;

    // cache it for next time
    return this._domain = domain;
  },

  _init: function(realmUrl, domainUrl) {
    this.amcdState = this.STATE_UNKNOWN;
    this.signinState = this.STATE_UNKNOWN;
    if (realmUrl)
      this.realmUrl = realmUrl;
    if (domainUrl)
      this._domainUrl = domainUrl;
    this.curId = "";
    this._log = Log4Moz.repository.getLogger(this._logName);
    this._log.level = Log4Moz.Level[Svc.Prefs.get(this._logPref)];
  },

  refreshAmcd: function Realm_refreshAmcd() {
    this.amcdState = this.AMCD_DOWNLOADING;

    let res = new Resource(this.realmUrl);
    let ret = res.get();

    if (ret.success) {
      try {
        this._amcd = ret.obj;
        this.amcdState = this.AMCD_OK;

        if (this.signinState == this.STATE_UNKNOWN)
          this.querySigninState();

      } catch (e) {
        this.amcdState = this.AMCD_PARSE_ERROR;
      }
    } else {
      this.amcdState = this.AMCD_DOWNLOAD_ERROR;
      this._log.warn("could not download amcd: " + this.realmUrl + "\n"); // xxx
    }
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

    switch (event[1]) {
    case "active":
      this.signinState = Realm.SIGNED_IN;
      this.curId = args["name"];
      break;
    case "passive":
    case "none":
      this.signinState = Realm.SIGNED_OUT;
      break;
    default:
      this.signinState = Realm.SIGNED_OUT;
      this._log.warn("Unknown status change event: " + event[1]);
    }
  },

  querySigninState: function() {
    this._log.trace('Querying signin state');

    error: {
      if (this.amcdState != this.AMCD_OK)
        this._log.warn("Attempted to query state but AMCD not parsed (" + this.amcdState + ")");
      else if (!this._amcd.methods || !this._amcd.methods.query)
        this._log.warn("Query method not supported AMCD");
      else
        break error;
      return;
    }

    if (this._amcd.methods.query['GET']) {
      let query = this._amcd.methods.query.GET;
      let res = new Resource(this.domain.obj.resolve(query.path));
      this.statusChange(res.get().headers['X-Account-Management-Status']);
    } else
      this._log.warn('No supported methods in common for query');
  },

  connect: function() {
    this._log.trace('Connecting');

    error: {
      if (this.amcdState != this.AMCD_OK)
        this._log.warn("Attempted to connect but AMCD not parsed");
      else if (!this._amcd.methods || !this._amcd.methods.connect)
        this._log.warn("Connect method not supported in AMCD");
      else
        break error;
      return;
    }

    // check if we're already trying to sign in
    // fixme: doesn't time out or check for errors in any way
    if (this.signinState == this.SIGNING_IN)
      return;
    this.signinState = this.SIGNING_IN;

    if (this._amcd.methods.connect['POST']) {
      let connect = this._amcd.methods.connect.POST;
      let logins = Utils.getLogins(this.domain.noslash);
      let username, password;
      if (logins && logins.length > 0) {
        try {
        username = encodeURIComponent(logins[0].username);
        password = encodeURIComponent(logins[0].password);
        } catch (e) {
          this._log.debug(e);
          throw e;
        }
      }

      let res1 = new Resource("https://www.google.com/accounts/Login");
      let foo = res1.get();
      let dsh =
        /^\s*<input\s*type="hidden"\s*name="dsh"\s*id="dsh"\s*value="([^"]*)"\s*\/>\s*$/m
        .exec("" + foo)[1];
      let galx =
        /^\s*<input\s*type="hidden"\s*name="GALX"\s*value="([^"]*)"\s*\/>\s*$/m
        .exec("" + foo)[1];

      let res = new Resource(this.domain.obj.resolve(connect.path));
      res.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      let ret = res.post(connect.params.username + '=' + username + '&' +
                         connect.params.password + '=' + password + '&' +
                         'dsh=' + dsh + '&GALX=' + galx);
      this.statusChange(ret.headers['X-Account-Management-Status']);

    } else
      this._log.warn('No supported methods in common for connect');
  },

  disconnect: function() {
    this._log.trace('Disconnecting');

    error: {
      if (this.amcdState != this.AMCD_OK)
        this._log.warn("Attempted to connect but AMCD not parsed");
      else if (!this._amcd.methods || !this._amcd.methods.disconnect)
        this._log.warn("Disconnect method not supported in AMCD");
      else
        break error;
      return;
    }

    // check if we're already trying to sign out
    // fixme: doesn't time out or check for errors in any way
    if (this.signinState == this.SIGNING_OUT)
      return;
    this.signinState = this.SIGNING_OUT;

    if (this._amcd.methods.disconnect['POST']) {
      let disconnect = this._amcd.methods.disconnect.POST;
      let res = new Resource(this.domain.obj.resolve(disconnect.path));
      this.statusChange(res.get().headers['X-Account-Management-Status']);
    } else
      this._log.warn('No supported methods in common for disconnect');
  }
};
Realm.__proto__ = Realm.prototype; // So that Realm.STATE_* work
