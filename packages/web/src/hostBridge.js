// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// In-page MessageHost + Vault for the web shell (§9.3.3).
//
// Extension shells dispatch messages across a service-worker boundary
// via chrome.runtime; the web shell runs the whole thing in one
// process. This module owns module-scoped `vault` + `host` so state
// survives component re-renders but is gone on tab close / reload (the
// web key-isolation tradeoff the spec calls out).
//
// Session semantics:
//   - The master key lives in `vault` (in-memory). There is no
//     `chrome.storage.session` equivalent; a page refresh re-locks
//     the wallet, by design.
//   - kdfParams live in `localStorage` via WebMetaBackend so the
//     unlock flow can derive the master key before touching the
//     IndexedDB ciphertext. Running inside the Capacitor shell, both
// stores move behind the native vault plugin instead (S2,
//     storage/backends.js); WebView storage is evictable, and on a
//     shell with `allowBackup=false` that blob is the only copy of the
//     vault that exists.
//
// The `sendMessage(type, request)` function exposes the MessageHost
// under the same envelope shape the extension's popup uses (popup's
// `chromeMessaging.sendMessage` wrapper). Keeps the route-level
// messaging helpers nearly identical across shells.

import {
    crypto as cryptoLib,
    registry as registryLib,
    sdk as sdkLib,
    signers as signersLib,
    storage as storageLib,
    notifications as notificationsLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import { createWebNotifyAdapter } from './notifications/webNotifyAdapter.js';
// Cross-package relative path rather than `@xchain-wallet/extension` so
// this module resolves under Node without the pnpm workspace symlink
// (needed for smoke tests) while still bundling cleanly through Vite
// at build time. Candidate for a lower-level package extraction once a
// third shell appears.
import { createBackgroundHost } from '../../extension/src/background/createBackgroundHost.js';
import { hydrateEnvelopeError } from '../../extension/src/background/MessageHost.js';
// Same reason as the line above: one resolver across shells, so the fresh and
// add restore lanes cannot drift on which pointer schemes they will fetch.
import { resolveBackupPointerContent } from '../../extension/src/background/backupPointerResolver.js';
// Same reason again: one definition of "this install is fresh", so the three
// in-page lanes below raise the same named WalletExistsError the pre-host
// shells raise, and check the storage blob as well as the meta slot.
import { assertFreshVault } from '../../extension/src/background/walletCreate.js';
import { WALLET_VERSION } from '@xchain-wallet/core/buildInfo.js';
import {
    fakeBalanceFor,
    fakeOwnedTokensFor,
    fakeTokenInfoFor,
    fakeDispensersFor,
    fakeOrdersFor,
    fakeSwapsFor,
    fakeHoldersFor,
    fakeHistoryFor,
    fakeGenesisFor,
    fakeSubassetsFor,
    fakeNativeFiatRates,
} from './devFakeBalances.js';
import {
    createDevMockEventBus,
    seedDefaultFixtures,
    installDevMockConsole,
} from './devMockEvents.js';

// §50 / Cluster L FOLLOWUP 4: shell-specific diagnostic env + build
// for the dump handler. Same shape across all three createBackgroundHost
// call sites (create-from-fresh, create-from-existing, unlock).
const webDiagnosticContext = async () => ({
    env: {
        shell: 'web',
        userAgent:
            typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        platform:
            typeof navigator !== 'undefined' ? navigator.platform : undefined,
    },
    build: {
        walletVersion: WALLET_VERSION,
    },
});
// Which stores this device uses is decided once, in backends.js: IndexedDB +
// localStorage in a browser, the native plugin when the same bundle is running
// inside the Capacitor shell (S2). Every site below asks rather than
// constructing a backend directly, because a mixture - creating into one store
// and reading from the other - presents as "no wallet on this device".
import {
    createStorageBackend,
    createMetaBackend,
    installNativeWipeHook,
    installNativeScreenGuard,
} from './storage/backends.js';
import { installNativeBiometricProvider } from './storage/nativeBiometricProvider.js';
import { installNativeGuardPersistence } from './storage/nativeGuards.js';
import { installDirectUpdateProvider } from './update/directUpdateProvider.js';
import { resolveSdkFactory } from './sdkFactory.js';

const chainRegistry = registryLib.defaultRegistry();

// Dev-mode SDK stub: fallback when `xchain-sdk` isn't resolvable.
//
// Production builds load the real SDK via `resolveSdkFactory` which
// dynamically imports `xchain-sdk`. This stub exists so Node smoke
// tests (no workspace install) + RC builds pre-SDK-pin can still
// exercise the onboarding / read flows.
//
// `deriveAddress` returns deterministic pseudo-addresses per
// (pubkey, type) so createWallet / importMnemonic persist real vault
// records. Signing / broadcast / WIF-import throw loudly; those
// paths have no non-SDK implementation.
//
// The whole mock is gated on `import.meta.env?.PROD`, which Vite
// statically replaces, so a production build dead-code-eliminates the
// entire implementation (and the devFakeBalances dataset it pulls in).
// That is what makes tools/build-reproduce/check-no-dev-mock.sh's grep
// for the mock implementation real evidence: before this gate the mock
// was referenced from live code paths and shipped in every build. The
// `?.` keeps the module importable under raw Node (smoke harness),
// where import.meta.env is undefined and the mock stays available.
// Dev-shell fiat rates: the real §45 price sources (mainnet explorer
// oracle, CoinGecko) aren't reachable from the dev mock environment, so
// seed priceLookup with a fake fetch that serves the devFakeBalances
// rates via the CoinGecko response shape (oracle URLs 404 to force the
// fallback). Same PROD gate as the mock SDK: dead-code-eliminated from
// production builds.
if (!import.meta.env?.PROD) {
    const rates = fakeNativeFiatRates();
    flowsLib.configureFiatRateSource({
        fetch: async (url) => {
            const u = String(url);
            if (u.includes('simple/price')) {
                return {
                    ok: true,
                    json: async () => ({
                        bitcoin: { usd: rates.bitcoin },
                        litecoin: { usd: rates.litecoin },
                        dogecoin: { usd: rates.dogecoin },
                    }),
                };
            }
            // Oracle price_snapshots (and anything else): report
            // unreachable so refreshFiatRates falls back to the fake
            // CoinGecko branch above.
            return { ok: false, status: 404, json: async () => ({}) };
        },
    });
}

// M1.3: one shared event bus across every per-chain mock SDK instance (the
// factory below is called once per chain), so a developer scripting from the
// console doesn't need to know or care which chain's SDK object currently
// holds the subscription - addresses are unique strings regardless. Seeded
// with a couple of fixtures so the dev shell shows pending activity with no
// scripting required (I-36); the `!PROD` gate matches the mock SDK's own so
// this dead-code-eliminates from production the same way.
let devMockEvents = null;
if (!import.meta.env?.PROD) {
    devMockEvents = createDevMockEventBus();
    seedDefaultFixtures(devMockEvents);
    installDevMockConsole(devMockEvents);
}

// The "on-chain-revealed" public key the dev-mock venue serves for an address
// it has seen. A valid compressed-key SHAPE (33 bytes, 02 prefix) so callers
// that measure or parse it behave as they would on chain; it is not derived
// from anything and nothing can sign with it.
const MOCK_RECIPIENT_PUBKEY = `02${'ab'.repeat(32)}`;

const createDevMockSdk = import.meta.env?.PROD ? null : (constructorOpts) => {
    // Each per-chain SDK instance carries its own `network` (chainId)
    // so the fake-balance dataset can return chain-appropriate values.
    const chainId = constructorOpts?.network || 'bitcoin-mainnet';

    // dev-mock "PSBT": a marker-prefixed JSON blob (browser-safe, no
    // Buffer) so encoder.createTx, wallet.decomposePsbt, and
    // decoder.decodeActionFromPsbt round-trip the SAME structure and the
    // confirm-pipeline tamper check stays self-consistent in the dev shell.
    const MOCK_PSBT_MARKER = 'devmockpsbt:';
    const encodeMockPsbt = (obj) => MOCK_PSBT_MARKER + JSON.stringify(obj);
    const decodeMockPsbt = (hex) => {
        if (typeof hex === 'string' && hex.startsWith(MOCK_PSBT_MARKER)) {
            try { return JSON.parse(hex.slice(MOCK_PSBT_MARKER.length)); } catch { /* fall through */ }
        }
        return { inputs: [], outputs: [] };
    };

    // Read-side stub. Any `get*` method the wallet calls before the
    // real SDK has finished loading (or when the real SDK isn't
    // resolvable at all) returns an empty list / zero-balance shape
    // rather than crashing with "X.getBalances is not a function".
    // `getBalances` is overridden to return the realistic dev dataset
    // so the UI has something to render. Methods that mutate or sign
    // throw loudly; those paths have no non-SDK implementation.
    const readStub = new Proxy({}, {
        get(_target, prop) {
            if (typeof prop !== 'string') return undefined;
            if (prop === 'getBalances') {
                // Return the EXPLORER's `/balances/` wire shape
                // (`{ data: [...] }`), not the pre-shaped `{ native, tokens }`
                // object. D-6 moved normalization into
                // `flows/balances.js#tokensFromBalances`, which reads
                // `balResp.data` and silently yields [] for anything else - so
                // the dev shell rendered "No coins yet" on every wallet, and
                // the command palette had no token rows to search (that
                // spec is what caught it). The mock was simply left behind by
                // that refactor.
                return async (address /* , opts */) => ({
                    data: fakeBalanceFor(address, chainId).tokens.map((t) => ({
                        tick: t.tick,
                        quantity: t.quantity,
                        divisibility: t.divisibility,
                        displayName: t.displayName,
                    })),
                });
            }
            if (prop === 'getAddress') {
                // The other half of D-6: the token ledger omits the chain's
                // native coin, which the flow reads from `/address/` as
                // `balances.confirmed` (a DECIMAL string, converted to sats by
                // `nativeFromAddress`). Without this the dev shell showed
                // "0 BTC available" and a disabled Max on a funded wallet.
                return async (address) => {
                    const { native } = fakeBalanceFor(address, chainId);
                    if (!native) return { address, balances: { confirmed: '0' } };
                    const div = Number(native.divisibility ?? 8);
                    const q = String(native.quantity ?? '0');
                    const padded = q.padStart(div + 1, '0');
                    const whole = padded.slice(0, padded.length - div) || '0';
                    const frac = div > 0 ? padded.slice(padded.length - div) : '';
                    return {
                        address,
                        balances: { confirmed: frac ? `${whole}.${frac}` : whole },
                    };
                };
            }
            if (prop === 'getToken') {
                // Single-token lookup powering useTokenInfo + the chart
                // on ManageToken / TokenDetail. Returns the indexer's
                // wire shape (info / supply / locks / market) when the
                // tick is in the dev dataset.
                return async (tick) => fakeTokenInfoFor(tick, chainId);
            }
            if (prop === 'getTokens') {
                // Only the "tokens owned by this address" lookup gets a
                // populated dev response; the substring-search shape
                // (type === 'token') stays empty so dev ReceivePicker
                // doesn't promise fake results from the platform.
                // type === 'subtoken' feeds ManageToken's Subassets list.
                return async (query, type /* , opts */) => {
                    if (type === 'address') return fakeOwnedTokensFor(chainId);
                    if (type === 'subtoken' && query) return fakeSubassetsFor(query, chainId);
                    return [];
                };
            }
            if (prop === 'getIssues') {
                // Genesis (ISSUE) lookup. Only the token-filtered shape
                // is populated: ManageToken takes the latest row and
                // treats it as the genesis event.
                return async (query, type /* , opts */) => {
                    if (type === 'token' && query) return fakeGenesisFor(query, chainId);
                    return [];
                };
            }
            // ManageToken tab panels: Dispensers / Orders / Swaps /
            // Holders / Activity. Real explorer isn't reachable from
            // this build (explorer.xchain.io is not yet provisioned),
            // so the dev mock returns realistic populated rows for the
            // tick-scoped queries that ManageToken issues. Other shapes
            // (address-scoped, market-scoped) stay empty to avoid
            // promising fake results elsewhere in the UI.
            if (prop === 'getDispensers') {
                return async (query, type /* , opts */) => {
                    if (type === 'token' && query) return fakeDispensersFor(query, chainId);
                    return [];
                };
            }
            if (prop === 'getOrders') {
                return async (query, type /* , opts */) => {
                    if (type === 'token' && query) return fakeOrdersFor(query, chainId);
                    return [];
                };
            }
            if (prop === 'getSwaps') {
                return async (query, type /* , opts */) => {
                    if (type === 'token' && query) return fakeSwapsFor(query, chainId);
                    return [];
                };
            }
            if (prop === 'getHistory') {
                return async (query, type /* , opts */) => {
                    if (type === 'token' && query) return fakeHistoryFor(query, chainId);
                    return [];
                };
            }
            if (prop === 'getHolders') {
                return async (tick /* , opts */) => {
                    if (tick) return fakeHoldersFor(tick, chainId);
                    return [];
                };
            }
            if (prop.startsWith('get')) {
                return async () => [];
            }
            return undefined;
        },
    });
    const sdk = {
        wallet: {
            /**
             * @param {string} publicKeyHex
             * @param {{ type?: string }} [opts]
             */
            deriveAddress(publicKeyHex, opts) {
                // No fallback type: mockDeriveAddress reads the chain
                // descriptor's default, which is p2pkh on dogecoin.
                return sdkLib.mockDeriveAddress(chainId, opts?.type, publicKeyHex);
            },
            signPsbt() { throw new Error('Dev SDK stub: signing requires the real xchain-sdk'); },
            validateAddress(addr) {
                return {
                    valid: typeof addr === 'string' && addr.length > 0,
                    type: null,
                    network: null,
                    error: null,
                };
            },
            broadcastTx() { return Promise.reject(new Error('Dev SDK stub: broadcast requires the real xchain-sdk')); },
            importWIF() { throw new Error('Dev SDK stub: WIF import requires the real xchain-sdk'); },
            // The confirm pipeline's tamper check decomposes the PSBT
            // host-side. The dev mock builds its "PSBT" as a marker-prefixed
            // JSON blob (encodeMockPsbt below), so decompose just parses it
            // back - self-consistent with encoder.createTx + decodeActionFromPsbt.
            decomposePsbt(psbtHex) {
                return decodeMockPsbt(psbtHex);
            },
        },
        // confirm pipeline: createAction + encoder.createTx + preflight +
        // decodeActionFromPsbt so the single-encode modal can OPEN, tamper-check,
        // and pre-flight in the dev shell (the real SDK isn't reachable here).
        // Signing still throws by design (see wallet.signPsbt), so Approve fails
        // loudly rather than broadcasting - the confirm-stage flow is what this
        // unblocks, mirroring the real host boundary.
        actions: {
            createAction({ action, params }) {
                // Minimal canonical SEND serializer: ACTION|0|TICK|AMOUNT|DEST[|MEMO].
                const p = params || {};
                const tail = [p.TICK, p.AMOUNT, p.DESTINATION];
                if (p.MEMO != null && p.MEMO !== '') tail.push(p.MEMO);
                return {
                    actionString: [action, '0', ...tail.filter((f) => f != null)].join('|'),
                    action,
                    version: 0,
                };
            },
        },
        encoder: {
            async createTx({ data, pubkey, customOutputs, change }) {
                const changeAddr = change
                    || sdkLib.mockDeriveAddress(chainId, undefined, pubkey);
                const outputs = [
                    // Inline OP_RETURN action carrier (zero value) - but ONLY
                    // when there is an action.: a plain native-coin
                    // payment carries none, and the real encoder now emits no
                    // nulldata output for it. A mock that kept emitting one
                    // would fail the output-set tamper check (which expects no
                    // carrier) and the confirm modal would never open in the
                    // dev shell - a divergence that says nothing about the
                    // product, which is the worst kind of mock behaviour.
                    ...(data
                        ? [{ address: null, scriptPubKeyHex: '6a00', scriptType: 'unknown', value: 0 }]
                        : []),
                    // Any caller custom outputs (native-fee dest / ADS donation).
                    ...(Array.isArray(customOutputs) ? customOutputs : []).map((o) => ({
                        address: String(o.address), scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: Number(o.value),
                    })),
                    // Change back to the wallet's own (source) address.
                    { address: changeAddr, scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 1000 },
                ];
                return { psbt: encodeMockPsbt({ actionString: data, outputs, inputs: [{ index: 0 }] }), encoding: 'OP_RETURN' };
            },
            broadcastTx() { return Promise.reject(new Error('Dev SDK stub: broadcast requires the real xchain-sdk')); },
        },
        decoder: {
            decodeActionFromPsbt(psbtHex) {
                const decoded = decodeMockPsbt(psbtHex);
                return decoded.actionString
                    ? { ok: true, actionString: decoded.actionString }
                    : { ok: false, reason: 'decode-failed' };
            },
        },
        // Best-effort dev pre-flight: parses a SEND string and flags an
        // insufficient balance against the dev balance dataset so the
        // excess-amount fail->fix flow is exercisable; otherwise passes.
        async preflight(actionString, opts) {
            const findings = [{ code: 'DRYRUN_VALID', severity: 'info', message: 'Dev mock: no on-chain dry-run.', source: 'client', overridable: false }];
            let verdict = 'pass';
            try {
                const parts = String(actionString).split('|'); // SEND|0|TICK|AMOUNT|DEST[|MEMO]
                const tick = parts[2];
                const amount = Number(parts[3]);
                const bals = await readStub.getBalances(opts?.source);
                const row = Array.isArray(bals) ? bals.find((b) => String(b.tick).toUpperCase() === String(tick).toUpperCase()) : null;
                // Dev balances are base units (8dp); the SEND amount is display
                // units. Normalize at 8dp (right for the native-coin excess test;
                // a dev approximation for other-decimal tokens).
                const amountBase = amount * 1e8;
                if (row && Number.isFinite(amount) && amountBase > Number(row.quantity ?? row.amount ?? 0)) {
                    verdict = 'fail';
                    // overridable: TRUE, mirroring the real engine. The SDK
                    // registers BALANCE_INSUFFICIENT as `network` in
                    // preflight/constants.js - the check is only as trustworthy
                    // as the explorer balance it read, so §4.2's censorship
                    // argument covers it. A mock that hard-blocks instead would
                    // make the dev shell render a variant with NO "Sign anyway"
                    // control, and every dev-server spec would learn the wrong
                    // trust model from it.
                    findings.push({ code: 'BALANCE_INSUFFICIENT', severity: 'error', overridable: true, source: 'client', message: `Insufficient ${tick}: you don't have ${amount} ${tick}.`, data: { tick, amount } });
                }
            } catch { /* pass by default */ }
            return { schemaVersion: 1, verdict, restricted: false, checksRun: ['BALANCE_INSUFFICIENT'], findings, unverified: [], quote: null, stateHeight: null, elapsedMs: 0 };
        },
        auth: {
            signMessage() { throw new Error('Dev SDK stub: message signing requires the real xchain-sdk'); },
            verifyMessage() { return false; },
            generateChallenge() { return ''; },
        },
        // §46: WebSocket surface so the notification watcher can "connect"
        // against the dev mock without a real explorer WS.
        connectWs() { return Promise.resolve(); },
        disconnectWs() {},
        // M1.3: onAddress/onMempoolAction now actually deliver frames, via
        // the shared devMockEvents bus, scriptable from the console (I-36).
        // Everything else on this WS surface stays inert - out of this row.
        onAddress(address, callback) {
            return devMockEvents ? devMockEvents.onAddress(address, callback) : () => {};
        },
        onMempoolAction(address, callback) {
            return devMockEvents ? devMockEvents.onMempoolAction(address, callback) : () => {};
        },
        onOrderMatch() { return () => {}; },
        onDispenser() { return () => {}; },
        onCoinpayRequired() { return () => {}; },
        // getUnconfirmed(address): explorer field names verbatim, served
        // from the fixtures store (I-10). Explicit on `sdk` (not the
        // readStub's generic get*() -> [] fallback) so it can honor a limit
        // and filter by source/destinations rather than always returning [].
        getUnconfirmed(address, opts) {
            return Promise.resolve(devMockEvents ? devMockEvents.getUnconfirmed(address, opts) : []);
        },
        // getPublicKey(address): has the chain ever seen this address SPEND?
        //
        // Explicit here because the readStub's generic `get*() -> []` fallback
        // is actively wrong for this one call. An empty array is not a public
        // key, but it IS truthy, so every caller read it as "found": compose
        // reported "✓ Recipient public key found." for every address ever
        // typed, and the first-contact surface behind the missing-key banner -
        // the plaintext fallback and the "Request encrypted session" handshake -
        // could not be reached in the dev shell at all.
        //
        // The rule mirrors the chain's: a key exists only for an address the
        // wallet itself derived (dev-mock shape, so it has "spent" as far as
        // this venue is concerned). Any real address is one this venue has
        // never seen, which is what first contact means.
        getPublicKey(address) {
            return Promise.resolve(sdkLib.isDevMockAddress(address) ? MOCK_RECIPIENT_PUBKEY : null);
        },
    };
    // Compose: explicit fields (wallet/auth) win; everything else falls
    // through to the read stub so any sdk.getXxx() call resolves to [].
    return new Proxy(sdk, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            return Reflect.get(readStub, prop, receiver);
        },
    });
};

// Pre-resolution placeholder for PRODUCTION builds, where
// the dev mock is compiled out. Any SDK call that lands before the real
// factory swaps in (or after it failed to load) throws loudly instead of
// serving fabricated data. Callable-and-traversable so both
// `sdk.getBalances(...)` and `sdk.wallet.deriveAddress(...)` shapes hit
// the throw rather than a confusing "not a function".
function makeLoadingSdkSurface() {
    const thrower = () => {
        throw new Error(
            '[xchain-wallet/web] xchain-sdk is not loaded yet (or failed to '
            + 'load); refusing to serve data. See sdkResolved.',
        );
    };
    return new Proxy(thrower, {
        get(_target, prop) {
            // Not a thenable: `await sdk` must not recurse into the proxy.
            if (prop === 'then') return undefined;
            return makeLoadingSdkSurface();
        },
        apply() { return thrower(); },
    });
}
const createLoadingSdk = () => makeLoadingSdkSurface();

// Build the SDKRegistry against a boot-time-resolved factory. Starts
// with the dev mock (dev builds) or a throwing placeholder (production,
// where the mock is DCE-d out) so the module is usable synchronously;
// the real factory swaps in once the dynamic import settles. A lazy
// swap like this is safe because `SDKRegistry._instances` caches per
// chain, so early-bind calls (onboarding) get the boot factory and
// post-resolution calls (Send) get the real SDK. For a clean production
// run users should onboard AFTER the swap; the `sdkResolved` promise
// below gives callers a handle on that.
let sdkRegistry = new sdkLib.SDKRegistry({
    chainRegistry,
    sdkFactory: createDevMockSdk ?? createLoadingSdk,
});

export const sdkResolved = resolveSdkFactory({ devMockFactory: createDevMockSdk })
    .then((result) => {
        sdkRegistry = new sdkLib.SDKRegistry({
            chainRegistry,
            sdkFactory: result.factory,
        });
        return result.source;
    })
    .catch((err) => {
        // Never swallow the production refusal. sdkFactory.js throws
        // precisely so a shipped wallet cannot silently run without the real
        // SDK; discarding that here (the old `.catch(() => 'dev-mock')`) left
        // the registry on the mock with no symptom.
        //
        // The dev branch that returned 'dev-mock' here is gone too.
        // resolveSdkFactory now picks its venue up front and only rejects when
        // the venue it was TOLD to use could not be built - asking for the real
        // SDK and quietly getting fake balances instead is the exact failure
        // this item was raised for. Log loudly and re-throw in every build; the
        // registry stays on its boot factory (the dev mock in a dev build, the
        // throwing placeholder in production, where the mock does not exist).
        console.error('[xchain-wallet/web] SDK resolution failed:', err);
        throw err;
    });

// Every path that binds a signer pool and a host awaits this first. Those
// two capture the `sdkRegistry` VALUE at bind time, so a wallet unlocked
// before the real factory swapped in kept the boot placeholder for the
// whole session: on a slow link a quick password after the network-switch
// reload beat the 1.9 MB SDK chunk, and every derive, balance and
// notification call then failed with "xchain-sdk is not loaded yet" until
// the user locked and unlocked again. A failed load is NOT swallowed here:
// the registry stays on the placeholder, which throws per call by design,
// and `sdkResolved` itself still rejects for anyone who reads it.
async function sdkBound() {
    try {
        await sdkResolved;
    } catch (_err) {
        /* already logged by sdkResolved's own catch */
    }
}

/** Default active chains for onboarding. Users can change later via Settings. */
export const DEFAULT_ACTIVE_CHAIN_IDS = [
    'bitcoin-mainnet',
    'dogecoin-mainnet',
    'litecoin-mainnet',
];

let host = null;
let vault = null;
let signerPool = null;
let notificationService = null;
let priceAlertWatcher = null;
let governancePollWatcher = null;
let coinpayAutopayWatcher = null;
let deadlineWatcher = null;
let dispenserEscrowWatcher = null;
let priceOracleInstance = null;

// Seen-state key for the governance-poll watcher (localStorage): notify-once
// bookkeeping only (chain → open-poll ids already announced), no secrets.
const GOV_POLL_SEEN_KEY = 'xchain.governancePolls.seen';
// Same for the PC-45 deadline watcher (chain -> announced kind:actionIndex).
const DEADLINE_SEEN_KEY = 'xchain.deadlines.seen';
// PC-46: chain -> announced `actionIndex:bucket` keys.
const DISPENSER_ESCROW_SEEN_KEY = 'xchain.dispenserEscrow.seen';

// §46: start the live notification watcher once a vault + host exist. All
// three host-creation paths (create / import / unlock) call this; lock stops
// it. Idempotent: a second call while already running is a no-op. `getFlows`
// is hoisted (a function declaration below), so referencing it here is safe.
function startNotifications() {
    if (notificationService || !vault) return;
    notificationService = new notificationsLib.NotificationService({
        getActiveAddresses: async () => {
            const flowsNs = await getFlows();
            const settings = await flowsNs.getSettings(vault);
            return notificationsLib.getActiveAddresses(vault, chainRegistry, {
                activeNetwork: settings.activeNetwork,
            });
        },
        getSdkForChain: (chainId) => sdkRegistry.get(chainId),
        getSettings: async () => {
            const flowsNs = await getFlows();
            return flowsNs.getSettings(vault);
        },
        notify: createWebNotifyAdapter(),
        getPendingTxids: () => notificationsLib.getBroadcastTxids(vault),
        onTxConfirmed: (txid) => notificationsLib.markPendingTxIndexed(vault, txid),
        onMempoolSeen: (txid) => notificationsLib.markPendingTxMempoolSeen(vault, txid),
        logger: console,
    });
    notificationService.start().catch((err) => {
        console.error('[xchain] notification watcher start failed:', err);
    });

    // §46 price-alert poll watcher: same lifecycle, same notify adapter.
    if (!priceAlertWatcher && typeof globalThis.fetch === 'function') {
        priceAlertWatcher = new notificationsLib.PriceAlertWatcher({
            getNativePrices: async ({ chainIds, fiatCurrency }) => {
                if (!priceOracleInstance) {
                    const flowsNs = await getFlows();
                    priceOracleInstance = flowsNs.createPriceOracle({ fetch: globalThis.fetch.bind(globalThis) });
                }
                return priceOracleInstance.getNativePrices({ chainIds, fiatCurrency });
            },
            listArmedAlerts: () => vault.priceAlerts.list(),
            getSettings: async () => {
                const flowsNs = await getFlows();
                return flowsNs.getSettings(vault);
            },
            notify: createWebNotifyAdapter(),
            markTriggered: async (id) => {
                const flowsNs = await getFlows();
                return flowsNs.markAlertTriggered({ vault, id });
            },
            logger: console,
        });
        priceAlertWatcher.start();
    }

    // §46 governance-poll watcher: notifies when a new VOTE poll opens over a
    // held token (binding polls flagged). Same lifecycle, same notify adapter;
    // seen-state persists in localStorage so a reload doesn't re-baseline.
    if (!governancePollWatcher) {
        governancePollWatcher = new notificationsLib.GovernancePollWatcher({
            getActiveAddresses: async () => {
                const flowsNs = await getFlows();
                const settings = await flowsNs.getSettings(vault);
                return notificationsLib.getActiveAddresses(vault, chainRegistry, {
                    activeNetwork: settings.activeNetwork,
                });
            },
            getSdkForChain: (chainId) => sdkRegistry.get(chainId),
            getSettings: async () => {
                const flowsNs = await getFlows();
                return flowsNs.getSettings(vault);
            },
            notify: createWebNotifyAdapter(),
            loadSeen: () => {
                try { return JSON.parse(globalThis.localStorage?.getItem(GOV_POLL_SEEN_KEY) || 'null'); }
                catch (_err) { return null; }
            },
            saveSeen: (seen) => {
                try { globalThis.localStorage?.setItem(GOV_POLL_SEEN_KEY, JSON.stringify(seen)); }
                catch (_err) { /* quota/private-mode: fall back to in-session only */ }
            },
            logger: console,
        });
        governancePollWatcher.start();
    }

    // PC-45: deadline watcher. COINPAY obligations (PC-15) and unstake
    // cooldowns (PC-47) own their own timers; this deep-links to them.
    if (!deadlineWatcher) {
        deadlineWatcher = new notificationsLib.DeadlineWatcher({
            getActiveAddresses: async () => {
                const flowsNs = await getFlows();
                const settings = await flowsNs.getSettings(vault);
                return notificationsLib.getActiveAddresses(vault, chainRegistry, {
                    activeNetwork: settings.activeNetwork,
                });
            },
            getSdkForChain: (chainId) => sdkRegistry.get(chainId),
            getSettings: async () => {
                const flowsNs = await getFlows();
                return flowsNs.getSettings(vault);
            },
            coinForChain: (chainId) => chainRegistry.get(chainId)?.coin || null,
            notify: createWebNotifyAdapter(),
            loadSeen: () => {
                try { return JSON.parse(globalThis.localStorage?.getItem(DEADLINE_SEEN_KEY) || 'null'); }
                catch (_err) { return null; }
            },
            saveSeen: (seen) => {
                try { globalThis.localStorage?.setItem(DEADLINE_SEEN_KEY, JSON.stringify(seen)); }
                catch (_err) { /* quota/private-mode: fall back to in-session only */ }
            },
            logger: console,
        });
        deadlineWatcher.start();
    }

    // PC-46: low-escrow alert. Auto-refill stays deferred (no per-event
    // consent); this deep-links to PC-19's refill stage instead.
    if (!dispenserEscrowWatcher) {
        dispenserEscrowWatcher = new notificationsLib.DispenserEscrowWatcher({
            getActiveAddresses: async () => {
                const flowsNs = await getFlows();
                const settings = await flowsNs.getSettings(vault);
                return notificationsLib.getActiveAddresses(vault, chainRegistry, {
                    activeNetwork: settings.activeNetwork,
                });
            },
            getSdkForChain: (chainId) => sdkRegistry.get(chainId),
            getSettings: async () => {
                const flowsNs = await getFlows();
                return flowsNs.getSettings(vault);
            },
            notify: createWebNotifyAdapter(),
            loadSeen: () => {
                try { return JSON.parse(globalThis.localStorage?.getItem(DISPENSER_ESCROW_SEEN_KEY) || 'null'); }
                catch (_err) { return null; }
            },
            saveSeen: (seen) => {
                try { globalThis.localStorage?.setItem(DISPENSER_ESCROW_SEEN_KEY, JSON.stringify(seen)); }
                catch (_err) { /* quota/private-mode: fall back to in-session only */ }
            },
            logger: console,
        });
        dispenserEscrowWatcher.start();
    }

    // PC-16 CoinPay auto-pay engine. Web caveat (stated in the order
    // form's one-time acknowledgment): it only runs while this tab is
    // open. The payer lease in the vault keeps two tabs from paying the
    // same match twice.
    if (!coinpayAutopayWatcher && host) {
        coinpayAutopayWatcher = new notificationsLib.CoinpayAutopayWatcher({
            vault,
            sdkRegistry,
            chainRegistry,
            getSigner: (walletId) => (signerPool ? signerPool.get(walletId) : null),
            reservationLedger: host.reservationLedger,
            notify: createWebNotifyAdapter(),
            shellKind: 'web',
            logger: console,
        });
        coinpayAutopayWatcher.start();
        coinpayAutopayWatcher.refresh().catch(() => { /* WS triggers are best-effort */ });
    }
}

function stopNotifications() {
    if (notificationService) {
        try { notificationService.stop(); } catch (_err) { /* best-effort */ }
        notificationService = null;
    }
    if (priceAlertWatcher) {
        try { priceAlertWatcher.stop(); } catch (_err) { /* best-effort */ }
        priceAlertWatcher = null;
    }
    if (governancePollWatcher) {
        try { governancePollWatcher.stop(); } catch (_err) { /* best-effort */ }
        governancePollWatcher = null;
    }
    if (deadlineWatcher) {
        try { deadlineWatcher.stop(); } catch (_err) { /* best-effort */ }
        deadlineWatcher = null;
    }
    if (dispenserEscrowWatcher) {
        try { dispenserEscrowWatcher.stop(); } catch (_err) { /* best-effort */ }
        dispenserEscrowWatcher = null;
    }
    if (coinpayAutopayWatcher) {
        try { coinpayAutopayWatcher.stop(); } catch (_err) { /* best-effort */ }
        coinpayAutopayWatcher = null;
    }
}

/**
 * Classify the current wallet-session state. Matches the extension's
 * `session.status` response shape so route code can be shared verbatim.
 *
 * @returns {Promise<{ hasWallet: boolean, hasSession: boolean, state: 'no-wallet' | 'locked' | 'unlocked' }>}
 */
export async function getSessionStatus() {
    // Boot hook for the native shells (S2). This is the first thing
    // the app awaits, and it runs again on every refresh, which is what keeps
    // the biometric enrollment flag honest after the user enrolls, disables,
    // or re-registers a fingerprint in system settings. No-op in a browser.
    try {
        installNativeWipeHook();
        installNativeScreenGuard();
        await installNativeBiometricProvider();
        // SSC-7, and the await is load-bearing rather than tidy: the lockout
        // ladder, the duress passphrase and the panic freeze are all read
        // SYNCHRONOUSLY by the Locked screen, so mounting before this
        // resolves answers "no lockout, no duress, no freeze" - the
        // permissive answer to all three.
        await installNativeGuardPersistence();
        // §6 / D4. Asks the native shell which lane installed this
        // build and installs the update-notice provider ONLY for a direct
        // APK. A browser, the extension, the desktop app, an iOS build and a
        // Play install all answer "not this lane" and get no provider, which
        // is what keeps an in-app update prompt out of every store build.
        await installDirectUpdateProvider();
    } catch (_err) {
        // A provider that cannot install must not stop the wallet from
        // opening: the password form is the path that always works.
    }
    const storage = createStorageBackend();
    // A throw here is deliberate and must NOT be caught into a default. On a
    // native shell `load()` distinguishes "no wallet" from "locked keystore"
    // and "unreadable blob"; App.jsx renders the rejection as an error state,
    // which is the whole point. Swallowing it would report no-wallet and
    // offer to create one over the top of the vault that is still there.
    const blob = await storage.load();
    const hasWallet = blob !== null;
    const hasSession = host !== null;
    return {
        hasWallet,
        hasSession,
        state: !hasWallet ? 'no-wallet' : hasSession ? 'unlocked' : 'locked',
    };
}

export class InvalidPasswordError extends Error {
    constructor() {
        super('Incorrect password.');
        this.name = 'InvalidPasswordError';
    }
}

export class NoVaultError extends Error {
    constructor() {
        super('No wallet exists to unlock.');
        this.name = 'NoVaultError';
    }
}

/**
 * Create a fresh BIP39 wallet. Generates kdfParams, derives the master
 * key from `password`, opens a blank Vault, runs the core `createWallet`
 * flow, persists kdfParams to the meta slot, and leaves the host live
 * so the app transitions to `unlocked` on the next `getSessionStatus`.
 *
 * @param {{ password: string, name?: string, strengthBits?: 128 | 160 | 192 | 224 | 256, bip39Passphrase?: string, activeChainIds?: string[] }} req
 * @returns {Promise<{ mnemonic: string, walletName: string }>}
 */
export async function createWalletLocal(req) {
    const password = req?.password;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.create: password is required');
    }
    const {
        name = 'Main Wallet',
        strengthBits = 128,
        bip39Passphrase = '',
        activeChainIds = DEFAULT_ACTIVE_CHAIN_IDS,
    } = req;

    const meta = createMetaBackend();
    await assertFreshVault({ metaBackend: meta, storageBackend: createStorageBackend() });

    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    try {
        const storage = createStorageBackend();
        const v = new storageLib.Vault({ backend: storage, masterKey });
        await v.open();  // blank document
        const flowsNs = await getFlows();
        const result = await flowsNs.createWallet({
            password,
            vault: v,
            chainRegistry,
            sdkRegistry,
            activeChainIds,
            name,
            strengthBits,
            bip39Passphrase,
            kdfParams,
        });
        await v.save();
        vault = v;
        await sdkBound();
        signerPool = new signersLib.SignerPool();
        await signerPool.populate({
            vault,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
        host = createBackgroundHost({
            vault,
            chainRegistry,
            sdkRegistry,
            signerPool,
            getDiagnosticContext: webDiagnosticContext,
        });
        startNotifications();
        await meta.save({ kdfParams });
        return { mnemonic: result.mnemonic, walletName: result.wallet.name };
    } finally {
        masterKey.fill(0);
    }
}

/**
 * Import a pre-existing mnemonic (BIP39 12/24-word or Counterwallet
 * legacy 12-word). Same persistence path as `createWalletLocal`: fresh
 * kdfParams, open vault, run the core `importMnemonic` flow, save meta.
 *
 * @param {{ password: string, mnemonic: string, name?: string, bip39Passphrase?: string, activeChainIds?: string[] }} req
 * @returns {Promise<{ format: 'bip39' | 'counterwallet-legacy', walletName: string }>}
 */
export async function importMnemonicLocal(req) {
    const password = req?.password;
    const mnemonic = req?.mnemonic;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.import: password is required');
    }
    if (typeof mnemonic !== 'string' || mnemonic.trim().length === 0) {
        throw new Error('wallet.import: mnemonic is required');
    }
    const {
        name = 'Imported Wallet',
        bip39Passphrase = '',
        activeChainIds = DEFAULT_ACTIVE_CHAIN_IDS,
    } = req;

    const meta = createMetaBackend();
    await assertFreshVault({ metaBackend: meta, storageBackend: createStorageBackend() });

    // Reject an unusable phrase BEFORE deriving the master key. Argon2id
    // is synchronous and pegs the main thread for seconds, and the vault
    // open behind it costs more still - so a single typo on the recovery
    // screen used to freeze the UI before it could say "that phrase is
    // not valid". The format check is microseconds and importMnemonic
    // re-validates anyway, so this is a fast path, not a second gate.
    const flowsNs = await getFlows();
    if (!flowsNs.detectMnemonicFormat(flowsNs.normalizeMnemonic(mnemonic))) {
        throw new Error(
            'That recovery phrase is not valid. Check for typos, missing words, or a phrase from a different wallet.',
        );
    }

    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    try {
        const storage = createStorageBackend();
        const v = new storageLib.Vault({ backend: storage, masterKey });
        await v.open();
        const result = await flowsNs.importMnemonic({
            password,
            mnemonic,
            vault: v,
            chainRegistry,
            sdkRegistry,
            activeChainIds,
            name,
            bip39Passphrase,
            kdfParams,
        });
        await v.save();
        vault = v;
        await sdkBound();
        signerPool = new signersLib.SignerPool();
        await signerPool.populate({
            vault,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
        host = createBackgroundHost({
            vault,
            chainRegistry,
            sdkRegistry,
            signerPool,
            getDiagnosticContext: webDiagnosticContext,
        });
        startNotifications();
        await meta.save({ kdfParams });
        // `walletId` rides along because the fresh-install caller may need to
        // keep working with the wallet it just made: the pairing lane
        // imports the shared phrase here and then asks the host to derive that
        // wallet's pairing payload, which is addressed BY id. Without it the
        // lane imported the phrase and then dead-ended on "the shell returned
        // no wallet id" - a hard stop after the wallet already existed.
        return { format: result.format, walletName: result.wallet.name, walletId: result.wallet.id };
    } finally {
        masterKey.fill(0);
    }
}

/**
 * Restore an encrypted §19.4 backup onto a FRESH install.
 *
 * Web twin of the extension/desktop pre-host `wallet.importBackup.fresh`.
 * `importBackupRequest` goes through the in-page host, and on a device with no
 * wallet there is no host yet - so the restore lane had nothing to talk to.
 * This creates the vault under the new device password first, then runs the
 * same core merge.
 *
 * Three secrets, three different things: `password` is what this
 * browser will unlock with from now on, `backupPassword` opens the file, and
 * `walletPassword` opens the backed-up wallet's own seal. The user may pick a
 * genuinely new `password` because `importBackupFile` re-keys the restored
 * seal onto it.
 *
 * `writes` and `skipped` are `importBackupFile`'s per-COLLECTION records, not
 * totals: the same `ImportBackupFileResult` shape core returns.
 *
 * @param {{ password: string, backupPassword: string, walletPassword: string, fileContent?: string, pointer?: object }} req
 * @returns {Promise<{ walletId: string, walletName?: string, writes?: { wallets: number, accounts: number, addresses: number, contacts: number, connectedSites: number, pendingTxs: number, settings: boolean }, skipped?: { wallets: number, accounts: number, addresses: number, contacts: number, connectedSites: number, pendingTxs: number, settings: boolean }, rekeyed: boolean }>}
 *   The same five fields `handleWalletImportBackup` resolves on the other two
 *   shells, so a screen rendering the per-record merge counts reads one shape
 *   everywhere.
 */
export async function importBackupLocal(req) {
    const password = req?.password;
    const backupPassword = req?.backupPassword;
    const walletPassword = req?.walletPassword;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.importBackup: password is required (the password this device will unlock with)');
    }
    if (typeof backupPassword !== 'string' || backupPassword.length === 0) {
        throw new Error('wallet.importBackup: backupPassword is required (it opens the backup file)');
    }
    if (typeof walletPassword !== 'string' || walletPassword.length === 0) {
        throw new Error("wallet.importBackup: walletPassword is required (it opens the backed-up wallet's seed)");
    }
    const hasContent = typeof req.fileContent === 'string' && req.fileContent.trim().length > 0;
    const hasPointer = req.pointer != null;
    if (!hasContent && !hasPointer) {
        throw new Error('wallet.importBackup: fileContent or pointer is required');
    }

    const meta = createMetaBackend();
    await assertFreshVault({ metaBackend: meta, storageBackend: createStorageBackend() });

    const flowsNs = await getFlows();
    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    try {
        const storage = createStorageBackend();
        const v = new storageLib.Vault({ backend: storage, masterKey });
        await v.open();
        const common = {
            vault: v,
            password: backupPassword,
            walletPassword,
            devicePassword: password,
            mode: 'fresh',
        };
        // Nothing is persisted or unlocked until the merge has actually
        // succeeded: a wrong wallet password leaves the install fresh and
        // retryable rather than half-onboarded.
        const result = hasPointer
            ? await flowsNs.restoreFromBackupPointer({
                ...common,
                pointer: req.pointer,
                resolveBackupContent: resolveBackupPointerContent,
            })
            : await flowsNs.importBackupFile({ ...common, fileContent: req.fileContent });
        await v.save();
        vault = v;
        await sdkBound();
        signerPool = new signersLib.SignerPool();
        // The restored seal now opens under `password`, which is exactly why
        // the re-key had to happen first: populate would otherwise skip the
        // wallet silently and the user would meet it at their first spend.
        await signerPool.populate({
            vault,
            password,
            chainRegistry,
            sdkRegistry,
        });
        host = createBackgroundHost({
            vault,
            chainRegistry,
            sdkRegistry,
            signerPool,
            getDiagnosticContext: webDiagnosticContext,
        });
        startNotifications();
        await meta.save({ kdfParams });
        return {
            walletId: result.walletId,
            walletName: result.payload?.wallet?.name,
            writes: result.writes,
            skipped: result.skipped,
            rekeyed: result.rekeyed,
        };
    } finally {
        masterKey.fill(0);
    }
}

/** Lazy-load the flows namespace so tests that don't touch onboarding
 * don't pay the cost of pulling every flow + BIP39 wordlist at module
 * init. */
let _flowsCache = null;
async function getFlows() {
    if (_flowsCache) return _flowsCache;
    const mod = await import('@xchain-wallet/core');
    _flowsCache = mod.flows;
    return _flowsCache;
}

/**
 * Derive the master key from `password`, open the encrypted vault,
 * and build the MessageHost in-page.
 *
 * @param {{ password: string, bip39Passphrase?: string }} req   `bip39Passphrase` is the
 *   §15.6 25th word; supplied, it unlocks every passphrase-enabled wallet into the pool
 *   and is checked against each one's stored addresses (a wrong one is refused, not
 *   silently accepted as a different seed)
 * @returns {Promise<{ unlocked: true, passphraseCaptureNeeded: Array<{ id: string, name: string }> }>}
 *   `passphraseCaptureNeeded` lists the legacy wallets the password opened but that hold no
 *   stored passphrase yet; the unlock screen asks for each one's 25th word once and sends it
 *   to `wallet.passphrase.capture` (§3.4)
 */
export async function unlockWalletLocal(req) {
    const password = req?.password;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.unlock: password is required');
    }
    const bip39Passphrase = typeof req?.bip39Passphrase === 'string' ? req.bip39Passphrase : '';
    const meta = /** @type {any} */ (await createMetaBackend().load());
    if (!meta || !meta.kdfParams) {
        throw new NoVaultError();
    }

    // NO host-side pre-KDF throttle on this lane, by omission of a store
    // rather than by an in-page equivalent. The extension and desktop pass
    // `unlockThrottleStore` into `handleWalletUnlock`, which refuses a
    // locked-out attempt before Argon2id runs; this shell has none, so the §26
    // ladder here is the Locked screen's own (core `lockoutTracking`, persisted
    // on the native shells by `installNativeGuardPersistence`). That gate is
    // UI-level: a caller reaching this function directly is not counted, and
    // every attempt costs a full KDF.
    const masterKey = cryptoLib.deriveMasterKey(password, meta.kdfParams);
    try {
        const storage = createStorageBackend();
        const v = new storageLib.Vault({ backend: storage, masterKey });
        try {
            await v.open();
        } catch (err) {
            if (isAeadAuthFailure(err)) throw new InvalidPasswordError();
            throw err;
        }
        vault = v;

        // Populate the SignerPool while the password is in scope so
        // subsequent HD-derive ops (account.create, receive.getAddress
        // for software signers) reuse pre-unlocked signers without
        // re-prompting. Pool is cleared in lockWalletLocal.
        await sdkBound();
        signerPool = new signersLib.SignerPool();
        const pooled = await signerPool.populate({
            vault,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
        // A typed 25th word that reproduced NONE of the passphrase wallets'
        // addresses is a mistype, and the honest answer is to stay on the
        // unlock screen with the field marked, not to open a session whose
        // signer silently owns different coins. The password itself was
        // right, so nothing counts against the lockout. When at least one
        // passphrase wallet matched, the unlock stands and the others sit
        // out until the next unlock, exactly as if no passphrase was typed.
        if (bip39Passphrase && pooled.passphraseMismatch.length > 0 && pooled.passphraseMatched.length === 0) {
            try { signerPool.lockAll(); } catch (_err) { /* best-effort */ }
            signerPool = null;
            try { v.close(); } catch (_err) { /* best-effort */ }
            vault = null;
            throw new flowsLib.PassphraseMismatchError(pooled.passphraseMismatchNames);
        }

        host = createBackgroundHost({
            vault,
            chainRegistry,
            sdkRegistry,
            signerPool,
            getDiagnosticContext: webDiagnosticContext,
        });
        startNotifications();
        // Legacy passphrase wallets the password opened but that hold no
        // stored 25th word yet. The pool reports them as two parallel arrays;
        // zip them here so the caller cannot pair the wrong name with the
        // wrong wallet.
        return {
            unlocked: true,
            passphraseCaptureNeeded: pooled.passphraseCaptureNeeded.map((id, i) => ({
                id,
                name: pooled.passphraseCaptureNames[i] || '',
            })),
        };
    } finally {
        masterKey.fill(0);
    }
}

/**
 * Close the vault + drop the host. Matches the extension's
 * `wallet.lock` behaviour.
 *
 * @returns {Promise<{ locked: true }>}
 */
export async function lockWalletLocal() {
    stopNotifications();
    if (signerPool) {
        try { signerPool.lockAll(); } catch (_err) { /* best-effort */ }
    }
    signerPool = null;
    if (vault) {
        try { vault.close(); } catch (_err) { /* best-effort */ }
    }
    vault = null;
    host = null;
    return { locked: true };
}

/**
 * Envelope-returning host dispatcher. Matches the `sendMessage` shape
 * used by the extension's popup so route code is swap-compatible.
 *
 * @param {string} type
 * @param {unknown} [request]
 * @returns {Promise<unknown>}
 */
export async function sendMessage(type, request) {
    if (!host) {
        throw Object.assign(new Error('wallet is locked'), { name: 'VaultClosedError' });
    }
    const response = await host.handle({ type, request });
    if (response.ok) return response.result;
    // Keeps `code` and the THROTTLED hints the envelope now carries; rebuilding
    // with name+message alone dropped them.
    throw hydrateEnvelopeError(response.error);
}

/** Test hook: expose module state without touching real IDB/localStorage. */
export function __resetForTests() {
    stopNotifications();
    vault = null;
    host = null;
}

function isAeadAuthFailure(err) {
    if (!err) return false;
    const name = err.name || '';
    const msg = err.message || String(err);
    return (
        name === 'OperationError' ||
        name === 'InvalidAccessError' ||
        /operation[- ]?error|auth|tag/i.test(msg)
    );
}
