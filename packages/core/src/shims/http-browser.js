// Browser-facing shim for Node's `http` module.
//
// xchain-sdk's explorer.js + encoder.js each instantiate
// `new (require('http').Agent)({ keepAlive: true, ... })` to reuse
// TCP connections when talking to their respective services from a
// Node server context. In the browser, connection pooling is handled
// by the user agent — passing an `httpAgent` to axios is a no-op.
//
// This shim surfaces a zero-cost `Agent` class so the SDK's inline
// `new http.Agent()` call resolves without pulling in the full
// `stream-http` browser polyfill (~30 KB). Any other `http` API the
// SDK adds later will throw here, flagging the change at bundle time
// rather than after a user clicks a broken button.

class Agent {
    constructor(_options) {
        // No-op — the browser manages its own connection pool.
    }
    destroy() { /* no-op */ }
}

export default { Agent };
export { Agent };
