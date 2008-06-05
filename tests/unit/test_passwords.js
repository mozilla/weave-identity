function loadInSandbox(aUri) {
  var sandbox = Components.utils.Sandbox(this);
  var request = Components.
                classes["@mozilla.org/xmlextras/xmlhttprequest;1"].
                createInstance();

  request.open("GET", aUri, false);
  request.send(null);
  Components.utils.evalInSandbox(request.responseText, sandbox);

  return sandbox;
}

function run_test() {
  // The JS module we're testing, with all members exposed.
  var passwords = loadInSandbox("resource://weave/engines/passwords.js");

  // Fake nsILoginInfo object.
  var fakeUser = {
    hostname: "www.boogle.com",
    formSubmitURL: "http://www.boogle.com/search",
    httpRealm: "",
    username: "",
    password: "",
    usernameField: "test_person",
    passwordField: "test_password"
    };

  // Fake nsILoginManager object.
  var fakeLoginManager = {
    getAllLogins: function() { return [fakeUser]; }
    };

  // Ensure that _hashLoginInfo() works.
  var fakeUserHash = passwords._hashLoginInfo(fakeUser);
  do_check_eq(typeof fakeUserHash, 'string');
  do_check_eq(fakeUserHash.length, 40);

  // Ensure that PasswordSyncCore._itemExists() works.
  var psc = new passwords.PasswordSyncCore();
  psc.__loginManager = fakeLoginManager;
  do_check_false(psc._itemExists("invalid guid"));
  do_check_true(psc._itemExists(fakeUserHash));
}