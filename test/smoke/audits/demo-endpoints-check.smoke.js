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
    DEMO_COIN, STALE_AFTER_MS, MAX_INDEXER_LAG_BLOCKS,
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

// --- 2a. Indexer freshness (2026-08-06) ---------------------------------
//
// Serving the coin is not serving it CURRENTLY. This gate reported all three
// testnet chains live on 2026-08-06 while TDOGE's indexer trailed its decoder
// by 756,703 blocks with a 32-day-old newest block, and TLTC's newest block was
// 38 hours old. A demo wallet funded on either would have shown the reviewer an
// empty balance screen - the same failure  fixed one layer up, where the
// notes sent the reviewer to a network the demo phrase was not funded on.

const NOW = 1_786_000_000_000;
const secondsAgo = (ms) => Math.floor((NOW - ms) / 1000);
const explorerBody = (coin, { blockTime, lag } = {}) => {
    const body = { available: { [coin]: 'a network' } };
    if (blockTime !== undefined) body.last_block_time = { [coin]: blockTime };
    if (lag !== undefined) body.decoder_lag_blocks = { [coin]: lag };
    return JSON.stringify(body);
};
const demoProbe = { service: 'explorer', coin: 'TBTC', isDemoCoin: true };
const otherProbe = { service: 'explorer', coin: 'TDOGE', isDemoCoin: false };
const at = (probe, body) => classifyProbe(probe, { status: 200, body }, { nowMs: NOW });

// The demo chain, current: live, and it SAYS it measured freshness rather than
// leaving the reader to assume the old check is all that ran.
const currentDemo = at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(10 * 60_000), lag: 2 }));
assert.equal(currentDemo.state, 'live');
assert.match(currentDemo.detail, /demo chain current/);

// The demo chain, stopped: fatal, and the detail says what it costs rather than
// reporting a number.
const stoppedDemo = at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(3 * 24 * 60 * 60_000), lag: 0 }));
assert.equal(stoppedDemo.state, 'failure', 'a stale demo chain is a failure: the funding tx would never appear');
assert.match(stoppedDemo.detail, /would not appear on the balance screen/);

// The demo chain, running but hopelessly behind. Kept separate from the case
// above because the two signals fail apart: a stalled node stops the clock, a
// backlogged indexer does not.
const behindDemo = at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(60_000), lag: 756_703 }));
assert.equal(behindDemo.state, 'failure', 'a recent block time does not excuse a 756k-block indexer backlog');
assert.match(behindDemo.detail, /trails the decoder by 756,703 blocks/);

// Both thresholds falsified at the boundary, so a future retune cannot silently
// widen them past the state actually found in production.
assert.equal(at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(STALE_AFTER_MS - 60_000), lag: 0 })).state, 'live');
assert.equal(at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(STALE_AFTER_MS + 60_000), lag: 0 })).state, 'failure');
assert.equal(at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(60_000), lag: MAX_INDEXER_LAG_BLOCKS })).state, 'live');
assert.equal(at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(60_000), lag: MAX_INDEXER_LAG_BLOCKS + 1 })).state, 'failure');

// A body with no clock at all cannot answer the question, and this script's
// standing rule is that a check which cannot tell says so instead of passing.
const noClock = at(demoProbe, explorerBody('TBTC'));
assert.equal(noClock.state, 'inconclusive');
assert.match(noClock.detail, /freshness cannot be checked/);

// A chain the demo is NOT funded on stays live and is named unfundable, with
// the chain to use instead. Failing here would hold a submission over a chain
// nobody's demo wallet touches, which is how a gate gets routed around.
const staleOther = at(otherProbe, explorerBody('TDOGE', { blockTime: secondsAgo(32 * 24 * 60 * 60_000), lag: 756_703 }));
assert.equal(staleOther.state, 'live', 'a stale non-demo chain is information, not a blocker');
assert.match(staleOther.detail, /NOT FUNDABLE/);
assert.match(staleOther.detail, new RegExp(`Fund the demo wallet on ${DEMO_COIN}`));
assert.doesNotMatch(
    at(otherProbe, explorerBody('TDOGE', { blockTime: secondsAgo(60_000), lag: 0 })).detail,
    /NOT FUNDABLE/,
    'a current non-demo chain is not warned about, so the warning means something',
);

// The flag has to reach the real probe list, or every check above is dead code
// in production. Exactly one explorer probe carries it, and it is the pinned
// demo coin: a descriptor rename that drops TBTC fails here rather than
// silently downgrading the gate to the lenient path.
const demoExplorerProbes = testnet.filter((p) => p.service === 'explorer' && p.isDemoCoin);
assert.equal(demoExplorerProbes.length, 1, 'exactly one explorer probe is the demo chain');
assert.equal(demoExplorerProbes[0].coin, DEMO_COIN);

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
// The clock is computed rather than pinned: a literal timestamp would pass
// today and start failing on its own six hours later, which is the shape of
// test that gets deleted rather than fixed.
const nowSec = Math.floor(Date.now() / 1000);
const HEALTHY = {
    'https://explorer.example/TBTC/api/status': JSON.stringify({
        available: { TBTC: 'BTC (testnet)' },
        last_block_time: { TBTC: nowSec - 60 },
        decoder_lag_blocks: { TBTC: 0 },
    }),
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
assert.equal(allBroken.results.filter((r) => r.state === 'live').length, 3, 'explorer, encoder and the hub JSON-RPC probe still pass on their own merits');

// --- CORS: the half that reported green while the app could not call anything -
//
// These fixtures carry real Headers, because the distinction under test is one
// the stubs above cannot express: a response with NO readable headers is
// "cannot tell", a response whose headers simply lack the key is "blocked".
// Collapsing the two is what the first cut of this check got wrong.
const withHeaders = (body, headers = {}) => async () => ({
    status: 200,
    text: async () => body,
    headers: new Headers(headers),
});
const ENCODER_OK = JSON.stringify({ status: 'healthy', tracker_reachable: true, tracker_synced: true });
const encoderCors = async (headers) => {
    const run = await checkDemoEndpoints({
        descriptors: FAKE,
        fetchImpl: routed({ 'https://encoder.example/TBTC/status': withHeaders(ENCODER_OK, headers) }),
    });
    return run.results.find((r) => r.service === 'encoder');
};

// A healthy service with no ACAO is a FAILURE, not a warning: the shipped app
// is a WebView and cannot read the reply at all.
const noAcao = await encoderCors({});
assert.equal(noAcao.state, 'failure', 'a healthy encoder that serves no Access-Control-Allow-Origin is unusable by the store build');
assert.match(noAcao.detail, /UNREACHABLE FROM THE APP/, 'the reason has to name itself, or it reads as an unrelated encoder fault');

// The comma-joined value: looks configured, accepted by no browser, and needs a
// different remedy from "no header", so it is reported as its own thing.
const commaJoined = await encoderCors({
    'access-control-allow-origin': 'capacitor://localhost,https://wallet.xchain.io',
});
assert.equal(commaJoined.state, 'failure', 'a multi-value ACAO is rejected by every browser');
assert.match(commaJoined.detail, /names several origins/, 'the multi-origin case must be named, since its fix is an allowlist rather than a wider string');

// An origin that is allowed, and one that is allowed but not OURS.
assert.equal((await encoderCors({ 'access-control-allow-origin': '*' })).state, 'live', 'a wildcard permits the shell');
assert.equal(
    (await encoderCors({ 'access-control-allow-origin': 'capacitor://localhost' })).state,
    'live',
    'the shell origin echoed back to itself permits the shell',
);
const wrongOrigin = await encoderCors({ 'access-control-allow-origin': 'https://example.invalid' });
assert.equal(wrongOrigin.state, 'failure', 'an ACAO naming somebody else does not permit this shell');

// --origin re-points the probe at another shell, because iOS and Android do not
// share an origin (capacitor.config.json declares androidScheme and no iosScheme).
const asAndroid = await checkDemoEndpoints({
    descriptors: FAKE,
    origin: 'https://localhost',
    fetchImpl: routed({
        'https://encoder.example/TBTC/status': withHeaders(ENCODER_OK, { 'access-control-allow-origin': 'https://localhost' }),
    }),
});
assert.equal(asAndroid.results.find((r) => r.service === 'encoder').state, 'live', 'the Android origin is permitted when the service names it');

// The probe must actually SEND the Origin, not merely read the reply. Asserted
// on the outgoing request because every check above is satisfied by fixtures
// that answer with CORS headers regardless of what was asked - so deleting the
// header from the request would leave them all green while restoring the exact
// blind spot this whole section exists to remove.
const sentOrigins = [];
await checkDemoEndpoints({
    descriptors: FAKE,
    origin: 'https://localhost',
    fetchImpl: async (url, init) => {
        sentOrigins.push(init?.headers?.origin);
        return { status: 200, text: async () => '{}', headers: new Headers({ 'access-control-allow-origin': '*' }) };
    },
});
assert.ok(sentOrigins.length > 0, 'no probe was issued at all');
assert.ok(
    sentOrigins.every((o) => o === 'https://localhost'),
    'every probe must carry the shell Origin header. Without it the services answer as they do to curl,'
    + ` and the gate goes back to certifying endpoints the app cannot use. Sent: ${JSON.stringify(sentOrigins)}`,
);

// A stale demo chain has to reach the EXIT CODE, not just the detail line: the
// operator reads `echo $?` before they read the report, and the whole point of
// the check is to stop a submission whose demo cannot show a balance.
const staleDemoRun = await checkDemoEndpoints({
    descriptors: FAKE,
    fetchImpl: routed({
        'https://explorer.example/TBTC/api/status': reply(JSON.stringify({
            available: { TBTC: 'BTC (testnet)' },
            last_block_time: { TBTC: nowSec - 32 * 24 * 60 * 60 },
            decoder_lag_blocks: { TBTC: 756_703 },
        })),
    }),
});
assert.equal(staleDemoRun.exit, EXIT.FAILURE);
assert.equal(staleDemoRun.results.find((r) => r.service === 'explorer').state, 'failure');

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
