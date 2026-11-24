// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Signer-facing copy for the pre-flight warnings and the "Could not verify"
// list (§5.2.4). The SDK writes both for a report reader, in wire field names
// and protocol terms: a warning shows that text beneath its line as the detail,
// and an unverified check shows only its line (operator 2026-11-18).
//
// The extension approval root renders the panel and the SDK must stay out of
// that bundle, so codes are literals and only the i18n store is imported.
//
// A headline must be true of EVERY state its code can carry, the rule the
// panel's notice copy already follows. Several codes are raised by many
// actions, so those lines stay action-neutral, and rules that bind only past a
// network upgrade say "may", never "will".

import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/preflightCopy.js';
import '../../i18n/locales/en/batch.js';
import { consensusRefusalMessage } from './preflightFindingKey.js';

// The demotion the SDK stamps when the network accepted the action but a local
// projection over the sender's other unconfirmed actions still flags the balance
// (code-keyed copy would contradict it); PreflightPanel.findingCopy.test.jsx pins it.
const LOCAL_DELTA_DOWNGRADE = 'dryrun-valid-local-delta';

const LOCAL_DELTA_HEADLINE = 'The network accepted this action on its own, but counting your other unconfirmed'
    + ' transactions your balance may not cover it. Review the amounts before signing.';

const WARNING_FALLBACK = 'The checks flagged something to review before you sign.';

// Keep the protocol-fee forfeiture as one warning because the producer's
// message restates the same consequence in protocol-facing words.
const HEADLINE_ONLY_WARNINGS = new Set(['NATIVE_FEE_FORFEIT']);

export const WARNING_COPY = Object.freeze({
    // Also raised for a dispense against a dispenser whose own price is not
    // positive, so the line names neither whose amount it is nor a certain outcome.
    AMOUNT_NOT_POSITIVE: 'An amount this action uses, one you entered or a price it pays against, is zero, missing or below zero.'
        + ' The network may reject the action or let it move nothing, and coin you send with it may not come back.',
    AMOUNT_FORMAT_INVALID: 'An amount is not written in a form its coin or token accepts, so the network may reject this action.',
    BALANCE_INSUFFICIENT: 'Your balance may not cover everything this action spends, so part of it may fail.',
    BATCH_LIMIT_EXCEEDED: 'This batch is larger than the network accepts in one transaction, so the whole batch may be rejected. Split it into smaller batches.',
    BATCH_NOT_ATOMIC: 'The commands in this batch run one after another. If one fails, the ones before it still go through.',
    CARET_REF_UNRESOLVABLE: 'An address in this action is written as a short reference that may not resolve, so the network may reject'
        + ' the action after its fee is spent. Use the full address.',
    DISPENSER_LIFECYCLE: 'This dispenser is not open, so this change will likely be rejected.',
    // The wire value: the SDK registers it under DISPENSER_NOT_OWNER_W.
    DISPENSER_NOT_OWNER: 'This address does not control this dispenser, so the network will reject this change.',
    DISPENSER_OWNERSHIP_ESCROW: 'This dispenser sells ownership and cannot hold a token top-up. The network may reject this edit,'
        + ' and if it accepts it the tokens added may not come back. Remove the top-up.',
    NATIVE_FEE_FORFEIT: 'This action charges a protocol fee. If the network rejects the action, the coin attached to pay that fee is not returned.',
    TICK_FORMAT: 'The network may refuse this action because of the token name. The detail below says why.',
});

/**
 * Resolve one warning into the headline the panel vouches for and the
 * producer's own words beneath it. An unmapped code (a newer SDK, free-form
 * validator text) never promotes its raw message to the headline.
 *
 * @param {{ code?: string, message?: string, _downgradedBy?: string }} f
 * @returns {{ headline: string, detail: string | null }}
 */
export function warningText(f) {
    const headline = f?._downgradedBy === LOCAL_DELTA_DOWNGRADE
        ? LOCAL_DELTA_HEADLINE
        : (WARNING_COPY[f?.code] || WARNING_FALLBACK);
    const detail = !HEADLINE_ONLY_WARNINGS.has(f?.code) && f?.message && f.message !== headline
        ? f.message
        : null;
    return { headline, detail };
}

// A plain object, so the key audit can read it.
const ERROR_FIELD_KEYS = {
    FEE: 'batch.feeWord',
    VALUE: 'preflightCopy.fieldName.value',
    DECIMALS: 'preflightCopy.fieldName.decimals',
    CALLBACK_BLOCK: 'preflightCopy.fieldName.callbackBlock',
    MINT_START_BLOCK: 'preflightCopy.fieldName.mintStartBlock',
    MINT_STOP_BLOCK: 'preflightCopy.fieldName.mintStopBlock',
    BRIDGE_CHAINS: 'preflightCopy.fieldName.bridgeChains',
    LOCK_BRIDGE: 'preflightCopy.fieldName.bridgeLock',
    MIN_DEPTH: 'preflightCopy.fieldName.minimumDepth',
    DISPENSER_ACTION_INDEX: 'preflightCopy.fieldName.dispenserAction',
    ORDER_ACTION_INDEX: 'preflightCopy.fieldName.orderAction',
    SWAP_ACTION_INDEX: 'preflightCopy.fieldName.swapAction',
    FEED_ACTION_INDEX: 'preflightCopy.fieldName.feedAction',
    SIGNING_PUBKEY: 'preflightCopy.fieldName.signingKey',
    EXPIRATION: 'preflightCopy.fieldName.expiration',
    DEADLINE: 'preflightCopy.fieldName.deadline',
    REFUND_WINDOW: 'preflightCopy.fieldName.refundWindow',
    OUTCOME: 'preflightCopy.fieldName.outcome',
    COIN1_ACTION_INDEX: 'preflightCopy.fieldName.firstLinkedAction',
    COIN2_ACTION_INDEX: 'preflightCopy.fieldName.secondLinkedAction',
    TARGET_CONTRACT_INDEX: 'preflightCopy.fieldName.targetContract',
};

function errorFieldLabel(field) {
    return t(ERROR_FIELD_KEYS[field] || 'preflightCopy.fieldName.value');
}

/**
 * Resolve an error into signer-facing copy while retaining the producer's
 * diagnostic only as secondary detail.
 *
 * @param {{ code?: string, message?: string, data?: Record<string, unknown> }} f
 * @returns {{ headline: string, detail: string | null }}
 */
export function errorText(f) {
    const consensus = consensusRefusalMessage(f);
    if (consensus) return { headline: consensus, detail: null };
    const data = f?.data || {};
    const field = errorFieldLabel(data.field);
    let headline = t('preflightCopy.error.fallback');
    if (f?.code === 'VALIDATOR_SEMANTICS' && data.haltClass === true) {
        if (Number.isFinite(data.width) && Number.isFinite(data.limit)) {
            headline = t('preflightCopy.error.tooLong', { field });
        } else if (typeof data.value === 'string' && /^[-+]?0[xbo]/i.test(data.value.trim())) {
            headline = t('preflightCopy.error.prefixedNumber', { field });
        } else if (data.value === '') {
            headline = t('preflightCopy.error.required', { field });
        } else if (data.value !== undefined) {
            headline = t('preflightCopy.error.invalidReference', { field });
        }
    }
    const message = typeof f?.message === 'string' ? f.message.trim() : '';
    return { headline, detail: message && message !== headline ? message : null };
}

// Each entry names WHAT was not checked, so it stays true whatever the reason
// was: a lookup that failed, a rule only the network can judge, or an upgrade
// whose height the client cannot read. Values are i18n keys (locales/en/preflightCopy.js).
const UNVERIFIED_FALLBACK = 'preflightCopy.unverified.fallback';

// Codes that share a line share its key. A plain object, so the key audit can read it.
const UNVERIFIED_KEYS = {
    TOKEN_LOOKUP: 'preflightCopy.unverified.tokenLookup',
    BALANCE_LOOKUP: 'preflightCopy.unverified.balanceLookup',
    NATIVE_BALANCE_LOOKUP: 'preflightCopy.unverified.nativeBalanceLookup',
    SWEEP_STATE: 'preflightCopy.unverified.sweepState',
    STAKE_STATE: 'preflightCopy.unverified.stakeState',
    UNSTAKE_STATE: 'preflightCopy.unverified.unstakeState',
    DELEGATE_STATE: 'preflightCopy.unverified.delegateState',
    VOTE_CREATE_STATE: 'preflightCopy.unverified.voteCreateState',
    VOTE_STATE: 'preflightCopy.unverified.voteState',
    VOTE_FINALIZE_STATE: 'preflightCopy.unverified.voteFinalizeState',
    VOTE_DELEGATION_STATE: 'preflightCopy.unverified.voteDelegationState',
    COLLECT_STATE: 'preflightCopy.unverified.collectState',
    DEPLOY_STATE: 'preflightCopy.unverified.deployState',
    EXECUTE_STATE: 'preflightCopy.unverified.executeState',
    DEPOSIT_STATE: 'preflightCopy.unverified.depositState',
    WITHDRAW_STATE: 'preflightCopy.unverified.withdrawState',
    COINPAY_STATE: 'preflightCopy.unverified.coinpayState',
    FILE_STATE: 'preflightCopy.unverified.fileState',
    LINK_STATE: 'preflightCopy.unverified.linkState',
    LIST_STATE: 'preflightCopy.unverified.listState',
    ADDRESS_STATE: 'preflightCopy.unverified.addressState',
    PRICE_STATE: 'preflightCopy.unverified.priceState',
    SLEEP_STATE: 'preflightCopy.unverified.sleepState',
    LIST_SET_META_FEE: 'preflightCopy.unverified.listSetMetaFee',
    BALANCE_INSUFFICIENT: 'preflightCopy.unverified.balanceInsufficient',
    AMOUNT_FORMAT_INVALID: 'preflightCopy.unverified.amountFormatInvalid',
    LEG_AMOUNT_CONSOLIDATION: 'preflightCopy.unverified.amountFormatInvalid',
    AMOUNT_REPRESENTABILITY: 'preflightCopy.unverified.amountRepresentability',
    AIRDROP_TOTAL_VS_BALANCE: 'preflightCopy.unverified.airdropTotalVsBalance',
    DIVIDEND_DEBIT_TOTAL: 'preflightCopy.unverified.dividendDebitTotal',
    SUPPLY_EXCEEDED: 'preflightCopy.unverified.supplyExceeded',
    MINT_OVER_MAX: 'preflightCopy.unverified.mintOverMax',
    MINT_ADDRESS_HEADROOM: 'preflightCopy.unverified.mintAddressHeadroom',
    NOT_OWNER: 'preflightCopy.unverified.notOwner',
    ISSUE_GAS_TICK: 'preflightCopy.unverified.issueGasTick',
    ISSUE_TICK_NAMESPACE: 'preflightCopy.unverified.issueTickNamespace',
    ISSUE_TICK_COIN_PREFIX: 'preflightCopy.unverified.issueTickCoinPrefix',
    ISSUE_BRIDGE_ACTIVATION: 'preflightCopy.unverified.issueBridgeActivation',
    ISSUE_LOCK_RATCHETS: 'preflightCopy.unverified.issueLockRatchets',
    ISSUE_BRIDGE_POLICY_EXCLUSION: 'preflightCopy.unverified.issueBridgePolicyExclusion',
    SEND_RESTRICTIONS: 'preflightCopy.unverified.sendRestrictions',
    DESTROY_BRIDGE_SUPPLY: 'preflightCopy.unverified.destroyBridgeSupply',
    DESTROY_RESTRICTIONS: 'preflightCopy.unverified.destroyRestrictions',
    CARET_REF_UNRESOLVABLE: 'preflightCopy.unverified.caretRefUnresolvable',
    LIST_NOT_FOUND: 'preflightCopy.unverified.listNotFound',
    LIST_REFERENCE_VALIDITY: 'preflightCopy.unverified.listReferenceValidity',
    ORDER_REFERENCE: 'preflightCopy.unverified.orderReference',
    SWAP_REFERENCE: 'preflightCopy.unverified.swapReference',
    ORDER_RESTRICTIONS: 'preflightCopy.unverified.orderRestrictions',
    SWAP_RESTRICTIONS: 'preflightCopy.unverified.orderRestrictions',
    DISPENSER_NOT_FOUND: 'preflightCopy.unverified.dispenserNotFound',
    DISPENSER_LIFECYCLE: 'preflightCopy.unverified.dispenserLifecycle',
    DISPENSER_NOT_OPEN: 'preflightCopy.unverified.dispenserLifecycle',
    DISPENSER_EMPTY: 'preflightCopy.unverified.dispenserEmpty',
    DISPENSER_MAX_REFILLS: 'preflightCopy.unverified.dispenserMaxRefills',
    DISPENSER_ORACLE_FEE: 'preflightCopy.unverified.dispenserOracleFee',
    DISPENSER_SETTLEMENT_PRICE: 'preflightCopy.unverified.dispenserSettlementPrice',
    DISPENSE_SETTLEMENT_MATCH: 'preflightCopy.unverified.dispenseSettlementMatch',
    GATED_HANDOFF_REF: 'preflightCopy.unverified.gatedHandoffRef',
    DISPENSER_RESTRICTIONS: 'preflightCopy.unverified.dispenserRestrictions',
    LIST_LOOKUP: 'preflightCopy.unverified.listLookup',
    DISPENSER_LOOKUP: 'preflightCopy.unverified.dispenserLookup',
    DURATION_FEE: 'preflightCopy.unverified.durationFee',
    DISPENSER_ORIGIN_STANDING: 'preflightCopy.unverified.dispenserOriginStanding',
    ISSUE_CARET_TICK_NO_CREATE: 'preflightCopy.unverified.issueCaretTickNoCreate',
    VALIDATOR_SEMANTICS: 'preflightCopy.unverified.validatorSemantics',
    // Declared for a VOTE format the SDK does not recognise, so nothing more
    // specific than the generic line is true of it.
    VOTE_UNKNOWN_STATE: UNVERIFIED_FALLBACK,
};

export const UNVERIFIED_COPY = Object.freeze(UNVERIFIED_KEYS);

// Checks the wallet itself writes, whose reason is already signer copy and
// stays the headline (routes/DispenserDetail.jsx).
const WALLET_AUTHORED_CHECKS = new Set(['dispenser_state']);

/**
 * The plain headline for one "Could not verify" entry. The SDK's reason is
 * report-reader text, so it stays on the report and is never drawn.
 *
 * @param {{ check?: string, reason?: string }} u
 * @returns {{ headline: string, detail: null }}
 */
export function unverifiedText(u) {
    const reason = typeof u?.reason === 'string' ? u.reason : '';
    if (WALLET_AUTHORED_CHECKS.has(u?.check) && reason) return { headline: reason, detail: null };
    return { headline: t(UNVERIFIED_KEYS[u?.check] || UNVERIFIED_FALLBACK), detail: null };
}
