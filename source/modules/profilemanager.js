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

const EXPORTED_SYMBOLS = ['ProfileManager'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://weave-identity/ext/log4moz.js");
Cu.import("resource://weave-identity/ext/Observers.js");
Cu.import("resource://weave-identity/ext/resource.js");
Cu.import("resource://weave-identity/constants.js");
Cu.import("resource://weave-identity/util.js");

let ProfileManager = {};
Utils.lazy(ProfileManager, 'Service', ProfileManagerSvc);

function ProfileManagerSvc() {
  this._log = Log4Moz.repository.getLogger("ProfileManager");
  this._log.level = Log4Moz.Level[Svc.Prefs.get("log.logger.profiles")];

  this._profiles = {};

  // auto-register bundled profiles
  this._registerBundledProfiles();

  // let others know the manager has started, so they can register with it now
  Observers.notify("weaveid-profile-manager-start");
}
ProfileManagerSvc.prototype = {
  _registerBundledProfiles: function() {
    let dir = Utils.makeURI("resource://weave-identity/profiles");
    dir.QueryInterface(Ci.nsIFileURL);
    dir = dir.file;
  
    let entries = dir.directoryEntries;
    let array = [];
    while (entries.hasMoreElements()) {
      let entry = entries.getNext();
      entry.QueryInterface(Ci.nsIFile);
      try {
        let sym = {};
        Cu.import("resource://weave-identity/profiles/" + entry.leafName, sym);
        for (let profile in sym) {
          this.registerProfile(sym[profile]);
        }
      } catch (e) {
        this._log.error("Could not load profiles/" + entry.leafName + e);
      }
    }
  },

  registerProfile: function(profile) {
    // FIXME: check overwrite and warn (?)
    this._log.debug("Registering Profile: " + profile.prototype.name);
    this._profiles[profile.prototype.name] = profile;
  },

  getProfile: function(name, realm) {
    if (name in this._profiles)
      return new this._profiles[name](realm);
    return null;
  }
};
