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

const EXPORTED_SYMBOLS = ['SynthRealmManager'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://weave-identity/ext/log4moz.js");
Cu.import("resource://weave-identity/ext/Observers.js");
Cu.import("resource://weave-identity/ext/resource.js");
Cu.import("resource://weave-identity/constants.js");
Cu.import("resource://weave-identity/util.js");
Cu.import("resource://weave-identity/realm.js");

function SynthRealmManager() {
  this._log = Log4Moz.repository.getLogger("SynthRealmManager");
  this._log.level = Log4Moz.Level[Svc.Prefs.get("log.logger.realm")];

  this._desc = {};
  this._realms = {};

  // auto-register bundled synth realms & descriptors
  this._registerBundledRealms();
  this._registerBundledDescriptors();

  // let others know the manager has started, so they can register with it now
  Observers.notify("weaveid-synth-manager-start");
}
SynthRealmManager.prototype = {
  // FIXME: this slows down startup time, we need to phase this out
  // with some other solution (ideally sites will just support the
  // AMCD)
  _registerBundledRealms: function() {
    let dir = Utils.makeURI("resource://weave-identity/synth/realms");
    dir.QueryInterface(Ci.nsIFileURL);
    dir = dir.file;
  
    let entries = dir.directoryEntries;
    let array = [];
    while (entries.hasMoreElements()) {
      let entry = entries.getNext();
      entry.QueryInterface(Ci.nsIFile);
      try {
        let sym = {};
        Cu.import("resource://weave-identity/synth/realms/" + entry.leafName, sym);
        for (let realm in sym) {
          this.registerRealm(sym[realm]);
        }
      } catch (e) {
        this._log.error("Could not load synth/" + entry.leafName + e);
      }
    }
  },

  _registerBundledDescriptors: function() {
    let dir = Utils.makeURI("resource://weave-identity/synth/desc");
    dir.QueryInterface(Ci.nsIFileURL);
    dir = dir.file;
  
    let entries = dir.directoryEntries;
    let array = [];
    while (entries.hasMoreElements()) {
      let entry = entries.getNext();
      entry.QueryInterface(Ci.nsIFile);
      try {
        let sym = {};
        Cu.import("resource://weave-identity/synth/desc/" + entry.leafName, sym);
        for (let desc in sym) {
          this.registerDescriptor(sym[desc]);
        }
      } catch (e) {
        this._log.error("Could not load synth/" + entry.leafName + e);
      }
    }
  },

  registerDescriptor: function(desc) {
    // FIXME: check overwrite and warn (?)
    this._log.debug("Registering site descriptor: " + desc.name);
    this._desc[desc.realmUri] = desc;
  },

  registerRealm: function(realm) {
    // FIXME: check overwrite and warn (?)
    this._log.debug("Registering SynthRealm: " + realm.name);
    this._realms[realm.name] = realm;
  },

  getDescriptorForUri: function(uri) {
    if (typeof uri == 'string')
      uri = Utils.makeURI(value);

    this._log.trace("Finding a synthrealm descriptor for " + uri.spec);

    // first check for an exact match
    for each (let d in this._desc) {
      for each (let u in d.matchingUris) {
        u = Utils.makeURI(u);
        if (u.equals(uri))
          return d;
      }
    }

    // check for matching domain - XXX ignore scheme?
    for each (d in this._desc) {
      for each (let u in d.matchingUris) {
        u = Utils.makeURI(u);
        if (u.hostPort == uri.hostPort)
          return d;
      }
    }

    return null;
  },

  // FIXME: kind of an API mess, clean up!

  // XXX should this return singletons instead?
  newRealmForUri: function(uri) {
    let desc = this.getDescriptorForUri(uri);
    if (desc)
      return this.makeRealm(desc.realmUri);
    return null;
  },

  // XXX should this return singletons instead?
  makeRealm: function(uri) {
    this._log.trace("Attempting to make a synthrealm for " + uri);
    let d = this._desc[uri];
    if (!d || !this._realms[d.realmClass])
      return null;
    return new this._realms[d.realmClass](d);
  },

  realmUri: function(request, location) {
    let d = this.getDescriptorForUri(location);
    if (d)
      return d.realmUri;
    return null;
  }
};
