// Keep stdout pure. The `postgres` driver prints server NOTICE messages (e.g.
// the idempotent "relation already exists, skipping" from CREATE TABLE IF NOT
// EXISTS) via console.log — i.e. to stdout. For the MCP server, stdout IS the
// JSON-RPC channel, so any stray bytes there corrupt the protocol. Route all
// incidental console.log chatter to stderr; real output goes through the MCP
// transport (server) or process.stdout.write (CLI), neither of which uses
// console.log. Import this module FIRST, before anything touches the database.

const toStderr = console.error.bind(console);
console.log = (...args: unknown[]) => toStderr(...args);
console.info = (...args: unknown[]) => toStderr(...args);
console.debug = (...args: unknown[]) => toStderr(...args);

export {};
