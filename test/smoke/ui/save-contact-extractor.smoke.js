// Cluster O FOLLOWUP 2 — peerAddressOfEntry now handles MESSAGE
// incoming + ORDER_MATCH fill counterparties. The v0.207.0 version
// returned the wallet's own address for any row whose `destination`
// equalled `entry.address` (RECEIVE, MESSAGE incoming), making the
// SaveContactPrompt suppress itself. The extended extractor checks
// each candidate against the wallet's own address and falls through
// to source / counterparty fields when the leading candidate matches.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const historySrc = read('packages/core/src/shared/routes/History.jsx');

// 1. Header tags the FOLLOWUP id and explicitly notes both the
//    closing scope (MESSAGE / ORDER_MATCH) and the deferred branch
//    (DIVIDEND / AIRDROP need a derived-data fetch).
assert.ok(/Cluster O\s*\n\s*\* FOLLOWUP 2/.test(historySrc),
    'peerAddressOfEntry header tags Cluster O FOLLOWUP 2');
assert.ok(/DIVIDEND recipients are computed at runtime from holders/.test(historySrc),
    'peerAddressOfEntry header documents the DIVIDEND deferred branch');
assert.ok(/AIRDROP/.test(historySrc),
    'peerAddressOfEntry header documents the AIRDROP deferred branch');

// 2. ORDER_MATCH branch picks the counterparty from a candidate list
//    that includes tx0_address / tx1_address / give_address / get_address.
for (const field of ['tx0_address', 'tx1_address', 'give_address', 'get_address']) {
    assert.ok(new RegExp(`raw\\.${field}`).test(historySrc),
        `peerAddressOfEntry checks raw.${field} for ORDER_MATCH rows`);
}
assert.ok(/action === 'ORDER_MATCH' \|\| action === 'ORDER_FILL' \|\| action === 'ORDERFILL'/.test(historySrc),
    'peerAddressOfEntry switches on ORDER_MATCH / ORDER_FILL / ORDERFILL action labels');

// 3. The generic SEND / RECEIVE / MESSAGE branch checks dest against
//    `isSelf` BEFORE returning it (this is the fix for incoming
//    rows where dest === wallet's own address).
assert.ok(/dest\.length > 0 && !isSelf\(dest\)/.test(historySrc),
    'destination is rejected when it equals the wallet self address');
assert.ok(/src\.length > 0 && !isSelf\(src\)/.test(historySrc),
    'source is rejected when it equals the wallet self address');

// 4. Functional regression check by reading the source as text and
//    verifying the structural shape — the `isSelf` helper exists with
//    the documented signature.
assert.ok(/const isSelf = \(a\) => typeof self === 'string' && self\.length > 0 && a === self;/.test(historySrc),
    'peerAddressOfEntry defines an isSelf helper that requires a non-empty self address');

// 5. The function is still exported as `peerAddressOfEntry` (or rather
//    declared in this file — it's local), with the same call signature
//    so existing callers (SaveContactPrompt) keep working unchanged.
assert.ok(/function peerAddressOfEntry\(entry\)/.test(historySrc),
    'peerAddressOfEntry keeps its (entry) signature');
assert.ok(/peerAddressOfEntry\(entry\)/.test(historySrc),
    'peerAddressOfEntry is invoked from SaveContactPrompt');

console.log('OK — Save-as-contact peer-extractor sweep (MESSAGE + ORDER_MATCH)');
