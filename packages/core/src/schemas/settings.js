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

export const CURRENT_VERSION = 1;

export const THEMES = /** @type {const} */ (['system', 'light', 'dark']);
export const FEE_STRATEGIES = /** @type {const} */ (['low', 'normal', 'fast', 'custom']);

// ADS default — single source of truth per §36. Flip this to false to
// make ADS opt-in without touching call sites.
export const ADS_DEFAULT_ENABLED = true;
export const ADS_DEFAULT_PER_TX_SATS = 1;
export const ADS_DEFAULT_TRIGGER_SATS = 1000;

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
 * @property {1} schemaVersion
 * @property {typeof THEMES[number]} theme
 * @property {number} autolockMinutes
 * @property {string} fiatCurrency
 * @property {string} language
 * @property {Record<string, SdkEndpoint>} sdkEndpoints
 * @property {Record<string, FeeSettings>} fees
 * @property {{ torRouting: boolean, changeAddressRotation: boolean, hideSmallBalances: boolean }} privacy
 * @property {{ enabled: boolean, perChain: Record<string, AdsChainState> }} ads
 * @property {{ txConfirmations: boolean, incomingReceipts: boolean, dispenserFills: boolean, orderFills: boolean, priceAlerts: boolean }} notifications
 * @property {boolean} developerMode
 * @property {boolean} learnMode
 * @property {{ undoSendSeconds: number }} grace
 */

/** @returns {Settings} */
export function createDefaultSettings() {
    return {
        schemaVersion: CURRENT_VERSION,
        theme: 'system',
        autolockMinutes: 15,
        fiatCurrency: 'USD',
        language: 'en',
        sdkEndpoints: {},
        fees: {},
        privacy: {
            torRouting: false,
            changeAddressRotation: true,
            hideSmallBalances: false,
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
        },
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
            isBoolean(r.privacy.hideSmallBalances),
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
        isPlainObject(r.grace) && isNonNegativeInteger(r.grace.undoSendSeconds),
        'malformed',
    );

    return result(errors);
}
