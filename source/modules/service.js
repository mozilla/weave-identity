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

const EXPORTED_SYMBOLS = ['WeaveID'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://weave-identity/ext/log4moz.js");
Cu.import("resource://weave-identity/ext/Observers.js");
Cu.import("resource://weave-identity/ext/Preferences.js");
Cu.import("resource://weave-identity/ext/resource.js");
Cu.import("resource://weave-identity/ext/Cache.js");
Cu.import("resource://weave-identity/constants.js");
Cu.import("resource://weave-identity/util.js");
Cu.import("resource://weave-identity/realm.js");
Cu.import("resource://weave-identity/synthrealm.js");

// for export
let WeaveID = {};
Cu.import("resource://weave-identity/constants.js", WeaveID);
Cu.import("resource://weave-identity/util.js", WeaveID);
Cu.import("resource://weave-identity/realm.js", WeaveID);

Utils.lazy(WeaveID, 'Service', WeaveIDSvc);

/*
 * Service singleton
 */

function WeaveIDSvc() {
  this.realms = {};
}
WeaveIDSvc.prototype = {
  // this gets called on app startup by an xpcom component
  onStartup: function onStartup() {
    let ua = Cc["@mozilla.org/network/protocol;1?name=http"].
      getService(Ci.nsIHttpProtocolHandler).userAgent;

    this._initLogs();
    this._log.info("Loading Weave Identity component");
    this._log.info(ua);

    this._locationCache = new Cache();
    this._synthRealms = new SynthRealmManager();

    try {
      this._docLoader = Cc["@mozilla.org/docloaderservice;1"]
        .getService(Ci.nsIWebProgress);
      this._docLoader.addProgressListener(this, Ci.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
    } catch (e) {
      this._log.error(e);
    }
  },

  _initLogs: function WeaveID__initLogs() {
    this._log = Log4Moz.repository.getLogger("Service");
    this._log.level =
      Log4Moz.Level[Svc.Prefs.get("log.logger.service")];

    let formatter = new Log4Moz.BasicFormatter();
    let root = Log4Moz.repository.rootLogger;
    root.level = Log4Moz.Level[Svc.Prefs.get("log.rootLogger")];

    let capp = new Log4Moz.ConsoleAppender(formatter);
    capp.level = Log4Moz.Level[Svc.Prefs.get("log.appender.console")];
    root.addAppender(capp);

    let dapp = new Log4Moz.DumpAppender(formatter);
    dapp.level = Log4Moz.Level[Svc.Prefs.get("log.appender.dump")];
    root.addAppender(dapp);
  },

  //**************************************************************************//
  // nsIWebProgressListener

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener,
                                         Ci.nsIDOMEventListener,
                                         Ci.nsISupportsWeakReference]),

  onStateChange: function(progress, request, stateFlags, status) {
    if (stateFlags & Ci.nsIWebProgressListener.STATE_REDIRECTING ||
        stateFlags & Ci.nsIWebProgressListener.STATE_STOP)
      this.updateRealm(progress, request);
  },
  onLocationChange: function() {},
  onProgressChange: function() {},
  onStatusChange: function() {},
  onSecurityChange: function() {},
  onLinkIconAvailable: function() {},

  //**************************************************************************//

  updateRealm: function WeaveID_updateRealm(progress, request, location) {
    try {
      request.QueryInterface(Ci.nsIHttpChannel);
    } catch (e) { return null; } // we only care about http

    if (!location)
      location = request.URI;

    let realm = this._findRealm(request, location);
    if (!realm)
      return null;

    this._log.trace("updateRealm: " + realm.realmUrl);

    // FIXME: also refresh after a timeout
    if (realm.amcdState == Realm.STATE_UNKNOWN) {
      this._log.trace("Downloading AMCD");
      realm.refreshAmcd();
    }

    realm.updateStatus(progress, request, location);

    Observers.notify("weaveid-realm-updated", realm.realmUrl);
    return realm.realmUrl;
  },

  _findRealm: function(request, location) {
    try {
      // if we have a header, that's the amcd url
      let url = request.getResponseHeader('X-Account-Management');
      if (this.realms[url])
        return this.realms[url];
      return this.realms[url] = new Realm(url, location);

    } catch (e) {
      let url = this._locationCache.get(location.hostPort);

      if (typeof(url) != "undefined") {
        // cache hit
        // if null, we already probed this site and found nothing
        // else we should have a realm for it already
        if (!url)
          return null;
        return this.realms[url];

      } else {
        // * probe for host-meta, and discover the amcd if present
        // * if that doesn't work, try finding a synthRealm
        // * if that fails too, cache a null location (so we don't
        //   keep probing the site for the host-meta)
        let fakeRealm = false;
        url = this._probeHostMeta(location);
        if (!url) {
          fakeRealm = true;
          url = this._synthRealms.realmUri(request, location);
        }

        this._locationCache.put(location.hostPort, url);

        // if we did find a url, return the cached realm object, or make a new one
        if (url) {
          // xxx should not be there unless there was a location cache miss
          if (this.realms[url])
            return this.realms[url];

          let domain = location.scheme + '://' + location.hostPort;
          if (fakeRealm)
            return this.realms[url] = this._synthRealms.makeRealm(url);
          else
            return this.realms[url] = new Realm(url, domain);
        }

        return null; // this site is not supported
      }
    }
  },

  _probeHostMeta: function(location) {
    this._log.trace("Probing host-meta for realm url");
    let res = new Resource(location.scheme + '://' +
                           location.hostPort + '/.well-known/host-meta');
    let hostmeta = res.get();
    if (!hostmeta || hostmeta.status == 404)
      return null;

    let parser = Cc["@mozilla.org/xmlextras/domparser;1"]
      .createInstance(Ci.nsIDOMParser);
    let doc = parser.parseFromString(hostmeta, "text/xml");

    for each (let link in doc.getElementsByTagName("Link")) {
      if (link.hasAttribute('rel') &&
          link.getAttribute('rel') == "http://services.mozilla.com/amcd/0.1")
        return location.resolve(link.getAttribute('href'));
    }
    return null;
  }
};
