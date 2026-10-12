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
// and protocol terms; the panel shows that text beneath as the detail and
// leads with the line below.
//
// Zero dependencies on purpose: the extension approval root renders the
// panel, and the SDK must stay out of that bundle, so codes are literals.
//
// A headline must be true of EVERY state its code can carry, the rule the
// panel's notice copy already follows. Several codes are raised by many
// actions, so those lines stay action-neutral, and rules that bind only past a
// network upgrade say "may", never "will".

// The demotion the SDK stamps when the network accepted the action but a
// local balance projection over the sender's other unconfirmed actions still
// flags it. Copy keyed on the code alone would contradict the acceptance.
const LOCAL_DELTA_DOWNGRADE = 'dryrun-valid-local-delta';

const LOCAL_DELTA_HEADLINE = 'The network accepted this action on its own, but counting your other unconfirmed'
    + ' transactions your balance may not cover it. Review the amounts before signing.';

const WARNING_FALLBACK = 'The checks flagged something to review before you sign.';

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
    return { headline, detail: f?.message && f.message !== headline ? f.message : null };
}

// Each entry names WHAT was not checked, so it stays true whatever the reason
// was: a lookup that failed, a rule only the network can judge, or an upgrade
// whose height the client cannot read. A consequence the signer needs to know
// before signing stays in the line rather than only in the detail.
const UNVERIFIED_FALLBACK = 'Other conditions the network checks when this transaction arrives';

export const UNVERIFIED_COPY = Object.freeze({
    // Per-action notes for actions with no dedicated client checks.
    SWEEP_STATE: 'Whether your balance covers the fee for this sweep',
    STAKE_STATE: 'Whether the stake target accepts this stake',
    UNSTAKE_STATE: 'Whether you have an active stake to withdraw and its waiting period has passed',
    DELEGATE_STATE: 'Whether you have an active stake to delegate',
    VOTE_STATE: 'Whether the poll is open, your ballot is valid, and how much your vote counts',
    COLLECT_STATE: 'Your unclaimed rewards, and whether the pool can pay them',
    DEPLOY_STATE: 'Whether the contract code is complete and valid, and the gas its setup needs',
    EXECUTE_STATE: 'The contract\'s state and the gas this call needs. A call that fails still charges its fee.',
    DEPOSIT_STATE: 'Whether the contract is active and the token\'s rules allow this deposit',
    WITHDRAW_STATE: 'Whether you may withdraw from this contract and the token\'s rules allow it',
    COINPAY_STATE: 'Whether the payment request exists, matches this payment, and has not expired',
    FILE_STATE: 'Ownership and escrow of the gated content',
    LINK_STATE: 'Whether you own what this link points to',
    LIST_STATE: 'Who owns this list, and its sharing and size limits',
    ADDRESS_STATE: 'Whether the contract can be bound to this address',
    PRICE_STATE: 'Whether this address may publish prices',
    SLEEP_STATE: 'Ownership, locks and escrow on what this action pauses',
    LIST_SET_META_FEE: 'Whether this list is shared. Editing a shared list charges an extra fee.',

    // Balances, amounts and limits.
    BALANCE_INSUFFICIENT: 'Whether your balance covers this action',
    AMOUNT_FORMAT_INVALID: 'Whether each amount fits its token\'s decimal places',
    LEG_AMOUNT_CONSOLIDATION: 'Whether each amount fits its token\'s decimal places',
    AMOUNT_REPRESENTABILITY: 'Whether every amount is written in a form the network accepts',
    AIRDROP_TOTAL_VS_BALANCE: 'Who receives this airdrop, and so its total cost',
    DIVIDEND_DEBIT_TOTAL: 'Who receives this dividend, and so its total cost',
    SUPPLY_EXCEEDED: 'Whether this mint stays within the token\'s supply limit',
    MINT_OVER_MAX: 'Whether this mint stays within the token\'s mint limits',
    MINT_ADDRESS_HEADROOM: 'Per-address mint limits, allow and block lists, and the token\'s own rules',

    // Tokens and their rules.
    NOT_OWNER: 'Whether this address owns the token',
    ISSUE_GAS_TICK: 'Whether this token name is reserved on this chain',
    ISSUE_TICK_NAMESPACE: 'Whether this token name is available',
    ISSUE_TICK_COIN_PREFIX: 'Whether this token name is allowed',
    ISSUE_BRIDGE_ACTIVATION: 'Whether the network supports this bridging option yet',
    ISSUE_LOCK_RATCHETS: 'Whether the token\'s locks allow this change',
    ISSUE_BRIDGE_POLICY_EXCLUSION: 'Whether the token\'s bridging and transfer rules allow this change',
    SEND_RESTRICTIONS: 'Transfer rules on the token and on both addresses',
    DESTROY_BRIDGE_SUPPLY: 'Whether this token can be destroyed on this chain',
    DESTROY_RESTRICTIONS: 'Burn rules on the token and on your address',
    CARET_REF_UNRESOLVABLE: 'Which address a short address reference points to',

    // Lists, trading and dispensers.
    LIST_NOT_FOUND: 'Whether the list this action names exists',
    LIST_REFERENCE_VALIDITY: 'Whether the list this action names is valid',
    ORDER_REFERENCE: 'Whether the order this action changes exists',
    SWAP_REFERENCE: 'Whether the swap this action changes exists',
    ORDER_RESTRICTIONS: 'Trading rules on the token',
    SWAP_RESTRICTIONS: 'Trading rules on the token',
    DISPENSER_NOT_FOUND: 'Whether the dispenser exists',
    DISPENSER_LIFECYCLE: 'Whether the dispenser is still open',
    DISPENSER_NOT_OPEN: 'Whether the dispenser is still open',
    DISPENSER_EMPTY: 'Whether the dispenser still has enough to sell',
    DISPENSER_MAX_REFILLS: 'Whether this dispenser has refills left',
    DISPENSER_ORACLE_FEE: 'Whether the oracle usage fee is paid',
    DISPENSER_SETTLEMENT_PRICE: 'Whether a price is available for this dispenser when the transaction confirms',
    DISPENSE_SETTLEMENT_MATCH: 'Whether your payment exactly matches what the dispenser expects',
});

// Checks the wallet itself writes, whose reason is already signer copy and
// stays the headline (routes/DispenserDetail.jsx).
const WALLET_AUTHORED_CHECKS = new Set(['dispenser_state']);

/**
 * Resolve one "Could not verify" entry into its headline and the producer's
 * own reason beneath it.
 *
 * @param {{ check?: string, reason?: string }} u
 * @returns {{ headline: string, detail: string | null }}
 */
export function unverifiedText(u) {
    const reason = typeof u?.reason === 'string' ? u.reason : '';
    if (WALLET_AUTHORED_CHECKS.has(u?.check) && reason) return { headline: reason, detail: null };
    const headline = UNVERIFIED_COPY[u?.check] || UNVERIFIED_FALLBACK;
    return { headline, detail: reason && reason !== headline ? reason : null };
}
