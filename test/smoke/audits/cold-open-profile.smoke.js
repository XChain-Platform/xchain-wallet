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
// a host on the rule-9 skip measures the skip; the client's own demand is
// measurable here, offline, and it is the number every rate limit on the
// wallet's path is derived from (rate-limits spec §3.4).
//
// Six properties, and they are all about the number not being a story
// somebody told:
//
// 1. The fan-out is DRIVEN out of the real flows, so it moves when they do.
// 2. The measurement SENDS NOTHING, asserted at the socket and at fetch.
// 3. The proof fan-out is measured (it was the profile's blind spot) and does
//    not re-fire on a poll whose (chain, address, token) set is unchanged.
// 4. An alt-tab costs one poll after the data has aged, none before.
// 5. Both zone rules and the rule-9 skip list are transcribed as measured,
//    and the wallet's explorer paths are counted where the rules count them.
// 6. The cadences the wallet repeats on are read from the app's own
//    constants, not copied.

import { strict as assert } from 'node:assert';
import http from 'node:http';
import https from 'node:https';

import {
    measureColdOpen, coldOpenProfile, coldOpenBurstSize, busiestHost, driveRefocus, routeFamily,
    ZONE_RULES, RATE_LIMIT_SKIP_HOSTS, ATTEMPTS_PER_CALL, COUNTING_PERIOD_SEC,
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

// The badge hook's scan is its own step, on its own interval, and it repeats.
assert.ok(oneAddress.byStep['coinpay-badge'] > 0, 'the badge\'s first scan is part of the cold-open');
assert.equal(oneAddress.badgeRequests.length, oneAddress.byStep['coinpay-badge'], 'the badge repeat is the same scan');
assert.equal(oneAddress.badgeIntervalMs, COINPAY_BADGE_POLL_MS, 'the badge cadence is the hook\'s own constant');

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

// --- 5. The zone rules and the skip are transcribed as measured ----------

const general = ZONE_RULES.find((r) => r.name === 'General Rate Limit');
const api = ZONE_RULES.find((r) => r.name === 'API Rate Limit');
assert.ok(general && api, 'both zone rules must be recorded');
assert.deepEqual(
    [general.threshold, general.periodSec, api.threshold, api.periodSec],
    [90, 60, 30, 60],
    'both rules are one-minute windows (90 and 30), not the "req/sec" their names suggest',
);
assert.equal(general.matches('/icon/favicon.png'), false, 'the General rule excludes /icon/');
assert.equal(general.matches('/'), true);

// The wallet's explorer calls are /{COIN}/api/..., NOT /api/..., so the API
// rule does not see them and the General rule is the one that would bind.
assert.equal(api.matches('/TBTC/api/balances/tb1qexample'), false);
assert.equal(general.matches('/TBTC/api/balances/tb1qexample'), true);
assert.equal(api.matches('/api/v1/chain-registry'), true);

assert.equal(RATE_LIMIT_SKIP_HOSTS.length, 14, 'custom rule 9 names fourteen hosts');
for (const h of ['explorer.xchain.io', 'hub.xchain.io', 'encoder.xchain.io']) {
    assert.ok(RATE_LIMIT_SKIP_HOSTS.includes(h), `${h} is on the rule-9 skip today`);
}
assert.ok(!RATE_LIMIT_SKIP_HOSTS.includes('wallet.xchain.io'), 'the wallet SPA host is NOT on the skip');

// --- 6. The arithmetic, and the multipliers it rests on -------------------

assert.equal(
    ATTEMPTS_PER_CALL,
    1 + DEFAULT_SDK_NETWORK_OPTIONS.retry.maxRetries,
    'the retry multiplier must track the wallet\'s own SDK network policy',
);

const profile = coldOpenProfile(oneAddress, { headroom: 3 });
assert.equal(profile.periodSec, COUNTING_PERIOD_SEC);
assert.equal(profile.recurringIntervalMs, BALANCE_POLL_INTERVAL_MS, 'the repeat cadence is the app\'s own constant');

// As the zone is configured today, every host the wallet's API traffic lands
// on is on the rule-9 skip, so the two edge rules count NONE of it. If this
// starts failing, the skip was narrowed (M2) and the recorded list is stale.
const generalRow = profile.rules.find((r) => r.rule === 'General Rate Limit');
assert.equal(generalRow.matched, 0, 'today the General rule counts nothing the wallet\'s API traffic does');
assert.equal(generalRow.skipped, oneAddress.total, 'every API request is on a skip-listed host');
assert.equal(generalRow.fitsToday, true);

// The per-host edge requirement is the whole cold-open times retries times
// headroom, on the hosts the wallet actually reached.
assert.deepEqual(profile.edge.hosts, ['explorer.xchain.io', 'hub.xchain.io']);
assert.equal(profile.edge.burst, oneAddress.total);
assert.equal(profile.edge.required, oneAddress.total * ATTEMPTS_PER_CALL * 3);

// The per-poll figures are per chain per address, so a fourth chain cannot
// fail this: two balance reads, one coinpay read, no proof reads.
assert.deepEqual(profile.perPoll, { balanceReadsPerAddress: 2, coinpayReadsPerAddress: 1, proofReadsPerAddress: 0 });

// The worst minute per route folds in every further poll and badge scan that
// fits in the minute after the cold-open.
const balancesRoute = profile.routes.find((r) => r.family === 'balances' && r.host.startsWith('explorer.'));
assert.ok(balancesRoute, 'the balances route is profiled');
const furtherPolls = Math.ceil(60_000 / BALANCE_POLL_INTERVAL_MS) - 1;
assert.equal(balancesRoute.worstMinute, balancesRoute.coldOpen + balancesRoute.perPoll * furtherPolls);
const coinpayRoute = profile.routes.find((r) => r.family === 'coinpay');
const furtherBadge = Math.ceil(60_000 / COINPAY_BADGE_POLL_MS) - 1;
assert.equal(coinpayRoute.worstMinute,
    coinpayRoute.coldOpen + coinpayRoute.perPoll * furtherPolls + coinpayRoute.perBadge * furtherBadge);
assert.equal(balancesRoute.required, balancesRoute.worstMinute * ATTEMPTS_PER_CALL * 3);

console.log(
    'OK: cold-open profile smoke (the fan-out is driven out of the real balance, coinpay, proof and'
    + ' chain-registry flows and scales with addresses and tokens rather than being restated; every'
    + ' socket request is re-pointed at a refused loopback port and the light client\'s fetch is'
    + ' replaced, so profiling the load never adds it; the proof fan-out is measured and does not'
    + ' re-fire on a poll whose token set is unchanged; an alt-tab costs one poll after the data has'
    + ' aged and none before, driven through the shipped throttle; both zone rules are transcribed as'
    + ' one-minute windows with the fourteen-host rule-9 skip, under which today\'s edge rules count none'
    + ' of the wallet\'s API traffic; the per-host edge requirement and the per-route worst minute are'
    + ' derived with the wallet\'s own retry multiplier and poll constants)',
);
