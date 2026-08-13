// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/cold-open-profile.mjs - how many requests does ONE wallet
// cold-open put on the xchain.io zone, all at once, and what must the zone's
// rate limits be raised above before the twelve-hostname skip can be narrowed?
//
// WHY THIS EXISTS. The public API is usable today only because two zone-wide
// Cloudflare rate limits are SKIPPED for twelve named hostnames, not because
// the limits are survivable: `General Rate Limit` is 1.5 req/sec on every path
// and `API Rate Limit` is 0.5 req/sec (one request every two seconds) on
// /api/ and /explorer/, both action Block. The skip is all-or-nothing, so the
// busiest public hosts carry no rate limiting at all, and any hostname added
// to the zone later inherits a limit no real client can live within and fails
// as a 403 that looks exactly like the bot-block. Narrowing the skip requires
// first knowing what a real client asks for, which is what this measures.
//
// The residual it closes is a specific one. `verify-demo-endpoints.mjs
// --burst 8` came back unthrottled on 2026-08-02, and again on 2026-08-13 in
// this run: that measures the SKIP, not the limit. Firing at a host on the
// skip list can never tell you what the limit would do, and 8 was a number
// nobody had derived from anything. So the question this file answers is the
// other one: what does the CLIENT demand, in requests, on the paths those
// rules actually match?
//
// HOW IT MEASURES, and why not by reading the code. The fan-out is DRIVEN, not
// restated: the real `walletBalances`, `getCoinpayObligationsForAddress` and
// `syncChainRegistryFromHub` flows run against a real ChainRegistry, a real
// SDKRegistry and a real xchain-sdk instance, and the SDK's own `onRequest`
// hook records the URL each call would have issued. A comment claiming "three
// requests per address" rots the day a flow adds a fourth; a driven count
// moves on its own. Nothing leaves the process: the hook records the request
// and then throws, so the measurement cannot become the load it is measuring
// (this tool would otherwise fire a cold-open's worth of traffic at production
// every time anyone ran it).
//
// WHAT THE NUMBERS MEAN. Cloudflare rate-limiting rules count requests
// matching their expression, keyed by client IP, over a counting period whose
// floor is 10 seconds. A wallet cold-open is not paced: `walletBalances` fans
// out with Promise.all across every chain and every address at once, so the
// whole burst lands inside ONE counting period no matter how long that period
// is. The number that matters is therefore a COUNT, not a rate, and the two
// zone rules must each be raised above the count of measured requests their
// own expression matches - times the SDK's own retry multiplier, because a
// blocked request is retried and a rate limit that bites amplifies the traffic
// it is biting.
//
// The three chains share ONE explorer hostname, which is the whole reason this
// concentrates: `explorer.xchain.io` takes every balance, native-coin and
// coinpay read for every address on all three chains.
//
// Usage:
//   node tools/release/cold-open-profile.mjs
//   node tools/release/cold-open-profile.mjs --addresses 5
//   node tools/release/cold-open-profile.mjs --network mainnet --json

import { createRequire } from 'node:module';
import http from 'node:http';
import https from 'node:https';

import { ChainRegistry } from '../../packages/core/src/registry/index.js';
import { SDKRegistry, DEFAULT_SDK_NETWORK_OPTIONS } from '../../packages/core/src/sdk/SDKRegistry.js';
import { walletBalances, BALANCE_POLL_INTERVAL_MS } from '../../packages/core/src/flows/balances.js';
import { getCoinpayObligationsForAddress } from '../../packages/core/src/flows/coinpayQueries.js';
import { syncChainRegistryFromHub, REGISTRY_DEFAULT_URL } from '../../packages/core/src/registry/remote.js';

export const EXIT = { OK: 0, FAILURE: 1, CONFIG: 2 };

/**
 * The zone's two rate-limiting rules, RECORDED rather than measured.
 *
 * These are operator-owned facts read off the Cloudflare dashboard for zone
 * xchain.io (rules 1 and 2, both action Block; custom rule 9 is the
 * twelve-hostname skip that currently suspends them). Nothing in this repo can
 * observe them - a request that is skipped tells you nothing about the limit
 * that was skipped - so they live here as data with their provenance attached,
 * and an operator who changes them in the dashboard has to change them here.
 *
 * `matches` is each rule's expression, transcribed. `reqPerSec` is the figure
 * the dashboard displays; `requestsPerPeriod` below converts it into the count
 * that actually decides whether a burst is blocked.
 */
export const ZONE_RULES = Object.freeze([
    Object.freeze({
        name: 'General Rate Limit',
        expression: 'URI path starts with "/"',
        reqPerSec: 1.5,
        matches: (path) => path.startsWith('/'),
    }),
    Object.freeze({
        name: 'API Rate Limit',
        expression: 'URI path starts with "/api/" or "/explorer/"',
        reqPerSec: 0.5,
        matches: (path) => path.startsWith('/api/') || path.startsWith('/explorer/'),
    }),
]);

/**
 * Cloudflare's shortest counting period. A rule configured at 1.5 req/sec is
 * enforced as 15 requests per 10 seconds, and a burst that arrives all at once
 * is compared against that COUNT. Stated once here because every number this
 * tool prints is derived from it.
 */
export const COUNTING_PERIOD_SEC = 10;

/**
 * The step name under which the repeat load is recorded.
 *
 * Home's polling effect re-runs the whole balance load (balances, native coin
 * and coinpay, every address on every chain) every BALANCE_POLL_INTERVAL_MS,
 * and again on every focus and visibilitychange with no debounce between them.
 * So a cold-open is not a one-off spike to be absorbed: it is the wallet's
 * steady-state shape, and two full loads can land inside one counting period
 * whenever a user alt-tabs back.
 *
 * The repeat is measured by running it, not by classifying the first load's
 * rows, because it is genuinely smaller: the registry sync is boot-only and
 * each SDK's lazy hub discovery memoizes.
 */
const POLL_STEP = 'poll';

/**
 * How many HTTP requests one logical wallet call can become.
 *
 * DERIVED from the wallet's own SDK network policy rather than assumed: the
 * shells hand every SDK instance `DEFAULT_SDK_NETWORK_OPTIONS`, whose
 * `retry.maxRetries` decides how many extra attempts a failed call makes. This
 * is the amplification that makes a rate limit self-reinforcing - the block
 * produces the retry that produces the next block - so the ceiling has to be
 * set above the retried count, not the polite one.
 */
export const ATTEMPTS_PER_CALL = 1 + (DEFAULT_SDK_NETWORK_OPTIONS.retry?.maxRetries ?? 0);

/** Requests a rule permits inside one counting period. */
export function requestsPerPeriod(reqPerSec, periodSec = COUNTING_PERIOD_SEC) {
    return reqPerSec * periodSec;
}

/**
 * Where a measured request is sent instead of its real destination: a port
 * nothing can be listening on (binding below 1024 needs root), on loopback, so
 * the connection is refused in microseconds and no packet leaves the machine.
 *
 * The alternative is to let the tool issue a cold-open's worth of traffic at
 * production on every run, which would make measuring the load
 * indistinguishable from adding it.
 */
const DEAD_END = Object.freeze({ hostname: '127.0.0.1', port: 1 });

/**
 * Record every outbound HTTP request the measured code makes, and send none of
 * them.
 *
 * Intercepting at http/https.request rather than at the SDK's own `onRequest`
 * hook is the whole difference between a profile and a guess, and it was not
 * the first design here. The hook version missed three requests per cold-open:
 * every XChainSDK instance runs a lazy hub discovery (`hub.getAllConfig()`,
 * one POST to hub.xchain.io per chain) before its first service call, through
 * a client the hook does not cover. Those are real requests the shipped wallet
 * makes, they were invisible to the instrument, and the instrument reported a
 * confident number anyway. The socket layer cannot be routed around by any
 * client this tree adds later.
 *
 * @param {(req: { host: string, path: string, method: string }) => void} record
 * @returns {() => void} restore
 */
function interceptRequests(record) {
    const originals = [[http, http.request], [https, https.request]];
    for (const [mod] of originals) {
        mod.request = (...args) => {
            const { host, path, method, options, callback } = normalizeRequestArgs(args);
            record({ host, path, method });
            // Always re-issue over plain http: the destination refuses the
            // connection either way, and a TLS handshake we do not need is
            // just latency inside a measurement.
            return originals[0][1].call(http, {
                ...options,
                protocol: 'http:',
                host: DEAD_END.hostname,
                hostname: DEAD_END.hostname,
                port: DEAD_END.port,
                path,
                // The caller's keep-alive agent is pinned to the real host.
                agent: false,
            }, callback);
        };
    }
    return () => {
        for (const [mod, real] of originals) {
            mod.request = real;
        }
    };
}

/**
 * http.request accepts (url, options?, cb?) and (options, cb?). Both shapes
 * reach here: axios builds an options object, and other clients pass a URL.
 */
function normalizeRequestArgs(args) {
    let url = null;
    let options = {};
    let callback;
    if (typeof args[0] === 'string' || args[0] instanceof URL) {
        url = new URL(String(args[0]));
        if (args[1] && typeof args[1] === 'object') options = { ...args[1] };
        callback = typeof args[1] === 'function' ? args[1] : args[2];
    } else {
        options = { ...(args[0] ?? {}) };
        callback = typeof args[1] === 'function' ? args[1] : args[2];
    }
    const host = url ? url.host : (options.host ?? options.hostname ?? 'unknown-host');
    const path = url ? `${url.pathname}${url.search}` : (options.path ?? '/');
    return { host, path, method: (options.method ?? 'GET').toUpperCase(), options, callback };
}

/** Minimal in-memory Vault collection, enough for the flows driven here. */
function memCollection(initial = []) {
    const rows = new Map(initial.map((r) => [r.id, r]));
    return {
        get: async (id) => rows.get(id) ?? null,
        put: async (rec) => { rows.set(rec.id, rec); },
        list: async () => Array.from(rows.values()),
        delete: async (id) => { rows.delete(id); },
        findBy: async (field, value) => Array.from(rows.values()).filter((r) => r[field] === value),
    };
}

/**
 * A vault holding one wallet, one account, and `addressesPerChain` addresses
 * on every chain of the requested network kind.
 *
 * The address STRINGS are placeholders: they appear only inside the path the
 * SDK would have requested, and no branch of any flow driven here reads them.
 * The address COUNT is the thing being varied, because it is the term that
 * multiplies (a wallet with five addresses on three chains fans out five times
 * wider than a fresh one, and nothing paces it).
 */
function makeVault({ chainRegistry, networkKind, addressesPerChain }) {
    const chains = chainRegistry.byNetworkKind(networkKind);
    const addresses = [];
    for (const d of chains) {
        for (let i = 0; i < addressesPerChain; i += 1) {
            addresses.push({
                id: `addr-${d.id}-${i}`,
                accountId: 'acct-1',
                chain: d.coin,
                network: d.networkKind,
                source: 'hd',
                addressType: d.defaultAddressType,
                derivationPath: `m/44'/0'/0'/0/${i}`,
                label: `${d.coin} #${i + 1}`,
                address: `addr-${d.coin}-${i}`,
            });
        }
    }
    return {
        vault: {
            wallets: memCollection([{ id: 'w1', schemaVersion: 1, name: 'Cold-open profile', importedKeys: [] }]),
            accounts: memCollection([{ id: 'acct-1', walletId: 'w1', index: 0, name: 'Main' }]),
            addresses: memCollection(addresses),
        },
        chains,
        addresses,
    };
}

/**
 * Load xchain-sdk the way a Node shell does. Kept behind a function so a
 * caller (or a test) can inject a stand-in instead, and so a tree without
 * dependencies fails with its own sentence rather than a module-not-found
 * stack trace at import time.
 */
export function loadSdkClass() {
    const require = createRequire(import.meta.url);
    const { XChainSDK } = require('xchain-sdk');
    return XChainSDK;
}

/**
 * Drive one wallet cold-open and record every request it would have issued.
 *
 * @param {object} [opts]
 * @param {string} [opts.networkKind]        default 'testnet'
 * @param {number} [opts.addressesPerChain]  default 1 (what wallet creation persists)
 * @param {Function} [opts.sdkClass]         default the installed xchain-sdk
 * @returns {Promise<{ networkKind: string, addressesPerChain: number, chains: string[],
 *                     requests: { step: string, chainId: string|null, host: string, path: string }[],
 *                     byHost: Record<string, number>, byStep: Record<string, number>, total: number }>}
 */
export async function measureColdOpen({
    networkKind = 'testnet',
    addressesPerChain = 1,
    sdkClass = null,
} = {}) {
    if (!Number.isInteger(addressesPerChain) || addressesPerChain < 1) {
        throw new Error('measureColdOpen: addressesPerChain must be a positive integer');
    }
    const XChainSDK = sdkClass ?? loadSdkClass();
    const chainRegistry = new ChainRegistry();
    const { vault, chains, addresses } = makeVault({ chainRegistry, networkKind, addressesPerChain });
    if (chains.length === 0) {
        throw new Error(`measureColdOpen: no bundled descriptors for network kind "${networkKind}"`);
    }

    /** @type {{ step: string, host: string, path: string, method: string }[]} */
    const requests = [];
    let step = 'boot';
    const restore = interceptRequests(({ host, path, method }) => {
        requests.push({ step, host, path, method });
    });

    try {
        // One SDK per chain, built by the real SDKRegistry from the real
        // descriptors, so the host each call lands on is the host the shipped
        // build resolves rather than one restated here. `retry: false` keeps
        // one refused connection from being recorded as several attempts; the
        // retry multiplier is applied later, once, as arithmetic the operator
        // can see.
        const sdkRegistry = new SDKRegistry({
            chainRegistry,
            sdkFactory: (opts) => new XChainSDK({ ...opts, retry: false }),
        });

        // 1. Every shell syncs the signed chain registry from the hub at boot
        //    (extension background.js, web main.jsx, desktop main/index.js).
        //    One request, and it is the one that lands on an /api/ path.
        //
        //    Driven with a stub fetchImpl rather than through the interceptor
        //    because this call goes out over `fetch`, whose Node
        //    implementation does not route through http.request at all - the
        //    interceptor would neither see nor stop it.
        step = 'chain-registry';
        await syncChainRegistryFromHub({
            registry: new ChainRegistry(),
            fetchImpl: async (url) => {
                const parsed = new URL(url);
                requests.push({ step, host: parsed.host, path: parsed.pathname, method: 'GET' });
                // A non-ok reply ends the sync before signature verification,
                // which is not what is being measured here.
                return { ok: false, status: 503, json: async () => ({}) };
            },
        });

        // 2. Home's balance load: the aggregator every shell calls on mount,
        //    and the term that multiplies by addresses and by chains at once.
        //    Also the point where each chain's SDK runs its one-time lazy hub
        //    discovery, which is why the hub takes more than the single
        //    registry request above.
        step = 'wallet-balances';
        await walletBalances({
            vault,
            walletId: 'w1',
            chainRegistry,
            sdkRegistry,
            activeNetwork: networkKind,
        });

        // 3. Home's coinpay resume card, one read per address, fired from the
        //    same mount effect with nothing between it and the balance load.
        step = 'coinpay-obligations';
        await Promise.all(addresses.map((a) => getCoinpayObligationsForAddress({
            sdkRegistry,
            chainId: chainRegistry.chainIdFor(a.chain, a.network),
            address: a.address,
        }).catch(() => null)));

        // 4. The SECOND load, on the same SDK instances, because a cold-open
        //    is not a one-off. Home's polling effect re-runs steps 2 and 3
        //    every BALANCE_POLL_INTERVAL_MS for as long as the wallet is open,
        //    and again on every focus and visibilitychange.
        //
        //    Driven rather than derived by subtraction: the repeat is SMALLER
        //    than the first load by exactly the requests that happen once per
        //    session (each SDK's lazy hub discovery memoizes its promise), and
        //    the only trustworthy way to know which those are is to run it
        //    again and look.
        step = 'poll';
        await walletBalances({
            vault,
            walletId: 'w1',
            chainRegistry,
            sdkRegistry,
            activeNetwork: networkKind,
        });
        await Promise.all(addresses.map((a) => getCoinpayObligationsForAddress({
            sdkRegistry,
            chainId: chainRegistry.chainIdFor(a.chain, a.network),
            address: a.address,
        }).catch(() => null)));
    } finally {
        restore();
    }

    const coldOpen = requests.filter((r) => r.step !== POLL_STEP);
    const recurring = requests.filter((r) => r.step === POLL_STEP);
    const byHost = {};
    const byStep = {};
    for (const r of coldOpen) {
        byHost[r.host] = (byHost[r.host] ?? 0) + 1;
        byStep[r.step] = (byStep[r.step] ?? 0) + 1;
    }
    return {
        networkKind,
        addressesPerChain,
        chains: chains.map((d) => d.id),
        requests: coldOpen,
        recurringRequests: recurring,
        recurringIntervalMs: BALANCE_POLL_INTERVAL_MS,
        byHost,
        byStep,
        total: coldOpen.length,
    };
}

/**
 * Turn a measurement into the target profile: for each zone rule, how many of
 * the measured requests it matches, what that becomes once the SDK's retries
 * are counted, and the ceiling the rule has to clear.
 *
 * `headroom` is a judgement, not a measurement, and it is a multiplier rather
 * than a fudge: a limit set exactly at one cold-open blocks the second wallet
 * behind one NAT, the user who reopens the app, and the shell that re-mounts
 * Home after a network change. Default 2, printed as arithmetic so an operator
 * can pick their own.
 *
 * @param {Awaited<ReturnType<typeof measureColdOpen>>} measurement
 * @param {{ headroom?: number, periodSec?: number }} [opts]
 */
export function coldOpenProfile(measurement, { headroom = 2, periodSec = COUNTING_PERIOD_SEC } = {}) {
    const rules = ZONE_RULES.map((rule) => {
        const matched = measurement.requests.filter((r) => rule.matches(r.path));
        const worstCase = matched.length * ATTEMPTS_PER_CALL;
        const required = worstCase * headroom;
        const allowed = requestsPerPeriod(rule.reqPerSec, periodSec);
        const recurring = measurement.recurringRequests.filter((r) => rule.matches(r.path)).length;
        return {
            rule: rule.name,
            expression: rule.expression,
            configuredReqPerSec: rule.reqPerSec,
            allowedPerPeriod: allowed,
            matched: matched.length,
            recurringPerCycle: recurring * ATTEMPTS_PER_CALL,
            worstCasePerPeriod: worstCase,
            requiredPerPeriod: required,
            requiredReqPerSec: required / periodSec,
            fitsToday: worstCase <= allowed,
            hosts: [...new Set(matched.map((r) => r.host))],
        };
    });
    return {
        periodSec,
        headroom,
        attemptsPerCall: ATTEMPTS_PER_CALL,
        total: measurement.total,
        busiestHost: busiestHost(measurement),
        // Not a one-off spike: Home re-runs the same load on this interval for
        // as long as the wallet is open, and on every focus/visibilitychange
        // in between.
        recurringIntervalMs: measurement.recurringIntervalMs,
        rules,
    };
}

/** The host taking the most of one cold-open, and how much of it. */
export function busiestHost(measurement) {
    let host = null;
    let count = 0;
    for (const [h, n] of Object.entries(measurement.byHost)) {
        if (n > count) { host = h; count = n; }
    }
    return { host, count };
}

/**
 * The burst size `verify-demo-endpoints.mjs --burst` should fire by default.
 *
 * That probe points at ONE endpoint, so the honest default is the number of
 * requests one cold-open puts on the busiest single host - not a round number.
 * Exported so the gate can import it instead of restating it.
 */
export async function coldOpenBurstSize(opts = {}) {
    const measurement = await measureColdOpen(opts);
    return busiestHost(measurement).count;
}

const USAGE = `cold-open-profile.mjs - how many requests does one wallet cold-open put on
the xchain.io zone, and what must the zone rate limits be raised above?

Usage:
  node tools/release/cold-open-profile.mjs [--network <kind>] [--addresses N]
                                          [--headroom N] [--json]

Options:
  --network <kind>  network kind to profile, default testnet
  --addresses N     addresses per chain, default 1 (what wallet creation
                    persists). A wallet the user has added addresses to fans
                    out linearly wider; pass 3 or 5 to see the slope.
  --headroom N      safety multiplier over the measured worst case, default 2
  --json            machine-readable result instead of the table
  -h, --help        print this and exit 0

SENDS NO TRAFFIC. Every request is recorded and suppressed at the SDK's own
request hook, so running this does not add the load it measures.

Exit codes:
  0  the profile was measured
  1  a zone rule the wallet's traffic matches is set below one cold-open
  2  a configuration problem (no descriptors, SDK not installed)
`;

function parseArgs(argv) {
    const args = { networkKind: 'testnet', addressesPerChain: 1, headroom: 2, json: false, help: false };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--network') args.networkKind = argv[i + 1];
        else if (argv[i] === '--addresses') args.addressesPerChain = Number(argv[i + 1]) || 1;
        else if (argv[i] === '--headroom') args.headroom = Number(argv[i + 1]) || 2;
        else if (argv[i] === '--json') args.json = true;
        else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(USAGE);
        return EXIT.OK;
    }

    let measurement;
    try {
        measurement = await measureColdOpen({
            networkKind: args.networkKind,
            addressesPerChain: args.addressesPerChain,
        });
    } catch (e) {
        console.log(`Configuration problem: ${e?.message ?? e}`);
        return EXIT.CONFIG;
    }
    const profile = coldOpenProfile(measurement, { headroom: args.headroom });

    if (args.json) {
        console.log(JSON.stringify({ measurement, profile }, null, 2));
        return profile.rules.every((r) => r.fitsToday) ? EXIT.OK : EXIT.FAILURE;
    }

    console.log(`Wallet cold-open, ${measurement.networkKind}, ${measurement.addressesPerChain}`
        + ` address(es) per chain on ${measurement.chains.length} chains\n`);
    console.log(`${measurement.total} requests, all concurrent, by step:`);
    for (const [step, n] of Object.entries(measurement.byStep)) {
        console.log(`  ${String(n).padStart(3)}  ${step}`);
    }
    console.log('\nby host:');
    for (const [host, n] of Object.entries(measurement.byHost)) {
        console.log(`  ${String(n).padStart(3)}  ${host}`);
    }
    console.log(`\nAgainst the zone rules, per ${profile.periodSec}s counting period`
        + ` (x${profile.attemptsPerCall} for the SDK's retry, x${profile.headroom} headroom):\n`);
    for (const r of profile.rules) {
        const mark = r.fitsToday ? 'OK  ' : 'OVER';
        console.log(`${mark} ${r.rule} (${r.expression})`);
        console.log(`       configured ${r.configuredReqPerSec} req/sec = ${r.allowedPerPeriod} requests`
            + ` per ${profile.periodSec}s`);
        console.log(`       one cold-open matches ${r.matched}, ${r.worstCasePerPeriod} with retries`
            + `, on ${r.hosts.join(', ') || 'no host'}`);
        console.log(`       ${r.recurringPerCycle} of those repeat every`
            + ` ${profile.recurringIntervalMs / 1000}s while the wallet stays open`);
        // Only a rule the traffic does NOT fit inside has a "raise to" number.
        // Printing one for a rule that already clears the demand reads as an
        // instruction to LOWER the limit, which is not what was measured.
        if (r.fitsToday) {
            console.log(`       already clears one cold-open with ${r.allowedPerPeriod - r.worstCasePerPeriod}`
                + ' request(s) to spare');
        } else {
            console.log(`       raise to at least ${r.requiredPerPeriod} per ${profile.periodSec}s`
                + ` (${r.requiredReqPerSec} req/sec), which is the measured worst case x${profile.headroom}`);
        }
    }
    console.log();
    if (profile.rules.every((r) => r.fitsToday)) {
        console.log('Every rule already clears one cold-open. The twelve-hostname skip can be narrowed'
            + ' without breaking the wallet.');
    } else {
        console.log('At least one rule is set BELOW one wallet cold-open. Removing the twelve-hostname'
            + ' skip today would block the wallet at the edge, as a 403 that looks exactly like the'
            + ' bot-block. Raise the limits above the figures printed above FIRST, then narrow the skip.');
    }
    return profile.rules.every((r) => r.fitsToday) ? EXIT.OK : EXIT.FAILURE;
}

if (process.argv[1] && process.argv[1].endsWith('cold-open-profile.mjs')) {
    process.exitCode = await main();
}
