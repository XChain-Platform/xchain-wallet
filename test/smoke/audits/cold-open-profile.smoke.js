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
// one wallet cold-open ASK FOR, on the paths the zone's two rate-limiting rules
// actually match? A burst fired at a host on the twelve-hostname skip measures
// the skip; the client's own demand is measurable here, offline, and it is the
// number the limits have to be raised above before the skip can be narrowed.
//
// Four properties, and they are all about the number not being a story
// somebody told:
//
// 1. The fan-out is DRIVEN out of the real flows, so it moves when they do. A
//    restated "three requests per address" would be wrong the day a flow adds
//    a fourth, and nothing would say so.
// 2. The measurement SENDS NOTHING. A tool that measured production load by
//    adding it would be its own worst input, and this one runs on every smoke
//    pass.
// 3. Both zone rules are transcribed with their real expressions, so the
//    per-rule counts land on the rule that would actually block them - the
//    wallet's explorer paths are /{COIN}/api/..., which the "/api/" rule does
//    NOT match, and reading that wrong would have the operator raising the
//    rule the traffic never touches.
// 4. The cadence the wallet re-runs the load on is read from the app's own
//    constant, not copied.

import { strict as assert } from 'node:assert';
import http from 'node:http';
import https from 'node:https';

import {
    measureColdOpen, coldOpenProfile, coldOpenBurstSize, busiestHost,
    ZONE_RULES, ATTEMPTS_PER_CALL, COUNTING_PERIOD_SEC, requestsPerPeriod,
} from '../../../tools/release/cold-open-profile.mjs';
import { DEFAULT_SDK_NETWORK_OPTIONS } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/descriptors/index.js';

// --- 1. Nothing leaves the process -------------------------------------
//
// Asserted at the socket layer rather than by reading the code, because a
// refactor can quietly stop suppressing and nothing else would notice until
// the smoke suite was quietly DDoSing production.
//
// The tool suppresses by re-pointing every request at a refused port on
// loopback, so the property is not "no socket was opened" but "no socket was
// opened to anything but loopback". Counting calls alone would pass on the day
// the rewrite stopped rewriting.
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

const oneAddress = await measureColdOpen({ networkKind: 'testnet', addressesPerChain: 1 });

http.request = realHttp;
https.request = realHttps;
assert.ok(destinations.length > 0, 'the measurement must actually exercise the HTTP clients');
const escaped = destinations.filter((h) => h !== '127.0.0.1');
assert.deepEqual(
    escaped,
    [],
    `the cold-open measurement must reach nothing but loopback (escaped to: ${escaped.join(', ')})`,
);

// --- 2. The fan-out is driven, not restated ----------------------------

assert.ok(oneAddress.total > 0, 'a cold-open must measure as some requests');
assert.ok(oneAddress.chains.length >= 3, 'the testnet profile covers every bundled testnet chain');

const fiveAddresses = await measureColdOpen({ networkKind: 'testnet', addressesPerChain: 5 });
assert.ok(
    fiveAddresses.total > oneAddress.total,
    'the fan-out must scale with addresses; a constant here means the count was restated',
);
// The per-address term is linear and nothing paces it, which is the reason a
// wallet with a handful of addresses is the case that decides the ceiling.
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
// a lazy hub discovery before its first service call. Those requests are
// invisible to the SDK's own onRequest hook, which is why this tool intercepts
// at the socket instead - an instrument that cannot see three requests per
// cold-open still reports a confident number.
const hubRequests = oneAddress.requests.filter((r) => r.host.startsWith('hub.'));
assert.ok(
    hubRequests.length > 1,
    'the hub takes the registry sync AND each chain\'s lazy discovery; only seeing one means'
    + ' the instrument is back to reading a hook that does not cover them',
);

// The repeat load is MEASURED by running the poll, not by classifying the
// first load's rows, and it is genuinely smaller: the registry sync is
// boot-only and each SDK's discovery memoizes.
assert.ok(oneAddress.recurringRequests.length > 0, 'the poll re-issues the balance load');
assert.ok(
    oneAddress.recurringRequests.length < oneAddress.total,
    'the repeat must be smaller than the cold-open; equal means the once-per-session calls were counted twice',
);
assert.ok(
    oneAddress.recurringRequests.every((r) => !r.host.startsWith('hub.')),
    'nothing hub-side repeats on the poll; if it does, the sustained profile is wrong',
);

// The three chains share one explorer hostname, which is the whole reason a
// cold-open concentrates rather than spreads.
const busiest = busiestHost(oneAddress);
assert.ok(busiest.count > 1, 'one host must take more than one request of a cold-open');
assert.equal(busiest.count, await coldOpenBurstSize(), 'the exported burst size is the busiest host\'s share');

// --- 3. The zone rules are transcribed, and match what they really match --

const general = ZONE_RULES.find((r) => r.name === 'General Rate Limit');
const api = ZONE_RULES.find((r) => r.name === 'API Rate Limit');
assert.ok(general && api, 'both zone rules must be recorded');

// The wallet's explorer calls are /{COIN}/api/..., NOT /api/..., so the API
// rule does not see them and the General rule is the one that binds. Getting
// this backwards would send an operator to raise a limit the wallet's busiest
// traffic never touches.
assert.equal(api.matches('/TBTC/api/balances/tb1qexample'), false);
assert.equal(general.matches('/TBTC/api/balances/tb1qexample'), true);
assert.equal(api.matches('/api/v1/chain-registry'), true);
assert.equal(general.matches('/api/v1/chain-registry'), true, 'the general rule matches every path, including API ones');

const explorerPaths = oneAddress.requests.filter((r) => r.host.startsWith('explorer.'));
assert.ok(explorerPaths.length > 0);
assert.ok(
    explorerPaths.every((r) => !api.matches(r.path)),
    'no explorer path may be classified under the API rule; they are /{COIN}/api/, not /api/',
);

// --- 4. The arithmetic, and the retry multiplier it rests on -----------

assert.equal(
    ATTEMPTS_PER_CALL,
    1 + DEFAULT_SDK_NETWORK_OPTIONS.retry.maxRetries,
    'the retry multiplier must track the wallet\'s own SDK network policy',
);
assert.equal(requestsPerPeriod(1.5, 10), 15, 'a req/sec figure is enforced as a count per counting period');

const profile = coldOpenProfile(oneAddress, { headroom: 2 });
assert.equal(profile.periodSec, COUNTING_PERIOD_SEC);
assert.equal(
    profile.recurringIntervalMs,
    BALANCE_POLL_INTERVAL_MS,
    'the repeat cadence must be the app\'s own constant, not a copy',
);

const generalRow = profile.rules.find((r) => r.rule === 'General Rate Limit');
assert.equal(generalRow.requiredPerPeriod, generalRow.matched * ATTEMPTS_PER_CALL * 2);
assert.equal(
    generalRow.fitsToday,
    generalRow.worstCasePerPeriod <= generalRow.allowedPerPeriod,
);
// The finding this whole row exists for: as the zone is configured today, one
// ordinary cold-open does not fit inside the General rule. If this ever passes
// without the limits having been raised, something under it changed and the
// recorded target profile is stale.
assert.equal(
    generalRow.fitsToday,
    false,
    'as recorded, the General rule is set below one wallet cold-open; if that changed, re-record the profile',
);

// Most of a cold-open is not a one-off spike: Home re-runs it on an interval
// for as long as the wallet is open, so a ceiling sized for a single burst is
// sized for the wrong thing.
assert.ok(
    generalRow.recurringPerCycle > 0 && generalRow.recurringPerCycle <= generalRow.worstCasePerPeriod,
    'the recurring share must be a real subset of the cold-open',
);

console.log(
    'OK: cold-open profile smoke (the fan-out is driven out of the real balance, coinpay and'
    + ' chain-registry flows and scales with addresses rather than being restated; every request it'
    + ' measures is re-pointed at a refused port on loopback, asserted at the http/https socket layer'
    + ' on the DESTINATION rather than the call count, so profiling the load never adds it; the hub'
    + ' takes each chain\'s lazy discovery on top of the registry sync, which the SDK\'s own request'
    + ' hook cannot see; the repeat load is measured by running the poll rather than by classifying'
    + ' the first load; every measured host is one a shipped descriptor names; both zone rules are'
    + ' transcribed with their real expressions and the wallet\'s /{COIN}/api/ explorer paths land under'
    + ' the General rule rather than the API one that never sees them; the retry multiplier tracks the'
    + ' wallet\'s own SDK network policy and the repeat cadence is the app\'s own poll constant; and one'
    + ' ordinary cold-open still does not fit inside the General rule as the zone is configured)',
);
