// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : the queued-broadcast copy must match the shipped
// behaviour.
//
// The wallet used to tell a user whose broadcast failed that the signed
// transaction "will be re-broadcast automatically". Nothing in the wallet
// re-broadcasts anything. The one and only caller of the broadcast route is
// the user pressing "Broadcast now" in QueuedBroadcastBanner; what the wallet
// does by itself is show a toast when reachability flips back to normal. A
// user who believed the old sentence, and was told in the same breath not to
// send the payment again, waited for a retry that could never run.
//
// The manual queue is also what the spec asks for: §49.5 explicitly rules out
// automatic re-broadcast (see packages/core/src/flows/queuedBroadcast.js), so
// the copy was the thing that was wrong, not the behaviour.
//
// So this smoke pins BOTH halves and fails if they drift apart:
//   1. no surface promises an automatic (re-)broadcast, and every queued done
//      screen says the wallet will REMIND the user;
//   2. the behaviour the copy now describes still exists - a single manual
//      caller of the broadcast route, plus the reconnection toast.
//
// If the auto-drain is ever built (the other half of ), part 2 goes red
// and whoever builds it has to come back here and make the copy true again.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const shared = join(core, 'src', 'shared');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(js|jsx)$/.test(full)) out.push(full);
    }
    return out;
}

// --- 1. Nothing promises an automatic re-broadcast -----------------------

// Deliberately matched against the RAW source, comments included: a comment
// that still describes an auto-drain is how the sentence grew back the first
// time. Reword the comment rather than loosening the pattern.
const PROMISES_AUTO = [
    /will be (?:re-)?broadcast(?:ed)? automatically/i,
    /broadcast will retry/i,
    /re-?broadcasts? (?:it )?automatically/i,
    /(?:will )?retr(?:y|ies) automatically/i,
    /automatic(?:ally)? re-?broadcast/i,
];

const scanned = [];
for (const pkg of ['core', 'web', 'extension', 'desktop']) {
    const src = join(wsRoot, 'packages', pkg, 'src');
    if (existsSync(src)) scanned.push(...walk(src));
}
assert.ok(scanned.length > 200, `found ${scanned.length} source files to scan (sweep looks empty)`);

// A line that DENIES the automatic behaviour is the point of the exercise
// (§49.5 rules it out, and several comments say so), so only an unqualified
// promise counts.
const DENIES_AUTO = /(rules out|never|nothing|no longer|instead of|used to promise|without)/i;

for (const file of scanned) {
    // Whitespace-collapsed, because JSX copy wraps mid-sentence and a
    // line-by-line scan would miss "will be\n broadcast automatically".
    const text = readFileSync(file, 'utf8').replace(/\s+/g, ' ');
    for (const pattern of PROMISES_AUTO) {
        const hit = text.match(pattern);
        if (!hit) continue;
        const at = hit.index;
        const window = text.slice(Math.max(0, at - 140), at + hit[0].length + 60);
        if (DENIES_AUTO.test(window)) continue;
        assert.fail(
            `${relative(wsRoot, file)} promises an automatic re-broadcast near "${hit[0]}" `
            + `(${pattern}). Nothing in the wallet re-broadcasts a queued transaction: the user `
            + 'does it from QueuedBroadcastBanner. Say the wallet will REMIND them , or '
            + 'build the auto-drain first and then change this smoke.',
        );
    }
}

// --- 2. The canonical sentence says what actually happens ----------------

// Imported rather than regexed out of the file: these two are what the
// surfaces actually render.
const { SIGNED_NOT_BROADCAST_TITLE, SIGNED_NOT_BROADCAST_MESSAGE } =
    await import(join(shared, 'utils', 'submitFailureMessage.js'));

assert.equal(
    SIGNED_NOT_BROADCAST_TITLE, 'Signed. Not broadcast yet.',
    'the shared queued heading states the fact instead of promising a retry',
);
for (const [label, pattern] of [
    ['names the queue the user has to go to', /queued-transactions banner/i],
    ['says the user is the one who sends it', /you broadcast it from there/i],
    ['promises the reminder the toast actually delivers', /reminds you when the network is back/i],
    ['still forbids submitting a second copy', /do not submit this again/i],
]) {
    assert.ok(pattern.test(SIGNED_NOT_BROADCAST_MESSAGE), `SIGNED_NOT_BROADCAST_MESSAGE ${label}`);
}

// --- 3. Every queued done screen says the same thing ---------------------

// Each surface owns its own noun ("your bet", "your order"), so the sentences
// differ; what may not differ is the promise inside them.
const QUEUED_SURFACES = [
    ['components/QueuedResultPanel.jsx', /don't submit this again/i],
    ['routes/Send.jsx', /don't send this payment again/i],
    ['components/PlaceOrderPanel.jsx', /don't place it again/i],
    ['routes/BetFeedDetail.jsx', /do not place it again/i],
    ['routes/OracleConsole.jsx', /do not submit it again/i],
];
for (const [rel, dontRepeat] of QUEUED_SURFACES) {
    // Copy wraps across lines and escapes its apostrophes, so read it the way
    // the DOM ends up showing it.
    const src = readFileSync(join(shared, rel), 'utf8')
        .replace(/&apos;/g, "'")
        .replace(/'\s*\+\s*'/g, '')
        .replace(/\s+/g, ' ');
    assert.ok(
        /queued-transactions banner/i.test(src),
        `${rel} points the user at the queued-transactions banner`,
    );
    assert.ok(
        /reminds you when the network is back/i.test(src),
        `${rel} promises the reminder the wallet actually gives`,
    );
    assert.ok(
        /(only goes out when you broadcast|until you broadcast it from there)/i.test(src),
        `${rel} says the transaction does not go out until the user broadcasts it`,
    );
    assert.ok(
        dontRepeat.test(src),
        `${rel} still warns against authorising a second copy (§5.3.4)`,
    );
}

const confirmModal = readFileSync(join(shared, 'components', 'ConfirmActionModal.jsx'), 'utf8');
assert.ok(
    /Signed - not broadcast yet\./.test(confirmModal),
    'ConfirmActionModal\'s signed-not-broadcast phase states the fact, not a retry promise',
);

// --- 4. The behaviour the copy describes still exists --------------------

// 4a. Exactly one place broadcasts a queued entry, and it is a click handler.
const callers = [];
for (const file of scanned) {
    const text = readFileSync(file, 'utf8');
    // Skip the messaging shims: they DEFINE the route wrapper rather than
    // deciding when to fire it.
    if (/export (?:async )?function broadcastQueuedRequest/.test(text)) continue;
    if (/\.broadcastQueuedRequest\(/.test(text)) callers.push(relative(wsRoot, file));
}
assert.deepEqual(
    callers,
    ['packages/core/src/shared/components/QueuedBroadcastBanner.jsx'],
    'the queued-broadcast route has exactly one caller (the banner\'s "Broadcast now" button). '
    + `Found: ${callers.join(', ') || 'none'}. If an auto-drain was added, the done-screen copy `
    + 'in QUEUED_SURFACES has to be made true again ( remedy b).',
);

const banner = readFileSync(join(shared, 'components', 'QueuedBroadcastBanner.jsx'), 'utf8');
assert.ok(
    /onClick=\{\(\) => broadcast\(entry\.id\)\}/.test(banner),
    'the banner broadcasts on a user click, not on a timer',
);
assert.ok(
    !/setInterval\([^)]*broadcast\(/.test(banner) && !/setTimeout\([^)]*broadcast\(/.test(banner),
    'nothing in the banner drains the queue on a timer',
);

// 4b. The reminder the copy promises: a toast on offline|degraded -> normal.
assert.ok(
    /useReachability/.test(banner) && /showToast\(/.test(banner),
    'the banner watches reachability and can raise a toast',
);
assert.ok(
    /queued transactions?\. Broadcast now\?/.test(banner),
    'the reconnection toast asks the user to broadcast the queued transactions',
);
assert.ok(
    /if \(prev !== 'offline' && prev !== 'degraded'\) return;[\s\S]{0,120}?reachabilityOverall !== 'normal'/
        .test(banner),
    'the reminder fires on an offline|degraded -> normal transition',
);
assert.ok(
    /if \(queue\.length === 0\) return;/.test(banner),
    'the reminder only fires when something is actually queued',
);

console.log('queued-broadcast-copy smoke OK');
