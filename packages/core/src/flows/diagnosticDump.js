// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Diagnostic dump (§50). One-shot collection of non-sensitive wallet
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
//                  could identify the wallet (custom endpoint URLs).
//                  Replaced with `redacted:sha256:<8-hex>` so two
//                  dumps from the same user remain comparable without
//                  exposing the original string.
//
// Callers pass optional `recentErrors` (last N from the shell's
// error hook), `signers` (installed signer kinds: just type/model,
// no device identifiers), `build` (bundle metadata), and environment
// info (platform/os/browser). All optional; missing fields become
// `null` in the output rather than throwing, so a diagnostic dump is
// always producible even on a half-configured wallet.

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english';
import { COUNTERWALLET_WORDLIST } from '../crypto/counterwallet-wordlist.js';

const RECENT_ERRORS_LIMIT = 50;
const ERROR_MESSAGE_LIMIT = 500;
const REDACTED_HASH_PREFIX_LEN = 8;
const REDACTED = '[REDACTED]';
const BIP39_WORDS = new Set(englishWordlist);
const COUNTERWALLET_WORDS = new Set(COUNTERWALLET_WORDLIST);
const MNEMONIC_LENGTHS = [24, 21, 18, 15, 12];

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
 * @property {string} [gitCommit]        short sha only; never include branch/tag privately
 */

/**
 * @typedef {Object} DiagnosticError
 * @property {string} at                 ISO timestamp
 * @property {string} kind               error class/name
 * @property {string} message            truncated to {@link ERROR_MESSAGE_LIMIT} chars
 * @property {string} [phase]            optional context like 'encoding', 'broadcasting'
 */

/**
 * @typedef {Object} DiagnosticLogEntry
 * @property {number} id
 * @property {number} timestamp
 * @property {'log'|'info'|'warn'|'error'} level
 * @property {string} source
 * @property {string} message              expected to be pre-truncated by the caller (logConsole.snapshot defaults to 500 chars)
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
 * @property {DiagnosticLogEntry[]} [recentLogs]   Cluster Q FOLLOWUP 5. Pre-snapshotted from `logConsole.snapshot({ limit, messageLimit })` by the host so the flow doesn't reach into a process-specific buffer. Truncated + bounded by the caller.
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
 * @property {DiagnosticLogEntry[]} recent_logs
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
        recentLogs = [],
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
    const dump = {
        wallet: {
            version: sanitizeTextValue(walletVersion),
            platform: sanitizeTextValue(env.shell ?? env.platform),
            os: sanitizeTextValue(env.os ?? (env.shell ? env.platform : null)),
            browser: sanitizeTextValue(env.browser ?? env.userAgent),
        },
        sdk: { version: sanitizeTextValue(sdkVersion) },
        chains,
        endpoints,
        signers: signers.map(sanitizeSigner),
        settings: sanitizeSettings(settingsSnapshot),
        recent_errors: sanitizeErrors(recentErrors),
        recent_logs: sanitizeLogs(recentLogs),
        counts,
        build: sanitizeBuild(build),
        generatedAt: new Date().toISOString(),
    };
    return sanitizeDiagnosticValue(dump);
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

/**
 * Register the global 'error' and 'unhandledrejection' listeners on a
 * shell realm so crashes land in `buffer`. Safe on targets without
 * `addEventListener`. Returns an uninstall function.
 *
 * @param {{ addEventListener?: Function, removeEventListener?: Function } | null | undefined} target
 * @param {{ record: (err: unknown, phase?: string) => void }} buffer
 * @returns {() => void}
 */
export function installShellErrorCapture(target, buffer) {
    if (!target || typeof target.addEventListener !== 'function' || !buffer) {
        return () => {};
    }
    const onError = (ev) => {
        try { buffer.record(ev?.error ?? ev?.message ?? 'Error', 'error'); } catch { /* never throw from a crash hook */ }
    };
    const onRejection = (ev) => {
        try { buffer.record(ev?.reason ?? 'unhandledrejection', 'unhandledrejection'); } catch { /* never throw from a crash hook */ }
    };
    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
    return () => {
        target.removeEventListener?.('error', onError);
        target.removeEventListener?.('unhandledrejection', onRejection);
    };
}

function sanitizeSigner(s) {
    if (!s || typeof s !== 'object') return null;
    /** @type {DiagnosticSignerSummary} */
    const out = { kind: sanitizeTextValue(s.kind ?? s.vendor) };
    if (typeof s.model === 'string') out.model = redactDiagnosticText(s.model);
    const firmware = s.firmware ?? s.firmwareVersion;
    if (typeof firmware === 'string') out.firmware = redactDiagnosticText(firmware);
    return out;
}

function sanitizeSettings(settings) {
    if (!settings || typeof settings !== 'object') return {};
    // Whitelist approach: pick only known non-sensitive fields. Any
    // future Settings additions default to being REDACTED until they
    // land on this list (sensitive-by-default).
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
            // `lifetimeDonatedSats`. Both are small ints so exposure
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
        notifications: sanitizeNotifications(settings.notifications),
        grace: sanitizeGrace(settings.grace),
    };
}

function sanitizeNotifications(notifications) {
    if (!notifications || typeof notifications !== 'object') return null;
    const out = {};
    for (const key of [
        'txConfirmations', 'incomingReceipts', 'dispenserFills', 'orderFills',
        'priceAlerts', 'messages', 'governancePolls', 'deadlines',
        'dispenserEscrow', 'incomingPending',
    ]) {
        if (typeof notifications[key] === 'boolean') out[key] = notifications[key];
    }
    return out;
}

function sanitizeGrace(grace) {
    if (!grace || typeof grace !== 'object') return null;
    return {
        undoSendEnabled: grace.undoSendEnabled === true,
        undoSendSeconds: Number.isFinite(grace.undoSendSeconds) ? grace.undoSendSeconds : null,
        testSendThresholdSats: Number.isFinite(Number(grace.testSendThresholdSats))
            ? Number(grace.testSendThresholdSats)
            : null,
    };
}

// Cluster Q FOLLOWUP 5: defensive bound + truncation on logConsole
// snapshots that crossed a process boundary. The caller is expected
// to have already truncated each `message` via
// `logConsole.snapshot({ messageLimit })`, but a stale shell or a
// custom messaging shim could feed in untrimmed entries. The flow
// caps the array length and re-truncates each message so a single
// runaway log line never bloats a pasted bug report.
const RECENT_LOGS_LIMIT = 200;
const LOG_MESSAGE_LIMIT = 500;
function sanitizeLogs(arr) {
    if (!Array.isArray(arr)) return [];
    const logs = arr.slice(-RECENT_LOGS_LIMIT).map((e) => ({
        id: Number.isFinite(e?.id) ? Number(e.id) : 0,
        timestamp: Number.isFinite(e?.timestamp) ? Number(e.timestamp) : 0,
        level: ['log', 'info', 'warn', 'error'].includes(e?.level) ? e.level : 'log',
        source: typeof e?.source === 'string' ? e.source : 'console',
        message: typeof e?.message === 'string'
            ? e.message.slice(0, LOG_MESSAGE_LIMIT)
            : '',
    }));
    return logs.map((entry) => ({
        ...entry,
        source: redactDiagnosticText(entry.source),
        message: redactDiagnosticText(entry.message),
    }));
}

function sanitizeErrors(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(-RECENT_ERRORS_LIMIT).map((e) => ({
        at: typeof e?.at === 'string' ? e.at : new Date().toISOString(),
        kind: typeof e?.kind === 'string' ? redactDiagnosticText(e.kind) : 'Error',
        message: typeof e?.message === 'string'
            ? redactDiagnosticText(e.message.slice(0, ERROR_MESSAGE_LIMIT))
            : '',
        ...(typeof e?.phase === 'string' ? { phase: redactDiagnosticText(e.phase) } : {}),
    }));
}

function sanitizeBuild(build) {
    if (!build || typeof build !== 'object') return null;
    const out = {};
    for (const key of ['buildId', 'buildDate', 'gitCommit', 'walletVersion', 'target']) {
        if (typeof build[key] === 'string') out[key] = redactDiagnosticText(build[key]).slice(0, 200);
    }
    return out;
}

function sanitizeTextValue(value) {
    return typeof value === 'string' ? redactDiagnosticText(value).slice(0, 500) : null;
}

/**
 * Remove wallet identifiers and secret material from untrusted diagnostic text.
 * This also protects the final UI copy boundary when an older host returns a
 * diagnostic object that predates the structured field whitelist.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function redactDiagnosticText(value) {
    let text = String(value ?? '');
    const secretLabel = '(?:password|passphrase|mnemonic|seed[_\\s-]*phrase|recovery[_\\s-]*phrase|private[_\\s-]*key|secret(?:[_\\s-]*key)?|wif)';
    text = redactLabeledValues(text, secretLabel);
    text = redactLabeledValues(text, 'balance');
    text = text
        .replace(/\b(?:xprv|tprv)[1-9A-HJ-NP-Za-km-z]{40,120}\b/g, REDACTED)
        .replace(/\b[KL5c9][1-9A-HJ-NP-Za-km-z]{50,51}\b/g, REDACTED)
        .replace(/\b(?:bc1|tb1|bcrt1|ltc1|tltc1|rltc1)[02-9ac-hj-np-z]{8,90}\b/gi, REDACTED)
        .replace(/\b[123mnLMQDA9][1-9A-HJ-NP-Za-km-z]{25,34}\b/g, REDACTED)
        .replace(/\b0x[0-9a-f]{40}\b/gi, REDACTED)
        .replace(/(\b(?:txid|tx[_\s-]*hash|transaction[_\s-]*id)\b\s*["']?\s*[:=]\s*["']?)(?:0x)?[0-9a-f]{64}\b/gi, `$1${REDACTED}`)
        .replace(/\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:BTC|TBTC|LTC|TLTC|DOGE|XCP|sats?|litoshis?|koinu)\b/gi, REDACTED);
    return redactBip39Phrases(text);
}

function redactLabeledValues(text, labelSource) {
    const pattern = new RegExp(
        `(\\b${labelSource}\\b\\s*["']?\\s*[:=]\\s*)(?:(['"])(.*?)\\2|([^"',;\\n\\r}]+))`,
        'gi',
    );
    return text.replace(pattern, (match, prefix, quote, quotedValue, plainValue) => {
        if ((quotedValue ?? plainValue).trim() === REDACTED) return match;
        return `${prefix}${quote || ''}${REDACTED}${quote || ''}`;
    });
}

/**
 * Sanitize every value before a diagnostic object crosses the copy boundary.
 * Sensitive field names are removed even when a stale host sends an unknown
 * report shape, while ordinary strings still receive content-based redaction.
 *
 * @param {unknown} value
 * @param {string} [key]
 * @returns {unknown}
 */
export function sanitizeDiagnosticValue(value, key = '') {
    const normalizedKey = key.replace(/[_\s-]/g, '').toLowerCase();
    if ([
        'password', 'passphrase', 'mnemonic', 'seedphrase', 'recoveryphrase',
        'privatekey', 'secret', 'secretkey', 'wif', 'xprv', 'xpriv', 'key',
        'keys', 'balance', 'balances',
    ].includes(normalizedKey)) return REDACTED;
    if (typeof value === 'string') return redactDiagnosticText(value);
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map((item) => sanitizeDiagnosticValue(item));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
            childKey,
            sanitizeDiagnosticValue(childValue, childKey),
        ]));
    }
    return value;
}

function redactBip39Phrases(text) {
    const words = [...text.matchAll(/\b[a-z]{3,12}\b/gi)];
    const ranges = [];
    for (let start = 0; start < words.length; start += 1) {
        for (const length of MNEMONIC_LENGTHS) {
            const end = start + length;
            if (end > words.length) continue;
            const slice = words.slice(start, end);
            const contiguous = slice.every((word, index) => index === 0
                || /^\s+$/.test(text.slice(slice[index - 1].index + slice[index - 1][0].length, word.index)));
            const phraseWords = slice.map((word) => word[0].toLowerCase());
            const isRecoveryPhrase = phraseWords.every((word) => BIP39_WORDS.has(word))
                || (length === 12 && phraseWords.every((word) => COUNTERWALLET_WORDS.has(word)));
            if (contiguous && isRecoveryPhrase) {
                ranges.push([slice[0].index, slice[length - 1].index + slice[length - 1][0].length]);
                start = end - 1;
                break;
            }
        }
    }
    for (let index = ranges.length - 1; index >= 0; index -= 1) {
        const [start, end] = ranges[index];
        text = `${text.slice(0, start)}${REDACTED}${text.slice(end)}`;
    }
    return text;
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
