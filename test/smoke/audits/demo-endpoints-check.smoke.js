// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for tools/release/verify-demo-endpoints.mjs ( §2.1).
//
// The script asks whether a store reviewer can reach the endpoints the
// scripted demo sends them to. It only runs against production, so the parts
// worth pinning offline are the parts that decide what an answer MEANS - and
// those are exercised precisely when production is broken, which is when
// nobody wants to be discovering that a branch was wrong.
//
// Three properties:
//
// 1. The probe list is DERIVED from the shipped descriptors. If it were
//    restated, the gate would keep checking a host the build stopped using,
//    pass, and send a reviewer somewhere else entirely.
// 2. Every non-200 shape lands on the right side, and "200" is not by itself
//    a pass: a signed-registry check, an available-networks check and a
//    tracker-sync check each turn a healthy-looking response into the failure
//    a reviewer would actually experience.
// 3. Inconclusive never becomes a pass, and a failure outranks it. Same rule
//    as verify-privacy-url.mjs, with 403 deliberately on the OTHER side: on
//    these hosts a 403 is coming back, which is the whole reason
//    this file exists.

import { strict as assert } from 'node:assert';

import {
    demoProbesFor, classifyProbe, checkDemoEndpoints, burstProbe, EXIT,
} from '../../../tools/release/verify-demo-endpoints.mjs';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/descriptors/index.js';

// --- 1. The probe list comes from the descriptors ----------------------

const testnet = demoProbesFor('testnet');
assert.ok(testnet.length > 0, 'testnet must produce probes');

// Every URL must be built from a descriptor this build actually ships, which
// is the property that keeps the gate pointed where the app points.
const shippedHosts = new Set(
    BUNDLED_DESCRIPTORS.filter((d) => d.networkKind === 'testnet')
        .flatMap((d) => [d.explorer.defaultUrl, d.encoder.defaultUrl, d.hub.defaultUrl])
        .map((u) => new URL(u).host),
);
for (const probe of testnet) {
    assert.ok(
        shippedHosts.has(new URL(probe.url).host),
        `probe ${probe.url} names a host no shipped testnet descriptor does`,
    );
}

// One hub probe, not one per chain: the registry route is origin-level, and
// three identical probes would report one outage three times.
assert.equal(
    testnet.filter((p) => p.service === 'hub').length,
    1,
    'the hub registry probe is deduplicated by URL',
);
assert.equal(
    new Set(testnet.map((p) => p.url)).size,
    testnet.length,
    'no probe URL appears twice',
);

// The demo runs on testnet, so the coin codes must carry the T prefix. A
// mainnet code here would be a gate that checks the wrong chain and passes.
for (const probe of testnet.filter((p) => p.service === 'explorer')) {
    assert.match(probe.url, /\/T[A-Z]+\/api\/status$/, `explorer probe ${probe.url} targets a testnet coin`);
}
assert.equal(demoProbesFor('nosuchkind').length, 0, 'an unknown network kind produces no probes');

// --- 2. Classification --------------------------------------------------

const explorerProbe = { service: 'explorer', coin: 'TBTC' };
const encoderProbe = { service: 'encoder', coin: 'TBTC' };
const hubProbe = { service: 'hub', coin: 'TBTC' };

// The two blocks this gate was written for, each named so the reader of a red
// run does not have to rediscover the cause.
const blocked = classifyProbe(explorerProbe, { status: 403, body: '' });
assert.equal(blocked.state, 'failure', 'a 403 is a failure, not an inconclusive: it is  returning');
assert.match(blocked.detail, //, 'the 403 detail names the item');

const limited = classifyProbe(explorerProbe, { status: 429, body: '' });
assert.equal(limited.state, 'failure');
assert.match(limited.detail, //, 'the 429 detail names the rate-limit item');

assert.equal(classifyProbe(explorerProbe, { status: 502, body: '' }).state, 'failure');
assert.equal(
    classifyProbe(explorerProbe, { error: 'timed out after 15000ms' }).state,
    'inconclusive',
    'a transport failure is not evidence either way',
);

// A 200 carrying an error page is the failure that reads as health.
const htmlOn200 = classifyProbe(explorerProbe, { status: 200, body: '<!DOCTYPE html><html>...' });
assert.equal(htmlOn200.state, 'failure');
assert.match(htmlOn200.detail, /not JSON/);

// Explorer: up is not the same as serving the demo's chain.
assert.equal(
    classifyProbe(explorerProbe, { status: 200, body: JSON.stringify({ available: { TBTC: 'BTC (testnet)' } }) }).state,
    'live',
);
const wrongChain = classifyProbe(explorerProbe, { status: 200, body: JSON.stringify({ available: { BTC: 'BTC (mainnet)' } }) });
assert.equal(wrongChain.state, 'failure', 'an explorer that no longer serves TBTC leaves the demo on an empty screen');
assert.match(wrongChain.detail, /TBTC is not among/);
assert.equal(classifyProbe(explorerProbe, { status: 200, body: '{}' }).state, 'failure');

// Encoder: healthy is not the same as able to compose.
assert.equal(
    classifyProbe(encoderProbe, {
        status: 200,
        body: JSON.stringify({ status: 'healthy', tracker_reachable: true, tracker_synced: true, tracker_lag: 0 }),
    }).state,
    'live',
);
const desynced = classifyProbe(encoderProbe, {
    status: 200,
    body: JSON.stringify({ status: 'healthy', tracker_reachable: true, tracker_synced: false, tracker_lag: 412 }),
});
assert.equal(desynced.state, 'failure', 'a desynced tracker composes against a stale chain view');
assert.match(desynced.detail, /412/, 'the lag is reported, since it is the number that says how bad');
assert.equal(
    classifyProbe(encoderProbe, { status: 200, body: JSON.stringify({ status: 'healthy', tracker_reachable: false }) }).state,
    'failure',
);
assert.equal(
    classifyProbe(encoderProbe, { status: 200, body: JSON.stringify({ status: 'degraded' }) }).state,
    'failure',
);

// Hub: HTTP 200 with a snapshot the wallet itself would refuse. The wallet
// pins the federation key, so an unsigned or mis-signed registry is a dead
// demo even though the host is plainly up.
const unsigned = classifyProbe(hubProbe, {
    status: 200,
    body: JSON.stringify({ generatedAt: '2026-08-02T00:00:00.000Z', descriptors: [{ coin: 'bitcoin' }] }),
});
assert.equal(unsigned.state, 'failure', 'an unsigned chain-registry is refused by the wallet, so it fails here too');
assert.match(unsigned.detail, /signature/);
const wrongSigner = classifyProbe(hubProbe, {
    status: 200,
    body: JSON.stringify({
        generatedAt: '2026-08-02T00:00:00.000Z',
        descriptors: [{ coin: 'bitcoin' }],
        signature: 'a'.repeat(128),
        signer_pubkey: 'b'.repeat(64),
    }),
});
assert.equal(wrongSigner.state, 'failure');
assert.match(wrongSigner.detail, /pinned federation key/);

// --- 3. Aggregation: the outcome axis -----------------------------------

const FAKE = [
    {
        coin: 'bitcoin',
        networkKind: 'testnet',
        explorer: { defaultUrl: 'https://explorer.example' },
        encoder: { defaultUrl: 'https://encoder.example/TBTC' },
        hub: { defaultUrl: 'https://hub.example/TBTC' },
    },
];

const reply = (body, status = 200) => async () => ({ status, text: async () => body });
const HEALTHY = {
    'https://explorer.example/TBTC/api/status': JSON.stringify({ available: { TBTC: 'BTC (testnet)' } }),
    'https://encoder.example/TBTC/status': JSON.stringify({ status: 'healthy', tracker_reachable: true, tracker_synced: true }),
};

const routed = (overrides = {}) => async (url) => {
    if (overrides[url]) return overrides[url]();
    if (HEALTHY[url]) return { status: 200, text: async () => HEALTHY[url] };
    // The hub: signed bodies cannot be forged offline, so it is held at a
    // shape the classifier rejects and the tests below account for it.
    return { status: 200, text: async () => '{}' };
};

const allBroken = await checkDemoEndpoints({ descriptors: FAKE, fetchImpl: routed() });
assert.equal(allBroken.exit, EXIT.FAILURE, 'the unsignable hub body keeps this run red, which is the correct answer');
assert.equal(allBroken.results.filter((r) => r.state === 'live').length, 2, 'explorer and encoder still pass on their own merits');

// A failure outranks an inconclusive: a run that has both must not be reported
// as merely "could not tell", which reads as retryable.
const mixed = await checkDemoEndpoints({
    descriptors: FAKE,
    fetchImpl: routed({
        'https://explorer.example/TBTC/api/status': async () => { throw new Error('ENOTFOUND'); },
        'https://encoder.example/TBTC/status': reply('', 403),
    }),
});
assert.equal(mixed.exit, EXIT.FAILURE);
assert.equal(mixed.results.find((r) => r.service === 'explorer').state, 'inconclusive');

// Nothing reachable at all is inconclusive, never a pass.
const unreachable = await checkDemoEndpoints({
    descriptors: FAKE,
    fetchImpl: async () => { throw new Error('EAI_AGAIN'); },
});
assert.equal(unreachable.exit, EXIT.INCONCLUSIVE);
assert.ok(unreachable.results.every((r) => r.state === 'inconclusive'));

assert.equal(
    (await checkDemoEndpoints({ descriptors: FAKE, networkKind: 'nosuchkind' })).exit,
    EXIT.CONFIG,
    'no descriptors for the requested network is a config error, not a pass and not an outage',
);

// --- 4. The burst, which is the only thing that can see a rate limit ----
//
// One request per host cannot trip a 0.5 req/sec limit; a wallet opening on
// three chains is not one request .
const burstProbes = demoProbesFor('testnet', FAKE);
const burstBlocked = await burstProbe(burstProbes, { fetchImpl: reply('', 429), timeoutMs: 100, count: 4 });
assert.equal(burstBlocked.blocked, 4, 'every 429 in the burst is counted');

const burstFine = await burstProbe(burstProbes, { fetchImpl: reply(HEALTHY['https://explorer.example/TBTC/api/status']), timeoutMs: 100, count: 4 });
assert.equal(burstFine.blocked, 0);

const withBurst = await checkDemoEndpoints({
    descriptors: FAKE,
    burst: 4,
    fetchImpl: routed({ 'https://explorer.example/TBTC/api/status': reply('', 429) }),
});
assert.ok(
    withBurst.results.some((r) => r.service === 'rate-limit' && r.state === 'failure'),
    'a rate-limited burst adds its own failure row rather than hiding inside the per-probe result',
);

console.log(
    'OK: demo-endpoint gate smoke ( §2.1: probe list derived from the shipped testnet descriptors and'
    + ' deduplicated; 403 is a failure that names  and 429 one that names ; a 200 is not a pass on'
    + ' its own, since the hub signature, the explorer available-networks map and the encoder tracker-sync flag'
    + ' each turn a healthy-looking response into the failure a reviewer would hit; inconclusive never becomes a'
    + ' pass and a failure outranks it; the opt-in burst is the only probe that can see a rate limit)',
);
