// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/cold-open-profile.mjs - what does ONE honest wallet ask the
// xchain.io zone for: on a cold open, on every poll, on an alt-tab, and once
// per session for proof verification? And what must every rate limit on that
// path (the edge rules, and the explorer's per-route limiters once they key
// on the real client) be set above so the wallet fits with headroom?
//
// WHY THIS EXISTS. Every threshold in the rate-limits spec is DERIVED from the
// number this prints, times a stated multiplier, never picked. The zone's two
// Cloudflare rate-limiting rules (`General Rate Limit`, 90 per minute on every
// path but /icon/, and `API Rate Limit`, 30 per minute on /api/ and /explorer/,
// both Block 429 for a minute) are SKIPPED by custom rule 9 for fourteen named
// hosts, which today include every host the wallet's API traffic lands on, so
// they bind only the hosts left off the list (wallet.xchain.io's SPA load among
// them). The edge rule that will replace the API one is sized from the
// wallet's worst ten-second burst, and the explorer's eight origin limits from
// its worst minute, both printed here.
//
// The residual it closes is a specific one. `verify-demo-endpoints.mjs
// --burst` fired at a host on the skip measures the skip, not the limit, and
// its old count of 8 was a number nobody had derived from anything. So the
// question this file answers is the other one: what does the CLIENT demand, in
// requests, per host, per route, per window?
//
// HOW IT MEASURES, and why not by reading the code. The fan-out is DRIVEN, not
// restated: the real `walletBalances`, `getCoinpayObligationsForAddress`,
// `verifyAddressBalance` and `syncChainRegistryFromHub` flows run against a
// real ChainRegistry, a real SDKRegistry and a real xchain-sdk instance, and
// the http/https socket layer (or, for the flows that go out over `fetch`, a
// recording stand-in) records the URL each call would have issued. A comment
// claiming "three requests per address" rots the day a flow adds a fourth; a
// driven count moves on its own. Nothing leaves the process: every request is
// recorded and then refused, so the measurement cannot become the load it is
// measuring. The alt-tab cost is driven the same way, through the shipped poll
// throttle, and the proof fan-out's per-poll behaviour through the shipped
// hook's own re-fire signature.
//
// WHAT THE NUMBERS MEAN. Cloudflare rate-limiting rules count requests matching
// their expression, keyed by client IP, over a counting period whose floor is
// 10 seconds. A wallet cold-open is not paced: `walletBalances` fans out with
// Promise.all across every chain and every address at once, so the whole burst
// lands inside ONE counting period no matter how long that period is. The
// number that matters for the edge is therefore a COUNT, not a rate; the
// number that matters for the origin's per-minute limiters is the worst minute
// a wallet left open produces. Both are multiplied by the SDK's own retry
// count, because a blocked request is retried and a rate limit that bites
// amplifies the traffic it is biting, and then by a headroom multiplier.
//
// The three chains share ONE explorer hostname, which is the whole reason this
// concentrates: `explorer.xchain.io` takes every balance, native-coin, coinpay
// and proof read for every address on all three chains.
//
// Usage:
//   node tools/release/cold-open-profile.mjs
//   node tools/release/cold-open-profile.mjs --addresses 5 --headroom 3
//   node tools/release/cold-open-profile.mjs --network mainnet --json

import { createRequire } from 'node:module';
import http from 'node:http';
import https from 'node:https';

import { ChainRegistry } from '../../packages/core/src/registry/index.js';
import { SDKRegistry, DEFAULT_SDK_NETWORK_OPTIONS } from '../../packages/core/src/sdk/SDKRegistry.js';
import { walletBalances, BALANCE_POLL_INTERVAL_MS } from '../../packages/core/src/flows/balances.js';
import { createPollThrottle } from '../../packages/core/src/flows/pollThrottle.js';
import { getCoinpayObligationsForAddress } from '../../packages/core/src/flows/coinpayQueries.js';
import { verifyAddressBalance } from '../../packages/core/src/flows/verifyBalances.js';
import { syncChainRegistryFromHub } from '../../packages/core/src/registry/remote.js';
import { proofJobsSignature } from '../../packages/core/src/shared/hooks/useProofVerification.js';
import { COINPAY_BADGE_POLL_MS } from '../../packages/core/src/shared/hooks/useCoinpayObligations.js';

export const EXIT = { OK: 0, FAILURE: 1, CONFIG: 2 };

/**
 * The zone's two rate-limiting rules, RECORDED rather than measured.
 *
 * These are operator-owned facts read off the Cloudflare dashboard for zone
 * xchain.io (rule editors opened read-only 2026-09-04; both rules action Block
 * 429 with a one-minute mitigation). Nothing in this repo can observe them (a
 * request that is skipped tells you nothing about the limit that was skipped)
 * so they live here as data with their provenance attached, and an operator
 * who changes them in the dashboard has to change them here.
 *
 * `matches` is each rule's expression, transcribed. The rule names on the
 * dashboard say "1.5 req/sec" and "0.5 req/sec"; those are the rates, and the
 * configured windows are one minute, which is why `threshold` and `periodSec`
 * are recorded as the count the rule actually enforces.
 */
export const ZONE_RULES = Object.freeze([
    Object.freeze({
        name: 'General Rate Limit',
        expression: 'starts_with(http.request.uri.path, "/") and not starts_with(http.request.uri.path, "/icon/")',
        threshold: 90,
        periodSec: 60,
        action: 'Block 429, 1 minute',
        matches: (path) => path.startsWith('/') && !path.startsWith('/icon/'),
    }),
    Object.freeze({
        name: 'API Rate Limit',
        expression: 'starts_with(http.request.uri, "/api/") or starts_with(http.request.uri, "/explorer/")',
        threshold: 30,
        periodSec: 60,
        action: 'Block 429, 1 minute',
        matches: (path) => path.startsWith('/api/') || path.startsWith('/explorer/'),
    }),
]);

/**
 * Custom rule 9, "Allow non-browser clients (skip SBFM)": Skip action for
 * "All rate limiting rules" and "All Super Bot Fight Mode Rules" on these
 * fourteen hosts (read off the rule editor 2026-09-04). A request to one of
 * them is never counted by either rule above, so the two rules bind only the
 * hosts left off this list. `wallet.xchain.io` is deliberately not on it.
 */
export const RATE_LIMIT_SKIP_HOSTS = Object.freeze([
    'xchain.io',
    'testnet.xchain.io',
    'dogeparty.xchain.io',
    'dogeparty-testnet.xchain.io',
    'btns.xchain.io',
    'btns-testnet.xchain.io',
    'btns-dogeparty.xchain.io',
    'btns-dogeparty-testnet.xchain.io',
    'explorer.xchain.io',
    'hub.xchain.io',
    'encoder.xchain.io',
    'dashboard.xchain.io',
    'docs.xchain.io',
    'www.xchain.io',
]);

/**
 * Cloudflare's shortest counting period on this plan, and the window the
 * spec's replacement API rule uses: a wallet burst arrives all at once, so the
 * count inside this window is the count that decides whether it is blocked.
 */
export const COUNTING_PERIOD_SEC = 10;

/**
 * The step name under which the repeat load is recorded.
 *
 * Home's polling effect re-runs the whole balance load (balances, native coin
 * and coinpay, every address on every chain) every BALANCE_POLL_INTERVAL_MS,
 * and again on a focus or visibilitychange that the poll throttle admits. So a
 * cold-open is not a one-off spike to be absorbed: it is the wallet's
 * steady-state shape.
 *
 * The repeat is measured by running it, not by classifying the first load's
 * rows, because it is genuinely smaller: the registry sync is boot-only, each
 * SDK's lazy hub discovery memoizes, and the proof fan-out re-fires only when
 * the (chain, address, token) set changes.
 */
const POLL_STEP = 'poll';

/**
 * The nav badge's own coinpay scan. The web SPA (and so the desktop and mobile
 * shells, which bundle it) mounts `useCoinpayObligations` beside Home, and it
 * polls on its own cadence, separate from Home's beat. Recorded as its own
 * step because it repeats on a different interval.
 */
const BADGE_STEP = 'coinpay-badge';

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

/**
 * The light client goes out over global `fetch`, whose Node implementation
 * does not route through http.request at all, so the socket interceptor can
 * neither see nor stop it. For the proof step, `fetch` itself is the recorder.
 *
 * The proof read is answered with a canned proof-plus-checkpoint body rather
 * than refused, on purpose: refusing it would end verification before the
 * SECOND read (the checkpoint's validator set from `/api/checkpoint/{h}/verify`)
 * that the real wallet issues, and the profile would under-count the proof
 * path by half. The checkpoint carries one fixed height so that an SDK which
 * caches the validator set per height gets to show it; the verdict itself is
 * irrelevant (the proof cannot verify) and is discarded.
 *
 * @param {(req: { host: string, path: string, method: string }) => void} record
 * @returns {() => void} restore
 */
function interceptFetch(record) {
    const real = globalThis.fetch;
    const reply = (status, body) => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    });
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        const path = `${url.pathname}${url.search}`;
        record({ host: url.host, path, method: String(init.method ?? 'GET').toUpperCase() });
        if (/\/api\/proof\/balance\//.test(path)) {
            return reply(200, {
                proof: { height: PROOF_CHECKPOINT.block_index },
                checkpoint: PROOF_CHECKPOINT,
            });
        }
        if (/\/api\/checkpoint\/[^/]+\/verify$/.test(path)) return reply(200, { validators: [] });
        return reply(503, {});
    };
    return () => { globalThis.fetch = real; };
}

/** One served checkpoint for every canned proof; the height is what a per-height cache keys on. */
const PROOF_CHECKPOINT = Object.freeze({
    block_index: 100,
    chain: 'profile',
    network: 'profile',
    state_root: null,
});

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
 * The per-address balances shape Home holds, for `tokensPerAddress` tokens on
 * every address. Built fresh on each call, because the property under
 * measurement is what happens when a poll hands the proof hook an EQUAL set
 * under a NEW object identity.
 */
function balancesShape({ chainRegistry, addresses, tokensPerAddress }) {
    const shape = {};
    for (const a of addresses) {
        const chainId = chainRegistry.chainIdFor(a.chain, a.network);
        const tokens = Array.from({ length: tokensPerAddress }, (_, i) => ({ tick: `TOKEN${i + 1}` }));
        (shape[chainId] ??= []).push({ address: a.address, balances: { tokens } });
    }
    return shape;
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

/** The installed SDK's version, so a profile says which light client it drove. */
export function installedSdkVersion() {
    try {
        const require = createRequire(import.meta.url);
        return String(require('xchain-sdk/package.json').version);
    } catch {
        return 'unknown';
    }
}

/**
 * Drive one wallet session and record every request it would have issued: the
 * cold-open, the proof fan-out, the poll, the badge's own scan, and the cost
 * of an alt-tab.
 *
 * @param {object} [opts]
 * @param {string} [opts.networkKind]        default 'testnet'
 * @param {number} [opts.addressesPerChain]  default 1 (what wallet creation persists)
 * @param {number} [opts.tokensPerAddress]   default 1 (one provable token per address)
 * @param {Function} [opts.sdkClass]         default the installed xchain-sdk
 * @returns {Promise<{ networkKind: string, addressesPerChain: number, tokensPerAddress: number,
 *                     chains: string[], sdkVersion: string,
 *                     requests: { step: string, host: string, path: string, method: string }[],
 *                     recurringRequests: object[], badgeRequests: object[],
 *                     recurringIntervalMs: number, badgeIntervalMs: number,
 *                     proof: { jobs: number, reads: number, readsPerJob: number, refiresOnPoll: boolean },
 *                     refocus: { intervalMs: number, insideWindow: number, afterWindow: number },
 *                     byHost: Record<string, number>, byStep: Record<string, number>, total: number }>}
 */
export async function measureColdOpen({
    networkKind = 'testnet',
    addressesPerChain = 1,
    tokensPerAddress = 1,
    sdkClass = null,
} = {}) {
    if (!Number.isInteger(addressesPerChain) || addressesPerChain < 1) {
        throw new Error('measureColdOpen: addressesPerChain must be a positive integer');
    }
    if (!Number.isInteger(tokensPerAddress) || tokensPerAddress < 0) {
        throw new Error('measureColdOpen: tokensPerAddress must be a non-negative integer');
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
    const record = ({ host, path, method }) => { requests.push({ step, host, path, method }); };
    const restoreSockets = interceptRequests(record);
    const restoreFetch = interceptFetch(record);

    const coinpayScan = () => Promise.all(addresses.map((a) => getCoinpayObligationsForAddress({
        sdkRegistry,
        chainId: chainRegistry.chainIdFor(a.chain, a.network),
        address: a.address,
    }).catch(() => null)));

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

    let proof;
    let refocus;
    try {
        // 1. Every shell syncs the signed chain registry from the hub at boot
        //    (extension background.js, web main.jsx, desktop main/index.js).
        //    One request, and it is the one that lands on an /api/ path.
        //    A non-ok reply ends the sync before signature verification,
        //    which is not what is being measured here.
        step = 'chain-registry';
        await syncChainRegistryFromHub({
            registry: new ChainRegistry(),
            fetchImpl: async (url) => {
                const parsed = new URL(url);
                requests.push({ step, host: parsed.host, path: parsed.pathname, method: 'GET' });
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
        await coinpayScan();

        // 4. The nav badge's own first scan, same reads again from a second
        //    hook mounted beside Home in the web SPA.
        step = BADGE_STEP;
        await coinpayScan();

        // 5. Proof verification: one job per (chain, address, token), each
        //    through the real `verifyAddressBalance` flow and the installed
        //    SDK's light client, which is what decides how many reads a job
        //    costs (the proof, then the checkpoint's validator set; an SDK
        //    that caches the set per height fetches it once per chain). The
        //    hook fans out through a pool of six; concurrency is irrelevant
        //    to the count and is not reproduced.
        step = 'proof-verification';
        const firstBalances = balancesShape({ chainRegistry, addresses, tokensPerAddress });
        const jobs = [];
        for (const [chainId, entries] of Object.entries(firstBalances)) {
            for (const e of entries) {
                for (const t of e.balances.tokens) jobs.push({ chainId, address: e.address, tick: t.tick });
            }
        }
        const before = requests.length;
        await Promise.all(jobs.map((j) => verifyAddressBalance({ sdkRegistry, ...j }).catch(() => null)));
        const proofReads = requests.length - before;

        // 6. The SECOND load, on the same SDK instances, because a cold-open
        //    is not a one-off. Home's polling effect re-runs steps 2 and 3
        //    every BALANCE_POLL_INTERVAL_MS for as long as the wallet is open.
        //
        //    Driven rather than derived by subtraction: the repeat is SMALLER
        //    than the first load by exactly the requests that happen once per
        //    session (each SDK's lazy hub discovery memoizes its promise), and
        //    the only trustworthy way to know which those are is to run it
        //    again and look.
        step = POLL_STEP;
        await walletBalances({
            vault,
            walletId: 'w1',
            chainRegistry,
            sdkRegistry,
            activeNetwork: networkKind,
        });
        await coinpayScan();

        //    Whether the proof fan-out re-fires on this poll is decided by the
        //    hook's own re-fire signature over the balances the poll hands it:
        //    an equal (chain, address, token) set under a new object identity
        //    must produce the same signature, or every poll re-verifies. The
        //    hook's effect depending on that signature (and not on the object)
        //    is pinned by its unit test; this drives the signature itself.
        const secondBalances = balancesShape({ chainRegistry, addresses, tokensPerAddress });
        const refiresOnPoll = proofJobsSignature(firstBalances) !== proofJobsSignature(secondBalances);
        if (refiresOnPoll) {
            await Promise.all(jobs.map((j) => verifyAddressBalance({ sdkRegistry, ...j }).catch(() => null)));
        }
        proof = {
            jobs: jobs.length,
            reads: proofReads,
            readsPerJob: jobs.length > 0 ? proofReads / jobs.length : 0,
            refiresOnPoll,
        };

        // 7. The badge's repeat, on its own interval.
        step = BADGE_STEP;
        const badgeStart = requests.length;
        await coinpayScan();
        var badgeRequests = requests.splice(badgeStart);
    } finally {
        restoreFetch();
        restoreSockets();
    }

    // 8. What an alt-tab costs, driven through the shipped throttle: `focus`
    //    and `visibilitychange` fire together, once with data fresher than the
    //    poll interval (the user flicked away and back) and once after the
    //    data has aged past it (the user came back after a while). The count
    //    of polls the throttle admits in each case is the count printed.
    refocus = driveRefocus();

    const coldOpen = requests.filter((r) => r.step !== POLL_STEP && r.step !== BADGE_STEP);
    const firstBadge = requests.filter((r) => r.step === BADGE_STEP);
    const recurring = requests.filter((r) => r.step === POLL_STEP);
    const byHost = {};
    const byStep = {};
    for (const r of [...coldOpen, ...firstBadge]) {
        byHost[r.host] = (byHost[r.host] ?? 0) + 1;
        byStep[r.step] = (byStep[r.step] ?? 0) + 1;
    }
    const all = [...coldOpen, ...firstBadge];
    return {
        networkKind,
        addressesPerChain,
        tokensPerAddress,
        chains: chains.map((d) => d.id),
        sdkVersion: sdkClass ? 'injected' : installedSdkVersion(),
        requests: all,
        recurringRequests: recurring,
        recurringIntervalMs: BALANCE_POLL_INTERVAL_MS,
        badgeRequests,
        badgeIntervalMs: COINPAY_BADGE_POLL_MS,
        proof,
        refocus,
        byHost,
        byStep,
        total: all.length,
    };
}

/**
 * Two events at once, twice: inside the window and after it. Returns how many
 * polls the throttle admitted each time.
 */
export function driveRefocus(intervalMs = BALANCE_POLL_INTERVAL_MS) {
    let clock = 0;
    const throttle = createPollThrottle(intervalMs, { now: () => clock });
    throttle.succeed(); // the cold-open landed at t=0
    const burst = () => {
        let admitted = 0;
        for (const _ of ['focus', 'visibilitychange']) {
            if (throttle.start()) admitted += 1;
        }
        if (admitted > 0) throttle.succeed();
        return admitted;
    };
    clock = Math.max(1, Math.floor(intervalMs / 4));
    const insideWindow = burst();
    clock = intervalMs + Math.max(1, Math.floor(intervalMs / 4));
    const afterWindow = burst();
    return { intervalMs, insideWindow, afterWindow };
}

/**
 * Which origin limiter a request lands under. The explorer runs an app-wide
 * limiter plus seven per-route ones (rate-limits spec §1.3); grouping the
 * measured paths by route family is what lets each of those be derived from
 * the profile instead of guessed. Address and tick segments are not part of
 * the family.
 */
export function routeFamily({ host, path, method }) {
    if (/\/api\/balances\//.test(path)) return 'balances';
    if (/\/api\/address\//.test(path)) return 'address';
    if (/\/api\/coinpay_obligations\//.test(path)) return 'coinpay';
    if (/\/api\/proof\//.test(path)) return 'proof';
    if (/\/api\/checkpoint\/[^/]+\/verify/.test(path)) return 'checkpoint-verify';
    if (/\/api\/v1\/chain-registry/.test(path)) return 'chain-registry';
    if (host.startsWith('hub.') && method === 'POST') return 'hub-rpc';
    return 'other';
}

/**
 * Turn a measurement into the target profile.
 *
 * `headroom` is a judgement, not a measurement, and it is a multiplier rather
 * than a fudge: a limit set exactly at one wallet blocks the second wallet
 * behind one NAT, the user who reopens the app, and the shell that re-mounts
 * Home after a network change. The spec fixes it at 3 (a NAT with three
 * testers); the default here stays 2 so the arithmetic is visible either way.
 *
 * Three views come out, because three different limits are derived from them:
 *
 * - `rules`: today's two edge rules, counting only requests on hosts the rule
 *   actually sees (the rule-9 skip hosts are counted separately as `skipped`).
 * - `edge`: the requirement for a per-host edge rule on the API hosts over the
 *   shortest counting period: the whole cold-open lands inside it.
 * - `routes`: per host and route family, the cold-open, the per-poll repeat,
 *   and the worst minute a wallet left open produces (cold-open plus every
 *   further poll and badge scan that fits in the same minute), which is what
 *   the origin's per-minute limiters must clear.
 *
 * @param {Awaited<ReturnType<typeof measureColdOpen>>} m
 * @param {{ headroom?: number, periodSec?: number }} [opts]
 */
export function coldOpenProfile(m, { headroom = 2, periodSec = COUNTING_PERIOD_SEC } = {}) {
    const skipped = (r) => RATE_LIMIT_SKIP_HOSTS.includes(r.host);
    const rules = ZONE_RULES.map((rule) => {
        const seen = m.requests.filter((r) => rule.matches(r.path) && !skipped(r));
        const onSkip = m.requests.filter((r) => rule.matches(r.path) && skipped(r));
        const worstCase = seen.length * ATTEMPTS_PER_CALL;
        return {
            rule: rule.name,
            expression: rule.expression,
            threshold: rule.threshold,
            periodSec: rule.periodSec,
            action: rule.action,
            matched: seen.length,
            skipped: onSkip.length,
            worstCasePerPeriod: worstCase,
            requiredPerPeriod: worstCase * headroom,
            fitsToday: worstCase <= rule.threshold,
            hosts: [...new Set(seen.map((r) => r.host))],
            skippedHosts: [...new Set(onSkip.map((r) => r.host))],
        };
    });

    // The API hosts are the skip-listed hosts the wallet actually reaches;
    // derived from the measurement so a fourth API host would show up here.
    const apiHosts = [...new Set(m.requests.filter(skipped).map((r) => r.host))].sort();
    const burst = m.requests.filter((r) => apiHosts.includes(r.host)).length;
    const edge = {
        hosts: apiHosts,
        periodSec,
        burst,
        withRetries: burst * ATTEMPTS_PER_CALL,
        required: burst * ATTEMPTS_PER_CALL * headroom,
    };

    const furtherPolls = Math.max(0, Math.ceil(60_000 / m.recurringIntervalMs) - 1);
    const furtherBadge = Math.max(0, Math.ceil(60_000 / m.badgeIntervalMs) - 1);
    const routes = {};
    const bump = (r, field, n = 1) => {
        const key = `${r.host} ${routeFamily(r)}`;
        const row = (routes[key] ??= { host: r.host, family: routeFamily(r), coldOpen: 0, perPoll: 0, perBadge: 0 });
        row[field] += n;
    };
    for (const r of m.requests) bump(r, 'coldOpen');
    for (const r of m.recurringRequests) bump(r, 'perPoll');
    for (const r of m.badgeRequests) bump(r, 'perBadge');
    for (const row of Object.values(routes)) {
        row.worstMinute = row.coldOpen + row.perPoll * furtherPolls + row.perBadge * furtherBadge;
        row.worstMinuteWithRetries = row.worstMinute * ATTEMPTS_PER_CALL;
        row.required = row.worstMinuteWithRetries * headroom;
    }

    const chainCount = m.chains.length;
    const perAddress = (list, family) => list.filter((r) => routeFamily(r) === family).length
        / (chainCount * m.addressesPerChain);
    const perPoll = {
        balanceReadsPerAddress: perAddress(m.recurringRequests, 'balances') + perAddress(m.recurringRequests, 'address'),
        coinpayReadsPerAddress: perAddress(m.recurringRequests, 'coinpay'),
        proofReadsPerAddress: m.proof.refiresOnPoll ? (m.proof.reads / (chainCount * m.addressesPerChain)) : 0,
    };

    return {
        periodSec,
        headroom,
        attemptsPerCall: ATTEMPTS_PER_CALL,
        sdkVersion: m.sdkVersion,
        total: m.total,
        busiestHost: busiestHost(m),
        recurringIntervalMs: m.recurringIntervalMs,
        badgeIntervalMs: m.badgeIntervalMs,
        perPoll,
        proof: m.proof,
        refocus: m.refocus,
        rules,
        edge,
        routes: Object.values(routes).sort((a, b) => b.worstMinute - a.worstMinute),
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

const USAGE = `cold-open-profile.mjs - what does one honest wallet ask the xchain.io zone
for, and what must every rate limit on its path be set above?

Usage:
  node tools/release/cold-open-profile.mjs [--network <kind>] [--addresses N]
                                          [--tokens N] [--headroom N] [--json]

Options:
  --network <kind>  network kind to profile, default testnet
  --addresses N     addresses per chain, default 1 (what wallet creation
                    persists). A wallet the user has added addresses to fans
                    out linearly wider; pass 3 or 5 to see the slope.
  --tokens N        provable tokens per address, default 1; each is one proof
                    job per session
  --headroom N      multiplier over the measured worst case, default 2 (the
                    rate-limits spec fixes it at 3)
  --json            machine-readable result instead of the table
  -h, --help        print this and exit 0

SENDS NO TRAFFIC. Every request is recorded and refused at the socket (or at
fetch, for the light client), so running this does not add the load it measures.

Exit codes:
  0  the profile was measured
  1  an edge rule the wallet's traffic is counted under is set below one cold-open
  2  a configuration problem (no descriptors, SDK not installed)
`;

function parseArgs(argv) {
    const args = {
        networkKind: 'testnet', addressesPerChain: 1, tokensPerAddress: 1, headroom: 2, json: false, help: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--network') args.networkKind = argv[i + 1];
        else if (argv[i] === '--addresses') args.addressesPerChain = Number(argv[i + 1]) || 1;
        else if (argv[i] === '--tokens') args.tokensPerAddress = Number(argv[i + 1]) ?? 1;
        else if (argv[i] === '--headroom') args.headroom = Number(argv[i + 1]) || 2;
        else if (argv[i] === '--json') args.json = true;
        else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    }
    return args;
}

const pad = (n, w = 4) => String(n).padStart(w);

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(USAGE);
        return EXIT.OK;
    }

    let m;
    try {
        m = await measureColdOpen({
            networkKind: args.networkKind,
            addressesPerChain: args.addressesPerChain,
            tokensPerAddress: args.tokensPerAddress,
        });
    } catch (e) {
        console.log(`Configuration problem: ${e?.message ?? e}`);
        return EXIT.CONFIG;
    }
    const p = coldOpenProfile(m, { headroom: args.headroom });
    const ok = p.rules.every((r) => r.fitsToday);

    if (args.json) {
        console.log(JSON.stringify({ measurement: m, profile: p }, null, 2));
        return ok ? EXIT.OK : EXIT.FAILURE;
    }

    console.log(`Wallet session, ${m.networkKind}, ${m.addressesPerChain} address(es) x ${m.tokensPerAddress}`
        + ` token(s) per chain on ${m.chains.length} chains, xchain-sdk ${m.sdkVersion}\n`);
    console.log(`${m.total} requests on a cold open, all concurrent, by step:`);
    for (const [step, n] of Object.entries(m.byStep)) console.log(`  ${pad(n)}  ${step}`);
    console.log('\nby host:');
    for (const [host, n] of Object.entries(m.byHost)) console.log(`  ${pad(n)}  ${host}`);

    console.log(`\nEvery ${p.recurringIntervalMs / 1000}s while the wallet stays open (Home's poll), per chain, per address:`);
    console.log(`  ${p.perPoll.balanceReadsPerAddress} balance reads, ${p.perPoll.coinpayReadsPerAddress} coinpay read(s),`
        + ` ${p.perPoll.proofReadsPerAddress} proof reads`);
    console.log(`  the badge's coinpay scan repeats every ${p.badgeIntervalMs / 1000}s: ${m.badgeRequests.length} more reads`);
    console.log(`\nProof verification, once per session: ${p.proof.jobs} job(s), ${p.proof.reads} reads`
        + ` (${p.proof.readsPerJob} per job on this SDK); re-fires on a poll: ${p.proof.refiresOnPoll ? 'YES' : 'no'}`);
    console.log(`\nAn alt-tab (focus + visibilitychange together), driven through the poll throttle:`);
    console.log(`  ${p.refocus.insideWindow} poll(s) when the data is fresher than ${p.refocus.intervalMs / 1000}s,`
        + ` ${p.refocus.afterWindow} poll(s) when it is older`);

    console.log(`\nToday's edge rules (x${p.attemptsPerCall} for the SDK's retry, x${p.headroom} headroom):\n`);
    for (const r of p.rules) {
        const mark = r.fitsToday ? 'OK  ' : 'OVER';
        console.log(`${mark} ${r.rule}: ${r.threshold} per ${r.periodSec}s, ${r.action}`);
        console.log(`       expression: ${r.expression}`);
        console.log(`       counts ${r.matched} of this session's requests (${r.worstCasePerPeriod} with retries)`
            + ` on ${r.hosts.join(', ') || 'no host'}`);
        console.log(`       skips ${r.skipped} on ${r.skippedHosts.join(', ') || 'no host'} (custom rule 9)`);
        if (!r.fitsToday) {
            console.log(`       raise to at least ${r.requiredPerPeriod} per ${r.periodSec}s`);
        }
    }

    console.log(`\nA per-host edge rule on ${p.edge.hosts.join(', ')} over the plan's shortest window (${p.edge.periodSec}s):`);
    console.log(`  one cold open lands ${p.edge.burst} requests inside it, ${p.edge.withRetries} with retries;`
        + ` threshold must be at least ${p.edge.required} (x${p.headroom})`);

    console.log('\nOrigin limiters, worst minute a wallet left open produces, by host and route:');
    console.log('  cold  poll  badge  minute  x retries  required   route');
    for (const r of p.routes) {
        console.log(`  ${pad(r.coldOpen)}  ${pad(r.perPoll)}  ${pad(r.perBadge, 5)}  ${pad(r.worstMinute, 6)}`
            + `  ${pad(r.worstMinuteWithRetries, 9)}  ${pad(r.required, 8)}   ${r.host} ${r.family}`);
    }
    console.log();
    if (ok) {
        console.log('No edge rule that counts this session\'s traffic is set below one cold-open.'
            + ' The API hosts sit on the rule-9 skip, so their ceiling is the per-host rule above, not today\'s two.');
    } else {
        console.log('An edge rule that counts this session\'s traffic is set BELOW one cold-open:'
            + ' the wallet would be blocked at the edge as a 429 the client cannot tell from an outage.'
            + ' Raise it above the figure printed above.');
    }
    return ok ? EXIT.OK : EXIT.FAILURE;
}

if (process.argv[1] && process.argv[1].endsWith('cold-open-profile.mjs')) {
    process.exitCode = await main();
}
