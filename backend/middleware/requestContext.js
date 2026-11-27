const { AsyncLocalStorage } = require('async_hooks');

const authContext = new AsyncLocalStorage();

function runWithAuth(auth, callback) {
  return authContext.run(auth, callback);
}

function getAuthContext() {
  return authContext.getStore() || null;
}

module.exports = { runWithAuth, getAuthContext };
