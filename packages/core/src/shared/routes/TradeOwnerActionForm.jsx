// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Edit and Cancel for one of the wallet's open orders (ORDER v2 and v1) or
// swaps (SWAP v2 and v1), in the Form Standard (G20 to G26) like every other
// action form, since each is an on-chain transaction (operator 2026-11-14):
// From (the locked network and the owner address that must sign), the main
// section (the order's or swap's terms as fact rows, plus the new expiration
// and the allow and block lists on Edit), Memo, Advanced and Speed and Fees
// (FeeSection draws both, G98, G113), the status slot and one green action
// with its icon. Review is the shared confirm screen, which carries the
// cancel warning from the pre-flight classification (flows/actionWarnings.js
// ORDER_CANCEL, SWAP_CANCEL; G105).
//
// OrderActionPanel and SwapActionPanel hand in what differs between the two:
// the wire action, the signing flows, the copy, the submit-time checks and
// the fresh re-reads. The form keeps their behaviour and validation as they
// were before the move. The memo is the one new field: ORDER and SWAP v1 and
// v2 all end in MEMO, and a blank memo sends nothing, so the composed action
// is unchanged unless one is typed.

import { useMemo, useState } from 'react';
import { Button, FormPage, Icon, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    MemoSection,
    useFormSections,
} from '../components/formStandard/index.js';
import { MAX_MEMO_LENGTH, memoCharacterError, memoLengthError } from '../utils/memoLimit.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { ListField } from '../components/ListField.jsx';
import { editListClear, editListText } from '../utils/editListField.js';
import { ActionConfirmScreen, ActionWarningsCard } from '../components/ActionConfirmScreen.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { boundListIndex } from '../../flows/accessListSlots.js';
import { isListEditRemoveActive } from '../../flows/protocolActivations.js';
import {
    customFeeEstimate,
    customFeeReviewStop,
    displayRateToSettingsCustom,
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
} from '../../flows/feeEstimate.js';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { useSettings } from '../hooks/useSettings.js';
import { explorerPageUrl } from '../utils/explorerLinks.js';
import { fmtDate } from '../utils/orderView.js';
import F from './IssueTokenForm.module.css';
import facts from './FactRows.module.css';

const chainRegistry = registryLib.defaultRegistry();

// The memo checks Create Order and Swap make: the wire's separators, the
// indexer's length and the unsafe characters. The memo goes out trimmed.
function memoError(memo) {
    if (memo.includes('|') || memo.includes(';')) return 'Memo cannot contain "|" or ";".';
    return memoLengthError(memo) || memoCharacterError(memo);
}

// The confirm screen shows the expiration as a date, not Unix seconds.
function withFormattedExpiration(confirmAction) {
    const decoded = confirmAction?.composed?.decoded;
    if (!decoded || !Array.isArray(decoded.details)) return confirmAction;
    const replacements = [];
    const details = decoded.details.map((detail) => {
        if (!/expir/i.test(String(detail?.label || ''))) return detail;
        const formatted = fmtDate(detail.value);
        if (!formatted) return detail;
        replacements.push([String(detail.value), formatted]);
        return { ...detail, value: formatted };
    });
    if (replacements.length === 0) return confirmAction;
    const summary = replacements.reduce(
        (value, [raw, formatted]) => String(value).split(raw).join(formatted),
        decoded.summary,
    );
    return {
        ...confirmAction,
        composed: {
            ...confirmAction.composed,
            decoded: { ...decoded, summary, details },
        },
    };
}

/**
 * @typedef {object} TradeOwnerActionKind
 * @property {'ORDER' | 'SWAP'} action          the wire action
 * @property {string} indexParam                 ORDER_ACTION_INDEX or SWAP_ACTION_INDEX
 * @property {string} noun                       'Order' or 'Swap' (Title Case, for titles and buttons)
 * @property {string} lowerNoun                  'order' or 'swap' (sentence text)
 * @property {{ cancel: string, edit: string }} software   messaging flows that sign with a password
 * @property {{ cancel: string, edit: string }} hardware   messaging flows that sign on a device
 * @property {import('react').ComponentType<any>} icon     the main section's icon on Cancel
 * @property {string} indexLabel                 the facts row naming the item ("Order", "Swap")
 * @property {(row: any, side: 'give' | 'get') => string} sideText
 * @property {(type: 'cancel' | 'edit') => string} confirmVerb   the confirm screen's verb
 * @property {{ expiration: string, allow: string, block: string, from: string, network: string }} help
 * @property {{ cancel: string, edit: string }} resultCopy   the broadcast panel's line
 * @property {{ cancel: string, edit: string }} resultWhat   the queued result's noun
 * @property {(ctx: object) => string | null} [liveError]   a refusal shown as soon as the fields hold it
 * @property {(ctx: object) => string | null} validate      submit-time checks, in order
 * @property {(ctx: object) => Promise<string | null>} recheck   fresh re-reads; a refusal stops the submit
 * @property {(ctx: object) => object} submitExtra           the signing flow's own fields
 * @property {(err: any, isCancel: boolean) => string} failFallback
 * @property {'chainLabel' | 'none'} [confirmChainLabel]     whether the confirm screen names the chain
 */

/**
 * Cancel or Edit one open order or swap, signed from its owner address.
 *
 * @param {object} props
 * @param {TradeOwnerActionKind} props.kind
 * @param {'cancel' | 'edit'} props.type
 * @param {{ chainId: string, owner: any, row: any, key: string, cancelledKeys?: Set<string> }} props.item
 * @param {any[]} props.chainAddresses    the wallet's addresses on the item's chain (the list picker)
 * @param {string} props.variant
 * @param {string} props.walletId
 * @param {any} props.messaging
 * @param {() => void} props.onDone
 * @param {() => void} [props.onCancelBroadcast]
 * @param {() => void} props.onBack
 */
export function TradeOwnerActionForm({
    kind, type, item, chainAddresses, variant, walletId, messaging, onDone, onCancelBroadcast, onBack,
}) {
    const demoGuard = useDemoGuard(walletId, { onBack });
    const { chainId, owner, row } = item;
    const { settings } = useSettings();
    const descriptor = chainRegistry.get(chainId);
    const coinTicker = descriptor ? tickerForDescriptor(descriptor) : '';
    const isCancel = type === 'cancel';
    const currentAllowList = boundListIndex(row.allow_list ?? row.allowList);
    const currentBlockList = boundListIndex(row.block_list ?? row.blockList);
    const canRemoveList = isListEditRemoveActive({ chainId });
    const signerReady = useSignerReady(walletId);
    const lane = useOwnerActionLane({
        messaging,
        walletId,
        chainId,
        owner,
        software: kind.software[type],
        hardware: kind.hardware[type],
    });
    // Off Bitcoin a protocol fee (an edit re-charges the expiration fee) is a
    // native-coin output the transaction must carry, or the indexer rejects it.
    const nativeFee = useNativeFee(chainId);

    // Held above the picker page (an early return) so the open state survives it.
    const sections = useFormSections({ from: false, main: true, memo: false, fee: false });
    const [attempt, setAttempt] = useState(0);
    const [errorSection, setErrorSection] = useState(/** @type {'main' | 'memo' | 'fee' | null} */ (null));

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const done = result !== null;

    // Edit fields; blank keeps the order's or swap's current value.
    const [expInput, setExpInput] = useState('');
    const [allowListIdx, setAllowListIdx] = useState('');
    const [blockListIdx, setBlockListIdx] = useState('');
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));
    // The optional public memo, on Cancel and Edit alike. It is not an edit
    // field: a memo alone changes nothing, so Edit still asks for a change.
    const [memo, setMemo] = useState('');
    const memoText = memo.trim();
    const memoProblem = memoText ? memoError(memoText) : null;

    // Speed and Fees: the standard Slow / Normal / Fast / Custom pick.
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId, chainRegistry }), [chainId]);
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

    const editParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {};
        if (expInput.trim()) {
            const ms = Date.parse(expInput.trim());
            if (Number.isFinite(ms)) p.EXPIRATION = String(Math.floor(ms / 1000));
        }
        if (allowListIdx) p.ALLOW_LIST = allowListIdx;
        if (blockListIdx) p.BLOCK_LIST = blockListIdx;
        return p;
    }, [expInput, allowListIdx, blockListIdx]);
    const editHasChange = Object.keys(editParams).length > 0;
    const actionIndex = String(row.action_index ?? '').trim();
    // MEMO is the last field of every format; a blank memo is left out.
    const params = useMemo(() => ({
        ...(isCancel
            ? { VERSION: '1', [kind.indexParam]: actionIndex }
            : { VERSION: '2', [kind.indexParam]: actionIndex, ...editParams }),
        ...(memoText ? { MEMO: memoText } : {}),
    }), [isCancel, kind.indexParam, actionIndex, editParams, memoText]);

    const ctx = {
        messaging, isCancel, item, owner, row, actionIndex, params, editParams, editHasChange, expInput, allowListIdx, blockListIdx,
        memo: memoText,
    };
    const liveError = kind.liveError ? kind.liveError(ctx) : null;

    // The protocol fee the Speed and Fees row quotes: the cancel, or an edit
    // that changes something, with a memo the network would accept.
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: owner?.address,
        actionData: owner?.address && (isCancel || editHasChange) && !memoProblem
            ? { action: kind.action, params }
            : null,
    });

    async function submit(event) {
        event.preventDefault();
        if (submitting || lane.composing) return;
        setAttempt((n) => n + 1);
        setErrorSection('main');
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setErrorSection('fee'); setError(feeStop.formError); return; }
        const refusal = liveError || kind.validate(ctx);
        if (refusal) { setError(refusal); return; }
        if (memoProblem) { setErrorSection('memo'); setError(memoProblem); return; }
        setSubmitting(true);
        setError(null);
        try {
            // The detail page can be minutes old: re-read cancels and fill
            // state so an item that expired, filled or was cancelled since is
            // not signed again.
            const stale = await kind.recheck(ctx);
            if (stale) { setError(stale); return; }
            const res = await lane.run({
                actionData: { action: kind.action, params },
                encoderOpts: {
                    ...(nativeFee.flag ? { payFeeInNativeCoin: true } : {}),
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                submitExtra: kind.submitExtra(ctx),
            });
            const txid = res?.txid || res?.broadcast?.txid;
            if (isCancel && txid && typeof onCancelBroadcast === 'function') onCancelBroadcast();
            setResult(res || {});
        } catch (err) {
            if (!isUserRejection(err)) {
                setError(err?.name === 'InvalidPasswordError' ? 'Incorrect password.' : submitFailureMessage(err, {
                    chainId,
                    mandatory: nativeFee.mandatory,
                    fallback: kind.failFallback(err, isCancel),
                }));
            }
        } finally {
            setSubmitting(false);
        }
    }

    const header = (
        <PageHeader onBack={done ? onDone : onBack} title={`${isCancel ? 'Cancel' : 'Edit'} ${kind.noun}`} />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (listPickerFor) {
        return (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={chainId}
                addresses={chainAddresses}
                filterType="2"
                title={listPickerFor === 'allow' ? 'Choose Allow-List' : 'Choose Block-List'}
                onSelect={(r) => {
                    if (listPickerFor === 'allow') setAllowListIdx(r.actionIndex); else setBlockListIdx(r.actionIndex);
                    setError(null);
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    if (lane.open) {
        return (
            <ActionConfirmScreen
                {...lane.confirmProps}
                confirmAction={withFormattedExpiration(lane.confirmProps.confirmAction)}
                summary={{
                    verb: kind.confirmVerb(type),
                    ...(row.give_tick ? { ticker: String(row.give_tick).toUpperCase() } : {}),
                    chainId,
                    direction: 'none',
                    address: owner?.address,
                }}
                screenVariant={variant}
                chainLabel={kind.confirmChainLabel === 'chainLabel' ? (descriptor?.displayName || chainId) : null}
                signerReady={signerReady}
                hintClassName={F.hint}
            />
        );
    }

    if (done) {
        const txid = result.txid || result.broadcast?.txid;
        const explorerUrl = explorerPageUrl({ chainId, kind: 'transaction', value: txid, settings });
        // Every result lays out through FormPage like the form itself.
        // Signed but not broadcast yet: nothing changed on chain, so no success copy.
        if (result.queued) {
            return wrap(
                <FormPage label={`Queued ${kind.lowerNoun} ${isCancel ? 'cancel' : 'edit'}`}>
                    <ResultScreen
                        state="signed-not-broadcast"
                        onDone={onDone}
                        what={kind.resultWhat[type]}
                        unsaved={result.unsaved}
                    />
                </FormPage>,
            );
        }
        if (result.psbtHex && !txid) {
            return wrap(
                <FormPage label={`Unsigned ${kind.lowerNoun} ${isCancel ? 'cancel' : 'edit'}`}>
                    <ResultScreen state="unsigned" result={result} onDone={onDone} />
                </FormPage>,
            );
        }
        return wrap(
            <FormPage
                label={`${kind.noun} ${isCancel ? 'cancel' : 'edit'} result`}
                actions={<Button variant="success" icon={<Icon.CheckIcon />} onClick={onDone}>Done</Button>}
            >
                <h2 className={F.successTitle}>{isCancel ? 'Cancel broadcast' : 'Edit broadcast'}</h2>
                <p className={F.hint}>{kind.resultCopy[type]}</p>
                {txid ? (
                    <>
                        <p className={F.successLabel}>Transaction ID</p>
                        <code className={F.txid}>{txid}</code>
                        {explorerUrl ? (
                            <p className={F.hint}>
                                <a href={explorerUrl} target="_blank" rel="noopener noreferrer">View on explorer ↗</a>
                            </p>
                        ) : null}
                    </>
                ) : null}
            </FormPage>,
        );
    }

    const revealKey = (id) => ((error || liveError) && errorSection === id ? attempt + 1 : 0);
    const shownError = liveError || error;
    const changeCount = Object.keys(editParams).length;
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={`${isCancel ? 'Cancel' : 'Edit'} ${kind.lowerNoun}`}
            onSubmit={submit}
            data-form-standard={`${isCancel ? 'cancel' : 'edit'}-${kind.lowerNoun}`}
            status={[
                shownError ? <StatusMessage key="error" variant="error">{shownError}</StatusMessage> : null,
                // Watcher mode reviews on the offline signer, so the cancel
                // warning the confirm screen would show is said here (G105).
                lane.isWatcherMode && isCancel
                    ? <ActionWarningsCard key="warnings" ids={[`${kind.action}_CANCEL`]} />
                    : null,
                lane.isWatcherMode ? (
                    <StatusMessage key="watcher" variant="warning">
                        Watcher mode: this prepares the transaction for your offline signer. Sign it
                        there, then bring the signed transaction to a wallet that can broadcast it.
                    </StatusMessage>
                ) : null,
            ]}
            action={(
                // The form's one action, green with its icon whether it
                // updates or cancels (G50).
                <FormAction
                    icon={lane.isWatcherMode ? <Icon.SignIcon /> : (isCancel ? <Icon.XIcon /> : <Icon.PencilIcon />)}
                    loading={submitting || lane.composing}
                    disabled={submitting || lane.composing}
                >
                    {lane.isWatcherMode ? 'Create Unsigned Transaction' : `${isCancel ? 'Cancel' : 'Update'} ${kind.noun}`}
                </FormAction>
            )}
            /* From: the item's network (fixed) and the owner address, the only
               address that can sign this change. */
            from={(
                <FromSection
                    {...sections.bind('from')}
                    chainId={chainId}
                    chainRegistry={chainRegistry}
                    lockNetwork
                    networkHelp={kind.help.network}
                    address={owner?.address || null}
                    addressHelp={kind.help.from}
                    pickerLockedReason={`Only the address that placed this ${kind.lowerNoun} can change it.`}
                />
            )}
            fee={(
                <FeeSection
                    {...sections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={(next) => { setFeePick(next); setError(null); }}
                    customEstimate={feeCustomEstimate}
                    revealKey={revealKey('fee')}
                    fees={{
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        nativeFeeProps: { ...nativeFee.toggleProps, coinTicker },
                    }}
                />
            )}
        >
            <FormSection
                id="main"
                title={isCancel ? kind.noun : `${kind.noun} Changes`}
                icon={isCancel ? kind.icon : Icon.PencilIcon}
                {...sections.bind('main')}
                revealKey={revealKey('main')}
                summary={isCancel
                    ? `#${actionIndex}`
                    : (changeCount === 0 ? 'No changes' : `${changeCount} ${changeCount === 1 ? 'change' : 'changes'}`)}
            >
                {/* What is being cancelled or edited, in the shared FactRows
                    look: label left, value right, one divider per row. The
                    section is the card, so the rows draw none of their own. */}
                <dl className={facts.list} aria-label={kind.noun} data-trade-owner-facts="">
                    <dt className={facts.label}>Give</dt>
                    <dd className={facts.value}>{kind.sideText(row, 'give')}</dd>
                    <dt className={facts.label}>Get</dt>
                    <dd className={facts.value}>{kind.sideText(row, 'get')}</dd>
                    <dt className={facts.label}>{kind.indexLabel}</dt>
                    <dd className={facts.value}>#{actionIndex}</dd>
                </dl>
                {isCancel ? null : (
                    <>
                        <Input
                            label="New expiration"
                            optional
                            type="datetime-local"
                            help={kind.help.expiration}
                            value={expInput}
                            onChange={(e) => { setExpInput(e.target.value); setError(null); }}
                        />
                        {/* Allow and block lists are picker fields like Token: the field
                            shows the bound or picked list and opens the list picker. */}
                        <ListField
                            label="Allow list"
                            optional
                            help={kind.help.allow}
                            placeholder="None set"
                            valueText={editListText(allowListIdx, currentAllowList, 'Allow list')}
                            onOpenPicker={() => setListPickerFor('allow')}
                            onClear={editListClear(allowListIdx, currentAllowList, canRemoveList, setAllowListIdx)}
                            clearLabel={allowListIdx && allowListIdx !== '0' ? 'Keep the current allow list' : 'Remove allow list'}
                        />
                        <ListField
                            label="Block list"
                            optional
                            help={kind.help.block}
                            placeholder="None set"
                            valueText={editListText(blockListIdx, currentBlockList, 'Block list')}
                            onOpenPicker={() => setListPickerFor('block')}
                            onClear={editListClear(blockListIdx, currentBlockList, canRemoveList, setBlockListIdx)}
                            clearLabel={blockListIdx && blockListIdx !== '0' ? 'Keep the current block list' : 'Remove block list'}
                        />
                    </>
                )}
            </FormSection>
            {/* Memo, closed and optional as on every other form; Advanced and
                Speed and Fees follow it (FeeSection draws both). */}
            <MemoSection
                {...sections.bind('memo')}
                inputId={`${isCancel ? 'cancel' : 'edit'}-${kind.lowerNoun}-memo`}
                maxLength={MAX_MEMO_LENGTH}
                revealKey={revealKey('memo')}
                value={memo}
                error={errorSection === 'memo' && memoProblem ? memoProblem : undefined}
                onChange={(e) => { setMemo(e.target.value); setError(null); }}
            />
        </FormFrame>,
    );
}
