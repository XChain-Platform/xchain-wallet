// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for tools/release/cold-open-profile.mjs.
//
// The tool answers the question the burst probe structurally cannot: what does
// one honest wallet ASK FOR, per host, per route, per window? A burst fired at
// one endpoint can only see the limit it happens to trip; the client's own
// demand is measurable here, offline, and it is the number every rate limit on
// the wallet's path is derived from.
//
// Six properties, and they are all about the number not being a story
// somebody told:
//
// 1. The fan-out is DRIVEN out of the real flows, so it moves when they do.
// 2. The measurement SENDS NOTHING, asserted at the socket and at fetch.
// 3. The proof fan-out is measured (it was the profile's blind spot) and does
//    not re-fire on a poll whose (chain, address, token) set is unchanged.
// 4. An alt-tab costs one poll after the data has aged, none before.
// 5. Both zone rules and both skip lists are transcribed as read off the rule
//    editors, and the wallet's traffic is counted where the rules count it:
//    since the M2 edge change that is all of it under the API rule and none of
//    it under the General one.
// 6. The cadences the wallet repeats on are read from the app's own
//    constants, not copied.

import { strict as assert } from 'node:assert';
import http from 'node:http';
import https from 'node:https';

import {
    measureColdOpen, coldOpenProfile, coldOpenBurstSize, busiestHost, driveRefocus, routeFamily,
    ZONE_RULES, RATE_LIMIT_SKIP_HOSTS, SBFM_ONLY_SKIP_HOSTS, ATTEMPTS_PER_CALL, COUNTING_PERIOD_SEC,
} from '../../../tools/release/cold-open-profile.mjs';
import { DEFAULT_SDK_NETWORK_OPTIONS } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';
import { COINPAY_BADGE_POLL_MS } from '../../../packages/core/src/shared/hooks/useCoinpayObligations.js';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/descriptors/index.js';

// --- 1 + 2. Nothing leaves the process ----------------------------------
//
// Asserted at the socket layer AND at fetch rather than by reading the code,
// because a refactor can quietly stop suppressing and nothing else would
// notice until the smoke suite was quietly DDoSing production. The tool
// suppresses socket requests by re-pointing them at a refused port on
// loopback, so that property is "no socket was opened to anything but
// loopback"; it suppresses fetch by replacing it, so that property is "the
// real fetch was never called".
const destinations = [];
const realHttp = http.request;
const realHttps = https.request;
const watch = (real, mod) => (...args) => {
    const target = args[0];
    destinations.push(typeof target === 'string' || target instanceof URL
        ? new URL(String(target)).hostname
        : (target?.hostname ?? target?.host ?? 'unknown'));
    return real.apply(mod, args);
};
http.request = watch(realHttp, http);
https.request = watch(realHttps, https);
const realFetch = globalThis.fetch;
let realFetchCalls = 0;
globalThis.fetch = (...args) => { realFetchCalls += 1; return realFetch(...args); };

const oneAddress = await measureColdOpen({ networkKind: 'testnet', addressesPerChain: 1 });

http.request = realHttp;
https.request = realHttps;
assert.equal(globalThis.fetch !== realFetch, true, 'the tool must restore the fetch it found (ours)');
globalThis.fetch = realFetch;
assert.ok(destinations.length > 0, 'the measurement must actually exercise the HTTP clients');
const escaped = destinations.filter((h) => h !== '127.0.0.1');
assert.deepEqual(
    escaped,
    [],
    `the cold-open measurement must reach nothing but loopback (escaped to: ${escaped.join(', ')})`,
);
assert.equal(realFetchCalls, 0, 'the light client\'s fetch must be replaced for the proof step, never called');

// --- 1. The fan-out is driven, not restated ----------------------------

assert.ok(oneAddress.total > 0, 'a cold-open must measure as some requests');
assert.ok(oneAddress.chains.length >= 3, 'the testnet profile covers every bundled testnet chain');

const fiveAddresses = await measureColdOpen({ networkKind: 'testnet', addressesPerChain: 5 });
assert.ok(
    fiveAddresses.total > oneAddress.total,
    'the fan-out must scale with addresses; a constant here means the count was restated',
);
const perAddressStep = (fiveAddresses.byStep['wallet-balances'] - oneAddress.byStep['wallet-balances'])
    / (5 - 1) / oneAddress.chains.length;
assert.ok(perAddressStep >= 2, 'each address costs at least a token read and a native-coin read');

// Every measured request must land on a host a SHIPPED descriptor names. Same
// property the demo gate pins: a profile of hosts the build stopped using
// would size the limits for traffic that no longer exists.
const shippedHosts = new Set(
    BUNDLED_DESCRIPTORS.flatMap((d) => [d.explorer.defaultUrl, d.encoder.defaultUrl, d.hub.defaultUrl])
        .map((u) => new URL(u).host),
);
for (const r of oneAddress.requests) {
    assert.ok(shippedHosts.has(r.host), `measured host ${r.host} is named by no shipped descriptor`);
}

// The hub takes MORE than the one chain-registry sync: every SDK instance runs
// a lazy hub discovery before its first service call, invisible to the SDK's
// own onRequest hook, which is why this tool intercepts at the socket.
const hubRequests = oneAddress.requests.filter((r) => r.host.startsWith('hub.'));
assert.ok(hubRequests.length > 1, 'the hub takes the registry sync AND each chain\'s lazy discovery');

// The repeat load is MEASURED by running the poll, and it is genuinely
// smaller: the registry sync is boot-only, discovery memoizes, and the proof
// fan-out does not re-fire.
assert.ok(oneAddress.recurringRequests.length > 0, 'the poll re-issues the balance load');
assert.ok(
    oneAddress.recurringRequests.length < oneAddress.total,
    'the repeat must be smaller than the cold-open; equal means the once-per-session calls were counted twice',
);
assert.ok(
    oneAddress.recurringRequests.every((r) => !r.host.startsWith('hub.')),
    'nothing hub-side repeats on the poll; if it does, the sustained profile is wrong',
);

// The shared hook's scan is its own step, on its own interval, and it repeats.
assert.ok(oneAddress.byStep['coinpay-badge'] > 0, 'the badge\'s first scan is part of the cold-open');
assert.equal(oneAddress.badgeRequests.length, oneAddress.byStep['coinpay-badge'], 'the badge repeat is the same scan');
assert.equal(oneAddress.badgeIntervalMs, COINPAY_BADGE_POLL_MS, 'the badge cadence is the hook\'s own constant');
// ...and it is the ONLY coinpay step. Before spec row 29 Home ran a second,
// identical scan of its own (step 'coinpay-obligations', on the 20 s balance
// beat); the provider's shared rows replaced it, so a cold-open
// carrying that step again means the duplicate scan is back.
assert.equal(oneAddress.byStep['coinpay-obligations'], undefined,
    'Home must not run a coinpay scan of its own; the shared hook is the tree\'s only one');

const busiest = busiestHost(oneAddress);
assert.ok(busiest.count > 1, 'one host must take more than one request of a cold-open');
assert.equal(busiest.count, await coldOpenBurstSize(), 'the exported burst size is the busiest host\'s share');

// --- 3. Proof verification is measured, and does not re-fire per poll ----

assert.ok(oneAddress.byStep['proof-verification'] > 0, 'the proof fan-out must be measured; it was the blind spot');
assert.equal(oneAddress.proof.jobs, oneAddress.chains.length * 1 * 1, 'one job per (chain, address, token)');
assert.ok(oneAddress.proof.readsPerJob >= 1 && oneAddress.proof.readsPerJob <= 2,
    'a proof job is one read (cached validator set) or two (uncached); anything else is a new path');
assert.equal(oneAddress.proof.refiresOnPoll, false,
    'an equal (chain, address, token) set under a new object identity must not re-fire the fan-out');
assert.ok(
    oneAddress.recurringRequests.every((r) => routeFamily(r) !== 'proof' && routeFamily(r) !== 'checkpoint-verify'),
    'no proof or checkpoint read may repeat on the poll',
);
const twoTokens = await measureColdOpen({ networkKind: 'testnet', addressesPerChain: 1, tokensPerAddress: 2 });
assert.equal(twoTokens.proof.jobs, 2 * oneAddress.proof.jobs, 'proof jobs scale with tokens per address');
const noTokens = await measureColdOpen({ networkKind: 'testnet', addressesPerChain: 1, tokensPerAddress: 0 });
assert.equal(noTokens.proof.reads, 0, 'no tokens, no proof reads');

// --- 4. An alt-tab costs one poll, and only once the data has aged --------

assert.deepEqual(
    { inside: oneAddress.refocus.insideWindow, after: oneAddress.refocus.afterWindow },
    { inside: 0, after: 1 },
    'focus + visibilitychange together: no poll inside the interval, exactly one after it',
);
assert.equal(oneAddress.refocus.intervalMs, BALANCE_POLL_INTERVAL_MS);
assert.deepEqual(driveRefocus(1000), { intervalMs: 1000, insideWindow: 0, afterWindow: 1 });

// --- 5. The zone rules and both skips are transcribed as read ------------

const API_HOSTS = ['explorer.xchain.io', 'hub.xchain.io', 'encoder.xchain.io'];

const general = ZONE_RULES.find((r) => r.name === 'General Rate Limit');
const api = ZONE_RULES.find((r) => r.name === 'API Rate Limit');
assert.ok(general && api, 'both zone rules must be recorded');
assert.deepEqual(
    [general.threshold, general.periodSec, api.threshold, api.periodSec],
    [90, 60, 564, 10],
    'the General rule is 90 per minute and the API rule 564 per 10 seconds, the plan\'s shortest window',
);
assert.equal(api.action, 'Block 429, 10 seconds', 'the API rule\'s mitigation is the 10 s minimum, not a minute');
assert.equal(general.matches('/icon/favicon.png', 'wallet.xchain.io'), false, 'the General rule excludes /icon/');
assert.equal(general.matches('/', 'wallet.xchain.io'), true);

// Since M2 the API rule matches by HOSTNAME, and the General rule excludes the
// same three hosts so it cannot bite the wallet's API traffic first. The
// wallet's explorer calls are /{COIN}/api/..., which the old path expression
// never saw at all, so a rule that still keyed on the path would count none of
// the traffic it exists to bound.
for (const h of API_HOSTS) {
    assert.equal(api.matches('/TBTC/api/balances/tb1qexample', h), true, `the API rule counts ${h} by host`);
    assert.equal(general.matches('/TBTC/api/balances/tb1qexample', h), false, `the General rule excludes ${h}`);
    assert.ok(api.expression.includes(`"${h}"`), `the printed API expression names ${h}`);
    assert.ok(general.expression.includes(`"${h}"`), `the printed General expression names ${h} in its exclusion`);
}
assert.equal(api.matches('/api/v1/chain-registry', 'wallet.xchain.io'), false,
    'the API rule is not a path rule any more: an /api/ path on another host is the General rule\'s');
assert.equal(general.matches('/api/v1/chain-registry', 'wallet.xchain.io'), true);

// The two skips are different skips, and confusing them puts the wallet's
// ceiling back at "none": rule 9 skips ALL rate limiting on the eleven hosts it
// kept, rule 10 skips Super Bot Fight Mode alone on the three API hosts.
assert.equal(RATE_LIMIT_SKIP_HOSTS.length, 11, 'custom rule 9 names eleven hosts since the API hosts came off it');
for (const h of API_HOSTS) {
    assert.ok(!RATE_LIMIT_SKIP_HOSTS.includes(h), `${h} is NOT on the rate-limit skip any more`);
    assert.ok(SBFM_ONLY_SKIP_HOSTS.includes(h), `${h} is on custom rule 10's SBFM-only skip`);
}
assert.equal(SBFM_ONLY_SKIP_HOSTS.length, 3, 'rule 10 names the three API hosts and nothing else');
assert.ok(!RATE_LIMIT_SKIP_HOSTS.includes('wallet.xchain.io'), 'the wallet SPA host is NOT on the skip');
assert.ok(!SBFM_ONLY_SKIP_HOSTS.includes('wallet.xchain.io'), 'and it gets no SBFM skip either');

// --- 6. The arithmetic, and the multipliers it rests on -------------------

assert.equal(
    ATTEMPTS_PER_CALL,
    1 + DEFAULT_SDK_NETWORK_OPTIONS.retry.maxRetries,
    'the retry multiplier must track the wallet\'s own SDK network policy',
);

const profile = coldOpenProfile(oneAddress, { headroom: 3 });
assert.equal(profile.periodSec, COUNTING_PERIOD_SEC);
assert.equal(profile.recurringIntervalMs, BALANCE_POLL_INTERVAL_MS, 'the repeat cadence is the app\'s own constant');

// The split the M2 rules were reshaped to produce: the API rule counts EVERY
// request the profiled wallet makes and the General rule counts none, so exactly
// one ceiling applies to the wallet and it is the one sized from this profile.
// Nothing the wallet touches is on a rate-limit skip any more, so `skipped` is
// zero; a non-zero one here means an API host went back onto rule 9.
const generalRow = profile.rules.find((r) => r.rule === 'General Rate Limit');
const apiRow = profile.rules.find((r) => r.rule === 'API Rate Limit');
assert.equal(apiRow.matched, oneAddress.total, 'the API rule counts every request of the session');
assert.equal(generalRow.matched, 0, 'the General rule counts none of the wallet\'s API traffic');
assert.equal(apiRow.skipped, 0, 'no request of this session is skipped by rule 9 any more');
assert.equal(generalRow.skipped, 0);
assert.equal(apiRow.worstCasePerPeriod, oneAddress.total * ATTEMPTS_PER_CALL, 'retries are counted at the edge too');
assert.equal(apiRow.requiredPerPeriod, oneAddress.total * ATTEMPTS_PER_CALL * 3);
assert.equal(apiRow.fitsToday, true, 'one cold-open with retries fits under 564');
assert.equal(apiRow.clearsRequirement, true, 'and so does the same cold-open times the headroom multiplier');
assert.equal(generalRow.clearsRequirement, true);

// The API rule's requirement is the whole cold-open times retries times
// headroom, over ITS window (10 s, not the General rule's minute), on the hosts
// the wallet actually reached.
assert.equal(profile.edge.rule, 'API Rate Limit');
assert.deepEqual(profile.edge.hosts, ['explorer.xchain.io', 'hub.xchain.io']);
assert.equal(profile.edge.periodSec, api.periodSec, 'the burst is sized against the window the rule runs');
assert.equal(profile.edge.threshold, api.threshold);
assert.equal(profile.edge.burst, oneAddress.total);
assert.equal(profile.edge.required, oneAddress.total * ATTEMPTS_PER_CALL * 3);

// The verdict the tool exits on is the HEADROOM question, not the bare one: a
// requirement above the recorded threshold must come back false, or a rule set
// to admit exactly one wallet would still report OK. Driven by pushing the
// multiplier past the threshold rather than by editing the recorded rule.
const overHeadroom = coldOpenProfile(oneAddress, { headroom: 1000 });
const overApi = overHeadroom.rules.find((r) => r.rule === 'API Rate Limit');
assert.ok(overApi.requiredPerPeriod > overApi.threshold, 'the driven requirement must exceed the threshold here');
assert.equal(overApi.clearsRequirement, false, 'a requirement above the threshold is not cleared');
assert.equal(overApi.fitsToday, true, 'and the bare cold-open still fits, so the two verdicts are not the same one');

// The per-poll figures are per chain per address, so a fourth chain cannot
// fail this: two balance reads, NO coinpay read (spec row 29 moved the resume
// cards onto the shared hook, so the 20 s beat carries no coinpay traffic at
// all), no proof reads.
// Two honest shapes, decided by the SDK in node_modules: the flows feature-detect
// the batch reads, so the pinned SDK (no batch methods) still reads two per
// address, and the SDK that carries them reads one batch per chain and no
// per-address balance read at all. Each shape is pinned in full so the other
// cannot satisfy it.
assert.equal(typeof profile.batchSupported, 'boolean', 'the profile says which SDK shape it measured');
if (profile.batchSupported) {
    assert.deepEqual(profile.perPoll, { balanceReadsPerAddress: 0, batchBalanceReadsPerChain: 1, coinpayReadsPerAddress: 0, proofReadsPerAddress: 0 });
    assert.deepEqual(profile.badge, { coinpayReadsPerAddress: 0, coinpayBatchReadsPerChain: 1 });
} else {
    assert.deepEqual(profile.perPoll, { balanceReadsPerAddress: 2, batchBalanceReadsPerChain: 0, coinpayReadsPerAddress: 0, proofReadsPerAddress: 0 });
    assert.deepEqual(profile.badge, { coinpayReadsPerAddress: 1, coinpayBatchReadsPerChain: 0 });
}

// The worst minute per route folds in every further poll and badge scan that
// fits in the minute after the cold-open.
const furtherPolls = Math.ceil(60_000 / BALANCE_POLL_INTERVAL_MS) - 1;
const furtherBadge = Math.ceil(60_000 / COINPAY_BADGE_POLL_MS) - 1;
let balancesRoute;
if (profile.batchSupported) {
    // One family carries both batch POSTs: the beat's balance batches and the
    // badge's coinpay batches, one per chain each, and nothing per address.
    balancesRoute = profile.routes.find((r) => r.family === 'batch' && r.host.startsWith('explorer.'));
    assert.ok(balancesRoute, 'the batch route is profiled');
    assert.equal(balancesRoute.perPoll, oneAddress.chains.length, 'one balance batch per chain per poll');
    assert.equal(balancesRoute.perBadge, oneAddress.chains.length, 'one coinpay batch per chain per badge scan');
    assert.equal(balancesRoute.worstMinute,
        balancesRoute.coldOpen + balancesRoute.perPoll * furtherPolls + balancesRoute.perBadge * furtherBadge);
    assert.equal(profile.routes.find((r) => r.family === 'balances'), undefined, 'no per-address balance read is left');
    assert.equal(profile.routes.find((r) => r.family === 'coinpay'), undefined, 'no per-address coinpay read is left');
} else {
    balancesRoute = profile.routes.find((r) => r.family === 'balances' && r.host.startsWith('explorer.'));
    assert.ok(balancesRoute, 'the balances route is profiled');
    assert.equal(balancesRoute.worstMinute, balancesRoute.coldOpen + balancesRoute.perPoll * furtherPolls);
    const coinpayRoute = profile.routes.find((r) => r.family === 'coinpay');
    // The coinpay route's worst minute is now the cold-open scan plus the badge
    // repeats ONLY: its per-poll term is zero, so the formula below has to be
    // pinned with that term stated, or a coinpay read creeping back into Home's
    // beat would still satisfy it.
    assert.equal(coinpayRoute.perPoll, 0, 'no coinpay read rides the 20 s balance poll any more');
    assert.equal(coinpayRoute.worstMinute,
        coinpayRoute.coldOpen + coinpayRoute.perPoll * furtherPolls + coinpayRoute.perBadge * furtherBadge);
    assert.equal(coinpayRoute.worstMinute, coinpayRoute.coldOpen + coinpayRoute.perBadge * furtherBadge);
    assert.equal(profile.routes.find((r) => r.family === 'batch'), undefined, 'this SDK predates the batch route');
}
assert.equal(balancesRoute.required, balancesRoute.worstMinute * ATTEMPTS_PER_CALL * 3);

console.log(
    'OK: cold-open profile smoke (the fan-out is driven out of the real balance, coinpay, proof and'
    + ' chain-registry flows and scales with addresses and tokens rather than being restated; every'
    + ' socket request is re-pointed at a refused loopback port and the light client\'s fetch is'
    + ' replaced, so profiling the load never adds it; the proof fan-out is measured and does not'
    + ' re-fire on a poll whose token set is unchanged; an alt-tab costs one poll after the data has'
    + ' aged and none before, driven through the shipped throttle; both zone rules are transcribed as'
    + ' read off the rule editors, the General one at 90 per minute excluding the three API hosts and the'
    + ' API one at 564 per 10s matching them by hostname, with rule 9\'s rate-limit skip down to eleven'
    + ' hosts and rule 10\'s SBFM-only skip on the three, so the API rule counts every request of the'
    + ' session and the General rule counts none; the API rule\'s requirement and the per-route worst'
    + ' minute are derived with the wallet\'s own retry multiplier and poll constants)',
);
