// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/send.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AddressText,
    Button,
    ChainBadge,
    FormNotice,
    FormPage,
    Icon,
    IconSelect,
    Input,
    PageHeader,
    Screen,
    SegmentedControl,
    Select,
    StatusMessage,
} from '@xchain-wallet/core/ui';
// The Wallet Form Standard frame (From, main section, Network fee, status
// slot, one action).
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    joinSummary,
    summaryAddress,
    useFormSections,
} from '../components/formStandard/index.js';
import { registry as registryLib } from '@xchain-wallet/core';
import { isDemoWallet, synthesizeDemoContractMeta, synthesizeDemoStaking } from '@xchain-wallet/core/flows';
import { validatorLaneChainIds } from '../../registry/actions.js';
import { tickerForCoin } from '../../registry/coinTicker.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { useDocumentTitleSection } from '../hooks/useDocumentTitle.js';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { useTickFiatRate } from '../hooks/useFiatRate.js';
import { useSettings } from '../hooks/useSettings.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useContractManifest } from '../hooks/useContractManifest.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { contractFieldName } from '../hooks/useContractTarget.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ContractConsentPanel } from '../components/ContractConsentPanel.jsx';
import { TargetField } from '../components/TargetField.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { preferredSourceId } from '../addressSelection.js';
import {
    compareDecimalStrings,
    countNonCommaBefore,
    formatWithThousands,
    indexAfterNonCommaCount,
    roundDecimalString,
    sumDecimalStrings,
    tokenAmountPrecisionError,
    trimAmountTail,
} from '../utils/amountFormat.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { titleCase } from '../utils/titleCase.js';
import { isValidAddressForChain } from '../utils/addressValidation.js';
import { bpsToPercent, permissionsToVerbs } from '../utils/contractConsentLabels.js';
import { targetBlockSecondsForCoin } from '../utils/blockDateEstimate.js';
import { coinToFiatExact, fiatToCoin } from '../../flows/priceLookup.js';
import {
    customFeeEstimate,
    customFeeReviewStop,
    displayRateToSettingsCustom,
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
} from '../../flows/feeEstimate.js';
import {
    effectiveStakingRows,
    latestEffectiveStakingRow,
    stakingActivationBlock,
    stakingRowState,
    unclaimedRewards,
} from '../../flows/stakingDashboard.js';
import { stakingActionParams } from '../../flows/unstakeClaimActions.js';
import { signingKeyRefusal } from '../../flows/signingKeyCheck.js';
import { compareAmounts } from '../../market/orderMath.js';
import { blocksDurationText } from './pollDisplay.js';
import { StakeNew } from './StakeNew.jsx';
import { ContractsList } from './ContractsList.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

function contractManifestFacts(manifest) {
    const permissions = manifest?.permissions ?? null;
    const status = manifest?.status ?? (Array.isArray(permissions) ? 'declared' : 'unavailable');
    if (status === 'unavailable') {
        return [{
            label: t('components.contractConsentPanel.permissionYouGrant'),
            value: t('components.contractConsentPanel.theWalletCouldnTLook'),
        }];
    }
    const permissionValue = status === 'unrestricted'
        ? t('components.contractConsentPanel.anythingByContinuingYouGrant')
        : (() => {
            const verbs = permissionsToVerbs(permissions);
            return verbs?.length
                ? verbs.map((verb) => `${t('components.contractConsentPanel.itCan')} ${verb}`).join(', ')
                : t('components.contractConsentPanel.youGrantNoActionPermissions');
        })();
    return [
        { label: t('components.contractConsentPanel.permissionYouGrant'), value: permissionValue },
        {
            label: t('components.contractConsentPanel.maxFeeItCanTake'),
            value: bpsToPercent(manifest?.maxTakeBps) ?? t('components.contractConsentPanel.noLimitOfItsOwn'),
        },
        {
            label: t('components.contractConsentPanel.whereThisComesFrom'),
            value: t('components.contractConsentPanel.reportedByTheXchainIndex'),
        },
    ];
}

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// Validator staking is denominated in XCHAIN on every chain, so its amount
// field and fiat preview always price this tick, never the chain's coin.
const STAKING_TICK = 'XCHAIN';

// Plain-language labels for the four capabilities (capability-staking-model.md
// §3). Keyed by the protocol capability id the hub returns.
const CAPABILITY_LABELS = {
    price:          'Price feeds',
    cross_chain:    'Cross-chain',
    oracle_publish: 'Oracle publishing',
    attestation:    'Attestations',
};

// Shown when an unstake or claim is pressed before the total the amount is
// judged against has loaded; until then a partial cannot be told from "everything".
const TOTAL_LOADING_MESSAGE = {
    claim: 'The pending reward total is still loading. Wait for it before claiming.',
    unstake: 'The staked balance is still loading. Wait for it before unstaking.',
};

const HEX64 = /^[0-9a-fA-F]{64}$/;

// House convention: explorer reads answer as a bare array, {data} or {rows}.
function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

/**
 * The cooldown line under the Stake On field of a contract: how long an
 * unstake waits, in the chain's target block time and in blocks. Stake and
 * Delegate say how long unstaking will take; Unstake says when the tokens
 * are free.
 *
 * @param {'stake' | 'unstake' | 'delegate'} mode
 * @param {number | null} cooldown   the contract's COOLDOWN_BLOCKS
 * @param {string | null | undefined} coin
 * @returns {string | null}
 */
export function contractCooldownHint(mode, cooldown, coin) {
    if (!Number.isFinite(cooldown) || cooldown < 0) return null;
    const blocks = `${formatWithThousands(String(cooldown))} block${cooldown === 1 ? '' : 's'}`;
    const duration = blocksDurationText(cooldown, targetBlockSecondsForCoin(coin));
    if (mode === 'unstake') {
        return duration ? `Free to use in about ${duration} (${blocks})` : `Free to use in ${blocks}`;
    }
    return duration ? `Unstaking takes about ${duration} (${blocks})` : `Unstaking takes ${blocks}`;
}

/**
 * The actions each kind of target takes, in toggle order. A contract stake
 * composes STAKE v3 / UNSTAKE v1 / DELEGATE v1 against the contract; a
 * network (validator) stake composes STAKE v1/v2, UNSTAKE, COLLECT, DELEGATE
 * v0 and DELEGATE v2 (revoke). The same word can mean a different action on
 * the wire, so everything below is keyed on the (target kind, action) pair.
 */
const ACTIONS = {
    contract: [
        { id: 'stake', label: 'Stake', Glyph: Icon.StakeIcon },
        { id: 'unstake', label: 'Unstake', Glyph: Icon.UnlinkIcon },
        { id: 'delegate', label: 'Delegate', Glyph: Icon.KeyIcon },
    ],
    network: [
        { id: 'stake', label: 'Stake', Glyph: Icon.StakeIcon },
        { id: 'unstake', label: 'Unstake', Glyph: Icon.UnlinkIcon },
        { id: 'claim-rewards', label: 'Claim', Glyph: Icon.CoinsIcon },
        { id: 'delegate', label: 'Delegate', Glyph: Icon.KeyIcon },
        { id: 'revoke', label: 'Revoke', Glyph: Icon.TrashIcon },
    ],
};

/**
 * The main section's title per action: a noun, so the section header never
 * shares the action button's accessible name ("Stake" button, "Staking"
 * section).
 */
export const STAKING_SECTION_TITLES = {
    stake: 'Staking',
    unstake: 'Unstaking',
    'claim-rewards': 'Rewards',
    delegate: 'Delegation',
    revoke: 'Revocation',
};

const NETWORK_ACTION_HELP = 'Stake locks XCHAIN behind a signing key that votes for the network. Unstake starts returning it. Claim collects the rewards it has earned. Delegate lets another key sign for this address; Revoke takes that back.';

const NETWORK_NO_ADDRESS = 'No address on this network. Use Receive to generate one first.';
const STAKE_NO_ADDRESS = 'No address on this network to stake from. Use Receive to generate one first.';

/**
 * What each (target kind, action) pair is: its wire action and version, the
 * host calls that sign it, the fields the form shows for it and the words
 * around them. The form holds one set of values (From, Stake On, action,
 * amount, signing key, token, fee speed); this table only decides which of
 * them an action shows, reads and sends.
 *
 * - `wire` / `version`: the action and, for contract actions, the VERSION
 *   the encoder sees. A versioned (contract) action composes the versioned
 *   params and submits the legacy shape plus `mode`; the host flow rebuilds
 *   the wire form itself.
 * - `amount`: 'balance' (stake from the address's balance), 'position'
 *   (unstake or claim against a known total, with a fiat view), 'contract'
 *   (a contract stake or partial unstake) or null (no amount).
 * - `key`: the signing key field's label and help, or null.
 * - `full`: the host flow takes `full` (the explicit whole-balance request).
 */
const STAKING_ACTIONS = {
    'network:stake': {
        wire: 'STAKE',
        software: 'stakeAction',
        hardware: 'stakeActionHw',
        verb: 'Stake',
        icon: Icon.StakeIcon,
        sectionIcon: Icon.StakeIcon,
        formLabel: 'Stake XCHAIN',
        submitLabel: (single) => (single ? 'Stake' : 'Review Stake'),
        reviewTitle: 'Review Stake',
        reviewLabel: 'Review stake',
        reviewSubmit: 'Stake XCHAIN',
        unsignedLabel: 'Create Unsigned Transaction',
        failText: 'Stake failed.',
        noAddress: STAKE_NO_ADDRESS,
        networkHelp: 'The chain your stake is locked on. Only networks that support staking are listed, and the From address and the fee are on the network you pick.',
        amount: 'balance',
        amountHelp: 'Amount to stake. Capabilities activate automatically when your total stake reaches their thresholds.',
        key: {
            label: 'Signing public key',
            help: '64-character hex-encoded Ed25519 public key. This key votes on the network on your behalf.',
        },
        resultNoun: 'stake',
        doneText: 'Stake broadcast. Activation takes effect after 6 BTC blocks.',
        txidFallback: 'N/A',
    },
    'network:unstake': {
        wire: 'UNSTAKE',
        software: 'unstakeAction',
        hardware: 'unstakeActionHw',
        verb: 'Unstake',
        icon: Icon.UnlinkIcon,
        sectionIcon: Icon.UnlinkIcon,
        formLabel: 'Unstake staking',
        submitLabel: (single) => titleCase(single ? 'Unstake' : 'Review unstake'),
        reviewTitle: titleCase('Review unstake'),
        reviewLabel: 'Review unstake',
        reviewSubmit: 'Unstake',
        unsignedLabel: 'Create Unsigned Transaction',
        failText: 'Unstake failed.',
        noAddress: NETWORK_NO_ADDRESS,
        networkHelp: 'The chain your stake is on. Only networks that support staking are listed, and the From address and the fee are on the network you pick.',
        amount: 'position',
        amountHelp: 'The amount you choose enters the cooldown and returns after it; anything left stays staked under the signing public key below.',
        key: { label: 'Signing public key' },
        full: true,
        resultNoun: 'unstake',
        doneText: 'Unstake broadcast. The network will return your staked XCHAIN after the on-chain confirmation window.',
        txidFallback: '(pending)',
    },
    'network:claim-rewards': {
        wire: 'COLLECT',
        software: 'collectAction',
        hardware: 'collectActionHw',
        verb: 'Claim Rewards',
        icon: Icon.StakeIcon,
        sectionIcon: Icon.StakeIcon,
        formLabel: 'Claim Rewards staking',
        submitLabel: (single) => titleCase(single ? 'Claim Rewards' : 'Review claim rewards'),
        reviewTitle: titleCase('Review claim rewards'),
        reviewLabel: 'Review claim rewards',
        reviewSubmit: 'Claim Rewards',
        unsignedLabel: 'Create Unsigned Transaction',
        failText: 'Claim Rewards failed.',
        noAddress: NETWORK_NO_ADDRESS,
        networkHelp: 'The chain your stake is on. Only networks that support staking are listed, and the From address and the fee are on the network you pick.',
        amount: 'position',
        amountHelp: 'Claimed rewards land in your balance, and rewards keep accruing after the claim. Any amount you leave unclaimed stays pending.',
        key: null,
        full: true,
        resultNoun: 'claim',
        doneText: 'Claim broadcast. Pending rewards will be credited after the network records the action.',
        txidFallback: '(pending)',
    },
    'network:delegate': {
        wire: 'DELEGATE',
        software: 'delegateAction',
        hardware: 'delegateActionHw',
        verb: 'Delegate Signing Key',
        icon: Icon.KeyIcon,
        sectionIcon: Icon.KeyIcon,
        formLabel: 'Delegate Signing Key',
        submitLabel: (single) => titleCase(single ? 'Delegate Signing Key' : 'Review delegate signing key'),
        reviewTitle: titleCase('Review delegate signing key'),
        reviewLabel: 'Review delegate signing key',
        reviewSubmit: 'Delegate Signing Key',
        unsignedLabel: 'Create Unsigned Transaction: Delegate Signing Key',
        failText: 'Delegate Signing Key failed.',
        noAddress: NETWORK_NO_ADDRESS,
        networkHelp: 'The chain the staked address is on. Only networks that support staking are listed, and the From address and the fee are on the network you pick.',
        amount: null,
        key: {
            label: 'New signing pubkey',
            help: 'The 64-character hex Ed25519 public key that can sign hub actions for this address without moving its stake. It replaces any currently active delegation; revoke it later from staking details.',
        },
        resultNoun: 'delegation',
        doneText: 'Delegation broadcast. The new signing key becomes active after the network records the action.',
        txidFallback: 'n/a',
    },
    'network:revoke': {
        wire: 'DELEGATE',
        software: 'revokeDelegationAction',
        hardware: 'revokeDelegationActionHw',
        verb: 'Revoke Delegation',
        icon: Icon.TrashIcon,
        sectionIcon: Icon.KeyIcon,
        formLabel: 'Revoke Delegation',
        submitLabel: (single) => titleCase(single ? 'Revoke Delegation' : 'Review revoke delegation'),
        reviewTitle: titleCase('Review revoke delegation'),
        reviewLabel: 'Review revoke delegation',
        reviewSubmit: 'Revoke Delegation',
        unsignedLabel: 'Create Unsigned Transaction: Revoke Delegation',
        failText: 'Revoke Delegation failed.',
        noAddress: NETWORK_NO_ADDRESS,
        networkHelp: 'The chain the staked address is on. Only networks that support staking are listed, and the From address and the fee are on the network you pick.',
        amount: null,
        key: {
            label: 'Signing pubkey to revoke',
            help: 'The 64-character hex Ed25519 public key to stop signing hub actions for this address. Pre-filled with your most recent active delegation; change it to revoke a specific older key.',
        },
        resultNoun: 'revocation',
        doneText: 'Revocation broadcast. The signing key will stop voting on your behalf once the network records the action.',
        txidFallback: 'n/a',
    },
    'contract:stake': {
        wire: 'STAKE',
        version: '3',
        software: 'contractStakeAction',
        hardware: 'contractStakeActionHw',
        verb: 'Stake',
        icon: Icon.StakeIcon,
        sectionIcon: Icon.StakeIcon,
        formLabel: 'Contract stake',
        submitLabel: () => 'Stake',
        reviewTitle: 'Stake',
        reviewLabel: 'Stake review',
        reviewSubmit: 'Stake',
        unsignedLabel: 'Create Unsigned Transaction',
        failText: 'stake failed.',
        noAddress: STAKE_NO_ADDRESS,
        amount: 'contract',
        amountHelp: "How much of the token to stake. Decimals must not exceed the token's precision.",
        key: {
            label: 'Signing Key',
            help: '64-character hex-encoded Ed25519 public key to associate with this stake. Re-staking with the same key tops up.',
        },
        resultNoun: 'stake',
        doneText: 'Stake submitted.',
        txidFallback: '(pending)',
    },
    'contract:unstake': {
        wire: 'UNSTAKE',
        version: '1',
        software: 'contractStakeAction',
        hardware: 'contractStakeActionHw',
        verb: 'Unstake',
        icon: Icon.UnlinkIcon,
        sectionIcon: Icon.UnlinkIcon,
        formLabel: 'Contract stake',
        submitLabel: () => 'Unstake',
        reviewTitle: 'Stake',
        reviewLabel: 'Unstake review',
        reviewSubmit: 'Unstake',
        unsignedLabel: 'Create Unsigned Transaction',
        failText: 'unstake failed.',
        noAddress: STAKE_NO_ADDRESS,
        amount: 'contract',
        amountHelp: 'How much to unstake. Leave blank (or use Max) to unstake the full staked balance; the rest stays staked.',
        key: {
            label: 'Signing Key',
            help: '64-character hex-encoded Ed25519 public key identifying which contract-stake to begin cooldown for.',
        },
        resultNoun: 'unstake',
        doneText: 'Unstake submitted.',
        txidFallback: '(pending)',
    },
    'contract:delegate': {
        wire: 'DELEGATE',
        version: '1',
        software: 'contractStakeAction',
        hardware: 'contractStakeActionHw',
        verb: 'Delegate',
        icon: Icon.KeyIcon,
        sectionIcon: Icon.KeyIcon,
        formLabel: 'Contract stake',
        submitLabel: () => 'Delegate Key',
        reviewTitle: 'Stake',
        reviewLabel: 'Delegate review',
        reviewSubmit: 'Delegate',
        unsignedLabel: 'Create Unsigned Transaction',
        failText: 'delegate failed.',
        noAddress: STAKE_NO_ADDRESS,
        amount: null,
        key: {
            label: 'New Signing Key',
            help: '64-character hex-encoded Ed25519 public key to rotate to. Generate one offline; this wallet does not auto-generate validator keys.',
        },
        resultNoun: 'delegation',
        doneText: 'Delegation submitted.',
        txidFallback: '(pending)',
    },
};

function normalizeTarget(target) {
    if (target?.kind === 'contract') {
        return {
            kind: 'contract',
            chainId: target.chainId,
            contractActionIndex: target.contractActionIndex == null ? '' : String(target.contractActionIndex),
        };
    }
    return { kind: 'network', chainId: target?.chainId };
}

function actionFor(kind, action) {
    return ACTIONS[kind].some((item) => item.id === action) ? action : 'stake';
}

function targetKey(target) {
    return `${target.kind}\0${target.chainId}\0${target.contractActionIndex ?? ''}`;
}

/**
 * The one Staking form. Every staking route renders it: a stake, unstake or
 * delegation on a contract, and a stake, unstake, rewards claim, delegation
 * or revocation on the network (validator staking). The title is always
 * "Stake"; the main section opens with the Stake On field, which names the
 * target and holds a contract's cooldown as a hint, and the action control
 * below it shows only the actions that target takes.
 *
 * The form owns one set of values. Switching the action or the target
 * keeps every value that still applies (the From address, the amount the
 * user typed, the signing key the user typed, the token, the fee speed) and
 * only shows or hides fields; STAKING_ACTIONS decides which. A value the
 * form filled in itself (an unstake's staked key, a revoke's active
 * delegation) gives way to the next action's own fill.
 *
 * The action control is the shared segmented toggle on a contract (three
 * actions fit at 360px with the 1.3 text setting) and the shared IconSelect
 * on the network, where five segments do not fit.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {{ kind: 'contract', chainId: string, contractActionIndex: string | number } | { kind: 'network', chainId: string }} props.target
 * @param {'stake' | 'unstake' | 'claim-rewards' | 'delegate' | 'revoke'} [props.action]
 * @param {string} [props.initialTick]          contract stakes: preseed the token (xchain-wallet#34)
 * @param {string} [props.initialSigningPubkey] contract stakes: preseed the signing key (xchain-wallet#34)
 * @param {string} [props.initialFromAddress]   act from this address when it is one of the wallet's on the target's chain
 * @param {() => void} props.onBack
 */
export function StakingForm({
    walletId,
    target: openedTarget,
    action: openedAction,
    initialTick,
    initialSigningPubkey,
    initialFromAddress,
    onBack,
}) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const { isWatcherMode } = useWalletMode();
    // Only for the unstake and claim fiat preview: the display currency, and
    // whether the user has opted out of third-party price data (§45).
    const { settings } = useSettings();

    // --- Target and action -------------------------------------------------
    const [target, setTarget] = useState(() => normalizeTarget(openedTarget));
    const [action, setAction] = useState(() => actionFor(normalizeTarget(openedTarget).kind, openedAction || 'stake'));
    // The target picker: the stake chooser, then the contracts list.
    const [pickerStep, setPickerStep] = useState(/** @type {null | 'chooser' | 'contracts'} */ (null));
    const kind = target.kind;
    const isContract = kind === 'contract';
    const currentAction = actionFor(kind, action);
    const cfg = STAKING_ACTIONS[`${kind}:${currentAction}`];
    const chainId = target.chainId;
    const contractActionIndex = isContract ? target.contractActionIndex : '';
    const isNetworkStake = !isContract && currentAction === 'stake';
    const isPosition = cfg.amount === 'position';
    const isUnstake = currentAction === 'unstake';
    const isRevoke = !isContract && currentAction === 'revoke';
    const opened = normalizeTarget(openedTarget);

    // --- The form's values -------------------------------------------------
    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [noAddress, setNoAddress] = useState(false);
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    // The amount the user typed. An unstake or claim shows the full known
    // total until the user edits (derived at render, never written here), so
    // a full-balance figure never becomes another action's amount.
    const [amount, setAmount] = useState('');
    const [amountTouched, setAmountTouched] = useState(false);
    const [amountInputMode, setAmountInputMode] = useState(/** @type {'coin' | 'fiat'} */ ('coin'));
    const [fiatAmount, setFiatAmount] = useState('');
    // One signing key field for every action that has one. Where it came
    // from decides whether a switch keeps it: 'typed' stays, 'prefill' (the
    // form's own fill) gives way to the next action's fill, 'seed' (the
    // position that opened a contract) belongs to that contract only.
    const seededKey = opened.kind === 'contract' && initialSigningPubkey ? initialSigningPubkey : '';
    const [signingPubkey, setSigningPubkey] = useState(seededKey);
    const keyRef = useRef(seededKey);
    keyRef.current = signingPubkey;
    const keyOriginRef = useRef(/** @type {'typed' | 'prefill' | 'seed'} */ (seededKey ? 'seed' : 'typed'));
    const seededTick = opened.kind === 'contract' && initialTick ? initialTick : '';
    const [tick, setTick] = useState(seededTick || 'XCHAIN');
    const tickSeededRef = useRef(Boolean(seededTick));
    // VERSION '1' = new stake, '2' = top up a key this address already staked.
    const [stakeMode, setStakeMode] = useState(/** @type {'1' | '2'} */ ('1'));
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const [password, setPassword] = useState('');

    // --- Stage, pickers and errors -----------------------------------------
    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [errorSection, setErrorSection] = useState(/** @type {'from' | 'main' | 'fee'} */ ('main'));
    const [prefillError, setPrefillError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    // The request the review or confirm page shows, frozen at the press.
    const [reviewRequest, setReviewRequest] = useState(
        /** @type {{ params: Record<string, string>, full?: boolean, availableAmt?: string } | null} */ (null),
    );
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const submitInFlightRef = useRef(false);
    // The standard's open state, held above the early returns (the picker
    // pages) so it survives them; only the main section starts open.
    const formSections = useFormSections({ from: false, main: true, fee: false });
    // Counts review presses, so a section holding the error reopens on each.
    const [validationAttempt, setValidationAttempt] = useState(0);

    function fail(message, section = 'main') {
        setErrorSection(section);
        setFormError(message);
    }

    // A value the form filled in itself gives way when the action or the
    // target changes; a value the user typed stays.
    function dropKey(origins) {
        if (!origins.includes(keyOriginRef.current)) return;
        keyOriginRef.current = 'typed';
        keyRef.current = '';
        setSigningPubkey('');
    }

    function switchAction(next) {
        setAction(next);
        setFormError(null);
        setPrefillError(null);
        dropKey(['prefill']);
    }

    function switchTarget(next) {
        if (targetKey(next) !== targetKey(target)) {
            dropKey(['prefill', 'seed']);
            if (tickSeededRef.current && (next.kind !== 'contract' || next.contractActionIndex !== target.contractActionIndex)) {
                tickSeededRef.current = false;
                setTick('XCHAIN');
            }
        }
        setTarget(next);
        setFormError(null);
        setPrefillError(null);
    }

    // A route that opens the form on another target or action is followed.
    const openedKey = `${targetKey(opened)}\0${openedAction || 'stake'}`;
    const openedKeyRef = useRef(openedKey);
    useEffect(() => {
        if (openedKeyRef.current === openedKey) return;
        openedKeyRef.current = openedKey;
        const next = normalizeTarget(openedTarget);
        switchTarget(next);
        switchAction(actionFor(next.kind, openedAction || 'stake'));
        setPickerStep(null);
        // switchTarget and switchAction read only refs and setters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openedKey, openedTarget, openedAction]);

    // The From address the form last acted from, so a switch of network or
    // target keeps it when it is still one of the wallet's on that chain.
    const lastFromAddressRef = useRef(initialFromAddress || null);

    // Addresses: reloaded per chain. The last From address wins when it is
    // still one of ours on this chain; otherwise act from the chain's active
    // address (else newest HD external), matching Send.
    const kindRef = useRef(kind);
    kindRef.current = kind;
    useEffect(() => {
        let cancelled = false;
        setAddressesByChain(null);
        setLoadError(null);
        setNoAddress(false);
        setFromAddressId(null);
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? messaging.getActiveAddresses(walletId)
                : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const onChain = byChain?.[chainId] || [];
                const last = lastFromAddressRef.current;
                const seeded = last ? onChain.find((a) => a.address === last) : null;
                const sourceId = seeded?.id || preferredSourceId(onChain, active?.[chainId]);
                if (!sourceId) {
                    setNoAddress(true);
                    return;
                }
                setFromAddressId(sourceId);
            })
            .catch((err) => {
                if (cancelled) return;
                setLoadError(kindRef.current === 'contract'
                    ? (err?.message || 'Failed to load addresses.')
                    : readFailureMessage(err, 'load your staking addresses'));
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);
    useEffect(() => {
        if (fromAddress?.address) lastFromAddressRef.current = fromAddress.address;
    }, [fromAddress?.address]);

    // --- Contract target: metadata, token, staked balance, consent ---------
    const [contractMeta, setContractMeta] = useState(
        /** @type {{ cooldown: number|null, slashDestination: string|null, valid: boolean, name: string } | null} */ (null),
    );
    const [contractLoadError, setContractLoadError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        setContractMeta(null);
        setContractLoadError(null);
        if (!isContract) return undefined;
        let cancelled = false;
        // Demo wallets have no live indexer to serve deploy metadata; use
        // the fixture so the demo contract positions stay actionable.
        if (isDemoWallet(walletId)) {
            const meta = synthesizeDemoContractMeta(chainId, contractActionIndex);
            setContractMeta({
                cooldown: meta ? Number(meta.cooldown_blocks) : null,
                slashDestination: meta ? String(meta.slash_destination) : null,
                valid: meta != null,
                name: contractFieldName(meta),
            });
            return () => { cancelled = true; };
        }
        messaging.getContractByActionIndex({ chainId, contractActionIndex })
            .then((resp) => {
                if (cancelled) return;
                const row = resp?.row || resp?.rows?.[0] || resp;
                if (!row) {
                    setContractLoadError('Could not load target contract metadata.');
                    return;
                }
                const cooldown = row.cooldown_blocks ?? row.COOLDOWN_BLOCKS ?? null;
                const slashDest = row.slash_destination ?? row.SLASH_DESTINATION
                    ?? row.slash_destination_address ?? null;
                setContractMeta({
                    cooldown: cooldown !== null ? Number(cooldown) : null,
                    slashDestination: slashDest ? String(slashDest) : null,
                    valid: cooldown !== null && cooldown !== undefined,
                    // The same row's exported name, for the Stake On field.
                    name: contractFieldName(row),
                });
            })
            .catch((err) => {
                if (!cancelled) setContractLoadError(readFailureMessage(err, 'load contract metadata'));
            });
        return () => { cancelled = true; };
    }, [isContract, walletId, chainId, contractActionIndex, messaging]);

    // Balance of the staked tick at the source address (Max + "available"):
    // XCHAIN for a validator stake, the contract's token on a contract.
    const balanceTick = isContract ? tick : (isNetworkStake ? STAKING_TICK : '');
    const tickAmtBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: balanceTick ? fromAddress?.address : null,
        tick: balanceTick,
    });
    const tokenInfo = useTokenInfo({ chainId, tick, skip: !isContract || !tick.trim() });
    const tokenDivisibility = tokenInfo?.divisibility ?? 8;

    // A contract unstake's "available" is the STAKED balance on this contract
    // (per key when one is entered), not the wallet token balance; it bounds
    // the optional partial amount.
    const [stakedAvailable, setStakedAvailable] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        const address = fromAddress?.address;
        // A demo wallet cannot unstake, and a demo wallet's addresses never go
        // to an explorer (issue #82).
        if (!isContract || !isUnstake || !address || !chainId || demoGuard.blocked) {
            setStakedAvailable(null);
            return undefined;
        }
        let cancelled = false;
        Promise.all([
            messaging.getContractStakesForAddress({ chainId, address }),
            typeof messaging.getIndexerWatermark === 'function'
                ? messaging.getIndexerWatermark({ chainId }).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([r, watermark]) => {
                if (cancelled) return;
                const rows = effectiveStakingRows(extractRows(r), watermark?.watermark).filter((row) =>
                    String(row.target_contract_index) === String(contractActionIndex)
                    && (!tick || String(row.tick || '').toUpperCase() === tick.trim().toUpperCase())
                    && (!signingPubkey.trim()
                        || String(row.signing_pubkey || row.SIGNING_PUBKEY || '').toLowerCase() === signingPubkey.trim().toLowerCase()));
                const total = trimAmountTail(sumDecimalStrings(
                    rows.map((row) => row.amount ?? row.AMOUNT ?? 0),
                ));
                setStakedAvailable(rows.length > 0 ? total : null);
            })
            .catch(() => { if (!cancelled) setStakedAvailable(null); });
        return () => { cancelled = true; };
    }, [isContract, isUnstake, chainId, fromAddress?.address, contractActionIndex, tick, signingPubkey, messaging, demoGuard.blocked]);

    // PC-39: consent disclosure for the contract the stake is locked into,
    // fetched only once the user reaches the review stage. Unstake and
    // delegate act on an existing position rather than granting new
    // authority, so they show none.
    const manifest = useContractManifest({
        chainId,
        contractActionIndex: String(contractActionIndex),
        skip: !isContract || currentAction !== 'stake' || (stage !== 'review' && stage !== 'submitting'),
    });

    // --- Network stake: capability thresholds and new-vs-top-up ------------
    // 'idle' until a valid key is entered; the Mode dropdown stays editable.
    const [detectStatus, setDetectStatus] = useState(/** @type {'idle' | 'checking' | 'new' | 'topup' | 'error'} */ ('idle'));
    // This source's existing valid stake for the entered key (top-ups add to it).
    const [existingStake, setExistingStake] = useState('0');
    // Live per-capability MIN_STAKE thresholds from the hub, or null when the
    // hub is unreachable / not configured (regtest) / the SDK predates the
    // getter; null hides the qualify readout.
    const [thresholds, setThresholds] = useState(
        /** @type {Array<{capability: string, min_stake: string, disabled?: boolean}> | null} */ (null),
    );
    useEffect(() => {
        if (!isNetworkStake || typeof messaging.getCapabilityThresholds !== 'function') return undefined;
        let cancelled = false;
        messaging.getCapabilityThresholds({ chainId })
            .then((rows) => { if (!cancelled) setThresholds(Array.isArray(rows) ? rows : null); })
            .catch(() => { if (!cancelled) setThresholds(null); });
        return () => { cancelled = true; };
    }, [isNetworkStake, messaging, chainId]);

    // Detect new-vs-top-up from this source's stakes once the key is a valid
    // 64-hex string. A newer input cancels a stale answer.
    useEffect(() => {
        const pk = signingPubkey.trim().toLowerCase();
        // A demo wallet cannot stake, and a demo wallet's addresses never go to
        // an explorer (issue #82).
        if (!isNetworkStake || !/^[0-9a-f]{64}$/.test(pk) || !fromAddress || !chainId || demoGuard.blocked) {
            setDetectStatus('idle');
            setExistingStake('0');
            return undefined;
        }
        let cancelled = false;
        setDetectStatus('checking');
        Promise.all([
            messaging.getStakesForAddress({ chainId, address: fromAddress.address }),
            typeof messaging.getIndexerWatermark === 'function'
                ? messaging.getIndexerWatermark({ chainId }).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([resp, watermark]) => {
                if (cancelled) return;
                const rows = effectiveStakingRows(extractRows(resp), watermark?.watermark);
                let match = false;
                const matchedAmounts = [];
                for (const row of rows) {
                    const rowPk = String(row.signing_pubkey || row.SIGNING_PUBKEY || '').toLowerCase();
                    if (rowPk === pk) {
                        match = true;
                        matchedAmounts.push(row.amount ?? row.AMOUNT ?? '0');
                    }
                }
                setExistingStake(sumDecimalStrings(matchedAmounts));
                setDetectStatus(match ? 'topup' : 'new');
                setStakeMode(match ? '2' : '1');
            })
            .catch(() => {
                if (cancelled) return;
                // Network or indexer failure; the user's manual choice stands.
                setExistingStake('0');
                setDetectStatus('error');
            });
        return () => { cancelled = true; };
    }, [isNetworkStake, signingPubkey, fromAddress, chainId, messaging, demoGuard.blocked]);

    // --- Network unstake and claim: the position totals --------------------
    const [positions, setPositions] = useState(
        /** @type {{ stakes: any[], rewards: any[], claims: any[], height: number|null } | null} */ (null),
    );
    const [positionsError, setPositionsError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        const address = fromAddress?.address;
        setPositions(null);
        setPositionsError(null);
        if (!isPosition || !address) return undefined;
        let cancelled = false;
        async function load() {
            try {
                let stakes = [];
                let rewards = [];
                let claims = [];
                let height = null;
                if (isDemoWallet(walletId)) {
                    const demo = synthesizeDemoStaking(chainId);
                    // Demo stake rows carry no signing_pubkey; attribute them
                    // to the demo delegation's key so key prefill works.
                    const demoKey = demo.delegations[0]?.signing_pubkey;
                    stakes = demo.stakes.map((s) => ({ signing_pubkey: demoKey, ...s }));
                    rewards = demo.rewards;
                } else if (isUnstake) {
                    const [stakeResponse, watermark] = await Promise.all([
                        messaging.getStakesForAddress({ chainId, address }),
                        typeof messaging.getIndexerWatermark === 'function'
                            ? messaging.getIndexerWatermark({ chainId }).catch(() => null)
                            : Promise.resolve(null),
                    ]);
                    stakes = extractRows(stakeResponse);
                    height = Number.isFinite(watermark?.watermark) ? watermark.watermark : null;
                } else {
                    // PC-47: the rewards endpoint is a pure accrual ledger with
                    // no status column, so "available" is computed against the
                    // claim ledger too, via unclaimedRewards() below.
                    const [r, c] = await Promise.all([
                        messaging.getRewardsForAddress({ chainId, address }),
                        typeof messaging.getRewardClaimsForAddress === 'function'
                            ? messaging.getRewardClaimsForAddress({ chainId, address })
                            : Promise.resolve(null),
                    ]);
                    rewards = extractRows(r);
                    claims = extractRows(c);
                }
                if (!cancelled) setPositions({ stakes, rewards, claims, height });
            } catch (err) {
                if (!cancelled) {
                    setPositions(null);
                    setPositionsError(readFailureMessage(err, 'load the available staking balance'));
                }
            }
        }
        load();
        return () => { cancelled = true; };
    }, [isPosition, walletId, chainId, fromAddress?.address, isUnstake, messaging]);

    // Distinct signing keys this address has staked under. The protocol
    // buckets stakes per (address, signing_pubkey), so the key selects WHICH
    // bundle an UNSTAKE returns; the wallet knows the candidates, so it
    // fills the key in instead of making the user paste hex.
    const activeStakes = useMemo(
        () => effectiveStakingRows(positions?.stakes, positions?.height),
        [positions],
    );
    const pendingStakes = useMemo(
        () => (positions?.stakes || []).filter((stake) => (
            stakingRowState(stake, positions?.height) === 'pending'
        )),
        [positions],
    );
    const stakedKeys = useMemo(() => {
        const keys = [];
        for (const s of [...activeStakes, ...pendingStakes]) {
            const k = s.signing_pubkey || s.SIGNING_PUBKEY;
            if (k && !keys.includes(k)) keys.push(k);
        }
        return keys;
    }, [activeStakes, pendingStakes]);
    const isNetworkUnstake = isPosition && isUnstake;
    useEffect(() => {
        if (isNetworkUnstake && !signingPubkey && stakedKeys.length > 0) {
            keyOriginRef.current = 'prefill';
            setSigningPubkey(stakedKeys[0]);
        }
    }, [isNetworkUnstake, signingPubkey, stakedKeys]);

    // Unstake: the full balance for the selected key (all keys until one is
    // chosen). Claim: the pending rewards for the address.
    const availableAmt = useMemo(() => {
        if (!isPosition || !positions) return null;
        if (isUnstake) {
            const amounts = [];
            for (const s of activeStakes) {
                const key = s.signing_pubkey || s.SIGNING_PUBKEY;
                if (signingPubkey && key && key !== signingPubkey) continue;
                amounts.push(s.amount ?? s.AMOUNT ?? s.quantity ?? 0);
            }
            return trimAmountTail(sumDecimalStrings(amounts));
        }
        // PC-47: accrual minus valid claims, NOT a status filter
        // (validator_rewards rows never carry `status`).
        return unclaimedRewards({ rewards: positions.rewards, claims: positions.claims }).unclaimed;
    }, [isPosition, positions, isUnstake, signingPubkey, activeStakes]);

    const selectedUnlockHeight = useMemo(() => {
        if (!isNetworkUnstake || activeStakes.some((stake) => (
            (stake.signing_pubkey || stake.SIGNING_PUBKEY) === signingPubkey
        ))) return null;
        const heights = pendingStakes
            .filter((stake) => (stake.signing_pubkey || stake.SIGNING_PUBKEY) === signingPubkey)
            .map(stakingActivationBlock)
            .filter((block) => block !== null)
            .sort((a, b) => a - b);
        return heights[0] ?? null;
    }, [isNetworkUnstake, activeStakes, pendingStakes, signingPubkey]);

    // An unstake or claim defaults to the full balance until the user edits;
    // deriving it at render keeps the balance, the input and the params
    // atomic, and a refresh never clobbers a typed partial.
    const effectiveAmount = isPosition && !amountTouched && availableAmt != null
        ? String(availableAmt)
        : amount;

    // §29.3 fiat preview for the XCHAIN amount of an unstake or claim, priced
    // by XCHAIN's own rate (never the chain coin's).
    const fiatRate = useTickFiatRate({
        chainCoin: descriptor?.coin,
        tick: STAKING_TICK,
        nativeTicker: descriptor?.coin ? tickerForCoin(descriptor.coin) : null,
        fiatCurrency: settings?.fiatCurrency || 'USD',
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
        enabled: isPosition,
    });
    const toggleAmountInputMode = useCallback(() => {
        if (!fiatRate) return;
        setAmountInputMode((prev) => {
            if (prev === 'coin') {
                const value = effectiveAmount ? coinToFiatExact(effectiveAmount, fiatRate) : null;
                setFiatAmount(value != null ? roundDecimalString(value, 2) : '');
                return 'fiat';
            }
            setFiatAmount('');
            return 'coin';
        });
    }, [effectiveAmount, fiatRate]);
    // A rate can go away mid-edit (chain or action switched, feed went
    // quiet), which would strand the field in a mode it cannot convert.
    useEffect(() => {
        if (!fiatRate && amountInputMode === 'fiat') {
            setAmountInputMode('coin');
            setFiatAmount('');
        }
    }, [fiatRate, amountInputMode]);

    // Commas are formatting only: strip before storing, then map the caret by
    // "non-comma chars to the left" so typing across a thousands boundary
    // does not fling it. In fiat mode the typed text is fiat and the coin
    // amount (what is broadcast and checked) derives from it.
    const amountInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onAmountFieldChange = useCallback((rawValue, cursorPos) => {
        const stripped = String(rawValue).replace(/,/g, '');
        // Valid partial decimals only ("" / "." / "1." stay allowed).
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        setAmountTouched(true);
        if (isPosition && amountInputMode === 'fiat') {
            setFiatAmount(stripped);
            if (!fiatRate) {
                if (stripped === '') setAmount('');
            } else {
                const derivedCoin = fiatToCoin(stripped, fiatRate);
                setAmount(derivedCoin != null ? derivedCoin : '');
            }
        } else {
            setAmount(stripped);
        }
        setFormError(null);
        if (isPosition && typeof cursorPos === 'number' && amountInputRef.current) {
            const formattedNew = formatWithThousands(stripped);
            const nonCommaBefore = countNonCommaBefore(String(rawValue), cursorPos);
            const nextCursor = indexAfterNonCommaCount(formattedNew, nonCommaBefore);
            const el = amountInputRef.current;
            requestAnimationFrame(() => {
                if (el && document.activeElement === el) {
                    try { el.setSelectionRange(nextCursor, nextCursor); } catch { /* selection unavailable on some input types */ }
                }
            });
        }
    }, [isPosition, amountInputMode, fiatRate]);

    // --- Network revoke: the active delegation fills the key ---------------
    useEffect(() => {
        if (!isRevoke) return undefined;
        // A demo wallet cannot revoke, and a demo wallet's addresses never go to
        // an explorer (issue #82).
        if (demoGuard.blocked) return undefined;
        if (!fromAddressId || !addressesByChain) return undefined;
        const addr = (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId);
        if (!addr) return undefined;
        let cancelled = false;
        setPrefillError(null);
        // A key filled in for another address or network is not this one's.
        if (keyOriginRef.current === 'prefill') {
            keyOriginRef.current = 'typed';
            keyRef.current = '';
            setSigningPubkey('');
        }
        Promise.all([
            messaging.getDelegationsForAddress({ chainId, address: addr.address }),
            typeof messaging.getIndexerWatermark === 'function'
                ? messaging.getIndexerWatermark({ chainId }).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([resp, watermark]) => {
                if (cancelled) return;
                const rows = extractRows(resp);
                const height = watermark?.watermark;
                const needsHeight = rows.some((row) => (
                    row?.activation_block != null
                    || row?.ACTIVATION_BLOCK != null
                    || row?.deactivation_block != null
                    || row?.DEACTIVATION_BLOCK != null
                ));
                if (needsHeight && (height == null || !Number.isFinite(Number(height)) || Number(height) < 0)) {
                    setPrefillError('Could not verify which delegation is currently active. Enter the signing public key manually.');
                    return;
                }
                const latest = latestEffectiveStakingRow(rows, height);
                const pk = latest?.signing_pubkey || latest?.SIGNING_PUBKEY;
                if (pk && typeof pk === 'string' && HEX64.test(pk) && !keyRef.current.trim()) {
                    keyOriginRef.current = 'prefill';
                    setSigningPubkey(pk.toLowerCase());
                }
            })
            .catch((err) => {
                if (!cancelled) setPrefillError(
                    `${readFailureMessage(err, 'load the current delegation')} Enter the signing public key manually.`,
                );
            });
        return () => { cancelled = true; };
    }, [isRevoke, fromAddressId, addressesByChain, chainId, messaging, demoGuard.blocked]);

    // --- Signing -------------------------------------------------------------
    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    // Only Unstake and Claim read the hardware signer's record (null otherwise).
    const hwSignerInfo = useSignerInfo({
        walletId: isPosition ? walletId : null,
        signerId: isPosition && isHwSource ? fromAddress?.signerId : null,
    });
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // (§5.6 slice 2): the software path composes ONE PSBT host-side and
    // confirms it on the shared confirm page, hardware included. Watcher
    // mode still branches: it encodes, it never signs.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // Hardware signs the SAME prebuilt PSBT through the same host flow, with
    // the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: cfg.software,
        hardware: cfg.hardware,
    });

    // --- Fee ---------------------------------------------------------------
    // Low / Normal / Fast / Custom; feePerKb prices the broadcast.
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId, chainRegistry }),
        [chainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [chainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    // --- What the current action sends -------------------------------------
    const positionParams = useMemo(
        () => (isPosition
            ? stakingActionParams({ isUnstake, signingPubkey, amount: effectiveAmount, availableAmt })
            : null),
        [isPosition, isUnstake, signingPubkey, effectiveAmount, availableAmt],
    );
    const actionParams = useMemo(() => {
        if (isPosition) return positionParams.params;
        if (isContract) {
            /** @type {Record<string, string>} */
            const p = {
                SIGNING_PUBKEY: signingPubkey.trim(),
                TARGET_CONTRACT_INDEX: String(contractActionIndex),
                TICK: tick.trim(),
            };
            if (currentAction === 'stake') p.AMOUNT = amount.trim();
            // An unstake AMOUNT is an optional strict partial. An empty field
            // or the full staked balance keeps the legacy absent-AMOUNT bytes
            // (full sweep); pre-flag-day layers IGNORE a present AMOUNT.
            if (currentAction === 'unstake' && amount.trim() !== '') {
                const comparison = compareAmounts(amount.trim(), stakedAvailable);
                if (stakedAvailable == null || comparison === null || comparison < 0) {
                    p.AMOUNT = amount.trim();
                }
            }
            return p;
        }
        const pk = signingPubkey.trim().toLowerCase();
        if (currentAction === 'stake') {
            return { VERSION: stakeMode, AMOUNT: amount.trim(), SIGNING_PUBKEY: pk };
        }
        // Rotate is DELEGATE v0; capability revoke is DELEGATE v2 (v0 has no SIGNING_PUBKEY slot).
        if (currentAction === 'delegate') return { VERSION: '0', NEW_SIGNING_PUBKEY: pk };
        return { VERSION: '2', SIGNING_PUBKEY: pk };
    }, [isPosition, positionParams, isContract, signingPubkey, contractActionIndex, tick, currentAction, amount, stakedAvailable, stakeMode]);
    const totalKnown = availableAmt != null;

    // The params the encoder sees: a contract action adds its VERSION.
    const wireParams = (params) => (cfg.version ? { ...params, VERSION: cfg.version } : params);
    // What the host flow takes beside the params: the whole-balance request
    // for an unstake or claim, the mode for a contract action.
    const flowExtras = (request) => ({
        ...(cfg.full ? { full: request.full } : {}),
        ...(isContract ? { mode: currentAction } : {}),
    });
    const fromRef = () => ({
        address: fromAddress.address,
        publicKey: fromAddress.publicKey,
        derivationPath: fromAddress.derivationPath,
        addressId: fromAddress.id,
        source: fromAddress.source,
        signerId: fromAddress.signerId,
    });

    // Project which capabilities the post-submit total stake qualifies for:
    // the key's existing valid stake (top-ups) plus the entered amount.
    const qualifyReadout = useMemo(() => {
        if (!isNetworkStake || !thresholds || thresholds.length === 0) return null;
        const projected = sumDecimalStrings([existingStake, amount.trim()]);
        const rows = thresholds
            .filter((row) => !row.disabled)
            .map((row) => ({
                capability: row.capability,
                label:      CAPABILITY_LABELS[row.capability] || row.capability,
                minStake:   row.min_stake,
                qualifies:  compareDecimalStrings(projected, '0') === 1
                    && compareDecimalStrings(projected, row.min_stake) >= 0,
            }))
            // Drop capabilities the hub has no numeric threshold for; the form
            // cannot claim qualified or not for those.
            .filter((r) => r.minStake != null
                && compareDecimalStrings(r.minStake, '0') !== null);
        if (rows.length === 0) return null;
        return {
            projected,
            rows,
            hasTopup: compareDecimalStrings(existingStake, '0') === 1,
        };
    }, [isNetworkStake, thresholds, amount, existingStake]);

    // --- Review checks, per action, in each action's own order -------------
    function checkNetworkStake() {
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) return [feeStop.formError, 'fee'];
        if (!fromAddress) return ['No source address available.', 'from'];
        const amt = amount.trim();
        if (!amt) return ['Enter an amount to stake.'];
        if (!/^[0-9]+(\.[0-9]+)?$/.test(amt)) return ['Amount must be a positive number.'];
        if (Number(amt) <= 0) return ['Amount must be greater than zero.'];
        if ((amt.split('.')[1] || '').length > 8) return ['Amount can have at most 8 decimal places.'];
        if (tickAmtBalance != null && compareDecimalStrings(amt, tickAmtBalance) === 1) {
            return [`Amount exceeds the ${formatWithThousands(tickAmtBalance)} XCHAIN available.`];
        }
        const pk = signingPubkey.trim();
        if (!pk) return ['Enter the signing public key.'];
        if (!HEX64.test(pk)) return ['Signing public key must be exactly 64 hexadecimal characters (Ed25519).'];
        return null;
    }

    function checkPosition() {
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) return [feeStop.formError, 'fee'];
        if (!fromAddress) return ['No source address available.', 'from'];
        if (isUnstake) {
            if (!HEX64.test(signingPubkey.trim())) return ['Signing public key must be exactly 64 hexadecimal characters.'];
            if (selectedUnlockHeight !== null) {
                return [`This stake cannot be unstaked until block ${formatWithThousands(String(selectedUnlockHeight))}.`];
            }
        }
        if (!totalKnown) return [TOTAL_LOADING_MESSAGE[isUnstake ? 'unstake' : 'claim']];
        const normalized = positionParams.normalizedAmount;
        if (!normalized) return ['Enter an amount.'];
        if (!/^[0-9]+(\.[0-9]+)?$/.test(normalized)) return ['Amount must be a positive number.'];
        if (compareAmounts(normalized, '0') !== 1) return ['Amount must be greater than zero.'];
        if ((normalized.split('.')[1] || '').length > 8 || !positionParams.amountValid) {
            return ['Amount can have at most 8 decimal places.'];
        }
        if (availableAmt != null && compareAmounts(normalized, availableAmt) === 1) {
            return [`Amount exceeds the ${formatWithThousands(String(availableAmt))} XCHAIN available.`];
        }
        return null;
    }

    function checkDelegation() {
        if (!fromAddress) return ['No source address available.', 'from'];
        if (!descriptor?.coin || !descriptor?.networkKind || !isValidAddressForChain(
            fromAddress.address,
            descriptor.coin,
            descriptor.networkKind,
        )) {
            return ['The selected source address is not valid for this network.', 'from'];
        }
        const pk = signingPubkey.trim();
        if (!pk) {
            return [currentAction === 'delegate'
                ? 'Enter the new signing public key.'
                : 'Enter the signing public key to revoke.'];
        }
        if (!HEX64.test(pk)) return ['Signing pubkey must be exactly 64 hex characters (Ed25519 public key).'];
        // A revoke names a key already on chain, whatever it is; a new delegation must be able to sign.
        const keyStop = currentAction === 'delegate' ? signingKeyRefusal(pk) : null;
        if (keyStop) return [keyStop];
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) return [feeStop.formError, 'fee'];
        return null;
    }

    function checkContract() {
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) return [feeStop.formError, 'fee'];
        if (!fromAddress) return ['No Bitcoin address available to stake from.', 'from'];
        if (!/^[1-9]\d*$/.test(String(contractActionIndex ?? '').trim())) {
            return ['Contract ID must be a positive whole number.'];
        }
        if (!contractMeta?.valid) return ['Target contract is not stakeable (no cooldown configured at deploy time).'];
        if (!actionParams.SIGNING_PUBKEY || !HEX64.test(actionParams.SIGNING_PUBKEY)) {
            return [`${currentAction === 'delegate' ? 'The new signing key' : 'The signing key'} must be exactly 64 characters, using only the digits 0-9 and the letters a-f (upper or lower case).`];
        }
        if (!actionParams.TICK) return ['Token ticker is required.'];
        if (currentAction === 'stake') {
            if (!actionParams.AMOUNT || !/^[0-9]+(\.[0-9]+)?$/.test(actionParams.AMOUNT)
                || compareAmounts(actionParams.AMOUNT, '0') !== 1) {
                return ['Amount must be a positive decimal.'];
            }
            const precisionError = tokenAmountPrecisionError(actionParams.AMOUNT, { divisibility: tokenDivisibility, tick });
            if (precisionError) return [precisionError];
            if (tickAmtBalance != null && compareAmounts(actionParams.AMOUNT, tickAmtBalance) === 1) {
                return [`Amount exceeds the ${formatWithThousands(String(tickAmtBalance))} ${tick.trim().toUpperCase()} available.`];
            }
        }
        if (currentAction === 'unstake' && amount.trim() !== '') {
            const amt = amount.trim();
            if (!/^[0-9]+(\.[0-9]+)?$/.test(amt) || compareAmounts(amt, '0') !== 1) {
                return ['Amount must be a positive decimal (or leave it blank to unstake everything).'];
            }
            const precisionError = tokenAmountPrecisionError(amt, { divisibility: tokenDivisibility, tick });
            if (precisionError) return [precisionError];
            if (stakedAvailable != null && compareAmounts(amt, stakedAvailable) === 1) {
                return [`Amount exceeds the ${formatWithThousands(String(stakedAvailable))} ${tick.trim().toUpperCase()} staked on this contract.`];
            }
        }
        return null;
    }

    function handleReview(event) {
        event.preventDefault();
        setValidationAttempt((n) => n + 1); // Reopens the section holding the error.
        // A demo wallet cannot move funds. The frame swallows the press and
        // answers it with the guard's refusal; this backstop does the same.
        if (demoGuard.blocked) { demoGuard.refuse?.(); return; }
        const stop = isContract ? checkContract()
            : isNetworkStake ? checkNetworkStake()
                : isPosition ? checkPosition()
                    : checkDelegation();
        if (stop) { fail(stop[0], stop[1] || 'main'); return; }
        setFormError(null);
        const request = isPosition
            ? { params: { ...actionParams }, full: positionParams.isWholeAmount, availableAmt: String(availableAmt) }
            : { params: { ...actionParams } };
        setReviewRequest(request);
        if (singleEncode) { void openConfirmScreen(request); return; }
        setStage('review');
    }

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen(request) {
        if (!request?.params) {
            fail('Enter an amount greater than zero, with at most 8 decimal places.');
            return;
        }
        if (demoGuard.blocked) { demoGuard.refuse?.(); return; }
        // A second press while the confirm page is still composing is the same request.
        if (submitInFlightRef.current) return;
        submitInFlightRef.current = true;
        try {
            const from = fromRef();
            setSubmitError(null);
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: cfg.wire, params: wireParams(request.params) },
                ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                // A contract flow builds its own wire params from mode and
                // params, so the submit keeps the legacy shape.
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: request.params,
                    ...flowExtras(request),
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            fail(submitFailureMessage(err, {
                chainId, coinTicker, fallback: err?.message || cfg.failText,
            }));
        } finally {
            submitInFlightRef.current = false;
        }
    }

    // The watch-only review's submit (and the legacy two-step path).
    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || submitInFlightRef.current) return;
        if (demoGuard.blocked) { demoGuard.refuse?.(); return; }
        const request = reviewRequest || (actionParams ? {
            params: actionParams,
            ...(isPosition ? { full: positionParams.isWholeAmount, availableAmt: String(availableAmt) } : {}),
        } : null);
        if (!request?.params) {
            fail('Enter an amount greater than zero, with at most 8 decimal places.');
            return;
        }
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        submitInFlightRef.current = true;
        setStage('submitting');
        setSubmitError(null);
        try {
            const from = fromRef();
            const base = {
                walletId,
                chainId,
                from,
                params: request.params,
                ...flowExtras(request),
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from,
                    actionData: { action: cfg.wire, params: wireParams(request.params) },
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                });
            } else if (isHwSource) {
                res = await messaging[cfg.hardware]({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging[cfg.software]({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId, coinTicker, fallback: err?.message || cfg.failText,
                    }),
            );
            setStage('review');
            if (!isWatcherMode && !isHwSource) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            submitInFlightRef.current = false;
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setReviewRequest(null);
        setStage('form');
    }

    function leaveReview() {
        setSubmitError(null);
        setReviewRequest(null);
        setStage('form');
    }

    function retargetNetwork(cid) {
        if (!cid || cid === chainId) return;
        switchTarget({ kind: 'network', chainId: cid });
        setFromAddressId(null);
    }

    // --- Frame ---------------------------------------------------------------
    const reviewing = stage === 'review' || stage === 'submitting';
    // The page title follows the Action field (its label: Stake, Unstake,
    // Claim, Delegate, Revoke); the review step keeps its own title.
    const actionLabel = ACTIONS[kind].find((item) => item.id === currentAction)?.label || 'Stake';
    const pageTitle = reviewing ? cfg.reviewTitle : actionLabel;
    // The window title names the same heading (U25).
    useDocumentTitleSection(pageTitle);
    const header = (
        <PageHeader
            onBack={stage === 'review' ? leaveReview : onBack}
            backDisabled={stage === 'submitting' || actionConfirm.composing}
            {...(isContract ? { backLabel: stage === 'review' ? 'Back to edit' : 'Back to contract' } : {})}
            title={pageTitle}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>
            {children}
        </Screen>
    );

    // The target picker pages: the stake chooser, then the contracts list.
    if (pickerStep === 'contracts') {
        return (
            <ContractsList
                walletId={walletId}
                onOpenContract={(cid, index) => {
                    switchTarget({ kind: 'contract', chainId: cid, contractActionIndex: String(index) });
                    setAction((prev) => actionFor('contract', prev));
                    setPickerStep(null);
                }}
                onBack={() => setPickerStep('chooser')}
            />
        );
    }
    if (pickerStep === 'chooser') {
        return (
            <StakeNew
                walletId={walletId}
                onPickValidator={(cid) => {
                    switchTarget({ kind: 'network', chainId: cid });
                    setPickerStep(null);
                }}
                onPickContract={() => setPickerStep('contracts')}
                onBack={() => setPickerStep(null)}
            />
        );
    }

    const targetField = {
        label: 'Stake On',
        help: isContract
            ? 'The contract this stake is locked in. Use the list icon to stake on another contract or on the network.'
            : 'Validator staking: your XCHAIN backs the network on this chain and earns rewards. Use the list icon to stake on a contract instead.',
        onPick: () => setPickerStep('chooser'),
        pickLabel: 'Choose what to stake on',
    };
    const actions = ACTIONS[kind];
    const toggle = isContract ? (
        <SegmentedControl
            aria-label="Action"
            value={currentAction}
            onChange={switchAction}
            items={actions.map(({ id, label, Glyph }) => ({
                id,
                label: <><Glyph aria-hidden="true" /><span>{label}</span></>,
            }))}
        />
    ) : (
        <IconSelect
            label="Action"
            help={NETWORK_ACTION_HELP}
            value={currentAction}
            onChange={switchAction}
            options={actions.map(({ id, label, Glyph }) => ({ value: id, label, icon: <Glyph /> }))}
        />
    );
    const VerbIcon = cfg.icon;

    // The load error, the loading line, the not-stakeable notice and every
    // result lay out through FormPage like the form itself, so no state
    // draws straight into the Screen box.
    const pageLabel = isContract ? 'Contract stake' : cfg.formLabel;
    const shownLoadError = loadError || (noAddress ? cfg.noAddress : null) || (isContract ? contractLoadError : null);
    if (shownLoadError) {
        return wrap(
            <FormPage label={pageLabel} status={<StatusMessage variant="error">{shownLoadError}</StatusMessage>} />,
        );
    }
    if (!addressesByChain || (isContract && !contractMeta)) {
        return wrap(
            <FormPage label={pageLabel}>
                <p className={styles.hint}>{isContract ? 'Loading…' : 'Loading addresses…'}</p>
            </FormPage>,
        );
    }
    if (isContract && !contractMeta.valid) {
        return wrap(
            <FormPage
                label={pageLabel}
                status={(
                    <StatusMessage variant="error">
                        Contract #{contractActionIndex} is not stakeable. Its deploy
                        transaction did not set a cooldown duration. Staking is only
                        available on contracts that explicitly opted in at deploy time.
                    </StatusMessage>
                )}
            >
                {/* The list icon stays, so a contract picked by mistake is
                    never a dead end. */}
                <TargetField
                    {...targetField}
                    name={contractMeta.name || 'Unnamed contract'}
                    detail={`#${contractActionIndex}`}
                />
            </FormPage>,
        );
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // A queued result is SIGNED and not broadcast. The confirm pipeline
        // resolves that case rather than throwing, so without this branch the
        // done screen below reports it as a completed action.
        if (result?.queued) {
            return wrap(
                <FormPage label={`Queued ${cfg.resultNoun} transaction`}>
                    <ResultScreen state="signed-not-broadcast" onDone={onBack} unsaved={result.unsaved} />
                </FormPage>,
            );
        }
        if (result?.psbtHex && !txid) {
            return wrap(
                <FormPage label={`Unsigned ${cfg.resultNoun} transaction`}>
                    <ResultScreen
                        state="unsigned"
                        result={result}
                        onBuildAnother={handleBuildAnother}
                        onDone={onBack}
                    />
                </FormPage>,
            );
        }
        return wrap(
            <FormPage
                label={`${titleCase(cfg.resultNoun)} result`}
                actions={<Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>}
            >
                <p className={styles.summary}>
                    {cfg.doneText}
                    {isContract ? ' The transaction was broadcast; the network will record it shortly.' : null}
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Transaction ID</dt>
                    <dd className={styles.detailsValue}>{String(txid || cfg.txidFallback)}</dd>
                </dl>
            </FormPage>,
        );
    }

    const feeRow = (
        <>
            <dt className={styles.detailsLabel}>Network fee</dt>
            <dd className={styles.detailsValue}>
                {feeEstimate
                    ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                    : 'Estimate unavailable'}
            </dd>
        </>
    );
    const networkRow = descriptor ? (
        <>
            <dt className={styles.detailsLabel}>Network</dt>
            <dd className={styles.detailsValue}><ChainBadge descriptor={descriptor} size="sm" /></dd>
        </>
    ) : null;

    function reviewBody(request) {
        const params = request.params || {};
        if (isNetworkStake) {
            const verb = params.VERSION === '2' ? 'Top up' : 'Stake';
            return {
                summary: <>{verb} {params.AMOUNT} XCHAIN for signing public key{' '}{params.SIGNING_PUBKEY.slice(0, 12)}….</>,
                rows: (
                    <>
                        {networkRow}
                        <dt className={styles.detailsLabel}>From</dt>
                        <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                        <dt className={styles.detailsLabel}>Mode</dt>
                        <dd className={styles.detailsValue}>
                            {params.VERSION === '2' ? 'Top up an existing stake' : 'New stake'}
                        </dd>
                        <dt className={styles.detailsLabel}>Signing public key</dt>
                        <dd className={styles.detailsValue} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            {params.SIGNING_PUBKEY}
                        </dd>
                        <dt className={styles.detailsLabel}>Amount</dt>
                        <dd className={styles.detailsValue}>{params.AMOUNT} XCHAIN</dd>
                        <dt className={styles.detailsLabel}>Activation</dt>
                        <dd className={styles.detailsValue}>After 6 BTC blocks</dd>
                        {feeRow}
                    </>
                ),
            };
        }
        if (isPosition) {
            const isPartial = !request.full;
            return {
                summary: isUnstake
                    ? (isPartial
                        ? `Unstake ${formatWithThousands(params.AMOUNT)} XCHAIN from signing public key ${params.SIGNING_PUBKEY?.slice(0, 12)}. The rest stays staked; the unstaked amount returns after the cooldown.`
                        : `Unstake signing public key ${params.SIGNING_PUBKEY?.slice(0, 12)}. The full active balance for this public key returns after the cooldown.`)
                    : (isPartial
                        ? `Claim ${formatWithThousands(params.AMOUNT)} XCHAIN of the pending staking rewards for this address; the rest stays pending.`
                        : 'Claim all pending staking rewards for this address.'),
                rows: (
                    <>
                        <dt className={styles.detailsLabel}>Amount</dt>
                        <dd className={styles.detailsValue}>
                            {isPartial
                                ? `${formatWithThousands(params.AMOUNT)} XCHAIN`
                                : `${formatWithThousands(request.availableAmt)} XCHAIN (full ${isUnstake ? 'balance' : 'pending rewards'})`}
                        </dd>
                        {networkRow}
                        <dt className={styles.detailsLabel}>From</dt>
                        <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                        {isUnstake ? (
                            <>
                                <dt className={styles.detailsLabel}>Signing public key</dt>
                                <dd className={styles.detailsValue} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                    {params.SIGNING_PUBKEY}
                                </dd>
                            </>
                        ) : null}
                        {feeRow}
                    </>
                ),
            };
        }
        if (!isContract) {
            const shownPubkey = params.NEW_SIGNING_PUBKEY || params.SIGNING_PUBKEY;
            return {
                summary: currentAction === 'delegate'
                    ? `Delegate hub-signing authority to ${shownPubkey.slice(0, 12)}…`
                    : `Revoke the delegated signing key ${shownPubkey.slice(0, 12)}…`,
                rows: (
                    <>
                        {networkRow}
                        <dt className={styles.detailsLabel}>From</dt>
                        <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                        <dt className={styles.detailsLabel}>
                            {currentAction === 'delegate' ? 'New signing pubkey' : 'Signing pubkey'}
                        </dt>
                        <dd className={styles.detailsValue} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            {shownPubkey}
                        </dd>
                        {feeRow}
                    </>
                ),
            };
        }
        return {
            summary: (
                <>
                    {cfg.verb}
                    {currentAction === 'stake'
                        ? ` ${params.AMOUNT} ${params.TICK}`
                        : currentAction === 'unstake' && params.AMOUNT !== undefined
                            ? ` ${params.AMOUNT} ${params.TICK}`
                            : ` (${params.TICK})`}
                    {' '}on contract #{contractActionIndex}.
                </>
            ),
            rows: (
                <>
                    {networkRow}
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                    <dt className={styles.detailsLabel}>{currentAction === 'delegate' ? 'New signing key' : 'Signing key'}</dt>
                    <dd className={styles.detailsValue}>
                        <code style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{params.SIGNING_PUBKEY}</code>
                    </dd>
                    {currentAction === 'stake' ? (
                        <>
                            <dt className={styles.detailsLabel}>Amount</dt>
                            <dd className={styles.detailsValue}>{params.AMOUNT} {params.TICK}</dd>
                        </>
                    ) : null}
                    {currentAction === 'unstake' ? (
                        <>
                            <dt className={styles.detailsLabel}>Amount</dt>
                            <dd className={styles.detailsValue}>
                                {params.AMOUNT !== undefined
                                    ? `${params.AMOUNT} ${params.TICK}`
                                    : `Full staked balance${stakedAvailable != null ? ` (${formatWithThousands(String(stakedAvailable))} ${params.TICK})` : ''}`}
                            </dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Cooldown</dt>
                    <dd className={styles.detailsValue}>{contractMeta.cooldown} blocks</dd>
                    {feeRow}
                    {currentAction === 'stake' ? (
                        <ContractConsentPanel
                            manifest={manifest}
                            labelClassName={styles.detailsLabel}
                            valueClassName={styles.detailsValue}
                        />
                    ) : null}
                    {/* A contract slash can take a staker's whole balance, cooldown
                        included, so the warning says so in plain words. */}
                    <dt className={styles.detailsLabel} style={{ color: 'var(--xc-danger-text)' }}>Penalty risk</dt>
                    <dd className={styles.detailsValue} style={{ color: 'var(--xc-danger-text)' }}>
                        This contract can take some or all of your staked tokens as a penalty.
                        {' '}Penalties are sent to{' '}
                        {contractMeta.slashDestination
                            ? <AddressText address={contractMeta.slashDestination} />
                            : 'the contract-configured destination'}.
                    </dd>
                </>
            ),
        };
    }

    if (reviewing) {
        const request = reviewRequest || {
            params: actionParams || {},
            ...(isPosition ? { full: positionParams.isWholeAmount, availableAmt: String(availableAmt) } : {}),
        };
        const body = reviewBody(request);
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label={cfg.reviewLabel}
                onSubmit={handleSubmit}
                status={(isWatcherMode || isHwSource) && submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="primary"
                        icon={isWatcherMode || isHwSource ? <Icon.SignIcon /> : <VerbIcon />}
                        loading={stage === 'submitting'}
                        disabled={stage === 'submitting' || (
                            isWatcherMode
                                ? false
                                : isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)
                        )}
                    >
                        {isWatcherMode ? cfg.unsignedLabel : cfg.reviewSubmit}
                    </Button>
                )}
            >
                <p className={styles.summary}>{body.summary}</p>
                <dl className={styles.detailsList}>{body.rows}</dl>
                {isWatcherMode ? (
                    <p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => {
                            setPassword(v);
                            if (submitError) setSubmitError(null);
                        }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                        signerInfo={hwSignerInfo}
                    />
                )}
            </FormPage>,
        );
    }

    // The confirm page, rendered in place of the form (the overlay modal did
    // not fit small viewports); the form's values stay intact behind it.
    if (actionConfirm.open) {
        const params = reviewRequest?.params || actionParams || {};
        let summary;
        if (isContract) {
            // A stake moves its amount to the contract; an unstake brings it
            // back (the whole stake when no amount is set); a delegation moves
            // nothing.
            summary = {
                verb: currentAction === 'stake'
                    ? t('components.confirmSummary.verbStake')
                    : currentAction === 'unstake'
                        ? t('components.confirmSummary.verbUnstake')
                        : t('components.confirmSummary.verbDelegate'),
                ...(params.TICK ? { ticker: params.TICK.toUpperCase() } : {}),
                ...(params.AMOUNT && currentAction !== 'delegate'
                    ? {
                        amount: params.AMOUNT,
                        target: t('components.confirmSummary.contractTarget', { index: params.TARGET_CONTRACT_INDEX }),
                    }
                    : {}),
                direction: currentAction === 'stake' ? 'out' : currentAction === 'unstake' ? 'in' : 'none',
                ...(currentAction === 'stake' ? { facts: contractManifestFacts(manifest) } : {}),
            };
        } else if (isNetworkStake) {
            summary = {
                verb: t('components.confirmSummary.verbStake'),
                ticker: STAKING_TICK,
                ...(params.AMOUNT ? { amount: params.AMOUNT } : {}),
                direction: 'out',
            };
        } else if (isPosition) {
            // Unstaking and claiming bring XCHAIN back to the signer; without
            // an AMOUNT on the wire the whole known balance is what comes back.
            const full = reviewRequest ? reviewRequest.full : positionParams.isWholeAmount;
            const returnedAmount = params.AMOUNT
                || (full && availableAmt != null ? String(availableAmt) : '');
            summary = {
                verb: isUnstake
                    ? t('components.confirmSummary.verbUnstake')
                    : t('components.confirmSummary.verbClaimRewards'),
                ticker: STAKING_TICK,
                ...(returnedAmount ? { amount: returnedAmount } : {}),
                direction: 'in',
            };
        } else {
            // The key handed control to, or the one revoked, cut in the
            // middle; the full key is under Technical details.
            const delegatedKey = String(params.NEW_SIGNING_PUBKEY || params.SIGNING_PUBKEY || '');
            summary = {
                verb: currentAction === 'delegate'
                    ? t('components.confirmSummary.verbDelegateSigningKey')
                    : t('components.confirmSummary.verbRevokeDelegation'),
                ...(delegatedKey.length > 16
                    ? { target: `${delegatedKey.slice(0, 8)}…${delegatedKey.slice(-8)}` }
                    : {}),
                direction: 'none',
            };
        }
        // Every branch names the action's verb; the address and chain are shared.
        const confirmSummary = {
            verb: summary.verb,
            ...summary,
            chainId,
            address: fromAddress?.address,
        };
        const isDelegation = !isContract && !isNetworkStake && !isPosition;
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={confirmSummary}
                screenVariant={variant}
                // A delegation names the chain by its badge; the others by name, as before.
                chainLabel={isDelegation ? (descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null) : (descriptor?.displayName || chainId)}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // Hardware swaps the password field for the device block and
                // gates Approve on the device being available (§5.1).
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    const onPickSource = (a) => {
        setFromAddressId(a.id);
        setSourcePickerOpen(false);
    };
    // A contract fixes the network, so its picker stays on the contract's
    // chain; on the network, picking an address on another chain moves the form there.
    if (sourcePickerOpen && isContract) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={chainId}
                lockNetwork
                onPick={onPickSource}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }
    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={chainId}
                onChainChange={(cid) => { retargetNetwork(cid); setFormError(null); }}
                onPick={onPickSource}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // Token picker (spendable balances, locked to the contract's chain),
    // rendered in place of the form.
    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                // A contract stake locks a token; the network coin cannot be staked.
                kindFilter="tokens"
                kindLocked
                title="Select Token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => {
                    tickSeededRef.current = false;
                    setTick(String(sel.tick || '').toUpperCase());
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // The section each error belongs to; it reopens on every press.
    const sectionErrorKey = (section) => {
        const hasError = section === 'main'
            ? Boolean((formError && errorSection === 'main') || positionsError || prefillError)
            : Boolean(formError && errorSection === section);
        return hasError ? validationAttempt + 1 : 0;
    };
    const tickUpper = String(tick || '').trim().toUpperCase();
    const mainSummary = isContract
        ? (joinSummary(currentAction !== 'delegate' && amount.trim() ? `${amount.trim()} ${tickUpper}`.trim() : tickUpper) || null)
        : cfg.amount
            ? (effectiveAmount ? formatWithThousands(String(effectiveAmount)) : 'No amount yet')
            : (signingPubkey.trim() ? summaryAddress(signingPubkey.trim().toLowerCase()) : 'No key yet');
    const mainSummaryUnit = !isContract && cfg.amount && effectiveAmount ? STAKING_TICK : undefined;
    const keyHelp = isNetworkUnstake
        ? (stakedKeys.length > 0
            ? 'Filled in from your stake; edit only if you staked with a different key.'
            : '64-character hex-encoded Ed25519 public key (the same one used to stake).')
        : cfg.key?.help;
    const onKeyChange = (e) => {
        keyOriginRef.current = 'typed';
        setSigningPubkey(isContract ? e.target.value.trim() : e.target.value);
        setFormError(null);
        setPrefillError(null);
    };

    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={cfg.formLabel}
            onSubmit={handleReview}
            onChangeCapture={() => { if (formError) setFormError(null); }}
            data-form-standard="staking"
            status={formError || positionsError || prefillError ? (
                <StatusMessage variant="error">{formError || positionsError || prefillError}</StatusMessage>
            ) : null}
            action={(
                <FormAction
                    loading={actionConfirm.composing}
                    icon={<VerbIcon />}
                    disabled={!fromAddress || actionConfirm.composing || (isPosition && !totalKnown)}
                >
                    {cfg.submitLabel(singleEncode)}
                </FormAction>
            )}
            /* The standard order: From (Network and address), the main section
               (Stake On, the action, then the action's own fields), then the
               Network fee row. */
            from={isContract ? (
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainRegistry={chainRegistry}
                    lockNetwork
                    networkHelp="The chain this contract lives on. It is fixed by the contract, so your address, the token and the fee are all on this network."
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp="The address that stakes, unstakes or delegates, pays the network fee and signs."
                    missing={<FormNotice variant="error">{t('send.source.noAddress')}</FormNotice>}
                    revealKey={sectionErrorKey('from')}
                />
            ) : (
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={validatorLaneChainIds(Object.keys(addressesByChain), chainRegistry)}
                    chainRegistry={chainRegistry}
                    onNetworkChange={(cid) => { retargetNetwork(cid); setFormError(null); }}
                    networkHelp={cfg.networkHelp}
                    address={fromAddress?.address || null}
                    addressHelp={isNetworkStake
                        ? t('routes.stakeForm.fromHelp')
                        : isPosition ? t('routes.stakingAction.fromHelp') : t('routes.delegationAction.fromHelp')}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    revealKey={sectionErrorKey('from')}
                />
            )}
            fee={isContract || feeTiers ? (
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={sectionErrorKey('fee')}
                />
            ) : null}
        >
            <FormSection
                id="main"
                title={STAKING_SECTION_TITLES[currentAction]}
                icon={cfg.sectionIcon}
                {...formSections.bind('main')}
                revealKey={sectionErrorKey('main')}
                summary={mainSummary}
                summaryUnit={mainSummaryUnit}
            >
                {/* The action toggle is the first thing in the section (ruling
                    2026-11-13), above Stake On and every other field. */}
                {toggle}

                {/* Stake On names the target. A contract carries its cooldown as
                    the hint; the code holds no network cooldown figure. */}
                {isContract ? (
                    <TargetField
                        {...targetField}
                        name={contractMeta.name || 'Unnamed contract'}
                        detail={`#${contractActionIndex}`}
                        hint={contractCooldownHint(currentAction, contractMeta.cooldown, descriptor?.coin)}
                    />
                ) : (
                    <TargetField
                        {...targetField}
                        name="Validator staking"
                        detail={descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
                        icon={<Icon.StakeIcon />}
                    />
                )}

                {/* Set from the signing key when the network finds an existing
                    stake; the user can always override it. */}
                {isNetworkStake ? (
                    <IconSelect
                        label="Mode"
                        help="New stake locks XCHAIN behind a signing key that has no stake yet. Top up adds XCHAIN to a signing key this address already staked. The wallet picks one from the signing public key; change it only to override."
                        tag={detectStatus === 'new' || detectStatus === 'topup' ? 'Detected' : undefined}
                        value={stakeMode}
                        onChange={(value) => { setStakeMode(value); setFormError(null); }}
                        options={[
                            { value: '1', label: 'New stake', icon: <Icon.PlusIcon /> },
                            { value: '2', label: 'Top up an existing stake', icon: <Icon.StakeIcon /> },
                        ]}
                    />
                ) : null}

                {isContract ? (
                    <TokenField
                        label="Token"
                        help="The token staked in this contract. Stake and Unstake move this token; Delegate only rotates the signing key for the stake already there."
                        value={tick && chainId ? { chainId, tick } : null}
                        onOpenPicker={() => setTokenPickerOpen(true)}
                    />
                ) : null}

                {cfg.amount === 'balance' ? (
                    <AmountField
                        label="Amount"
                        help={cfg.amountHelp}
                        amount={amount}
                        tick={STAKING_TICK}
                        onAmountFieldChange={onAmountFieldChange}
                        onMax={tickAmtBalance && Number(tickAmtBalance) > 0
                            ? () => { setAmountTouched(true); setAmount(tickAmtBalance); setFormError(null); }
                            : undefined}
                        maxDisabled={!tickAmtBalance}
                        balanceText={tickAmtBalance != null
                            ? `${formatWithThousands(tickAmtBalance)} ${STAKING_TICK} available`
                            : null}
                    />
                ) : null}
                {cfg.amount === 'position' ? (
                    <AmountField
                        label="Amount"
                        help={cfg.amountHelp}
                        amount={effectiveAmount}
                        fiatAmount={fiatAmount}
                        tick={STAKING_TICK}
                        fiatRate={fiatRate}
                        amountInputMode={amountInputMode}
                        toggleAmountInputMode={toggleAmountInputMode}
                        onAmountFieldChange={onAmountFieldChange}
                        inputRef={amountInputRef}
                        onMax={() => {
                            const max = availableAmt != null ? String(availableAmt) : '';
                            setAmountTouched(true);
                            setAmount(max);
                            if (amountInputMode === 'fiat') {
                                const converted = max && fiatRate ? coinToFiatExact(max, fiatRate) : null;
                                setFiatAmount(converted != null ? roundDecimalString(converted, 2) : '');
                            }
                            setFormError(null);
                        }}
                        maxDisabled={availableAmt == null}
                        balanceText={availableAmt != null
                            ? `${formatWithThousands(String(availableAmt))} XCHAIN available`
                            : positionsError ? 'Unavailable' : 'Loading…'}
                    />
                ) : null}
                {cfg.amount === 'contract' ? (
                    <AmountField
                        label="Amount"
                        help={cfg.amountHelp}
                        amount={amount}
                        tick={tick}
                        divisibility={tokenDivisibility}
                        onAmountFieldChange={onAmountFieldChange}
                        onMax={currentAction === 'stake'
                            ? (tickAmtBalance && compareAmounts(tickAmtBalance, '0') === 1
                                ? () => { setAmountTouched(true); setAmount(tickAmtBalance); }
                                : undefined)
                            : (stakedAvailable != null && compareAmounts(stakedAvailable, '0') === 1
                                ? () => { setAmountTouched(true); setAmount(String(stakedAvailable)); }
                                : undefined)}
                        maxDisabled={currentAction === 'stake' ? !tickAmtBalance : stakedAvailable == null}
                        balanceText={currentAction === 'stake'
                            ? (tickAmtBalance != null && tick
                                ? `${formatWithThousands(tickAmtBalance)} ${String(tick).toUpperCase()} available`
                                : null)
                            : (stakedAvailable != null && tick
                                ? `${formatWithThousands(String(stakedAvailable))} ${String(tick).toUpperCase()} staked`
                                : null)}
                    />
                ) : null}

                {qualifyReadout ? (
                    <div style={{ marginBottom: '0.75rem' }}>
                        <p style={{ fontSize: '0.85rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
                            Capabilities this stake unlocks
                        </p>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {qualifyReadout.rows.map((r) => (
                                <li
                                    key={r.capability}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'baseline',
                                        gap: '0.5rem',
                                        fontSize: '0.85rem',
                                        padding: '0.15rem 0',
                                    }}
                                >
                                    <span
                                        aria-hidden="true"
                                        style={{ color: r.qualifies ? 'var(--xc-success)' : 'var(--xc-text-muted)' }}
                                    >
                                        {r.qualifies ? '✓' : '○'}
                                    </span>
                                    <span style={{
                                        flex: 1,
                                        color: r.qualifies ? 'var(--xc-text)' : 'var(--xc-text-muted)',
                                    }}>
                                        {r.label}
                                        <span className="sr-only">{r.qualifies ? ' (qualifies)' : ' (not yet)'}</span>
                                    </span>
                                    <span style={{ color: 'var(--xc-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                                        {r.minStake} XCHAIN
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <p style={{ fontSize: '0.75rem', color: 'var(--xc-text-muted)', margin: '0.5rem 0 0' }}>
                            {qualifyReadout.hasTopup
                                ? `Based on your total stake of ${qualifyReadout.projected} XCHAIN for this public key, including this top-up. `
                                : ''}
                            Thresholds are set by network governance and can change.
                        </p>
                    </div>
                ) : null}

                {isNetworkUnstake && stakedKeys.length > 1 ? (
                    <Select
                        label="Staked signing public key"
                        value={stakedKeys.includes(signingPubkey) ? signingPubkey : ''}
                        onChange={onKeyChange}
                        help="This address has stakes under more than one signing public key. Choose which one to unstake."
                    >
                        {stakedKeys.map((k) => (
                            <Select.Option key={k} value={k} icon={<Icon.KeyIcon />}>{`${k.slice(0, 10)}…${k.slice(-8)}`}</Select.Option>
                        ))}
                    </Select>
                ) : null}
                {cfg.key ? (
                    <Input
                        label={cfg.key.label}
                        help={keyHelp}
                        hint={!isContract && !isNetworkStake && !isPosition && isWatcherMode
                            ? 'Watch-only mode creates an unsigned transaction and cannot sign it.'
                            : undefined}
                        value={signingPubkey}
                        onChange={onKeyChange}
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                ) : null}
                {/* The detection line follows the key it reads. */}
                {isNetworkStake && detectStatus !== 'idle' ? (
                    <p style={{ fontSize: '0.8rem', margin: '0.5rem 0 0', color: 'var(--xc-text-muted)' }}>
                        {detectStatus === 'checking' && 'Checking the network for an existing stake…'}
                        {detectStatus === 'new' && '✓ No existing stake for this public key. New stake is selected.'}
                        {detectStatus === 'topup' && '✓ Existing stake found; defaulting to Top up. (Choose New stake to force-reject as duplicate.)'}
                        {detectStatus === 'error' && 'Couldn\'t reach the network. Pick the mode manually; the network will reject if the wrong one is chosen.'}
                    </p>
                ) : null}
            </FormSection>
        </FormFrame>,
    );
}
