// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for tools/release/verify-demo-endpoints.mjs (§2.1).
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
// these hosts a 403 is the bot-block coming back, which is the whole reason
//    this file exists.

import { strict as assert } from 'node:assert';

import {
    demoProbesFor, classifyProbe, checkDemoEndpoints, burstProbe, EXIT,
    DEMO_COIN, STALE_AFTER_MS, MAX_INDEXER_LAG_BLOCKS, MAX_DEMO_LAG_BLOCKS, preflightVerdict,
    replicaHaltVerdict, defaultBurstCount,
} from '../../../tools/release/verify-demo-endpoints.mjs';
import { coldOpenBurstSize } from '../../../tools/release/cold-open-profile.mjs';
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
assert.equal(blocked.state, 'failure', 'a 403 is a failure, not an inconclusive: it is returning');
assert.match(blocked.detail, /cannot load a balance/, 'the 403 detail says what a reviewer would see');

const limited = classifyProbe(explorerProbe, { status: 429, body: '' });
assert.equal(limited.state, 'failure');
assert.match(limited.detail, /below one wallet cold-open/, 'the 429 detail names the limit it hit');

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
assert.equal(classifyProbe(explorerProbe, { status: 200, body: '{}' }).state, 'failure');

// --- 1a. An absence is reported with its CAUSE, or with none ----------------
//
// The message this replaces said "TBTC is not among the networks it serves",
// which reads as deconfiguration and is a diagnosis the gate had no evidence
// for. On 2026-08-10 that sentence sent a run looking for explorer config that
// had never been touched: the explorer still listed all nine networks in
// `supported` and builds `available` by DELETING the coins it has marked
// stale, so the chain had been WITHDRAWN, not deconfigured. Three branches,
// because the payload can distinguish three situations and the old message
// collapsed them into the most alarming one.

// Withdrawn: configured, but dropped from service, and the reason is named.
const withdrawn = classifyProbe(explorerProbe, {
    status: 200,
    body: JSON.stringify({
        available: { BTC: 'BTC (mainnet)' },
        supported: { BTC: 'BTC (mainnet)', TBTC: 'BTC (testnet)' },
        stale: { TBTC: true },
        last_block_time: { TBTC: Math.floor(Date.now() / 1000) - 40 * 86400 },
    }),
});
assert.equal(withdrawn.state, 'failure', 'a withdrawn chain is still fatal for the demo coin');
assert.match(withdrawn.detail, /CONFIGURED for TBTC/, 'it says the explorer IS configured for the coin');
assert.match(withdrawn.detail, /withdrawn from service/, 'and that the coin was withdrawn rather than removed');
assert.ok(
    !/not in its configured set/.test(withdrawn.detail),
    'a withdrawn chain is never described as deconfigured, which is the defect this branch exists for',
);

// Withdrawn, but the body carries no reason: the gate must NOT supply one.
// This case exists because the first draft of the branch above hardcoded "the
// explorer marked it stale" as its fallback, and driving the live payload
// printed that sentence for a coin whose own stale flag was false - the same
// invented-cause defect, one level down from the one being fixed.
const withdrawnNoReason = classifyProbe(explorerProbe, {
    status: 200,
    body: JSON.stringify({
        available: { BTC: 'BTC (mainnet)' },
        supported: { BTC: 'BTC (mainnet)', TBTC: 'BTC (testnet)' },
        stale: { TBTC: false },
        last_block_time: { TBTC: Math.floor(Date.now() / 1000) - 60 },
        decoder_lag_blocks: { TBTC: 1 },
    }),
});
assert.equal(withdrawnNoReason.state, 'failure');
assert.match(withdrawnNoReason.detail, /gives no reason/, 'an unexplained withdrawal is reported as unexplained');
assert.ok(
    !/stale/.test(withdrawnNoReason.detail),
    'staleness is never asserted for a coin the body does not flag as stale',
);

// Genuinely deconfigured: absent from `supported` too.
const deconfigured = classifyProbe(explorerProbe, {
    status: 200,
    body: JSON.stringify({
        available: { BTC: 'BTC (mainnet)' },
        supported: { BTC: 'BTC (mainnet)' },
    }),
});
assert.equal(deconfigured.state, 'failure');
assert.match(deconfigured.detail, /not in its configured set/, 'a truly absent chain is named as such');

// No `supported` map: no evidence, so no cause is claimed either way.
const noEvidence = classifyProbe(explorerProbe, {
    status: 200,
    body: JSON.stringify({ available: { BTC: 'BTC (mainnet)' } }),
});
assert.equal(noEvidence.state, 'failure');
assert.match(noEvidence.detail, /absent from the networks it currently serves/);
assert.ok(
    !/not in its configured set/.test(noEvidence.detail) && !/CONFIGURED for/.test(noEvidence.detail),
    'with nothing to consult, the gate reports the absence and asserts no cause',
);

// --- 2a. Indexer freshness (2026-08-06) ---------------------------------
//
// Serving the coin is not serving it CURRENTLY. This gate reported all three
// testnet chains live on 2026-08-06 while TDOGE's indexer trailed its decoder
// by 756,703 blocks with a 32-day-old newest block, and TLTC's newest block was
// 38 hours old. A demo wallet funded on either would have shown the reviewer an
// empty balance screen - the same failure a later change fixed one layer up, where the
// notes sent the reviewer to a network the demo phrase was not funded on.

const NOW = 1_786_000_000_000;
const secondsAgo = (ms) => Math.floor((NOW - ms) / 1000);
// `halted` defaults to `false` so every freshness-focused fixture below keeps
// exercising the freshness branch unchanged; a test of the halt signal itself
// passes `halted` explicitly or `omitHalted: true` to build a body with no
// replica_halted key at all (the older-explorer-deployment shape).
const explorerBody = (coin, { blockTime, lag, halted = false, omitHalted = false } = {}) => {
    const body = { available: { [coin]: 'a network' } };
    if (blockTime !== undefined) body.last_block_time = { [coin]: blockTime };
    if (lag !== undefined) body.decoder_lag_blocks = { [coin]: lag };
    if (!omitHalted) body.replica_halted = { [coin]: halted };
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
assert.equal(at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(60_000), lag: MAX_DEMO_LAG_BLOCKS })).state, 'live');
assert.equal(at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(60_000), lag: MAX_DEMO_LAG_BLOCKS + 1 })).state, 'failure');

// The loose ceiling still governs every OTHER chain, so tightening the demo coin
// did not quietly re-tune the rest of the board.
assert.doesNotMatch(
    at(otherProbe, explorerBody('TDOGE', { blockTime: secondsAgo(60_000), lag: MAX_INDEXER_LAG_BLOCKS })).detail,
    /NOT FUNDABLE/);
assert.match(
    at(otherProbe, explorerBody('TDOGE', { blockTime: secondsAgo(60_000), lag: MAX_INDEXER_LAG_BLOCKS + 1 })).detail,
    /NOT FUNDABLE/);

// The exact production shape of 2026-08-10, which both loose thresholds passed:
// a replica fail-closed on a consensus divergence at block 147814 while its
// source ran on, reported as `lag 41, newest block 5h old` and certified "demo
// chain current" for hours. A halt is terminal, so no rate threshold sized for
// ordinary churn can see it; only the tight demo ceiling does.
const haltedDemo = at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(5 * 60 * 60_000), lag: 41 }));
assert.equal(haltedDemo.state, 'failure', 'a frozen demo replica must not read as current');
assert.match(haltedDemo.detail, /trails the decoder by 41 blocks \(ceiling 2\)/);

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

// --- 2b. Replica halt: the fact a lag ceiling can only proxy (row 84) ---
//
// A lag ceiling only ever proxies a halt: a replica halted AT its source's
// tip has no gap to measure until the source mints its next block. Measured
// 2026-08-10: this gate exited 0 twice, 22 minutes apart, over a provably
// halted demo chain, because MAX_DEMO_LAG_BLOCKS had nothing yet to measure.
// replica_halted asks the fact instead of inferring one from a rate.

// Demo coin, halted, at zero lag with a fresh clock: the exact gap this row
// closes. Every freshness signal reads perfectly current; only the halt flag
// knows better.
const demoHaltedAtTip = at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(60_000), lag: 0, halted: true }));
assert.equal(demoHaltedAtTip.state, 'failure', 'a halted demo replica is fatal even with zero lag and a fresh clock');
assert.match(demoHaltedAtTip.detail, /HALT/, 'the message names it as a HALT, not staleness or lag');
assert.match(demoHaltedAtTip.detail, /operator/, 'the message says a halt needs an operator, the different remedy from staleness');
assert.doesNotMatch(demoHaltedAtTip.detail, /trails the decoder/, 'the halt reason must not be reported as a lag number');
assert.doesNotMatch(demoHaltedAtTip.detail, /newest indexed block/, 'the halt reason must not be reported as staleness');

// Non-demo coin, halted: the existing loud, non-fatal NOT FUNDABLE register,
// same shape as a stale non-demo chain - reported, never held over.
const otherHalted = at(otherProbe, explorerBody('TDOGE', { blockTime: secondsAgo(60_000), lag: 0, halted: true }));
assert.equal(otherHalted.state, 'live', 'a halted chain nobody funds is information, not a blocker');
assert.match(otherHalted.detail, /NOT FUNDABLE/);
assert.match(otherHalted.detail, /HALT/);
assert.match(otherHalted.detail, new RegExp(`Fund the demo wallet on ${DEMO_COIN}`));

// Demo coin, field absent entirely (an older explorer deployment): NOT a pass
// and NOT a failure, the gate's existing inconclusive/unknown class.
const demoHaltAbsent = at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(60_000), lag: 0, omitHalted: true }));
assert.equal(demoHaltAbsent.state, 'inconclusive', 'an explorer that predates replica_halted cannot silently pass');
assert.match(demoHaltAbsent.detail, /halt state cannot be checked/);

// Demo coin, field explicitly null: the same unknown class as absent, not a
// third outcome and not a pass.
const demoHaltNull = classifyProbe(demoProbe, {
    status: 200,
    body: JSON.stringify({
        available: { TBTC: 'a network' },
        last_block_time: { TBTC: secondsAgo(60_000) },
        decoder_lag_blocks: { TBTC: 0 },
        replica_halted: { TBTC: null },
    }),
}, { nowMs: NOW });
assert.equal(demoHaltNull.state, 'inconclusive', 'a null halt reading is exactly as unusable as an absent one');
assert.match(demoHaltNull.detail, /halt state cannot be checked/);

// Demo coin, field false: passes exactly as it did before this signal
// existed, so a healthy replica is never held over a signal it already
// satisfies.
const demoHaltFalse = at(demoProbe, explorerBody('TBTC', { blockTime: secondsAgo(60_000), lag: 0, halted: false }));
assert.equal(demoHaltFalse.state, 'live', 'a replica that reports no halt passes as today');

// Unit level: replicaHaltVerdict() itself, no network, exercising all three
// states directly rather than only through classifyProbe's fold.
assert.equal(replicaHaltVerdict({ replica_halted: { TBTC: true } }, 'TBTC').state, 'halted');
assert.equal(replicaHaltVerdict({ replica_halted: { TBTC: false } }, 'TBTC').state, 'ok');
assert.equal(replicaHaltVerdict({ replica_halted: { TBTC: null } }, 'TBTC').state, 'unknown');
assert.equal(replicaHaltVerdict({}, 'TBTC').state, 'unknown');
assert.equal(replicaHaltVerdict(null, 'TBTC').state, 'unknown');

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
        replica_halted: { TBTC: false },
    }),
    'https://encoder.example/TBTC/status': JSON.stringify({ status: 'healthy', tracker_reachable: true, tracker_synced: true }),
};

// What the hub answers a JSON-RPC ping with, which is the call the wallet's
// own reachability check makes (sdk.pingHub()) and therefore the one the
// hub-rpc probe stands in for.
const RPC_PONG = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { status: 'success', db: true } });

const routed = (overrides = {}) => async (url, init = {}) => {
    if (overrides[url]) return overrides[url]();
    if (HEALTHY[url]) return { status: 200, text: async () => HEALTHY[url] };
    // The hub's JSON-RPC root answers the ping POST and nothing else; its
    // registry route is a signed body that cannot be forged offline, so that
    // one is held at a shape the classifier rejects and the tests below
    // account for it.
    if (init.method === 'POST') return { status: 200, text: async () => RPC_PONG };
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

// --- Preflight: the POST no GET can ever provoke ------------------------
//
// corsVerdict() above reads the ACAO on a GET's own reply. A GET is
// CORS-simple and never triggers a preflight, so every check above it is
// structurally blind to a service that answers the GET fine and blocks the
// OPTIONS - which is exactly what production does. Measured 2026-08-07:
// `OPTIONS https://encoder.xchain.io/TBTC/` with Access-Control-Request-Method:
// POST returns 204 with ACAO echoing the origin and Allow-Methods naming POST
// (a pass); `OPTIONS https://hub.xchain.io/` with the same headers returns 200
// with an `allow:` header (the plain HTTP verb list, a red herring) and NO
// access-control-* header at all, even though a plain POST to that same URL
// DOES carry one. A gate that only ever sends GET cannot see that gap.

const PREFLIGHT_ORIGIN = 'capacitor://localhost';

// 1. Classification, unit level, no network.
const passingPreflight = preflightVerdict({
    status: 204, origin: PREFLIGHT_ORIGIN,
    acao: PREFLIGHT_ORIGIN, allowMethods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
});
assert.equal(passingPreflight.state, 'ok', 'ACAO echoing the origin plus Allow-Methods naming POST is a pass, matching the encoder\'s measured shape');

assert.equal(
    preflightVerdict({ status: 204, origin: PREFLIGHT_ORIGIN, acao: '*', allowMethods: 'POST' }).state,
    'ok',
    'a wildcard ACAO permits the preflight the same way it permits a GET',
);

// The hub's exact measured shape: HTTP 200, a plain `Allow` header (not read
// here at all), and no access-control-* header whatsoever.
const hubMeasuredShape = preflightVerdict({ status: 200, origin: PREFLIGHT_ORIGIN, acao: null, allowMethods: null });
assert.equal(hubMeasuredShape.state, 'blocked', 'no ACAO on the preflight blocks the POST, same rule as no ACAO on a GET');
assert.match(hubMeasuredShape.detail, /no Access-Control-Allow-Origin/);

const preflightWrongOrigin = preflightVerdict({ status: 204, origin: PREFLIGHT_ORIGIN, acao: 'https://example.invalid', allowMethods: 'POST' });
assert.equal(preflightWrongOrigin.state, 'blocked', 'an ACAO naming somebody else does not permit this shell to preflight either');

// ACAO is fine but POST is not among the allowed methods: a service that
// wired CORS for its GET-based health check and never for its write path.
const noPostMethod = preflightVerdict({
    status: 204, origin: PREFLIGHT_ORIGIN, acao: PREFLIGHT_ORIGIN, allowMethods: 'GET,HEAD',
});
assert.equal(noPostMethod.state, 'blocked', 'an Allow-Methods that never names POST blocks the one request the demo needs');
assert.match(noPostMethod.detail, /does not name POST/);

// Allow-Methods genuinely absent on a real reply is "blocked", not "unknown" -
// the same undefined/null rule this file uses everywhere else.
assert.equal(
    preflightVerdict({ status: 204, origin: PREFLIGHT_ORIGIN, acao: PREFLIGHT_ORIGIN, allowMethods: null }).state,
    'blocked',
    'a real reply missing Access-Control-Allow-Methods is BLOCKED, not unknown - it answered, and it answered without the header',
);

// No readable headers at all (an offline fixture) cannot tell either way, kept
// apart from "blocked" for the same reason corsVerdict() keeps them apart.
assert.equal(
    preflightVerdict({ status: 204, origin: PREFLIGHT_ORIGIN, acao: undefined, allowMethods: undefined }).state,
    'unknown',
);
assert.equal(
    preflightVerdict({ status: 204, origin: PREFLIGHT_ORIGIN, acao: PREFLIGHT_ORIGIN, allowMethods: undefined }).state,
    'unknown',
    'ACAO readable and matching but Allow-Methods unreadable is still "cannot tell", not a pass',
);
assert.equal(preflightVerdict({ error: 'ENOTFOUND' }).state, 'unknown');

// 2. Probe-list shape: only the two POST-load-bearing services carry a
// preflightUrl at all, and the encoder's targets the exact slashed path the
// SDK's create_tx call hits - NOT the /status health path this probe already
// GETs. The SDK builds its encoder client with axios baseURL = the descriptor
// URL and calls client.post('/'); axios's combineURLs joins that into a
// TRAILING-SLASHED path, which is the only one the Apache vhost proxies to the
// encoder - the un-slashed path is served from DocumentRoot instead, a
// different route entirely. Probing the wrong one would measure a landing
// page, not the encoder.
const preflightingProbes = testnet.filter((p) => p.preflightUrl);
assert.ok(preflightingProbes.length > 0, 'at least one probe must carry a preflightUrl or this whole row is dead code');
assert.ok(
    preflightingProbes.every((p) => p.service === 'encoder' || p.service === 'hub-rpc'),
    'only the encoder and hub-rpc probes preflight; their load-bearing call is a POST',
);
assert.ok(
    testnet.filter((p) => p.service === 'hub-rpc').every((p) => p.preflightUrl),
    'every hub-rpc probe must carry a preflightUrl',
);
assert.ok(
    testnet.filter((p) => p.service === 'encoder').every((p) => p.preflightUrl),
    'every encoder probe must carry a preflightUrl',
);
assert.ok(
    testnet.filter((p) => p.service === 'hub').every((p) => !p.preflightUrl),
    'the hub registry route is GET-only; it must not preflight',
);
assert.ok(
    testnet.filter((p) => p.service === 'explorer').every((p) => !p.preflightUrl),
    'the explorer route is GET-only; it must not preflight',
);
for (const p of testnet.filter((p) => p.service === 'hub-rpc')) {
    assert.equal(p.preflightUrl, p.url, 'the hub-rpc preflight targets the same URL as its POST: there is only one JSON-RPC root');
}
for (const p of testnet.filter((p) => p.service === 'encoder')) {
    assert.notEqual(p.preflightUrl, p.url, 'the encoder preflight target must not be the /status health path');
    assert.match(p.preflightUrl, /\/$/, 'the encoder preflight target must carry the trailing slash the SDK\'s POST actually uses');
    assert.equal(
        p.preflightUrl, p.url.replace(/\/status$/, '/'),
        'the preflight base is the /status URL with /status swapped for the trailing slash the POST hits',
    );
}

// 3. Wired into the full run, against fixtures shaped like the two production
// hosts that diverge: an encoder whose preflight is blocked though its GET is
// fine, and a hub whose preflight is blocked though its POST carries a real
// ACAO (the exact "POST carries the header, preflight does not" split found
// on 2026-08-07).
const methodRouted = (routes) => async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const handler = routes[`${method} ${url}`];
    if (!handler) throw new Error(`unhandled ${method} ${url} in preflight test fixture`);
    return handler();
};
const jsonReply = (body, headers, status = 200) => () => ({
    status, text: async () => body, headers: new Headers(headers),
});

const baseRoutes = {
    'GET https://explorer.example/TBTC/api/status': jsonReply(
        HEALTHY['https://explorer.example/TBTC/api/status'],
        { 'access-control-allow-origin': PREFLIGHT_ORIGIN },
    ),
    'GET https://hub.example/api/v1/chain-registry': jsonReply('{}', { 'access-control-allow-origin': '*' }),
};

// The encoder's GET and CORS are both fine; only its preflight - the hub's
// exact measured shape - is blocked. A reviewer's balance screen would load
// and the send button would still be dead.
const encoderPreflightBlocked = await checkDemoEndpoints({
    descriptors: FAKE,
    origin: PREFLIGHT_ORIGIN,
    fetchImpl: methodRouted({
        ...baseRoutes,
        'GET https://encoder.example/TBTC/status': jsonReply(ENCODER_OK, { 'access-control-allow-origin': PREFLIGHT_ORIGIN }),
        'OPTIONS https://encoder.example/TBTC/': jsonReply('', {}),
        'POST https://hub.example/': jsonReply(RPC_PONG, { 'access-control-allow-origin': PREFLIGHT_ORIGIN }),
        'OPTIONS https://hub.example/': jsonReply('', { 'access-control-allow-origin': PREFLIGHT_ORIGIN, 'access-control-allow-methods': 'POST' }),
    }),
});
const encoderPfResult = encoderPreflightBlocked.results.find((r) => r.service === 'encoder');
assert.equal(encoderPfResult.state, 'failure', 'a healthy encoder with a healthy GET is still unreachable from the app if its preflight is blocked');
assert.match(encoderPfResult.detail, /UNREACHABLE FROM THE APP/, 'the register matches row 67s so a blocked preflight cannot be read as a warning');
assert.match(encoderPfResult.detail, /the browser never sends the POST at all/, 'the message has to say plainly that the POST never leaves the device');
assert.equal(encoderPreflightBlocked.exit, EXIT.FAILURE, 'a preflight-only failure still has to fail the exit code, or `echo $?` lies');
assert.equal(
    encoderPreflightBlocked.results.find((r) => r.service === 'hub-rpc').state,
    'live',
    'the hub-rpc probe passes on its own in this fixture, which isolates the encoder failure above from a coincidence',
);

// The hub: GET carries a real ACAO (it would pass corsVerdict() alone) but the
// preflight carries none. This is the split row 69 exists to catch, and it
// must not be excused by the GET having gone fine.
const hubPreflightBlocked = await checkDemoEndpoints({
    descriptors: FAKE,
    origin: PREFLIGHT_ORIGIN,
    fetchImpl: methodRouted({
        ...baseRoutes,
        'GET https://encoder.example/TBTC/status': jsonReply(ENCODER_OK, { 'access-control-allow-origin': PREFLIGHT_ORIGIN }),
        'OPTIONS https://encoder.example/TBTC/': jsonReply('', { 'access-control-allow-origin': PREFLIGHT_ORIGIN, 'access-control-allow-methods': 'GET,HEAD,PUT,PATCH,POST,DELETE' }),
        'POST https://hub.example/': jsonReply(RPC_PONG, { 'access-control-allow-origin': PREFLIGHT_ORIGIN }),
        'OPTIONS https://hub.example/': jsonReply('', {}),
    }),
});
const hubPfResult = hubPreflightBlocked.results.find((r) => r.service === 'hub-rpc');
assert.equal(hubPfResult.state, 'failure', 'a passing GET does not excuse a blocked preflight: they are different requests, and only the preflight guards the POST');
assert.match(hubPfResult.detail, /the preflight is blocked/);
assert.doesNotMatch(hubPfResult.detail, /ALSO blocked/, 'this fixture only breaks the preflight, not the GET, so the doubled wording must not appear here');
assert.equal(
    hubPreflightBlocked.results.find((r) => r.service === 'encoder').state,
    'live',
    'a healthy encoder whose GET and preflight both pass stays live',
);

// A service whose preflight answers Allow-Methods without POST in it.
const noPostRun = await checkDemoEndpoints({
    descriptors: FAKE,
    origin: PREFLIGHT_ORIGIN,
    fetchImpl: methodRouted({
        ...baseRoutes,
        'GET https://encoder.example/TBTC/status': jsonReply(ENCODER_OK, { 'access-control-allow-origin': PREFLIGHT_ORIGIN }),
        'OPTIONS https://encoder.example/TBTC/': jsonReply('', { 'access-control-allow-origin': PREFLIGHT_ORIGIN, 'access-control-allow-methods': 'GET,HEAD' }),
        'POST https://hub.example/': jsonReply(RPC_PONG, { 'access-control-allow-origin': PREFLIGHT_ORIGIN }),
        'OPTIONS https://hub.example/': jsonReply('', { 'access-control-allow-origin': PREFLIGHT_ORIGIN, 'access-control-allow-methods': 'POST' }),
    }),
});
assert.equal(noPostRun.results.find((r) => r.service === 'encoder').state, 'failure', 'Allow-Methods that never names POST is a failure even with a correct ACAO');

// 4. The request itself has to carry the three preflight headers - row 67's
// own trap, one probe over. Row 67 deleted the outgoing Origin and every
// reply-side assertion stayed green, because its fixtures answered with CORS
// headers regardless of what was actually asked. The fixture below does the
// same thing on purpose (every OPTIONS gets a fully-permissive reply no
// matter what it was asked) so that ONLY an assertion on the outgoing request
// can catch a preflight that stopped being issued, or that dropped one of its
// two request headers.
const preflightRequests = [];
const fullRun = await checkDemoEndpoints({
    descriptors: FAKE,
    origin: PREFLIGHT_ORIGIN,
    fetchImpl: async (url, init = {}) => {
        if (init.method === 'OPTIONS') preflightRequests.push({ url, headers: init.headers ?? {} });
        const body = url.includes('encoder') ? ENCODER_OK : (init.method === 'POST' ? RPC_PONG : '{}');
        return {
            status: 200,
            text: async () => body,
            headers: new Headers({ 'access-control-allow-origin': PREFLIGHT_ORIGIN, 'access-control-allow-methods': 'POST' }),
        };
    },
});
assert.equal(preflightRequests.length, 2, 'exactly one preflight per POST-load-bearing service (the encoder and hub-rpc), not more, not zero');
for (const req of preflightRequests) {
    assert.equal(req.headers.origin, PREFLIGHT_ORIGIN, 'the preflight must carry the shell Origin, or it measures curl\'s CORS posture, not the app\'s');
    assert.equal(req.headers['access-control-request-method'], 'POST', 'without this header the server has no way to know a POST is coming, and it is not a preflight at all');
    assert.equal(req.headers['access-control-request-headers'], 'content-type', 'the demo POST sends a JSON content-type; the preflight must ask permission for the exact header it will send');
}
assert.deepEqual(
    preflightRequests.map((r) => r.url).sort(),
    ['https://encoder.example/TBTC/', 'https://hub.example/'].sort(),
    'the preflight has to target the exact POST path (trailing slash on the encoder), not the /status GET path',
);
assert.ok(fullRun); // the run itself must complete without throwing on this fixture

// --- The verb has to match the call it stands in for (row 72) -----------
//
// The hub's JSON-RPC root answers TWO different resources at one URL: a POST
// is proxied to the app, a GET is served from the vhost's DocumentRoot as a
// static landing page. This gate used to GET it and read that landing page's
// (absent) CORS headers, which on 2026-08-08 reported the hub UNREACHABLE FROM
// THE APP on the same day every request the wallet issues to it started
// working. Row 67's blind spot inverted: that one asserted nothing about a
// relationship the app depends on, this one asserted on a relationship the app
// does not have. Both are the same root cause, and this is the guard for it.

const HUB_LANDING_PAGE = '<!DOCTYPE html><html><body>XChain Hub</body></html>';
const productionShapedHub = {
    // Exactly what the origin serves today, measured: the GET is HTML with no
    // ACAO at all, the POST is JSON-RPC with the shell origin echoed, and the
    // preflight is row 70's repaired 204.
    'GET https://hub.example/': jsonReply(HUB_LANDING_PAGE, {}),
    'POST https://hub.example/': jsonReply(RPC_PONG, { 'access-control-allow-origin': PREFLIGHT_ORIGIN }),
    'OPTIONS https://hub.example/': jsonReply('', {
        'access-control-allow-origin': PREFLIGHT_ORIGIN, 'access-control-allow-methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
    }, 204),
    'GET https://encoder.example/TBTC/status': jsonReply(ENCODER_OK, { 'access-control-allow-origin': PREFLIGHT_ORIGIN }),
    'OPTIONS https://encoder.example/TBTC/': jsonReply('', {
        'access-control-allow-origin': PREFLIGHT_ORIGIN, 'access-control-allow-methods': 'POST',
    }, 204),
};
const hubVerbRequests = [];
const hubVerbRun = await checkDemoEndpoints({
    descriptors: FAKE,
    origin: PREFLIGHT_ORIGIN,
    fetchImpl: async (url, init = {}) => {
        hubVerbRequests.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
        return methodRouted({ ...baseRoutes, ...productionShapedHub })(url, init);
    },
});
const hubVerbResult = hubVerbRun.results.find((r) => r.service === 'hub-rpc');
assert.equal(
    hubVerbResult.state, 'live',
    'a hub whose POST and preflight both carry the shell origin is reachable from the app, whatever its landing page serves',
);
assert.equal(
    hubVerbRun.results.find((r) => r.service === 'encoder').state, 'live',
    'and the encoder beside it stays live, so the hub verdict above is not riding on a fixture that passes everything',
);
// The run's own exit stays FAILURE here, and deliberately: baseRoutes answers
// the registry route with an unsignable body, which no offline fixture can
// forge. Asserting exit 0 would mean asserting a signature this file cannot
// produce, so the verdict under test is read off the hub-rpc row itself.

// The landing page must not be fetched AT ALL. Asserted on the outgoing
// request rather than on the verdict: leaving the GET in and merely ignoring
// its headers would pass every reply-side check above while still spending a
// request on a resource this gate has no question about, and the next reader
// would take its presence as evidence that it means something.
const hubRootRequests = hubVerbRequests.filter((r) => r.url === 'https://hub.example/');
assert.ok(hubRootRequests.length > 0, 'the hub JSON-RPC root was never probed at all');
assert.deepEqual(
    hubRootRequests.map((r) => r.method).sort(),
    ['OPTIONS', 'POST'],
    'the JSON-RPC root gets exactly its preflight and its POST: a GET there is a different resource (the static'
    + ' landing page) and reading a POST-only surface\'s CORS posture off it is the whole of row 72',
);
const hubPost = hubRootRequests.find((r) => r.method === 'POST');
assert.equal(hubPost.headers.origin, PREFLIGHT_ORIGIN, 'the POST must carry the shell Origin, or it measures curl\'s posture again');
assert.equal(
    hubPost.headers['content-type'], 'application/json',
    'the SDK POSTs JSON, and it is that content-type which makes the request non-simple and gives the preflight something to be about',
);
const hubPostBody = JSON.parse(hubPost.body);
assert.equal(
    hubPostBody.method, 'ping',
    'the probe sends the method the wallet\'s own reachability check sends (sdk.pingHub()), so a pass means the app can talk to the hub',
);
assert.notEqual(
    hubPostBody.method, 'getallconfigs',
    'getallconfigs is the hub\'s one sensitive read (it returns every service\'s DB credentials) and answers 401 to any'
    + ' client without HUB_API_KEY, which the shipped wallet correctly does not carry: probing it would paint'
    + ' working-as-designed red',
);

// And the failures on that POST still have to land. A JSON-RPC surface that
// answers the ping with an error, or that is answered by the static root
// instead of being proxied, is a hub the app cannot use.
const hubRpcOnly = (hubRoutes) => methodRouted({
    ...baseRoutes,
    ...productionShapedHub,
    ...hubRoutes,
});
const hubRefuses = await checkDemoEndpoints({
    descriptors: FAKE,
    origin: PREFLIGHT_ORIGIN,
    fetchImpl: hubRpcOnly({
        'POST https://hub.example/': jsonReply(
            JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'Unauthorized' } }),
            { 'access-control-allow-origin': PREFLIGHT_ORIGIN }, 401,
        ),
    }),
});
const refusedResult = hubRefuses.results.find((r) => r.service === 'hub-rpc');
assert.equal(refusedResult.state, 'failure', 'a hub that refuses the ping is a hub the reviewer\'s app sees as down');
assert.match(refusedResult.detail, /HTTP 401/, 'the status has to be in the message, or the operator cannot tell a refusal from an outage');
assert.match(refusedResult.detail, /POST/, 'and it has to say the verb, or the reader goes looking at the landing page');
assert.equal(hubRefuses.exit, EXIT.FAILURE);

const hubAnsweredByVhost = await checkDemoEndpoints({
    descriptors: FAKE,
    origin: PREFLIGHT_ORIGIN,
    fetchImpl: hubRpcOnly({
        'POST https://hub.example/': jsonReply(HUB_LANDING_PAGE, { 'access-control-allow-origin': PREFLIGHT_ORIGIN }),
    }),
});
const vhostResult = hubAnsweredByVhost.results.find((r) => r.service === 'hub-rpc');
assert.equal(vhostResult.state, 'failure', '200 with an HTML body means the vhost answered the POST rather than proxying it');
assert.match(vhostResult.detail, /not JSON/);

// A JSON-RPC 200 with no result member: the shape a stub or a half-deployed
// route produces, and it must not read as health.
const hubNoResult = await checkDemoEndpoints({
    descriptors: FAKE,
    origin: PREFLIGHT_ORIGIN,
    fetchImpl: hubRpcOnly({
        'POST https://hub.example/': jsonReply('{"jsonrpc":"2.0","id":1}', { 'access-control-allow-origin': PREFLIGHT_ORIGIN }),
    }),
});
assert.equal(hubNoResult.results.find((r) => r.service === 'hub-rpc').state, 'failure');

// And the CORS verdict now comes off the POST, which is the only reply a
// browser would ever read here. A POST with no ACAO is UNREACHABLE FROM THE
// APP even though the preflight beside it is perfect - the reverse of the
// row-69 split, and just as fatal.
const hubPostNoAcao = await checkDemoEndpoints({
    descriptors: FAKE,
    origin: PREFLIGHT_ORIGIN,
    fetchImpl: hubRpcOnly({
        'POST https://hub.example/': jsonReply(RPC_PONG, {}),
    }),
});
const postNoAcaoResult = hubPostNoAcao.results.find((r) => r.service === 'hub-rpc');
assert.equal(postNoAcaoResult.state, 'failure', 'the app cannot read a POST reply that carries no ACAO, whatever the preflight said');
assert.match(postNoAcaoResult.detail, /UNREACHABLE FROM THE APP/);

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
            replica_halted: { TBTC: false },
        })),
    }),
});
assert.equal(staleDemoRun.exit, EXIT.FAILURE);
assert.equal(staleDemoRun.results.find((r) => r.service === 'explorer').state, 'failure');

// A halted demo replica has to reach the EXIT CODE too, same property as the
// stale case above and the reason row 84's residue is a gate defect and not
// just a wording one: this is the exact 2026-08-10 shape (zero-ish lag, fresh
// clock) that this gate certified "live" twice, 22 minutes apart.
const haltedDemoRun = await checkDemoEndpoints({
    descriptors: FAKE,
    fetchImpl: routed({
        'https://explorer.example/TBTC/api/status': reply(JSON.stringify({
            available: { TBTC: 'BTC (testnet)' },
            last_block_time: { TBTC: nowSec - 60 },
            decoder_lag_blocks: { TBTC: 0 },
            replica_halted: { TBTC: true },
        })),
    }),
});
assert.equal(haltedDemoRun.exit, EXIT.FAILURE, 'a halted demo replica fails the run even at zero lag and a fresh clock');
const haltedDemoResult = haltedDemoRun.results.find((r) => r.service === 'explorer');
assert.equal(haltedDemoResult.state, 'failure');
assert.match(haltedDemoResult.detail, /HALT/);

// A halted NON-demo chain stays live and the demo path still passes: the same
// "reported, never held over" property already pinned for a stale non-demo
// chain, one signal over.
const haltedOtherFake = [
    { ...FAKE[0], coin: 'dogecoin' },
];
const haltedOtherRun = await checkDemoEndpoints({
    descriptors: haltedOtherFake,
    fetchImpl: async (url, init = {}) => {
        if (url.includes('/api/status')) {
            return {
                status: 200,
                text: async () => JSON.stringify({
                    available: { TDOGE: 'a network' },
                    last_block_time: { TDOGE: nowSec - 60 },
                    decoder_lag_blocks: { TDOGE: 0 },
                    replica_halted: { TDOGE: true },
                }),
            };
        }
        if (url.endsWith('/status')) return { status: 200, text: async () => HEALTHY['https://encoder.example/TBTC/status'] };
        if (init.method === 'POST') return { status: 200, text: async () => RPC_PONG };
        return { status: 200, text: async () => '{}' };
    },
});
const haltedOtherResult = haltedOtherRun.results.find((r) => r.service === 'explorer');
assert.equal(haltedOtherResult.state, 'live', 'a halted chain nobody funds is information, not a blocker for the demo path');
assert.match(haltedOtherResult.detail, /NOT FUNDABLE/);
assert.match(haltedOtherResult.detail, /HALT/);

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
// three chains is not one request.
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

// A CLEAN burst must SAY what it measured. These hosts sit on the zone's
// twelve-hostname rate-limit skip, so an unthrottled burst measures the skip
// and says nothing about the limit under it - and the 2026-08-02 run was read
// as evidence it did, because a clean burst produced no row at all.
const cleanBurst = await checkDemoEndpoints({
    descriptors: FAKE,
    burst: 4,
    fetchImpl: routed({}),
});
const cleanRow = cleanBurst.results.find((r) => r.service === 'rate-limit');
assert.ok(cleanRow, 'a clean burst still reports what it measured rather than staying silent');
assert.equal(cleanRow.state, 'live');
assert.match(
    cleanRow.detail,
    /measures the SKIP, not the limit/,
    'a clean burst must not be readable as proof the limit is survivable',
);

// "N requests came back 200" is not a rate. How long the burst took decides
// whether it was ever a test of a limit, so the elapsed time and the observed
// rate travel with the result.
assert.equal(typeof burstFine.elapsedMs, 'number');
assert.ok(Number.isFinite(burstFine.ratePerSec), 'the observed rate must be a finite number');

// `--burst` with no count parses to 'auto', which main() resolves from the
// measured cold-open. Reaching the run with it unresolved would compare
// 'auto' > 0, come back false, and skip the burst in SILENCE.
await assert.rejects(
    () => checkDemoEndpoints({ descriptors: FAKE, burst: 'auto', fetchImpl: routed({}) }),
    /burst must be a number/,
    'an unresolved burst size must fail loudly rather than skip the burst',
);

// The default burst size is DERIVED from the wallet's own cold-open, not the
// undefended 8 it used to be. Asserted through the gate's own accessor so the
// two tools cannot drift apart.
const measuredBurst = await defaultBurstCount();
assert.ok(
    Number.isInteger(measuredBurst) && measuredBurst > 0,
    'the default burst size must be a measured positive integer',
);
assert.equal(
    measuredBurst,
    await coldOpenBurstSize(),
    'the gate\'s default burst must be the cold-open profiler\'s number, not a copy of it',
);

console.log(
    'OK: demo-endpoint gate smoke (probe list derived from the shipped testnet descriptors and'
    + ' deduplicated; 403 is a failure that names and 429 one that names; a 200 is not a pass on'
    + ' its own, since the hub signature, the explorer available-networks map and the encoder tracker-sync flag'
    + ' each turn a healthy-looking response into the failure a reviewer would hit; inconclusive never becomes a'
    + ' pass and a failure outranks it; the opt-in burst is the only probe that can see a rate limit, its default'
    + ' size is the measured wallet cold-open rather than a round number, and a CLEAN burst says so rather than'
    + ' staying silent, because these hosts are on the zone rate-limit skip and an unthrottled burst measures the'
    + ' skip; the encoder'
    + ' and hub-rpc probes also send a CORS preflight at the exact POST path the SDK uses, trailing slash'
    + ' included, and a blocked preflight is a FAILURE named UNREACHABLE FROM THE APP even when the reply beside'
    + ' it is healthy, asserted on the outgoing OPTIONS request itself so a dropped header cannot hide behind a'
    + ' permissive fixture; and the hub JSON-RPC root is probed with the ping POST the wallet itself sends and'
    + ' never with a GET, because a GET there is the vhost static landing page, a different resource whose absent'
    + ' CORS headers reported the hub unreachable while every call the app makes worked)',
);
