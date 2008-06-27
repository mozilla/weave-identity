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
 *  Chris Beard <cbeard@mozilla.com>
 *  Maria Emerson <memerson@mozilla.com>
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

const SYNC_NS_ERROR_LOGIN_ALREADY_EXISTS = 2153185310;

const REGISTER_URL       = "https://services.mozilla.com/0.2/api/register/new/";
const CHECK_USERNAME_URL = "https://services.mozilla.com/0.2/api/register/check/";
const CHECK_EMAIL_URL    = "https://services.mozilla.com/0.2/api/register/chkmail/";
const CAPTCHA_IMAGE_URL  = "http://api.recaptcha.net/image";

const PROGRESS_COLOR     = "black";
const ERROR_COLOR        = "red";
const SERVER_ERROR_COLOR = "black";
const SUCCESS_COLOR      = "blue";

const SERVER_TIMEOUT = 10000;

function SyncWizard() {
  this._init();
}

// TODO: Get license agreement text. Add screen for current users and force acceptance to install.

SyncWizard.prototype = {
  
  __os: null,  
  get _os() {
    if (!this.__os)
      this.__os = Cc["@mozilla.org/observer-service;1"]
                  .getService(Ci.nsIObserverService);
    return this.__os;
  },

  get _stringBundle() {
    let stringBundle = document.getElementById("weaveStringBundle");
    this.__defineGetter__("_stringBundle",
                          function() { return stringBundle; });
    return this._stringBundle;
  },

  _init : function SyncWizard__init() {
    this._log = Log4Moz.Service.getLogger("Chrome.Wizard");
    
    if (Weave.Service.isLoggedIn) {
      Weave.Service.logout();
    }
	
    this._log.info("Initializing setup wizard");

    this._os.addObserver(this, "weave:service:login:success", false);
    this._os.addObserver(this, "weave:service:login:error", false);
    this._os.addObserver(this, "weave:service:verify-login:success", false);
    this._os.addObserver(this, "weave:service:verify-login:error", false);
    this._os.addObserver(this, "weave:service:logout:success", false);
    this._os.addObserver(this, "weave:service:sync:start", false);
    this._os.addObserver(this, "weave:service:sync:success", false);
    this._os.addObserver(this, "weave:service:sync:error", false);
  },

  onWizardShutdown: function SyncWizard_onWizardshutdown() {
    this._log.info("Shutting down setup wizard");

    this._os.removeObserver(this, "weave:service:login:success");
    this._os.removeObserver(this, "weave:service:login:error");
    this._os.removeObserver(this, "weave:service:verify-login:success");
    this._os.removeObserver(this, "weave:service:verify-login:error");
    this._os.removeObserver(this, "weave:service:logout:success");
    this._os.removeObserver(this, "weave:service:sync:start");
    this._os.removeObserver(this, "weave:service:sync:success");
    this._os.removeObserver(this, "weave:service:sync:error");
  },


  onPageShow: function SyncWizard_onPageShow(pageId) {
    let wizard = document.getElementById('sync-wizard');

    switch(pageId) {
      case "sync-wizard-intro":
        wizard.canAdvance = true;
        break;

    case "sync-wizard-eula":
      let radio = document.getElementById("acceptOrDecline");
      radio.value = "false";
      wizard.canAdvance = false;
      break;
      
    case "sync-wizard-welcome":
      this._log.info("Wizard: Showing welcome page");
      wizard.canAdvance = false;
      break;
    
      case "sync-wizard-verify":
        this._log.info("Wizard: Showing account verification page");
	
        if (document.getElementById("verify-check").value == "true")
          wizard.canAdvance = true;
        else
          wizard.canAdvance = false;
        break;

      case "sync-wizard-create1": 
        this._log.info("Wizard: Showing username/password creation page");

        if (document.getElementById("create1-check").value == "true")
          wizard.canAdvance = true;
        else
          wizard.canAdvance = false;
        break;

      case "sync-wizard-create2":
        this._log.info("Wizard: Showing passphrase/email page");

        if (document.getElementById("create2-check").value == "true")
	      wizard.canAdvance = true;
	    else 
	      wizard.canAdvance = false;
	    break;

    case "sync-wizard-create3": 
	this._log.info("Wizard: Showing captcha/license agreement page");
	
	if (document.getElementById("create3-check").value == "true") {
	  document.getElementById("captchaInput").value = "";
	  wizard.canAdvance = true;
	} 
	else {
	  document.getElementById('captcha').addEventListener("pageshow", function() {gSyncWizard.onLoadCaptcha()}, false, true);
	  document.getElementById('captcha').setAttribute("src", REGISTER_URL);
	  wizard.canAdvance = false;
	}
	break;
	
    case "sync-wizard-data": {      
	  this._log.info("Wizard: Showing data page");
	
	  // TODO: use a formatted string here from properties
	  // set default device name
	  let deviceName = document.getElementById('sync-instanceName-field');
	  let path = document.getElementById('path').value;
	  let username;  
	  if (path == "verify") 
	    username = document.getElementById('sync-username-field').value; 
	  else if (path == "create")
	    username = document.getElementById('sync-username-create-field').value;
	  /*
	  if (username)
	    deviceName.value = this._stringBundle.getFormattedString("default-name.label", [username]);
	  else
	    deviceName.value = this._stringBundle.getString("default-name-nouser.label");
	  */
	  let branch = Cc["@mozilla.org/preferences-service;1"].
	               getService(Ci.nsIPrefService).getBranch(Weave.PREFS_BRANCH + "engine.");
	
      // TODO: Move this into a separate module for use in prefs and wizard
      document.getElementById('sync-wizard-bookmarks').checked = branch.getBoolPref("bookmarks");
      document.getElementById('sync-wizard-history').checked = branch.getBoolPref("history");
      document.getElementById('sync-wizard-cookies').checked = branch.getBoolPref("cookies");
      document.getElementById('sync-wizard-passwords').checked = branch.getBoolPref("passwords");
      document.getElementById('sync-wizard-tabs').checked = branch.getBoolPref("tabs");
      document.getElementById('sync-wizard-forms').checked = branch.getBoolPref("forms");
	
	  wizard.canAdvance = true;
	  break;
	}
    case "sync-wizard-final": {
      this._log.info("Wizard: Showing final page");
            
      // display the username
      // TODO: better way to check for this, and move error string out to wizard.properties
      let accountDetails = document.getElementById('final-account-details');
	  let verifyUsername = document.getElementById('sync-username-field').value;
	  let createUsername = document.getElementById('sync-username-create-field').value;
	  if (verifyUsername)
        accountDetails.value = this._stringBundle.getFormattedString("final-account-value.label", [verifyUsername]);
	  else if (createUsername)
        accountDetails.value = this._stringBundle.getFormattedString("final-account-value.label", [createUsername]);
	  else
	    accountDetails.value = "No username provided";

      // get the preferences
      var prefArray = new Array();
      if (document.getElementById('sync-wizard-bookmarks').checked)
        prefArray.push(this._stringBundle.getString("bookmarks.label"));
      if (document.getElementById('sync-wizard-history').checked)
        prefArray.push(this._stringBundle.getString("history.label"));
      if (document.getElementById('sync-wizard-cookies').checked)
        prefArray.push(this._stringBundle.getString("cookies.label"));
      if (document.getElementById('sync-wizard-passwords').checked)
        prefArray.push(this._stringBundle.getString("passwords.label"));
      if (document.getElementById('sync-wizard-tabs').checked)
        prefArray.push(this._stringBundle.getString("tabs.label"));
      if (document.getElementById('sync-wizard-forms').checked)
        prefArray.push(this._stringBundle.getString("formdata.label"));
      var prefString = ""; 
      for (var i=0; i<prefArray.length-1; i++) 
          prefString = prefString + prefArray[i] + ", ";
      prefString = prefString + prefArray[prefArray.length-1];

      // display the preferences      
      let prefDetails = document.getElementById('final-pref-details');
      prefDetails.value = prefString;

      // explain sync
      let syncDetails = document.getElementById('final-sync-details');
      syncDetails.value = this._stringBundle.getString("final-sync-value.label");

      wizard.canAdvance = true;	
      break;
    }
    default:
      this._log.warn("Unknown wizard page requested: " + pageId);
      break;
    }
  },

  /////EULA SCREEN/////
  onChangeEULARadio: function SyncWizard_onChangeEULARadio() {
    let wizard = document.getElementById('sync-wizard');
    let radio = document.getElementById("acceptOrDecline");
 
    wizard.canAdvance = (radio.value == "true");
  },


  /////WELCOME SCREEN/////
  
  
  /* setTitles() - Called by welcome screen to set upcoming page titles.
   */
  setTitles: function SyncWizard_setTitles(type) {
    let wizard = document.getElementById('sync-wizard');
    let dataPage  = wizard.getPageById('sync-wizard-data');
    let finalPage = wizard.getPageById('sync-wizard-final');
      
    // The hidden "path" label- for later use so we know which path the user took.
    let path = document.getElementById('path');
      
    if (type == "verify") {
      dataPage.setAttribute("label", this._stringBundle.getString("data-verify.title"));
      finalPage.setAttribute("label", this._stringBundle.getString("final-verify.title"));
      path.value = "verify";
    }
    else if (type == "create") {
      dataPage.setAttribute("label", this._stringBundle.getString("data-create.title"));
      finalPage.setAttribute("label", this._stringBundle.getString("final-create.title"));
      path.value = "create";
    }
  }, 
  
  /* advanceTo() - Called by buttons on account type screen.
   *  Advances to the specified page.
   */
  advanceTo: function SyncWizard_advanceTo(pageid) {
    let wizard = document.getElementById('sync-wizard');
    wizard.canAdvance = true;
    wizard.advance(pageid);
  },

  
  /////ACCOUNT VERIFICATION/////
  
  /* checkVerificationFields() - Called oninput from all fields, and onadvance from verification page
   *  Checks that all fields have values and that the login and passphrase were verified
   */
  checkVerificationFields: function SyncWizard_checkVerify() {
	let wizard = document.getElementById('sync-wizard');

	let statusLabel = document.getElementById('verify-account-error');
    let username    = document.getElementById('sync-username-field').value;
    let password    = document.getElementById('sync-password-field').value;
    let passphrase  = document.getElementById('sync-passphrase-field').value;

    let loginVerified = this._stringBundle.getString("verify-success.label");
   
    wizard.canAdvance = false;
    
    if (!(username && password && passphrase)) {
      wizard.canAdvance = false;
      return false;
    }
    
    // Make sure the login has been verified
    // user could quickly enter an incorrect password and advance if malicious:)
    // to prevent this, add a call to Weave.Service.login(), but this is redundant for now
    // TODO: && document.getElementById('passphrase-verified').value == "true"
    if (document.getElementById('login-verified').value == "true") {
	  wizard.canAdvance = true;
      document.getElementById('verify-check').value = "true";
	  return true; 
    }

    wizard.canAdvance = false;
    document.getElementById('verify-check').value = "false";
    return false;
  },
  
  /* verifyLogin() - Called when username or password field is changed.
   *  Asychronously tests the login on the server.
   */
  verifyLogin: function SyncWizard_verifyLogin() {
    this._log.info("Verifying username/password...");
    
    let wizard = document.getElementById("sync-wizard");
    let statusLabel = document.getElementById("verify-account-error");
    let statusLink  = document.getElementById("verify-account-error-link");
    let statusIcon  = document.getElementById("verify-account-icon");

    let username = document.getElementById("sync-username-field").value;
    let password = document.getElementById("sync-password-field").value;

    let progress = this._stringBundle.getString("verify-progress.label");

    let loginVerified = document.getElementById("login-verified");

    // Don't allow advancing until we verify the account.
	wizard.canAdvance = false;
	document.getElementById("login-verified").value = "false";

    // Check for empty username or password fields
    if (!username || !password) {
      statusIcon.hidden = true;
      statusLabel.value = "";
      return;
    }

    // Ok to verify, set the status and throbber
    statusIcon.hidden  = false;
    statusLink.hidden  = true;
    statusLabel.hidden = false;
    statusLabel.value  = progress;
    statusLabel.style.color = PROGRESS_COLOR;
      
    // The observer will handle success and failure notifications
    // checkVerificationFields() will take care of allowing advance if this works
    Weave.Service.verifyLogin(username, password);
    
    // In case the server is hanging... 
    setTimeout(function() {
            if (loginVerified.value == "false") {
		      statusIcon.hidden = true;
		      statusLabel.value = this._stringBundle.getString("serverTimeoutError.label") ;
		      statusLabel.style.color = SERVER_ERROR_COLOR;
            }
	  }, SERVER_TIMEOUT);
  },

  /* verifyPassphrase() - Called when passphrase field changes.
   * Eventually this should actually verify that the passphrase works. :-)
   */
  verifyPassphrase : function SyncWizard_verifyPassphrase() {
    this._log.trace("verifyPassphrase called");

    // Don't allow advancing until we verify the passphrase.
    let wizard = document.getElementById('sync-wizard');
	wizard.canAdvance = false;
	document.getElementById('passphrase-verified').value = "false";

    // If the login hasn't been verified yet, we can't login to fetch the private key.
	if (document.getElementById('login-verified').value == "false") {
       this._log.info("deferring passphrase verification until login checked");
       return;
    }

    let username   = document.getElementById('sync-username-field').value;
    let password   = document.getElementById('sync-password-field').value;
    let passphrase = document.getElementById('sync-passphrase-field').value;

    // XXX at this point we should kick off an async fetch of the wrapped
    // private key from the server, and try unwrapping it with the passphrase.
    // If that's good, allow advancing. If not, the passphrase is bad.
    //
    // For now, just assume the passphrase is good if non-empty.

    if (passphrase) {
      wizard.canAdvance = true;
	  document.getElementById('passphrase-verified').value = "true";
    }
  },
  
  /* acceptExistingAccount() - Sets Weave properties so they are stored in login manager
   *  Do not call until final wizard screen in case the user cancels setup.
   */
  acceptExistingAccount: function SyncWizard_acceptExistingAccount() {
    let path = document.getElementById('path').value;
    let username, password, passphrase;
    
    if (path == "verify") {
      username = document.getElementById('sync-username-field').value;
      password = document.getElementById('sync-password-field').value;
      passphrase = document.getElementById('sync-passphrase-field').value;
    }
    else if (path == "create") {
      username = document.getElementById('sync-username-create-field').value;
      password = document.getElementById('sync-password-create-field').value;
      passphrase = document.getElementById('sync-passphrase-create-field').value;
    }

    // Setting these properties (really getters) results in this data being
    // saved in the Firefox login manager.
    Weave.Service.username = username;
    Weave.Service.password = password;
    Weave.Service.passphrase = passphrase;

    return true;
  },
  
  /////ACCOUNT CREATION - USERNAME, PASSWORD, PASSPHRASE/////
  
  /* checkUsername() - Called oncommand from username field for account creation. 
   *   Checks username availability. 
   */
  checkUsername: function SyncWizard_checkUsername() {

    let wizard = document.getElementById('sync-wizard');
    let username    = document.getElementById('sync-username-create-field').value;
    let statusLabel = document.getElementById('create-username-error');
    let statusLink  = document.getElementById('create-username-error-link');
    let statusIcon  = document.getElementById('create-username-icon');
      
    let log = this._log;
    let httpRequest = new XMLHttpRequest();
    let url = CHECK_USERNAME_URL + username;
      
    // Status messages
    let usernameTaken      = this._stringBundle.getFormattedString("createUsername-error.label", [username]);
    let usernameAvailable  = this._stringBundle.getFormattedString("createUsername-success.label", [username]);
	let checkingUsername   = this._stringBundle.getString("createUsername-progress.label");
    let serverError        = this._stringBundle.getString("serverError.label");
    let serverTimeoutError = this._stringBundle.getString("serverTimeoutError.label");

    // Don't check if they haven't entered something
    if (!username) {
      statusIcon.hidden = true;
      statusLink.hidden = true;
      statusLabel.value = "";
	  wizard.canAdvance = false;
	  return false;
    }
      
    // Show progress
    statusIcon.hidden = false;
    statusLink.hidden = true;
    statusLabel.hidden = false;
    statusLabel.value = checkingUsername;
    statusLabel.style.color = PROGRESS_COLOR;
      
    // Check availability	
    httpRequest.open('GET', url, true);
    httpRequest.onreadystatechange = function() {
      if (httpRequest.readyState == 4) {
        if (httpRequest.status == 200) {
          statusIcon.hidden = true;
          statusLink.hidden = true;
	      
          if (httpRequest.responseText == 0) {
            statusLabel.value = usernameTaken;
            statusLabel.style.color = ERROR_COLOR;
            wizard.canAdvance = false;
            document.getElementById('create1-check').value = "false";
            document.getElementById("username-verified").value = "false";
          } 
          else {
            statusLabel.value = usernameAvailable;
            statusLabel.style.color = SUCCESS_COLOR;
            document.getElementById("username-verified").value = "true";
          }
        } 
        else {
          log.info("Error: received status " + httpRequest.status);
          statusIcon.hidden = true;
          statusLink.hidden = false;
          // TODO: add more descriptive server errors in this case, we know what the status was
          statusLabel.value = serverError;
          statusLabel.style.color = SERVER_ERROR_COLOR;
          wizard.canAdvance = false;
          document.getElementById("username-verified").value = "false";
          document.getElementById('create1-check').value = "false";
        }
      } };
    httpRequest.send(null);	
      
    // In case the server is hanging...
    setTimeout(function() {
            if (statusLabel.value == checkingUsername) {
              statusIcon.hidden = true;
              statusLink.hidden = false;
              statusLabel.value = serverTimeoutError;
              statusLabel.style.color = SERVER_ERROR;
            }
      }, SERVER_TIMEOUT);
  },
  
  /* checkEmail() - Called oncommand from email field in account creation. 
   *  Checks validity and availability of email address. 
   */
  checkEmail: function SyncWizard_checkEmail() {
    
    let wizard = document.getElementById('sync-wizard');
    let email       = document.getElementById('sync-email-create-field').value;
    let statusLabel = document.getElementById('email-error');
    let statusLink  = document.getElementById('email-error-link');
    let statusIcon  = document.getElementById('email-icon');
    
    let log = this._log;
    let httpRequest = new XMLHttpRequest();
    let url = CHECK_EMAIL_URL + email;
    let regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
      
    // Status messages
    let checkingEmail      = this._stringBundle.getString("email-progress.label");
    let emailTaken         = this._stringBundle.getFormattedString("email-unavailable.label", [email]);
    let emailOk            = this._stringBundle.getFormattedString("email-success.label", [email]);
    let emailInvalid       = this._stringBundle.getString("email-invalid.label");
    let serverError        = this._stringBundle.getString("serverError.label");
    let serverTimeoutError = this._stringBundle.getString("serverTimeoutError.label");
      
    // Don't check if they haven't entered anything
    if (!email) {
      statusIcon.hidden = true;
      statusLink.hidden = true;
      statusLabel.value = "";
      document.getElementById("email-verified").value = "false";
	  wizard.canAdvance = false;
      return false;
    }
      
    if (!regex.test(email)) {
      statusIcon.hidden = true;
      statusLink.hidden = true;
      statusLabel.value = emailInvalid; 
      statusLabel.style.color = ERROR_COLOR;
      document.getElementById("email-verified").value = "false";
      wizard.canAdvance = false;
      return false;
    }
      
    // Show progress...
    statusIcon.hidden = false;
    statusLink.hidden = true;
    statusLabel.value = checkingEmail;
    statusLabel.style.color = PROGRESS_COLOR;
      
    httpRequest.open('GET', url, true);
    httpRequest.onreadystatechange = function() {			
      if (httpRequest.readyState == 4) {
        if (httpRequest.status == 200) {
          statusIcon.hidden = true;
          statusLink.hidden = true;
          if (httpRequest.responseText == 0) {
            statusLabel.value = emailTaken;
            statusLabel.style.color = ERROR_COLOR;
            wizard.canAdvance = false;
            document.getElementById("email-verified").value = "false";
          }
          else {
            statusLabel.value = emailOk;
            statusLabel.style.color = SUCCESS_COLOR;
            document.getElementById("email-verified").value = "true";
		  }
		} 
		else {
		  log.info("Error: received status " + httpRequest.status);
		  statusIcon.hidden = true;
		  statusLink.hidden = false;
		  statusLabel.value = serverError;
		  statusLabel.style.color = SERVER_ERROR_COLOR;
		}
      }};
    httpRequest.send(null);		
      
    // If the server is hanging...
    setTimeout(function() {
            if (document.getElementById("email-verified").value == "false") {
              statusIcon.hidden = true;
              statusLink.hidden = false;
              statusLabel.value = serverTimeoutError;
              statusLabel.style.color = SERVER_ERROR_COLOR;
              }
	  }, SERVER_TIMEOUT);
      
  },

  
  /* checkAccountInput() - Called oncommand from password and passphrase entry/reentry fields.
   *  Checks that password and passphrase reentry fields are the same, and that password
   *  and passphrase are different values. 
   */
  checkAccountInput: function SyncWizard_checkAccountInput(field) {
    let wizard = document.getElementById('sync-wizard');
    let username    = document.getElementById("sync-username-create-field").value;
    let password1   = document.getElementById("sync-password-create-field").value;
    let password2   = document.getElementById("sync-reenter-password-field").value;
    let passphrase1 = document.getElementById("sync-passphrase-create-field").value;
    let passphrase2 = document.getElementById("sync-reenter-passphrase-field").value;
      
    if (field == "password") {
      let passwordMatchError = document.getElementById("password-match-error");
	  
      // if the second password hasn't been entered yet, don't check
      if (!password2) {
        document.getElementById("password-verified").value = "false";
        return false;
      }

      // check that the two passwords are the same
      if (password1 != password2)  {
        passwordMatchError.value = this._stringBundle.getString("passwordsUnmatched.label");
        passwordMatchError.style.color = ERROR_COLOR;
        wizard.canAdvance = false;
        document.getElementById("password-verified").value = "false";
        return false;
      }

      document.getElementById("password-verified").value = "true";
      passwordMatchError.value = "";  
    }
    else if (field == "passphrase") {
      let passphraseError = document.getElementById("passphrase-match-error");
	  
	  // If the second passphrase hasn't been entered yet, don't check
	  if (!passphrase2) {
        document.getElementById("passphrase-verified").value = "false";
        return false;
      }
      
      // check that the two passphrases are the same
      if (passphrase1 != passphrase2)  {
        passphraseError.value = this._stringBundle.getString("passphrasesUnmatched.label");
        passphraseError.style.color = ERROR_COLOR;
        wizard.canAdvance = false;
        document.getElementById("passphrase-verified").value = "false";
        return false;
	  }
	  
	  // check that they haven't entered the same password and passphrase
	  // TODO: check for this in the password case as well for the devious user case
	  if (passphrase1 == password1) {
	    passphraseError.value = this._stringBundle.getString("samePasswordAndPassphrase.label");
	    passphraseError.style.color = ERROR_COLOR;
	    wizard.canAdvance = false;
	    document.getElementById("passphrase-verified").value = "false";
	    return false;
	  }

      document.getElementById("passphrase-verified").value = "true";
      passphraseError.value = "";
    }
    wizard.canAdvance = true;
    return true;
  },
  
  
  /* checkCreationFields() - Called oninput from password entry fields.
   *  Allows the wizard to continue if password fields have values and if an 
   *  available username has been chosen.
   */
  checkCreationFields: function SyncWizard_checkUserPasswordFields() {
    let wizard = document.getElementById("sync-wizard");
      
    let username  = document.getElementById("sync-username-create-field").value;
    let password1 = document.getElementById("sync-password-create-field").value;
    let password2 = document.getElementById("sync-reenter-password-field").value;
    let email     = document.getElementById("sync-email-create-field").value;
      
    // check for empty fields
    if (!(username && password1 && password2 && email)) {
      wizard.canAdvance = false;
      return false;
    }
      
    // check that everything has been verified
    if (document.getElementById("username-verified").value == "true" &&
        document.getElementById("email-verified").value == "true" &&
        document.getElementById("password-verified").value == "true") {
      wizard.canAdvance = true;
      document.getElementById("create1-check").value = "true";
      return true;
    }
      
    wizard.canAdvance = false;
    document.getElementById("create1-check").value = "false";
    return false;
  },
  
  /* checkPassphraseFields() - Called oninput from fields on passphrase / email entry screen.
   *  Allows wizard to advance if all fields have a value.
   */
  checkPassphraseFields: function SyncWizard_checkPassphraseFields() {
    let wizard = document.getElementById('sync-wizard');
    
    let passphrase1 = document.getElementById('sync-passphrase-create-field').value;
    let passphrase2 = document.getElementById('sync-reenter-passphrase-field').value;
      
    // check for empty fields
    if (!(passphrase1 && passphrase2)) {
      wizard.canAdvance = false;
      return false;
    }
    
    // check that everything has been verified
    if (document.getElementById("passphrase-verified").value == "true") {
      wizard.canAdvance = true;
      document.getElementById("create2-check").value = "true";
      return true;
    }
    
    wizard.canAdvance = false;
    document.getElementById('create2-check').value = "false";
    return false;
  },


    
  onLoadCaptcha: function SyncWizard_onLoadCaptcha() {
    let captchaImage = document.getElementById('captcha').contentDocument.getElementById('recaptcha_challenge_field').value;
    document.getElementById('lastCaptchaChallenge').value = captchaImage;
    document.getElementById('captchaImage').setAttribute("src", CAPTCHA_IMAGE_URL + "?c=" + captchaImage);   
  },
  
  
  /* createAccount() - Called onadvance for final account creation screen. 
   *  Posts http request to server, and checks for correct captcha response. 
   */
  
  createAccount: function SyncWizard_createAccount() {
      let httpRequest = new XMLHttpRequest();
      
      let wizard = document.getElementById('sync-wizard');
      let captchaError = document.getElementById('captcha-error');
	  let status = document.getElementById('account-creation-status');
	  let statusLink = document.getElementById('account-creation-status-link');
	  let icon = document.getElementById('account-creation-status-icon');
      
      let incorrectCaptcha = this._stringBundle.getString("incorrectCaptcha.label");

      let username = document.getElementById('sync-username-create-field');
      
      let created         = this._stringBundle.getFormattedString("create-success.label", [username.value]);
      let serverError     = this._stringBundle.getString("serverError.label");
      let progress        = this._stringBundle.getString("create-progress.label");
      let uidTaken        = this._stringBundle.getString("create-uid-inuse.label");
      let uidMissing      = this._stringBundle.getString("create-uid-missing.label");
      let uidInvalid      = this._stringBundle.getString("create-uid-invalid.label");
      let emailInvalid    = this._stringBundle.getString("create-mail-invalid.label");
      let emailTaken      = this._stringBundle.getString("create-mail-inuse.label");
      let captchaMissing  = this._stringBundle.getString("create-captcha-missing.label");
      let passwordMissing = this._stringBundle.getString("create-password-missing.label");
      
      let log = this._log;
      
      if (document.getElementById("create3-check").value == "true")
	    return true;
	    
	  // tell the user the server is working...
	  icon.hidden = false;
	  status.hidden = false;
	  status.value = progress;
	  status.style.color = PROGRESS_COLOR;
	  statusLink.hidden = true;

      // hide the captcha error message if that was the problem
      captchaError.value = "";
      
      httpRequest.open('POST', REGISTER_URL, true);
      
      httpRequest.onreadystatechange = function() { 
	  if (httpRequest.readyState == 4) {
	    switch (httpRequest.status) {
		  
		  // CREATED
	      case 201:
	        captchaError.value = "";
	        if (httpRequest.responseText == "2: VERIFICATION SENT") 
	          log.info("Account created, verification email sent.");
	        else if (httpRequest.responseText == "3: CREATED") 
	          log.info("Account created, no email address given.");
	        
	        icon.hidden = true;
	        status.value = created;
	        status.style.color = SUCCESS_COLOR;
	        statusLink.hidden = true;
	        
	        document.getElementById("create3-check").value = "true";
	        wizard.canAdvance = true;
	        wizard.advance('sync-wizard-data');
            break;
            
          // BAD REQUEST (the user should rarely get to this state -> ok to report one at a time)
          case 400:
            status.style.color = ERROR_COLOR;
	        icon.hidden = true;
	        statusLink.hidden = true;
            let response = httpRequest.responseText;
	        log.info("Status 400: Account not created, response " + response);

            if (response.match("0") && !response.match("-10"))
              status.value = uidTaken;
            else if (response.match("-2"))
              status.value = uidMissing;
            else if (response.match("-3"))
              status.value = uidInvalid;
            else if (response.match("-4"))
              status.value = emailInvalid;
            else if (response.match("-5"))
              status.value = emailTaken;
            else if (response.match("-7")) {
              captchaError.value = captchaMissing;
	          captchaError.style.color = ERROR_COLOR;
	          status.hidden = true;
	        }
            else if (response.match("-8"))
              status.value = passwordMissing;
	        else 
	          status.value = serverError;
            break;
            
	      // CAPTCHA FAILED
	      case 417:
	        log.info("Incorrect Captcha response. Account not created.");
	        captchaError.value = incorrectCaptcha;
	        captchaError.style.color = ERROR_COLOR;
	        document.getElementById('captcha').reload();
	        document.getElementById('captchaInput').value = "";
	        icon.hidden = true;
	        status.hidden = true;
	        statusLink.hidden = true;
	        //status.value = incorrectCaptcha;
	        //status.style.color = ERROR_COLOR;
	        break;

	      default:
	        log.info("Error: received status " + httpRequest.status + ". Account not created.");
	        icon.hidden = true;
	        status.value = serverError;
	        status.style.color = SERVER_ERROR_COLOR;
	        statusLink.hidden = false;
	        break;
	      }
	  }
      };
      
      let uid = document.getElementById("sync-username-create-field").value;
      let password = document.getElementById("sync-password-create-field").value;
      let passphrase = document.getElementById("sync-passphrase-create-field").value;
      let mail = document.getElementById("sync-email-create-field").value;
      
      let captchaDoc = document.getElementById("captcha").contentDocument;
      let challenge = document.getElementById("lastCaptchaChallenge").value;
      let response = document.getElementById("captchaInput").value;
      
      let message = "uid=" + encodeURIComponent(uid) + 
      "&password=" + encodeURIComponent(password) + 
      "&mail=" + encodeURIComponent(mail) + 
      "&recaptcha_response_field=" + encodeURIComponent(response) + 
      "&recaptcha_challenge_field=" + encodeURIComponent(challenge);
      
      httpRequest.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
      httpRequest.setRequestHeader("Content-Length", message.length);
      httpRequest.send(message);		
      
      return false;
  },
  
  
  
  /* reloadCaptcha() - Called onclick from "try another image" link.
   *  Refreshes captcha image. 
   */
  reloadCaptcha: function SyncWizard_reloadCaptcha() {
      document.getElementById("captcha").reload();
  },  
  
  
  /////INSTALLATION, FINAL SYNC/////
  
  /* checkFinalFields() - Called oninput from fields on final account creation screen.
   *  Allows wizard to advance if all fields have a value.
   */
  checkFinalFields: function SyncWizard_checkFinalFields() {
      let wizard = document.getElementById('sync-wizard');
      
      let input = document.getElementById('captchaInput');
      let agree = document.getElementById('terms-checkbox');
      
      if ((!(input && input.value)) || !agree.checked) {
	  wizard.canAdvance = false;
	  return false;
      }
      
      wizard.canAdvance = true;
      return true;
      
  },
   
   
  /* completeInstallation() - Called on advance from final wizard screen. 
   *  Sets prefs, does final login, does an initial sync.
   */
  completeInstallation: function SyncWizard_completeInstallation() {
    let prefStatus    = document.getElementById('final-pref-status');
    let accountStatus = document.getElementById('final-account-status');
    let syncStatus    = document.getElementById('final-sync-status');
    let finalStatus   = document.getElementById('final-status');
    let finalLink     = document.getElementById('final-status-link');
    let finalIcon     = document.getElementById('final-status-icon');
    let prefsProgress = this._stringBundle.getString("initialPrefs-progress.label");
    let loginProgress = this._stringBundle.getString("initialLogin-progress.label");
    let syncProgress  = this._stringBundle.getString("initialSync-progress.label");
    let loginError    = this._stringBundle.getString("initialLogin-error.label");
    let syncError     = this._stringBundle.getString("initialSync-error.label");

    
    finalStatus.style.color = PROGRESS_COLOR;
    finalIcon.hidden = false;
    finalLink.hidden = true;

    // for server error case, only start at sync if login worked
    if (Weave.Service.isLoggedIn) {
      gSyncWizard.initialSync();
      return;  
    }
      
    // set prefs
    finalStatus.value = prefsProgress;
    gSyncWizard.setPrefs();    
    prefStatus.style.color = SUCCESS_COLOR;
   
    // login and perform initial sync
    finalStatus.value = loginProgress;
    finalIcon.hidden = false;
	
	// adds username and password to manager
	gSyncWizard.acceptExistingAccount();
	
	// login using those values
    Weave.Service.login(function() {
          if(Weave.Service.isLoggedIn) {
            accountStatus.style.color = SUCCESS_COLOR;
            gSyncWizard.initialSync();
          } 
          else {
            accountStatus.style.color = ERROR_COLOR;
            finalStatus.value = loginError;
            finalStatus.style.color = SERVER_ERROR_COLOR;
            finalIcon.hidden = true;
            finalLink.hidden = false;
          }
      });

    return false;
  },
  
  /* initialSync() - Called from completeInstallation(). 
   *  Sets page values and does a sync.
   */
  initialSync: function SyncWizard_initialSync() {
    let finalStatus   = document.getElementById('final-status');
    let finalLink     = document.getElementById('final-status-link');
    let finalIcon     = document.getElementById('final-status-icon');
    let syncProgress  = this._stringBundle.getString("initialSync-progress.label");

    finalStatus.value = syncProgress;
    finalIcon.hidden = false;
    finalLink.hidden = true;
    
    Weave.Service.sync();
    
  },
  
  /* setPrefs() - Called during final screen checklist.
   *  Prefs are set on the previous screen, but committed here in case the user "Cancels".
   */
  setPrefs: function SyncWizard_setPrefs() {
      
      let branch = Cc["@mozilla.org/preferences-service;1"].
      getService(Ci.nsIPrefService).
      getBranch(Weave.PREFS_BRANCH + "engine.");
      
      let value;
      
      // TODO: Move this into a separate module for use in prefs and wizard
      value = document.getElementById('sync-wizard-bookmarks').checked;
      branch.setBoolPref("bookmarks", value);
      value = document.getElementById('sync-wizard-history').checked;
      branch.setBoolPref("history", value);
      value = document.getElementById('sync-wizard-cookies').checked;
      branch.setBoolPref("cookies", value);
      value = document.getElementById('sync-wizard-passwords').checked;
      branch.setBoolPref("passwords", value);
      value = document.getElementById('sync-wizard-tabs').checked;
      branch.setBoolPref("tabs", value);
      value = document.getElementById('sync-wizard-forms').checked;
      branch.setBoolPref("forms", value);
      
      this._log.info("Preferences set.");
            
      return true;
  },
  
  
  observe: function(subject, topic, data) {
    if (!document) {
      this._log.warn("XXX FIXME: wizard observer called after wizard went away");
      return;
    }
    let wizard = document.getElementById('sync-wizard');

    switch(topic) {

    case "weave:service:verify-login:success": {
      this._log.info("Login verify succeeded");
      
      document.getElementById('login-verified').value = "true";
        
      let statusIcon  = document.getElementById('verify-account-icon');
      let statusLink  = document.getElementById('verify-account-error-link');
      let statusLabel = document.getElementById('verify-account-error');        
      
      statusIcon.hidden = true;
      statusLink.hidden = true;
      statusLabel.value = this._stringBundle.getString("verify-success.label");
      statusLabel.style.color = SUCCESS_COLOR;
        
      // If the passphrase hasn't been verified, try doing so now.
      // Its check may have been deferred until we had a valid login.
      if (document.getElementById('passphrase-verified').value == "false") {
        this._log.info("Checking passphrase after login verify");
        this.verifyPassphrase();
      }
      
      // Don't allow the wizard to advance here in case other fields weren't filled in
      break;
    }
    
    case "weave:service:login:success":
      this._log.info("Initial login succeeded");
      break;

    case "weave:service:login:error":
      this._log.info("Initial login failed");
      break;
        
    case "weave:service:verify-login:error": {
      this._log.info("Login verify failed");
      
      document.getElementById('login-verified').value = "false";

      let statusIcon  = document.getElementById('verify-account-icon');
      let statusLink  = document.getElementById('verify-account-error-link');
      let statusLabel = document.getElementById('verify-account-error');        
     
      statusIcon.hidden = true;
      statusLink.hidden = true;
      statusLabel.value = this._stringBundle.getString("verify-error.label");
      statusLabel.style.color = ERROR_COLOR;

      wizard.canAdvance = false;
      break;
    }
    
    case "weave:service:logout:success":
      this._log.info("Logged out");
      break;

    case "weave:service:sync:success": {
      let syncStatus    = document.getElementById('final-sync-status');
      let finalStatus   = document.getElementById('final-status');
      let finalLink     = document.getElementById('final-status-link');
      let finalIcon     = document.getElementById('final-status-icon');
      let syncProgress  = this._stringBundle.getString("initialSync-progress.label");
      let complete      = this._stringBundle.getString("installation-complete.label");

      this._log.info("Initial Sync performed");
      syncStatus.style.color = SUCCESS_COLOR;
      finalStatus.value = complete;
      finalIcon.hidden = true;
      finalLink.hidden = true;
      
      wizard.advance('sync-wizard-thankyou');
      break;
    }
    
    case "weave:service:sync:error": {
      let syncStatus    = document.getElementById('final-sync-status');
      let finalStatus   = document.getElementById('final-status');
      let finalLink     = document.getElementById('final-status-link');
      let finalIcon     = document.getElementById('final-status-icon');
      let syncError     = this._stringBundle.getString("initialSync-error.label");

      this._log.info("Initial Sync failed");
      syncStatus.style.color = ERROR_COLOR;
      finalStatus.value = syncError;
      finalStatus.style.color = SERVER_ERROR_COLOR;
      finalLink.hidden = false;
      finalIcon.hidden = true;
     
      break;
    }
    
    default:
      this._log.warn("Unknown observer notification topic: " + topic);
      break;
    }
  }
};

let gSyncWizard = new SyncWizard();
