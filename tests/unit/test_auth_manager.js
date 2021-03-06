Cu.import("resource://weave/log4moz.js");
Cu.import("resource://weave/util.js");
Cu.import("resource://weave/auth.js");
Cu.import("resource://weave/identity.js");
Cu.import("resource://weave/resource.js");

let logger;
let Httpd = {};
Cu.import("resource://harness/modules/httpd.js", Httpd);

function server_handler(metadata, response) {
  let body;

  // no btoa() in xpcshell.  it's guest:guest
  if (metadata.hasHeader("Authorization") &&
      metadata.getHeader("Authorization") == "Basic Z3Vlc3Q6Z3Vlc3Q=") {
    body = "This path exists and is protected";
    response.setStatusLine(metadata.httpVersion, 200, "OK, authorized");
    response.setHeader("WWW-Authenticate", 'Basic realm="secret"', false);

  } else {
    body = "This path exists and is protected - failed";
    response.setStatusLine(metadata.httpVersion, 401, "Unauthorized");
    response.setHeader("WWW-Authenticate", 'Basic realm="secret"', false);
  }

  response.bodyOutputStream.write(body, body.length);
}

function run_test() {
  logger = Log4Moz.repository.getLogger('Test');
  Log4Moz.repository.rootLogger.addAppender(new Log4Moz.DumpAppender());

  let server = new Httpd.nsHttpServer();
  server.registerPathHandler("/foo", server_handler);
  server.start(8080);

  let auth = new BasicAuthenticator(new Identity("secret", "guest", "guest"));
  Auth.defaultAuthenticator = auth;

  let res = new Resource("http://localhost:8080/foo");
  let content = res.get();
  do_check_eq(content, "This path exists and is protected");
  do_check_eq(content.status, 200);

  server.stop();
}
