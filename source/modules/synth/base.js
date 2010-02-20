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

let EXPORTED_SYMBOLS = ['realm'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://weave-identity/util.js");
Cu.import("resource://weave-identity/realm.js");

function SynthRealm(descriptor) {
  this._init();
  this.realmUrl = descriptor.realmUri;
  this._amcd = descriptor.amcd;
  this._domainUrl = this._amcd.domain;
}
SynthRealm.prototype = {
  __proto__: Realm.prototype,

  refreshAmcd: function() {
    this._log.trace("refreshAmcd");
    this.amcdState = this.AMCD_OK;
  },

  updateStatus: function(progress, request, location) {
    if (progress.isLoadingDocument)
      return; // need the full doc to scrape it
    let user = Utils.xpathText(progress.DOMWindow.document,
                               this._amcd.methods.scrape.username);
    if (user)
      this.statusChange('active; name="' + user + '"');
    else
      this.statusChange('none;');
  }
};

let realm = SynthRealm;