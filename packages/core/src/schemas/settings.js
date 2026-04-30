// Settings record — §11.3.7. Global per-wallet user preferences. ADS
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

// §20 / G039 — wallet mode. `full` is the everyday wallet (sign + broadcast on
// this device). `watcher` builds unsigned PSBTs against pubkeys / xpubs and
// hands them to a signer-mode wallet for signing. `signer` is the air-gapped
// half — accepts pasted PSBTs, signs, returns the signed PSBT for broadcast
// on the watcher side. Readers default missing field to `'full'` so v2
// records without the field keep their existing behavior.
export const WALLET_MODES = /** @type {const} */ (['full', 'watcher', 'signer']);
export const WALLET_MODE_DEFAULT = 'full';

// ADS default — single source of truth per §36. Flip this to false to
// make ADS opt-in without touching call sites.
export const ADS_DEFAULT_ENABLED = true;
export const ADS_DEFAULT_PER_TX_SATS = 1;
export const ADS_DEFAULT_TRIGGER_SATS = 1000;

// §17.7.1 / G028 — clipboard auto-clear bounds. The Settings Privacy
// panel exposes this as a number input; ViewPrivateKey reads it via
// useSettings to pick the timer. 0 disables auto-clear.
export const CLIPBOARD_AUTO_CLEAR_MIN = 0;
export const CLIPBOARD_AUTO_CLEAR_MAX = 600;
export const CLIPBOARD_AUTO_CLEAR_DEFAULT = 60;

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
 * @property {typeof REDUCED_MOTION_MODES[number]} reducedMotion        v2 — `auto` follows the OS `prefers-reduced-motion`; `always` forces reduce; `never` ignores the OS preference
 * @property {number} autolockMinutes
 * @property {string} fiatCurrency
 * @property {string} language
 * @property {Record<string, SdkEndpoint>} sdkEndpoints
 * @property {Record<string, FeeSettings>} fees
 * @property {{ torRouting: boolean, changeAddressRotation: boolean, hideSmallBalances: boolean, blurOnBlur: boolean, labelsSurviveRestore: boolean, clipboardAutoClearSeconds?: number, hapticsEnabled?: boolean, alwaysRequireHwExplicitConfirm?: boolean }} privacy   v2 — adds blurOnBlur (window-unfocus blur of sensitive data), labelsSurviveRestore (§19.5.2 on-chain label sync opt-in); clipboardAutoClearSeconds is optional v2-tolerant — 0–600 inclusive, 0 = never clear, default 60 (§17.7.1 / G028); hapticsEnabled is v2-tolerant — defaults true when absent, set false to suppress every `useHaptic` pulse alongside the OS-level reduced-motion preference (Cluster P FOLLOWUP 1); alwaysRequireHwExplicitConfirm is v2-tolerant — defaults false; when true the HW sign-screen cross-check confirm is required on every sign regardless of the risk classifier (Cluster N FOLLOWUP 3).
 * @property {{ enabled: boolean, perChain: Record<string, AdsChainState> }} ads
 * @property {{ txConfirmations: boolean, incomingReceipts: boolean, dispenserFills: boolean, orderFills: boolean, priceAlerts: boolean }} notifications
 * @property {boolean} developerMode
 * @property {boolean} learnMode
 * @property {{ undoSendSeconds: number, testSendThresholdSats: number }} grace                              v2 — adds testSendThresholdSats (large-amount confirmation gate; 0 = disabled)
 * @property {{ enabled: boolean }} panicMode                                                                v2 — duress-mode toggle; full §26.5 wiring lands later, the schema slot ships now so the Safety panel can flip it
 * @property {typeof BACKUP_REMINDER_CADENCES[number]} backupReminders                                       v2 — backup-reminder cadence
 * @property {string[]} [pinnedTokens]                                                                       v2-tolerant — list of `chainId:asset` keys the user pinned to the top of the balance list (§27.3 / G072)
 * @property {string[]} [hiddenTokens]                                                                       v2-tolerant — list of `chainId:asset` keys the user hid (collapsed into the Hidden section at the bottom of each tab) (§27.4 / G073)
 * @property {boolean} [autoApproveLocalhost]                                                                v2-tolerant — when developerMode is also on, bridge.connect from localhost / 127.0.0.1 / [::1] origins skips the approval prompt (§48.6 / G151). Sign requests still prompt.
 * @property {string[]} [blockedOrigins]                                                                     v2-tolerant — user-managed origin blocklist (§12 / G009). bridge.connect + the four sign methods reject with BLOCKED_BY_USER for matching origins. Stored as URL.origin strings or wildcard patterns (`*.example.com`, Cluster S FOLLOWUP 3).
 * @property {Array<{ at: number, action: 'add' | 'remove', entry: string, evictedSiteIds?: string[] }>} [blocklistAuditLog]   v2-tolerant — ring-buffer of recent blocklist mutations (Cluster S FOLLOWUP 4). Capped at 50 entries.
 * @property {{ burst?: number, windowMs?: number }} [signThrottle]                                          v2-tolerant — per-origin sign-request token-bucket limits (§12 / G012 / Cluster S FOLLOWUP 1). `burst` is positive integer max requests per window; `windowMs` is window length in ms (positive integer). Either field may be omitted to fall back to SIGN_THROTTLE_DEFAULT_BURST / SIGN_THROTTLE_DEFAULT_WINDOW_MS.
 * @property {typeof WALLET_MODES[number]} [walletMode]                                                      v2-tolerant — `full` (default) signs + broadcasts here; `watcher` builds unsigned PSBTs for an air-gapped signer; `signer` accepts pasted PSBTs from a watcher and returns signed PSBTs (§20 / G039). Send / Home branch on this field in subsequent steps.
 */

// Sign-throttle limits — surfaced in Settings (Cluster S FOLLOWUP 1).
// Bounds are wide enough that the user can effectively disable throttling
// (very large burst, large window) while still preventing nonsense values.
export const SIGN_THROTTLE_BURST_MIN = 1;
export const SIGN_THROTTLE_BURST_MAX = 1000;
export const SIGN_THROTTLE_WINDOW_MS_MIN = 1_000;
export const SIGN_THROTTLE_WINDOW_MS_MAX = 24 * 60 * 60 * 1000;

/** @returns {Settings} */
export function createDefaultSettings() {
    return {
        schemaVersion: CURRENT_VERSION,
        theme: 'system',
        reducedMotion: 'auto',
        autolockMinutes: 15,
        fiatCurrency: 'USD',
        language: 'en',
        sdkEndpoints: {},
        fees: {},
        privacy: {
            torRouting: false,
            changeAddressRotation: true,
            hideSmallBalances: false,
            blurOnBlur: false,
            labelsSurviveRestore: false,
            clipboardAutoClearSeconds: CLIPBOARD_AUTO_CLEAR_DEFAULT,
            hapticsEnabled: true,
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
        walletMode: WALLET_MODE_DEFAULT,
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
                || isBoolean(r.privacy.alwaysRequireHwExplicitConfirm)),
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
            isBoolean(r.notifications.priceAlerts),
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
            'must be an array of strings (chainId:asset keys)',
        );
    }
    if (r.hiddenTokens !== undefined) {
        check(
            errors,
            'hiddenTokens',
            Array.isArray(r.hiddenTokens) && r.hiddenTokens.every(isString),
            'must be an array of strings (chainId:asset keys)',
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
    if (r.blockedOrigins !== undefined) {
        check(
            errors,
            'blockedOrigins',
            Array.isArray(r.blockedOrigins) && r.blockedOrigins.every(isString),
            'must be an array of origin strings',
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
                // Both fields v2-tolerant individually — undefined falls
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

    return result(errors);
}
