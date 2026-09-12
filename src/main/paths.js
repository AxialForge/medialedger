'use strict';
// rel_path is stored with "\" separators on every platform so a database moves
// between the Windows desktop app and the Linux server unchanged. Only when a
// path touches the real file system is it joined with the OS separator.
const path = require('path');

/** Absolute OS path for a stored rel_path under a root. */
function absOf(rootPath, rel) {
  if (!rel) return rootPath;
  return path.join(rootPath, ...String(rel).split('\\'));
}

module.exports = { absOf };
