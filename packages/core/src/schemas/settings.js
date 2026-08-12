// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings record (§11.3.7). Global per-wallet user preferences. ADS
// defaults follow §36 (opt-out default, 1 sat per tx, 1000 sat trigger).

import {
    check,
    isArray,
    isBoolean,
    isNonEmptyString,
    isNonNegativeInteger,
    isOneOf,
    isPlainObject,
    isString,
    result,
} from './validate.js';

export const CURRENT_VERSION = 2;

export const THEMES = /** @type {const} */ (['system', 'light', 'dark']);
export const FEE_STRATEGIES = /** @type {const} */ (['low', 'normal', 'fast', 'custom']);
export const REDUCED_MOTION_MODES = /** @type {const} */ (['auto', 'always', 'never']);
export const BACKUP_REMINDER_CADENCES = /** @type {const} */ (['off', 'monthly', 'quarterly']);

// §20 / G039: wallet mode. `full` is the everyday wallet (sign + broadcast on
// this device). `watcher` builds unsigned PSBTs against pubkeys / xpubs and
// hands them to a signer-mode wallet for signing. `signer` is the air-gapped
// half: accepts pasted PSBTs, signs, returns the signed PSBT for broadcast
// on the watcher side. Readers default missing field to `'full'` so v2
// records without the field keep their existing behavior.
export const WALLET_MODES = /** @type {const} */ (['full', 'watcher', 'signer']);
export const WALLET_MODE_DEFAULT = 'full';

// Active network filter: only chains on this network are visible AND
// queried. A user with `activeChainIds` carrying both mainnet and
// testnet chains who has `activeNetwork: 'mainnet'` set will see only
// mainnet balances / history, and the wallet will not fan out any
// network requests to the testnet chains. Switching networks is a
// dev-oriented operation buried in Settings; everyday users stay on
// mainnet. Cross-network operations (LINK / SWAP spanning networks)
// are structurally impossible while the filter is on. That's a
// clarification, not a regression, since cross-mainnet-testnet bridges
// don't exist anyway.
export const NETWORKS = /** @type {const} */ (['mainnet', 'testnet', 'regtest']);
export const NETWORK_DEFAULT = 'mainnet';

// ADS default: single source of truth per §36. Flip this to false to
// make ADS opt-in without touching call sites.
export const ADS_DEFAULT_ENABLED = true;
export const ADS_DEFAULT_PER_TX_SATS = 1;
export const ADS_DEFAULT_TRIGGER_SATS = 1000;

// Pre-flight privacy control (§4.8): two-state. 'full' (default) runs both
// tiers; 'local' runs Tier-2 local checks only (zero network). There is no
// 'off' state - local checks cost zero privacy and zero network, so 'off'
// would only discard free protection.
export const PREFLIGHT_PRIVACY_MODES = /** @type {const} */ (['full', 'local']);
export const PREFLIGHT_PRIVACY_DEFAULT = 'full';

/**
 * Resolve the pre-flight privacy mode with its code default.
 * @param {import('./settings.js').Settings | null | undefined} settings
 * @returns {'full' | 'local'}
 */
export function resolvePreflightPrivacy(settings) {
    const v = settings && settings.preflightPrivacy;
    return v === 'local' || v === 'full' ? v : PREFLIGHT_PRIVACY_DEFAULT;
}

// §17.7.1 / G028: clipboard auto-clear bounds. 0 disables auto-clear.
//
// DORMANT since  (operator ruling a, 2026-08-11). ViewPrivateKey
// was the only reader and  made key material uncopyable, so the
// Settings Privacy control that wrote this value was removed rather than
// left standing as a promise nothing kept. The field and these bounds
// stay: stored settings already carry the key, so deleting it would be a
// migration with no user-visible gain, and a copy path that earns the
// protection back can read it again without a schema bump. Nothing in
// the app reads `privacy.clipboardAutoClearSeconds` today.
export const CLIPBOARD_AUTO_CLEAR_MIN = 0;
export const CLIPBOARD_AUTO_CLEAR_MAX = 600;
export const CLIPBOARD_AUTO_CLEAR_DEFAULT = 60;

// §26: auto-lock idle timeout, in minutes. The Settings Safety panel
// offers 1 / 5 / 15 / 30 / 60 / 240 and "Never", where "Never" is the
// sentinel 0. Anything above the ceiling is a hand-edited record, not a
// choice the UI can produce. useAutoLockPolicy is the single reader.
export const AUTOLOCK_NEVER = 0;
export const AUTOLOCK_MINUTES_MIN = 1;
export const AUTOLOCK_MINUTES_MAX = 1440;
export const AUTOLOCK_MINUTES_DEFAULT = 15;

/**
 * @typedef {Object} SdkEndpoint
 * @property {string} explorerUrl
 * @property {string} encoderUrl
 * @property {string} hubUrl
 * @property {boolean} custom
 */

/**
 * @typedef {Object} FeeSettings
 * @property {typeof FEE_STRATEGIES[number]} strategy
 * @property {number | null} customSatsPerKb
 * @property {boolean} rbfByDefault
 */

/**
 * @typedef {Object} AdsChainState
 * @property {number} perTxAmountSats
 * @property {number} triggerAmountSats
 * @property {number} accumulatedSats
 * @property {number} lifetimeDonatedSats
 * @property {number} lifetimeTxCount
 */

/**
 * @typedef {Object} Settings
 * @property {2} schemaVersion
 * @property {typeof THEMES[number]} theme
 * @property {typeof REDUCED_MOTION_MODES[number]} reducedMotion        v2: `auto` follows the OS `prefers-reduced-motion`; `always` forces reduce; `never` ignores the OS preference
 * @property {number} autolockMinutes
 * @property {string} fiatCurrency
 * @property {string} language
 * @property {Record<string, SdkEndpoint>} sdkEndpoints
 * @property {Record<string, FeeSettings>} fees
 * @property {{ torRouting: boolean, changeAddressRotation: boolean, hideSmallBalances: boolean, blurOnBlur: boolean, labelsSurviveRestore: boolean, clipboardAutoClearSeconds?: number, hapticsEnabled?: boolean, alwaysRequireHwExplicitConfirm?: boolean, priceDataEnabled?: boolean, metadataFetchEnabled?: boolean }} privacy   v2: adds blurOnBlur (window-unfocus blur of sensitive data), labelsSurviveRestore (§19.5.2 on-chain label sync opt-in); clipboardAutoClearSeconds is optional v2-tolerant (0-600 inclusive, 0 = never clear, default 60, §17.7.1 / G028); hapticsEnabled is v2-tolerant (defaults true when absent, set false to suppress every `useHaptic` pulse alongside the OS-level reduced-motion preference, Cluster P FOLLOWUP 1); alwaysRequireHwExplicitConfirm is v2-tolerant (defaults false; when true the HW sign-screen cross-check confirm is required on every sign regardless of the risk classifier, Cluster N FOLLOWUP 3); formDraftTtlMs is v2-tolerant (defaults to 24h, allowed values are FORM_DRAFT_TTL_OPTIONS, Cluster P FOLLOWUP 6); priceDataEnabled is v2-tolerant (defaults true; when false the price oracle is disabled and the TokenDetail stats strip / chart hide for native coins, sends a request to a third-party API revealing wallet activity, hence the opt-out).
 * @property {{ enabled: boolean, perChain: Record<string, AdsChainState> }} ads
 * @property {{ txConfirmations: boolean, incomingReceipts: boolean, dispenserFills: boolean, orderFills: boolean, priceAlerts: boolean, messages?: boolean, governancePolls?: boolean, deadlines?: boolean, dispenserEscrow?: boolean }} notifications   v2: adds messages (v2-tolerant, defaults true; notify when a watched address receives a MESSAGE action) and governancePolls (v2-tolerant, defaults true; notify when a new VOTE poll opens over a held token, binding polls flagged)
 * @property {boolean} developerMode
 * @property {boolean} learnMode
 * @property {{ undoSendSeconds: number, testSendThresholdSats: number }} grace                              v2: adds testSendThresholdSats (large-amount confirmation gate; 0 = disabled)
 * @property {{ enabled: boolean }} panicMode                                                                v2: duress-mode toggle; full §26.5 wiring lands later, the schema slot ships now so the Safety panel can flip it
 * @property {typeof BACKUP_REMINDER_CADENCES[number]} backupReminders                                       v2: backup-reminder cadence
 * @property {string[]} [pinnedTokens]                                                                       v2-tolerant: list of `chainId:tick` keys the user pinned to the top of the balance list (§27.3 / G072)
 * @property {string[]} [hiddenTokens]                                                                       v2-tolerant: list of `chainId:tick` keys the user hid (collapsed into the Hidden section at the bottom of each tab) (§27.4 / G073)
 * @property {boolean} [showPinAffordance]                                                                   v2-tolerant: when true, balance rows render a per-row star button to pin/unpin the token. Default false to keep the row UI clean; users who want quick pin access flip it in Settings > Display.
 * @property {boolean} [showHideAffordance]                                                                  v2-tolerant: when true, balance rows render a per-row hide affordance. Default false; the Settings > Display unhide list still works regardless.
 * @property {{ bindings?: Record<string, string> }} [keyboard]                                              v2-tolerant: §34.1 keyboard-shortcut overrides. `bindings` maps a shortcut id from keyboard/shortcuts.js to a binding string ('mod+k' / '?' / 'g h'); unknown ids and invalid strings are ignored at resolve time (resolveBindings), so a stale override can't break dispatch.
 * @property {boolean} [verifyProofs]                                                                      v2-tolerant: when true (default), the wallet cryptographically verifies token balances + actions against quorum-signed SPV checkpoints and badges each row. Set false to skip the extra proof traffic. Seam for a future pinned validator set / trusted checkpoint.
 * @property {boolean} [showVariantBadge]                                                                    v2-tolerant (web shell only). When true AND developerMode is on, the floating dev variant switcher (small / full / sidebar / extension preview) renders. Default false, so production never shows it.
 * @property {boolean} [autoApproveLocalhost]                                                                v2-tolerant: when developerMode is also on, bridge.connect from localhost / 127.0.0.1 / [::1] origins skips the approval prompt (§48.6 / G151). Auto-sign is a separate opt-in (autoSignLocalhostMs).
 * @property {number} [autoSignLocalhostMs]                                                                  v2-tolerant: Developer-Mode localhost auto-sign timeout in ms (Cluster Q FOLLOWUP 3). Absent / 0 = off (default). Positive value = for that long after a real sign approval, further sign requests from a localhost dApp reuse the session-cached password instead of prompting. Allowed values are AUTO_SIGN_LOCALHOST_OPTIONS (off / 5 min / 1 hour). Only ever consulted when developerMode is also on; the password lives in service-worker memory only and never persists.
 * @property {string[]} [blockedOrigins]                                                                     v2-tolerant: user-managed origin blocklist (§12 / G009). bridge.connect + the four sign methods reject with BLOCKED_BY_USER for matching origins. Stored as URL.origin strings or wildcard patterns (`*.example.com`, Cluster S FOLLOWUP 3).
 * @property {Array<{ at: number, action: 'add' | 'remove', entry: string, evictedSiteIds?: string[] }>} [blocklistAuditLog]   v2-tolerant: ring-buffer of recent blocklist mutations (Cluster S FOLLOWUP 4). Capped at 50 entries.
 * @property {{ burst?: number, windowMs?: number }} [signThrottle]                                          v2-tolerant: per-origin sign-request token-bucket limits (§12 / G012 / Cluster S FOLLOWUP 1). `burst` is positive integer max requests per window; `windowMs` is window length in ms (positive integer). Either field may be omitted to fall back to SIGN_THROTTLE_DEFAULT_BURST / SIGN_THROTTLE_DEFAULT_WINDOW_MS.
 * @property {typeof WALLET_MODES[number]} [walletMode]                                                      v2-tolerant: `full` (default) signs + broadcasts here; `watcher` builds unsigned PSBTs for an air-gapped signer; `signer` accepts pasted PSBTs from a watcher and returns signed PSBTs (§20 / G039). Send / Home branch on this field in subsequent steps.
 * @property {{ walletMode: 'watcher' | 'signer', label: string, keySetId: string, keys: object[], sharedChainIds: string[], pairedAt: string } | null} [partnerPairing]   v2-tolerant:  / §20.5. The verified other half of a watcher/signer pair, holding that partner's account-level PUBLIC key set (never any seed or private key). Written only by `flows.pairPartner` after `verifyPartnerPairing` proves both halves derive from one recovery phrase. null / absent = unpaired, which is the only valid state for a `full` wallet.
 * @property {typeof NETWORKS[number]} [activeNetwork]                                                     v2-tolerant: `mainnet` (default) / `testnet` / `regtest`. Filters every visible chain AND every data fetch to chains on this network; a wallet with mainnet + testnet chains active under the hood shows only the mainnet ones while `activeNetwork === 'mainnet'`. Switching is a Settings > Network operation. Cross-network features are disabled while the filter is on.
 * @property {object[]} [customChains]                                                                       v2-tolerant: user-added ChainDescriptor records (§9.7 / Cluster Q FOLLOWUP 2). Persisted across SW restarts so `chainRegistry.addCustom` re-seeds on boot. Per-descriptor validation runs in the `wallet.addCustomChain` host route via `validateChainDescriptor`; the schema check here only enforces that the field is an array of plain objects so a corrupt persisted blob can't crash the settings read.
 * @property {boolean} [showFiatInHistory]                                                                   v2-tolerant: . When true, the History route shows a fiat equivalent alongside each row's native-coin amount (using `fiatCurrency` + the live price lookup). Default false. Fiat is only ever computed for native-coin amounts; token amounts have no valid coin rate and never show one, regardless of this flag.
 * @property {{ enabled: boolean, start: string, end: string }} [quietHours]                                 v2-tolerant: . Do-not-disturb window for notification delivery. `start`/`end` are 'HH:MM' 24h local-time strings (e.g. '22:00'/'08:00'); an end before start wraps past midnight. `enabled` defaults false. Read by the §46 NotificationService/PriceAlertWatcher delivery choke points, not by the settings toggles themselves - a suppressed notification is silently dropped, not queued.
 */

// Form-draft retention (surfaced in Settings > Privacy, Cluster P FU 6).
// Values are durations in ms; 0 means "off" (no drafts persisted at all).
// Only the four spec-listed values are accepted; any other input fails
// validation. Off/24h/7d/1h covers the common postures (paranoid, default,
// long-running send composition, brief).
export const FORM_DRAFT_TTL_OFF = 0;
export const FORM_DRAFT_TTL_1H = 60 * 60 * 1000;
export const FORM_DRAFT_TTL_24H = 24 * 60 * 60 * 1000;
export const FORM_DRAFT_TTL_7D = 7 * 24 * 60 * 60 * 1000;
export const FORM_DRAFT_TTL_DEFAULT = FORM_DRAFT_TTL_24H;
export const FORM_DRAFT_TTL_OPTIONS = Object.freeze([
    FORM_DRAFT_TTL_OFF,
    FORM_DRAFT_TTL_1H,
    FORM_DRAFT_TTL_24H,
    FORM_DRAFT_TTL_7D,
]);

// Developer-Mode localhost auto-sign timeout (Cluster Q FOLLOWUP 3), surfaced
// in Settings > Privacy. The value is how long a password captured by a real
// sign approval stays reusable for further localhost sign requests. `off`
// disables the feature entirely (the default): no password is ever cached.
// Only the three spec-listed postures are accepted; any other value fails
// validation so a corrupt blob can't widen the window.
export const AUTO_SIGN_LOCALHOST_OFF = 0;
export const AUTO_SIGN_LOCALHOST_5M = 5 * 60 * 1000;
export const AUTO_SIGN_LOCALHOST_1H = 60 * 60 * 1000;
export const AUTO_SIGN_LOCALHOST_OPTIONS = Object.freeze([
    AUTO_SIGN_LOCALHOST_OFF,
    AUTO_SIGN_LOCALHOST_5M,
    AUTO_SIGN_LOCALHOST_1H,
]);

// Sign-throttle limits, surfaced in Settings (Cluster S FOLLOWUP 1).
// Bounds are wide enough that the user can effectively disable throttling
// (very large burst, large window) while still preventing nonsense values.
export const SIGN_THROTTLE_BURST_MIN = 1;
export const SIGN_THROTTLE_BURST_MAX = 1000;
export const SIGN_THROTTLE_WINDOW_MS_MIN = 1_000;
export const SIGN_THROTTLE_WINDOW_MS_MAX = 24 * 60 * 60 * 1000;

// Quiet hours : 'HH:MM' 24h local-time strings only. Kept narrow
// (no seconds, no timezone) since the UI is a plain <input type="time">.
export const QUIET_HOURS_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const QUIET_HOURS_DEFAULT = Object.freeze({ enabled: false, start: '22:00', end: '08:00' });

/** @returns {Settings} */
export function createDefaultSettings() {
    return {
        schemaVersion: CURRENT_VERSION,
        theme: 'system',
        reducedMotion: 'auto',
        autolockMinutes: AUTOLOCK_MINUTES_DEFAULT,
        fiatCurrency: 'USD',
        language: 'en',
        sdkEndpoints: {},
        fees: {},
        privacy: {
            torRouting: false,
            changeAddressRotation: false,
            hideSmallBalances: false,
            blurOnBlur: false,
            labelsSurviveRestore: false,
            clipboardAutoClearSeconds: CLIPBOARD_AUTO_CLEAR_DEFAULT,
            hapticsEnabled: true,
            priceDataEnabled: true,
            metadataFetchEnabled: true,
        },
        ads: {
            enabled: ADS_DEFAULT_ENABLED,
            perChain: {},
        },
        notifications: {
            txConfirmations: true,
            incomingReceipts: true,
            dispenserFills: true,
            orderFills: true,
            priceAlerts: false,
            messages: true,
            governancePolls: true,
            deadlines: true,
            dispenserEscrow: true,
        },
        developerMode: false,
        learnMode: false,
        grace: {
            undoSendSeconds: 5,
            testSendThresholdSats: 0,
        },
        panicMode: {
            enabled: false,
        },
        backupReminders: 'off',
        pinnedTokens: [],
        hiddenTokens: [],
        showPinAffordance: false,
        showHideAffordance: false,
        showFiatInHistory: false,
        quietHours: { ...QUIET_HOURS_DEFAULT },
        verifyProofs: true,
        keyboard: { bindings: {} },
        showVariantBadge: false,
        walletMode: WALLET_MODE_DEFAULT,
        partnerPairing: null,
        activeNetwork: NETWORK_DEFAULT,
    };
}

/** @returns {AdsChainState} */
export function createDefaultAdsChainState() {
    return {
        perTxAmountSats: ADS_DEFAULT_PER_TX_SATS,
        triggerAmountSats: ADS_DEFAULT_TRIGGER_SATS,
        accumulatedSats: 0,
        lifetimeDonatedSats: 0,
        lifetimeTxCount: 0,
    };
}

const isSdkEndpoint = (v) =>
    isPlainObject(v) &&
    isString(v.explorerUrl) &&
    isString(v.encoderUrl) &&
    isString(v.hubUrl) &&
    isBoolean(v.custom);

const isFeeSettings = (v) =>
    isPlainObject(v) &&
    isOneOf(v.strategy, FEE_STRATEGIES) &&
    (v.customSatsPerKb === null || isNonNegativeInteger(v.customSatsPerKb)) &&
    isBoolean(v.rbfByDefault);

const isAdsChainState = (v) =>
    isPlainObject(v) &&
    isNonNegativeInteger(v.perTxAmountSats) &&
    isNonNegativeInteger(v.triggerAmountSats) &&
    isNonNegativeInteger(v.accumulatedSats) &&
    isNonNegativeInteger(v.lifetimeDonatedSats) &&
    isNonNegativeInteger(v.lifetimeTxCount);

const isRecordOf = (v, predicate) => {
    if (!isPlainObject(v)) return false;
    for (const [k, val] of Object.entries(v)) {
        if (!isNonEmptyString(k)) return false;
        if (!predicate(val)) return false;
    }
    return true;
};

export function validateSettings(record) {
    const errors = [];
    if (!check(errors, 'settings', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {Settings} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'theme', isOneOf(r.theme, THEMES), `must be one of ${THEMES.join(', ')}`);
    check(errors, 'reducedMotion', isOneOf(r.reducedMotion, REDUCED_MOTION_MODES), `must be one of ${REDUCED_MOTION_MODES.join(', ')}`);
    check(errors, 'autolockMinutes', isNonNegativeInteger(r.autolockMinutes), 'must be a non-negative integer');
    check(errors, 'fiatCurrency', isNonEmptyString(r.fiatCurrency), 'must be a non-empty string');
    check(errors, 'language', isNonEmptyString(r.language), 'must be a non-empty string');
    check(errors, 'sdkEndpoints', isRecordOf(r.sdkEndpoints, isSdkEndpoint), 'malformed');
    check(errors, 'fees', isRecordOf(r.fees, isFeeSettings), 'malformed');

    check(
        errors,
        'privacy',
        isPlainObject(r.privacy) &&
            isBoolean(r.privacy.torRouting) &&
            isBoolean(r.privacy.changeAddressRotation) &&
            isBoolean(r.privacy.hideSmallBalances) &&
            isBoolean(r.privacy.blurOnBlur) &&
            isBoolean(r.privacy.labelsSurviveRestore) &&
            // clipboardAutoClearSeconds is v2-tolerant: missing is fine
            // (older records default to 60s at read time); when present,
            // require an integer in [0, 600].
            (r.privacy.clipboardAutoClearSeconds === undefined
                || (Number.isInteger(r.privacy.clipboardAutoClearSeconds)
                    && r.privacy.clipboardAutoClearSeconds >= CLIPBOARD_AUTO_CLEAR_MIN
                    && r.privacy.clipboardAutoClearSeconds <= CLIPBOARD_AUTO_CLEAR_MAX))
            // hapticsEnabled is v2-tolerant: missing → default true at
            // read time; when present, require boolean.
            && (r.privacy.hapticsEnabled === undefined
                || isBoolean(r.privacy.hapticsEnabled))
            // alwaysRequireHwExplicitConfirm is v2-tolerant: missing →
            // default false; when present, require boolean.
            && (r.privacy.alwaysRequireHwExplicitConfirm === undefined
                || isBoolean(r.privacy.alwaysRequireHwExplicitConfirm))
            // priceDataEnabled is v2-tolerant: missing → default true;
            // when present, require boolean.
            && (r.privacy.priceDataEnabled === undefined
                || isBoolean(r.privacy.priceDataEnabled))
            // metadataFetchEnabled is v2-tolerant: missing → default true;
            // when present, require boolean. Gates the §27.6 TIS fetch
            // path in `tokenInfoFor`.
            && (r.privacy.metadataFetchEnabled === undefined
                || isBoolean(r.privacy.metadataFetchEnabled))
            // formDraftTtlMs is v2-tolerant: missing → default 24h;
            // when present, must be one of the allowed values (Off /
            // 1h / 24h / 7d).
            && (r.privacy.formDraftTtlMs === undefined
                || (Number.isFinite(r.privacy.formDraftTtlMs)
                    && FORM_DRAFT_TTL_OPTIONS.includes(r.privacy.formDraftTtlMs))),
        'malformed',
    );

    check(
        errors,
        'ads',
        isPlainObject(r.ads) &&
            isBoolean(r.ads.enabled) &&
            isRecordOf(r.ads.perChain, isAdsChainState),
        'malformed',
    );

    check(
        errors,
        'notifications',
        isPlainObject(r.notifications) &&
            isBoolean(r.notifications.txConfirmations) &&
            isBoolean(r.notifications.incomingReceipts) &&
            isBoolean(r.notifications.dispenserFills) &&
            isBoolean(r.notifications.orderFills) &&
            isBoolean(r.notifications.priceAlerts) &&
            // v2-tolerant: pre-v2 records predate the messages flag.
            (r.notifications.messages == null || isBoolean(r.notifications.messages)) &&
            // v2-tolerant: older records predate the governancePolls flag.
            (r.notifications.governancePolls == null || isBoolean(r.notifications.governancePolls)) &&
            // v2-tolerant: older records predate the deadlines flag (PC-45).
            (r.notifications.deadlines == null || isBoolean(r.notifications.deadlines)) &&
            // v2-tolerant: older records predate the dispenserEscrow flag (PC-46).
            (r.notifications.dispenserEscrow == null || isBoolean(r.notifications.dispenserEscrow)),
        'malformed',
    );

    check(errors, 'developerMode', isBoolean(r.developerMode), 'must be a boolean');
    check(errors, 'learnMode', isBoolean(r.learnMode), 'must be a boolean');
    check(
        errors,
        'grace',
        isPlainObject(r.grace)
            && isNonNegativeInteger(r.grace.undoSendSeconds)
            && isNonNegativeInteger(r.grace.testSendThresholdSats),
        'malformed',
    );
    check(
        errors,
        'panicMode',
        isPlainObject(r.panicMode) && isBoolean(r.panicMode.enabled),
        'malformed',
    );
    check(
        errors,
        'backupReminders',
        isOneOf(r.backupReminders, BACKUP_REMINDER_CADENCES),
        `must be one of ${BACKUP_REMINDER_CADENCES.join(', ')}`,
    );
    if (r.pinnedTokens !== undefined) {
        check(
            errors,
            'pinnedTokens',
            Array.isArray(r.pinnedTokens) && r.pinnedTokens.every(isString),
            'must be an array of strings (chainId:tick keys)',
        );
    }
    if (r.hiddenTokens !== undefined) {
        check(
            errors,
            'hiddenTokens',
            Array.isArray(r.hiddenTokens) && r.hiddenTokens.every(isString),
            'must be an array of strings (chainId:tick keys)',
        );
    }
    if (r.showPinAffordance !== undefined) {
        check(
            errors,
            'showPinAffordance',
            isBoolean(r.showPinAffordance),
            'must be a boolean when present',
        );
    }
    if (r.showHideAffordance !== undefined) {
        check(
            errors,
            'showHideAffordance',
            isBoolean(r.showHideAffordance),
            'must be a boolean when present',
        );
    }
    if (r.verifyProofs !== undefined) {
        check(
            errors,
            'verifyProofs',
            isBoolean(r.verifyProofs),
            'must be a boolean when present',
        );
    }
    if (r.keyboard !== undefined) {
        check(
            errors,
            'keyboard',
            isPlainObject(r.keyboard)
                && (r.keyboard.bindings === undefined
                    || (isPlainObject(r.keyboard.bindings)
                        && Object.values(r.keyboard.bindings).every(isString))),
            'must be { bindings?: Record<shortcutId, bindingString> } when present',
        );
    }
    if (r.autoApproveLocalhost !== undefined) {
        check(
            errors,
            'autoApproveLocalhost',
            isBoolean(r.autoApproveLocalhost),
            'must be a boolean when present',
        );
    }
    if (r.showVariantBadge !== undefined) {
        check(
            errors,
            'showVariantBadge',
            isBoolean(r.showVariantBadge),
            'must be a boolean when present',
        );
    }
    if (r.autoSignLocalhostMs !== undefined) {
        check(
            errors,
            'autoSignLocalhostMs',
            AUTO_SIGN_LOCALHOST_OPTIONS.includes(r.autoSignLocalhostMs),
            'must be one of the allowed auto-sign timeouts (off / 5 min / 1 hour)',
        );
    }
    if (r.blockedOrigins !== undefined) {
        check(
            errors,
            'blockedOrigins',
            Array.isArray(r.blockedOrigins) && r.blockedOrigins.every(isString),
            'must be an array of origin strings',
        );
    }
    //  slice 5: `confirmModalSlices` is GONE. The confirm pipeline is
    // unconditional, so the field is neither read nor validated. An existing
    // vault may still carry it; the validator checks named fields rather than
    // rejecting unknown ones, so a leftover key is inert.
    // v2-tolerant ( §4.8): pre-flight privacy mode.
    if (r.preflightPrivacy !== undefined) {
        check(
            errors,
            'preflightPrivacy',
            isOneOf(r.preflightPrivacy, PREFLIGHT_PRIVACY_MODES),
            `must be one of ${PREFLIGHT_PRIVACY_MODES.join(', ')}`,
        );
    }
    if (r.blocklistAuditLog !== undefined) {
        check(
            errors,
            'blocklistAuditLog',
            Array.isArray(r.blocklistAuditLog)
                && r.blocklistAuditLog.every((entry) =>
                    isPlainObject(entry)
                    && Number.isFinite(entry.at)
                    && (entry.action === 'add' || entry.action === 'remove')
                    && isNonEmptyString(entry.entry)
                    && (entry.evictedSiteIds === undefined
                        || (Array.isArray(entry.evictedSiteIds)
                            && entry.evictedSiteIds.every(isString)))),
            'must be an array of audit-entry objects',
        );
    }
    if (r.signThrottle !== undefined) {
        check(
            errors,
            'signThrottle',
            isPlainObject(r.signThrottle)
                // Both fields v2-tolerant individually; undefined falls
                // back to the default at read time.
                && (r.signThrottle.burst === undefined
                    || (Number.isInteger(r.signThrottle.burst)
                        && r.signThrottle.burst >= SIGN_THROTTLE_BURST_MIN
                        && r.signThrottle.burst <= SIGN_THROTTLE_BURST_MAX))
                && (r.signThrottle.windowMs === undefined
                    || (Number.isInteger(r.signThrottle.windowMs)
                        && r.signThrottle.windowMs >= SIGN_THROTTLE_WINDOW_MS_MIN
                        && r.signThrottle.windowMs <= SIGN_THROTTLE_WINDOW_MS_MAX)),
            'malformed',
        );
    }
    if (r.walletMode !== undefined) {
        check(
            errors,
            'walletMode',
            isOneOf(r.walletMode, WALLET_MODES),
            `must be one of ${WALLET_MODES.join(', ')}`,
        );
    }
    //  / §20.5: the verified watcher<->signer partner record.
    // Shape-checked only (no re-derivation of keyIds): `pairPartner` is the
    // sole writer and it validates the payload cryptographically before the
    // record ever reaches here. The point of this check is that a corrupt
    // persisted blob can't crash the settings read.
    if (r.partnerPairing !== undefined && r.partnerPairing !== null) {
        const pp = /** @type {any} */ (r.partnerPairing);
        check(
            errors,
            'partnerPairing',
            isPlainObject(pp)
                && (pp.walletMode === 'watcher' || pp.walletMode === 'signer')
                && isString(pp.label)
                && isNonEmptyString(pp.keySetId)
                && Array.isArray(pp.keys)
                && pp.keys.length > 0
                && pp.keys.every((k) =>
                    isPlainObject(k)
                    && isNonEmptyString(k.chainId)
                    && isNonEmptyString(k.path)
                    && isNonEmptyString(k.publicKey)
                    && isNonEmptyString(k.chainCode)
                    && isNonEmptyString(k.keyId))
                && (pp.sharedChainIds === undefined
                    || (Array.isArray(pp.sharedChainIds) && pp.sharedChainIds.every(isString)))
                && isNonEmptyString(pp.pairedAt),
            'must be null or a verified partner-pairing record',
        );
    }
    if (r.activeNetwork !== undefined) {
        check(
            errors,
            'activeNetwork',
            isOneOf(r.activeNetwork, NETWORKS),
            `must be one of ${NETWORKS.join(', ')}`,
        );
    }
    if (r.showFiatInHistory !== undefined) {
        check(
            errors,
            'showFiatInHistory',
            isBoolean(r.showFiatInHistory),
            'must be a boolean when present',
        );
    }
    if (r.quietHours !== undefined) {
        check(
            errors,
            'quietHours',
            isPlainObject(r.quietHours)
                && isBoolean(r.quietHours.enabled)
                && QUIET_HOURS_TIME_RE.test(r.quietHours.start)
                && QUIET_HOURS_TIME_RE.test(r.quietHours.end),
            "must be { enabled: boolean, start: 'HH:MM', end: 'HH:MM' } when present",
        );
    }
    if (r.customChains !== undefined) {
        // Only enforces "array of plain objects" here. Per-descriptor
        // validation runs in `wallet.addCustomChain` via
        // `validateChainDescriptor` before the descriptor is appended.
        // A corrupt persisted blob (the field somehow ended up with a
        // malformed descriptor) is filtered at boot in createBackground-
        // Host's re-seed loop, never raised to the user.
        check(
            errors,
            'customChains',
            Array.isArray(r.customChains)
                && r.customChains.every((entry) => isPlainObject(entry)),
            'must be an array of ChainDescriptor objects',
        );
    }

    return result(errors);
}
