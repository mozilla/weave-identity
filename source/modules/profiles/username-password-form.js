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

const EXPORTED_SYMBOLS = ['UPFormProfile'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://weave-identity/ext/log4moz.js");
Cu.import("resource://weave-identity/ext/resource.js");
Cu.import("resource://weave-identity/constants.js");
Cu.import("resource://weave-identity/util.js");

function UPFormProfile(realm) {
  this._init(realm);
}
UPFormProfile.prototype = {
  _logName: "UPFormProfile",
  _logPref: "log.logger.profiles",

  name: "username-password-form",

  _init: function(realm) {
    this._realm = realm;
    this._profile = realm.amcd.methods[this.name];
    this._log = Log4Moz.repository.getLogger(this._logName);
    this._log.level = Log4Moz.Level[Svc.Prefs.get(this._logPref)];
  },

  sessionstatus: function() {
    this._log.trace('Querying signin state');

    let query = this._profile.sessionstatus;
    if (query && query.method == 'GET') {
      let res = new Resource(this._realm.domain.obj.resolve(query.path));
      this._realm.statusChange(res.get().headers['X-Account-Management-Status']);
    } else
      this._log.warn('No supported methods in common for query');
  },

  connect: function() {
    this._log.trace('Connecting');

    // check if we're already trying to sign in
    // fixme: doesn't time out or check for errors in any way
    if (this._realm.signinState == this.SIGNING_IN)
      return;
    this._realm.signinState = this._realm.SIGNING_IN;

    if (this._profile.connect && this._profile.connect.method == 'POST') {
      this._connect_POST();
    } else {
      this._log.warn('No supported methods in common for connect');
    }
  },
  _connect_POST: function() {
    let connect = this._profile.connect;
    let logins = Utils.getLogins(this._realm.domain);
    let username, password;
    if (logins && logins.length > 0) {
      username = logins[0].username;
      password = logins[0].password;
    }

    let params = 
      connect.params.username + '=' + encodeURIComponent(username) + '&' +
      connect.params.password + '=' + encodeURIComponent(password);

    if (this._realm.token)
      params += '&' + connect.params.token + '=' +
        encodeURIComponent(this._realm.token);

    let res = new Resource(this._realm.domain.obj.resolve(connect.path));
    res.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    let ret = res.post(params);
    this._realm.statusChange(ret.headers['X-Account-Management-Status']);
  },

  disconnect: function() {
    this._log.trace('Disconnecting');

    // check if we're already trying to sign out
    // fixme: doesn't time out or check for errors in any way
    if (this._realm.signinState == this._realm.SIGNING_OUT)
      return;
    this._realm.signinState = this._realm.SIGNING_OUT;

    if (this._profile.disconnect &&
        this._profile.disconnect.method == 'POST') {
      this._disconnect_POST();
    } else if (this._profile.disconnect &&
               this._profile.disconnect.method == 'GET') {
      this._disconnect_GET();
    } else
      this._log.warn('No supported methods in common for disconnect');
  },
  _disconnect_POST: function() {
    let disconnect = this._profile.disconnect;
    let res = new Resource(this._realm.domain.obj.resolve(disconnect.path));
    let params;
    if (this._realm.token)
      params = connect.params.token + '=' + encodeURIComponent(this._realm.token);
    this._realm.statusChange(res.post(params).headers['X-Account-Management-Status']);
  },
  _disconnect_GET: function() {
    let disconnect = this._profile.disconnect;
    let res = new Resource(this._realm.domain.obj.resolve(disconnect.path));
    let params;

    if (this._realm.token) {
      params = connect.params.token + '=' + encodeURIComponent(this._realm.token);
      // be careful not to trample any params already there
      res.uri.QueryInterface(Ci.nsIURL);
      if (res.uri.query)
        res.uri.query += '&' + params;
      else
        res.uri.query = params;
    }

    this._realm.statusChange(res.get().headers['X-Account-Management-Status']);
  }
};
