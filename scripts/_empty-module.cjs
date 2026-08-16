// Stub for `server-only`, which Next provides at build time and which jiti cannot
// resolve when a verify script loads a server module directly. Importing it is a
// compile-time assertion, so an empty module is a faithful stand-in.
module.exports = {};
