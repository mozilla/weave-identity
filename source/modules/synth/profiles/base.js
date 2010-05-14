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

let EXPORTED_SYMBOLS = ['SynthProfile'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://weave-identity/ext/log4moz.js");
Cu.import("resource://weave-identity/ext/resource.js");
Cu.import("resource://weave-identity/util.js");
Cu.import("resource://weave-identity/profiles/username-password-form.js");

function SynthProfile(realm) {
  this._init(realm);
}
SynthProfile.prototype = {
  __proto__: UPFormProfile.prototype,
  _logName: "SynthProfile",

  _connect_POST: function() {
    let connect = this._profile.connect;
    let logins = Utils.getLogins(this._realm.domain, this._realm.realmUrl, null, true);
    let username, password;
    if (logins && logins.length > 0) {
      username = logins[0].username;
      password = logins[0].password;
    }

    let params = 
      connect.params.username + '=' + encodeURIComponent(username) + '&' +
      connect.params.password + '=' + encodeURIComponent(password);
    if (connect.params._extra) {
      for each (let p in connect.params._extra) {
        params += '&' + p + "=" + encodeURIComponent(connect.params._extra[p]);
      }
    }

    let synth = this._realm.amcd._synth;
    if (synth['connect-challenge']) {
      let uri = this._realm.domain.obj.resolve(synth['connect-challenge'].path);
      let dom = new Resource(uri).get().dom;
      let str = Utils.xpathText(dom, synth['connect-challenge'].xpath);
      if (str)
        params += '&' + synth['connect-challenge'].param + '=' + encodeURIComponent(str);
    }

    let res = new Resource(this._realm.domain.obj.resolve(connect.path));
    res.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    let ret = res.post(params);
    this._realm.statusChange(ret.headers['X-Account-Management-Status']);
  }
};
