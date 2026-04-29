// Diagnostic dump — §50. One-shot collection of non-sensitive wallet
// state for user-pasted bug reports. The goal per §50.2 is "a blob
// that makes bug reports productive without leaking anything
// sensitive."
//
// Strict redaction. This file is the single place in the codebase
// where we assemble a user-pastable snapshot, so the redaction rules
// live here in one list:
//
//   NEVER include: mnemonics, WIFs, passphrases, encrypted blobs, any
//                  address string, any balance, any txid, contact
//                  details, connected-site details.
//   COUNT ONLY:    wallets, accounts, addresses, contacts,
//                  connected-sites, pending-txs.
//   INCLUDE:       non-sensitive settings (theme, autolock, fiat,
//                  privacy flags, ADS counters), chain descriptor ids
//                  + kind, default endpoints, signer kinds, recent
//                  errors (truncated), build metadata.
//   HASH (Cluster L FOLLOWUP 3): user-supplied free-form text that
//                  could identify the wallet — custom endpoint URLs.
//                  Replaced with `redacted:sha256:<8-hex>` so two
//                  dumps from the same user remain comparable without
//                  exposing the original string.
//
// Callers pass optional `recentErrors` (last N from the shell's
// error hook), `signers` (installed signer kinds — just type/model,
// no device identifiers), `build` (bundle metadata), and environment
// info (platform/os/browser). All optional; missing fields become
// `null` in the output rather than throwing, so a diagnostic dump is
// always producible even on a half-configured wallet.

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

const RECENT_ERRORS_LIMIT = 50;
const ERROR_MESSAGE_LIMIT = 500;
const REDACTED_HASH_PREFIX_LEN = 8;

/**
 * @typedef {Object} DiagnosticDumpEnv
 * @property {string} [platform]         e.g. 'extension-chrome', 'desktop-electron', 'web'
 * @property {string} [os]               e.g. 'macOS 14.5'
 * @property {string} [browser]          e.g. 'Chrome 126'
 */

/**
 * @typedef {Object} DiagnosticSignerSummary
 * @property {'software' | 'trezor' | 'ledger' | 'multisig' | 'airgap'} kind
 * @property {string} [model]            HW device model (Trezor One, Ledger Nano X…)
 * @property {string} [firmware]         HW firmware string (redacted of serials)
 */

/**
 * @typedef {Object} DiagnosticBuild
 * @property {string} [buildId]
 * @property {string} [buildDate]
 * @property {string} [gitCommit]        short sha only — never include branch/tag privately
 */

/**
 * @typedef {Object} DiagnosticError
 * @property {string} at                 ISO timestamp
 * @property {string} kind               error class/name
 * @property {string} message            truncated to {@link ERROR_MESSAGE_LIMIT} chars
 * @property {string} [phase]            optional context like 'encoding', 'broadcasting'
 */

/**
 * @typedef {Object} DiagnosticDumpOpts
 * @property {import('../storage/Vault.js').Vault} [vault]                  optional; when supplied, counts are populated
 * @property {import('../registry/index.js').ChainRegistry} [chainRegistry]
 * @property {string} [walletVersion]
 * @property {string} [sdkVersion]
 * @property {DiagnosticDumpEnv} [env]
 * @property {DiagnosticBuild} [build]
 * @property {DiagnosticSignerSummary[]} [signers]
 * @property {DiagnosticError[]} [recentErrors]
 */

/**
 * @typedef {Object} DiagnosticDump
 * @property {{ version: string | null, platform: string | null, os: string | null, browser: string | null }} wallet
 * @property {{ version: string | null }} sdk
 * @property {Array<{ id: string, coin: string, networkKind: string, isUserAdded: boolean }>} chains
 * @property {Array<{ chainId: string, explorerUrl: string, encoderUrl: string, hubUrl: string, custom: boolean }>} endpoints
 * @property {DiagnosticSignerSummary[]} signers
 * @property {Record<string, unknown>} settings
 * @property {DiagnosticError[]} recent_errors
 * @property {{ wallets: number, accounts: number, addresses: number, contacts: number, connected_sites: number, pending_txs: number }} counts
 * @property {DiagnosticBuild | null} build
 * @property {string} generatedAt
 */

/**
 * @param {DiagnosticDumpOpts} opts
 * @returns {Promise<DiagnosticDump>}
 */
export async function diagnosticDump(opts = {}) {
    const {
        vault,
        chainRegistry,
        walletVersion = null,
        sdkVersion = null,
        env = {},
        build = null,
        signers = [],
        recentErrors = [],
    } = opts;

    const chains = chainRegistry
        ? chainRegistry.supportedChains().map((d) => ({
              id: d.id,
              coin: d.coin,
              networkKind: d.networkKind,
              isUserAdded: d.isUserAdded === true,
          }))
        : [];

    let settingsSnapshot = null;
    if (vault) {
        try {
            settingsSnapshot = await vault.settings.get();
        } catch {
            settingsSnapshot = null;
        }
    }

    const endpoints = chainRegistry
        ? chainRegistry.supportedChains().map((d) => {
              const override = settingsSnapshot?.sdkEndpoints?.[d.id];
              if (override) {
                  return {
                      chainId: d.id,
                      explorerUrl: redactCustomUrl(override.explorerUrl),
                      encoderUrl: redactCustomUrl(override.encoderUrl),
                      hubUrl: redactCustomUrl(override.hubUrl),
                      custom: override.custom === true,
                  };
              }
              return {
                  chainId: d.id,
                  explorerUrl: joinEndpoint(d.explorer),
                  encoderUrl: joinEndpoint(d.encoder),
                  hubUrl: joinEndpoint(d.hub),
                  custom: false,
              };
          })
        : [];

    const counts = {
        wallets: 0,
        accounts: 0,
        addresses: 0,
        contacts: 0,
        connected_sites: 0,
        pending_txs: 0,
    };
    if (vault) {
        // Count only. Never enumerate records.
        const [wCount, aCount, addrCount, cCount, csCount, pCount] = await Promise.all([
            safeCount(vault.wallets),
            safeCount(vault.accounts),
            safeCount(vault.addresses),
            safeCount(vault.contacts),
            safeCount(vault.connectedSites),
            safeCount(vault.pendingTxs),
        ]);
        counts.wallets = wCount;
        counts.accounts = aCount;
        counts.addresses = addrCount;
        counts.contacts = cCount;
        counts.connected_sites = csCount;
        counts.pending_txs = pCount;
    }

    /** @type {DiagnosticDump} */
    return {
        wallet: {
            version: walletVersion,
            platform: env.platform ?? null,
            os: env.os ?? null,
            browser: env.browser ?? null,
        },
        sdk: { version: sdkVersion },
        chains,
        endpoints,
        signers: signers.map(sanitizeSigner),
        settings: sanitizeSettings(settingsSnapshot),
        recent_errors: sanitizeErrors(recentErrors),
        counts,
        build: build ?? null,
        generatedAt: new Date().toISOString(),
    };
}

/**
 * Ring-buffer helper for the shell's error hook. Shells register a
 * global 'error' / 'unhandledrejection' handler (§50.4) that calls
 * `buffer.record(err)`; `buffer.list()` feeds `recentErrors` into
 * `diagnosticDump`. Capacity defaults to {@link RECENT_ERRORS_LIMIT}.
 *
 * @param {{ capacity?: number }} [opts]
 */
export function createErrorRingBuffer(opts = {}) {
    const capacity = Math.max(1, Math.floor(opts.capacity ?? RECENT_ERRORS_LIMIT));
    /** @type {DiagnosticError[]} */
    const entries = [];
    return {
        /**
         * @param {unknown} err
         * @param {string} [phase]
         */
        record(err, phase) {
            const message = err && err.message ? String(err.message) : String(err);
            const kind = err && err.name ? String(err.name) : 'Error';
            entries.push({
                at: new Date().toISOString(),
                kind,
                message: message.slice(0, ERROR_MESSAGE_LIMIT),
                ...(phase ? { phase } : {}),
            });
            while (entries.length > capacity) entries.shift();
        },
        /** @returns {DiagnosticError[]} */
        list() {
            return entries.slice();
        },
        clear() {
            entries.length = 0;
        },
    };
}

function sanitizeSigner(s) {
    if (!s || typeof s !== 'object') return null;
    /** @type {DiagnosticSignerSummary} */
    const out = { kind: s.kind };
    if (typeof s.model === 'string') out.model = s.model;
    if (typeof s.firmware === 'string') out.firmware = s.firmware;
    return out;
}

function sanitizeSettings(settings) {
    if (!settings || typeof settings !== 'object') return {};
    // Whitelist approach: pick only known non-sensitive fields. Any
    // future Settings additions default to being REDACTED until they
    // land on this list — sensitive-by-default.
    const fees = {};
    for (const [chainId, fs] of Object.entries(settings.fees ?? {})) {
        fees[chainId] = {
            strategy: fs.strategy,
            rbfByDefault: fs.rbfByDefault,
            customSatsPerKb: fs.customSatsPerKb,
        };
    }
    const adsPerChain = {};
    for (const [chainId, state] of Object.entries(settings.ads?.perChain ?? {})) {
        adsPerChain[chainId] = {
            perTxAmountSats: state.perTxAmountSats,
            triggerAmountSats: state.triggerAmountSats,
            lifetimeTxCount: state.lifetimeTxCount,
            // Intentionally redact `accumulatedSats` and
            // `lifetimeDonatedSats` — both are small ints so exposure
            // is minor, but they're user-visible counters that add
            // nothing to a bug report and could identify the wallet.
        };
    }
    return {
        theme: settings.theme,
        autolockMinutes: settings.autolockMinutes,
        fiatCurrency: settings.fiatCurrency,
        language: settings.language,
        developerMode: settings.developerMode,
        learnMode: settings.learnMode,
        privacy: {
            torRouting: settings.privacy?.torRouting ?? false,
            changeAddressRotation: settings.privacy?.changeAddressRotation ?? false,
            hideSmallBalances: settings.privacy?.hideSmallBalances ?? false,
        },
        ads: {
            enabled: settings.ads?.enabled ?? false,
            chainCount: Object.keys(settings.ads?.perChain ?? {}).length,
            perChain: adsPerChain,
        },
        fees,
        notifications: settings.notifications ?? null,
        grace: settings.grace ?? null,
    };
}

function sanitizeErrors(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(-RECENT_ERRORS_LIMIT).map((e) => ({
        at: typeof e?.at === 'string' ? e.at : new Date().toISOString(),
        kind: typeof e?.kind === 'string' ? e.kind : 'Error',
        message: typeof e?.message === 'string'
            ? e.message.slice(0, ERROR_MESSAGE_LIMIT)
            : '',
        ...(typeof e?.phase === 'string' ? { phase: e.phase } : {}),
    }));
}

async function safeCount(collection) {
    if (!collection || typeof collection.count !== 'function') return 0;
    try { return await collection.count(); } catch { return 0; }
}

function joinEndpoint(e) {
    if (!e) return '';
    if (e.defaultPort === 80 || e.defaultPort === 443) return e.defaultUrl;
    return `${e.defaultUrl}:${e.defaultPort}`;
}

// Custom endpoint URLs are user-supplied free-form strings (private
// node hostnames, internal proxies). Replace with a stable hash prefix
// so two dumps from the same user remain comparable but the original
// URL never leaves the wallet.
function redactCustomUrl(url) {
    if (typeof url !== 'string' || url.length === 0) return '';
    const bytes = new TextEncoder().encode(url);
    const hex = bytesToHex(sha256(bytes)).slice(0, REDACTED_HASH_PREFIX_LEN);
    return `redacted:sha256:${hex}`;
}
