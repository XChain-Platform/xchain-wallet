// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { isDeviceAddressSource } from '../../schemas/constants.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, FormErrorSummary, FormErrorsContext, Icon, InfoTip, Input, ListPage, PageHeader, Screen, StatusMessage, useFormErrors } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen, ActionWarningsCard } from '../components/ActionConfirmScreen.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { ListField } from '../components/ListField.jsx';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { pickedListText } from '../utils/listLabel.js';
import { ActionList } from '../components/ActionList.jsx';
import { outcomeLabelsOf, safeOutcomeLabel } from '../utils/betOutcomeLabels.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { t } from '../../i18n/index.js';
import { isRejectedFeedStatus, REJECTED_FEED_LABEL } from '../../market/feedStatus.js';
import '../../i18n/locales/en/components.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { FeeSection } from '../components/formStandard/index.js';
import {
    customFeeEstimate,
    customFeeReviewStop,
    displayRateToSettingsCustom,
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
} from '../../flows/feeEstimate.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import styles from './IssueTokenForm.module.css';
import consoleStyles from './OracleConsole.module.css';

const chainRegistry = registryLib.defaultRegistry();

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

// Plain-language countdown. An oracle's whole job is to act inside a window, so
// the console leads with time remaining rather than a raw unix stamp.
function countdown(targetSec, nowSec) {
    const n = Number(targetSec);
    if (!Number.isFinite(n)) return null;
    const d = n - nowSec;
    if (d <= 0) return 'in the past';
    const days = Math.floor(d / 86400);
    const hours = Math.floor((d % 86400) / 3600);
    const mins = Math.floor((d % 3600) / 60);
    if (days > 0) return `in ${days} ${days === 1 ? 'day' : 'days'} and ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    if (hours > 0) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'} and ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    return `in ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
}

function marketStatusLabel(status) {
    if (isRejectedFeedStatus(status)) return REJECTED_FEED_LABEL;
    if (status === 'open') return 'Positions available';
    if (status === 'closed') return 'Purchases closed, waiting for your result';
    if (status === 'resolved') return 'Settled';
    if (status === 'resolved_void') return 'Void, everyone refunded';
    if (status === 'cancelled') return 'Cancelled, everyone refunded';
    if (status === 'expired') return 'Expired unresolved, everyone refunded';
    const words = String(status || 'unknown').trim().replace(/[_-]+/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function countdownLabel(targetSec, nowSec) {
    return countdown(targetSec, nowSec) || 'at an unavailable time';
}

/**
 * Which oracle actions the chain would accept on a market right now. Resolve
 * is only legal between the deadline and the end of the refund window, cancel
 * only before the market reaches a terminal state, and a list edit only while
 * it takes bets and only from the address that opened it. The console and the
 * market page's owner Actions tab both ask this one function.
 *
 * @param {any} feed     a bet_feeds row carrying `owner` (the wallet address that runs it)
 * @param {number} nowSec
 * @returns {{ canResolve: boolean, canCancel: boolean, canEdit: boolean }}
 */
export function oracleActionLegality(feed, nowSec) {
    const status = feed?.feed_status;
    return {
        canResolve: status === 'closed' && Number(feed?.expire_at) > nowSec,
        canCancel: status === 'open' || status === 'closed',
        canEdit: status === 'open'
            && String(feed?.source || '') === String(feed?.owner?.address || ''),
    };
}

/**
 * The line that says what an oracle's market is waiting for, or null once
 * the market is terminal: a finished market kept counting down to a close
 * that cannot happen and a refund that already did.
 *
 * @param {any} feed
 * @param {number} nowSec
 * @param {{ waiting?: boolean }} [opts]  `waiting` words a closed market as
 *   waiting on the oracle's result (the market page) instead of its clocks
 * @returns {string | null}
 */
export function oracleTimingText(feed, nowSec, { waiting = false } = {}) {
    const { canResolve, canCancel } = oracleActionLegality(feed, nowSec);
    if (!canCancel) return null;
    if (waiting && feed.feed_status === 'closed') {
        return canResolve
            ? `Waiting for your result; refunds everyone ${countdownLabel(feed.expire_at, nowSec)} if unresolved`
            : 'Waiting for your result; the refund window has ended';
    }
    return `Purchases close ${countdownLabel(feed.deadline, nowSec)}; refunds everyone ${countdownLabel(feed.expire_at, nowSec)} if unresolved`;
}

/**
 * The markets this wallet's addresses run, with the owner record each
 * oracle action signs from, re-read every 30 seconds while mounted. The
 * console lists them with their actions; Bet Markets' My markets tab reads
 * its own creator list so it can share the All tab's filters.
 *
 * @param {{ walletId: string, accountId?: string, messaging: any }} args
 * @returns {{ rows: any[] | null, error: string | null, refreshing: boolean, reload: (background?: boolean) => Promise<void> }}
 */
export function useOracleMarkets({ walletId, accountId, messaging }) {
    const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [refreshing, setRefreshing] = useState(false);
    const loadSequence = useRef(0);

    const reload = useCallback(async (background = false) => {
        const sequence = ++loadSequence.current;
        if (typeof messaging?.getAddressesByChain !== 'function' || typeof messaging?.betFeeds !== 'function') {
            setError('Markets are unavailable in this wallet.');
            if (!background) setRows([]);
            return;
        }
        if (background) setRefreshing(true);
        else setRows(null);
        setError(null);
        try {
            const chains = (await messaging.getAddressesByChain(walletId, accountId)) || {};
            const pairs = [];
            for (const [chainId, addrs] of Object.entries(chains)) {
                for (const a of addrs || []) pairs.push({ chainId, address: a.address, addr: a });
            }
            const results = await Promise.all(pairs.map((p) => messaging
                .betFeeds({ chainId: p.chainId, query: p.address, type: 'source', opts: { limit: 100 } })
                .then((r) => ({ p, feeds: extractRows(r) }))
                .catch((requestError) => ({ p, feeds: [], requestError }))));
            if (sequence !== loadSequence.current) return;
            const failures = results.filter((entry) => entry.requestError);
            if (pairs.length > 0 && failures.length === pairs.length) {
                throw new Error('No market source answered.');
            }
            const seen = new Set();
            const all = [];
            for (const r of results) {
                for (const f of r.feeds) {
                    const key = `${r.p.chainId}:${f.action_index}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    all.push({ ...f, chainId: r.p.chainId, owner: r.p.addr });
                }
            }
            // Markets needing action first: a market past its deadline and still
            // unresolved is the one thing an oracle must not miss.
            const rank = (f) => (f.feed_status === 'closed' ? 0 : f.feed_status === 'open' ? 1 : 2);
            all.sort((a, b) => (rank(a) - rank(b)) || (Number(b.action_index || 0) - Number(a.action_index || 0)));
            setRows(all);
            if (failures.length > 0) {
                setError(background
                    ? 'Some markets could not be refreshed. The available markets are shown below.'
                    : 'Some markets could not be loaded. The available markets are shown below.');
            }
        } catch {
            if (sequence !== loadSequence.current) return;
            setError(background
                ? 'Could not refresh your markets. The last known markets are still shown.'
                : 'Could not load your markets. Check your connection and try again.');
            if (!background) setRows([]);
        } finally {
            if (sequence === loadSequence.current) setRefreshing(false);
        }
    }, [walletId, accountId, messaging]);

    useEffect(() => {
        reload(false);
        const timer = setInterval(() => reload(true), 30_000);
        return () => {
            clearInterval(timer);
            loadSequence.current += 1;
        };
    }, [reload]);

    return { rows, error, refreshing, reload };
}

/**
 * The oracle's own actions on one market at a time: publish the result,
 * cancel and refund, and edit the address lists, each through its inline
 * form and the shared confirm page. The console uses it per market row, and
 * the market page's owner Actions tab uses it for the one market shown.
 *
 * Every flow composes through the SDK host-side, so the confirm screen
 * decodes what was actually composed. No native-fee lane here on purpose:
 * edit (v4), resolve (v3), and cancel (v1) are FREE by protocol design.
 * Resolve and cancel credits were pre-funded when the bet was placed. Only
 * the two fee-bearing formats carry the toggle (create in CreateBetFeedForm,
 * place in BetFeedDetail); adding it here would ask a user to pay a fee the
 * chain never charges.
 *
 * @param {object} args
 * @param {string} args.walletId
 * @param {{ blocked: boolean, refuse: () => void }} args.demoGuard  the page's own guard
 * @param {() => void} [args.onDone]   told after an action is sent (re-read the market)
 */
export function useOracleMarketActions({ walletId, demoGuard, onDone }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const { isWatcherMode } = useWalletMode();

    const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));
    const [active, setActive] = useState(/** @type {any} */ (null));
    const [outcome, setOutcome] = useState(/** @type {number | null} */ (null));
    const [allowList, setAllowList] = useState('');
    const [blockList, setBlockList] = useState('');
    // The edit form's list pickers (G114): which one is open, the names of the
    // lists picked, and the names of the market's current lists.
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));
    const [allowPick, setAllowPick] = useState(/** @type {{ index: string, name: unknown } | null} */ (null));
    const [blockPick, setBlockPick] = useState(/** @type {{ index: string, name: unknown } | null} */ (null));
    const [currentListNames, setCurrentListNames] = useState(/** @type {Record<string, string>} */ ({}));
    const [password, setPassword] = useState('');
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const formErrors = useFormErrors();
    const [result, setResult] = useState(/** @type {any} */ (null));
    // Watcher lane only: the build is not a confirm phase, so composing never
    // turns on. The ref stops a second tap in the same turn from building a
    // second unsigned transaction, and the state disables the button.
    const watcherBuildRef = useRef(false);
    const [watcherBuilding, setWatcherBuilding] = useState(false);

    useEffect(() => {
        const timer = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30000);
        return () => clearInterval(timer);
    }, []);

    const fromAddress = active?.owner || null;
    const feeChainId = active?.chainId || '';
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId: feeChainId, chainRegistry }),
        [feeChainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId: feeChainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [feeChainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers?.[feePick.mode]
            || estimateNativeSendFee({ chainId: feeChainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate?.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;
    const isHw = isDeviceAddressSource(fromAddress?.source);
    const signerReady = useSignerReady(walletId);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // The names of the open edit's current lists, so its list fields show a
    // name rather than a bare number.
    const editChainId = active?.mode === 'edit' ? active.chainId : null;
    const editCurrentAllow = active?.mode === 'edit' && active.allow_list ? String(active.allow_list) : null;
    const editCurrentBlock = active?.mode === 'edit' && active.block_list ? String(active.block_list) : null;
    useEffect(() => {
        if (!editChainId || typeof messaging?.getListByActionIndex !== 'function') return undefined;
        let live = true;
        [editCurrentAllow, editCurrentBlock].filter(Boolean).forEach((idx) => {
            Promise.resolve(messaging.getListByActionIndex({ chainId: editChainId, actionIndex: idx }))
                .then((detail) => {
                    const name = detail?.name;
                    if (live && typeof name === 'string' && name.length > 0) {
                        setCurrentListNames((prev) => ({ ...prev, [idx]: name }));
                    }
                })
                .catch(() => { /* best-effort: the number alone still reads */ });
        });
        return () => { live = false; };
    }, [editChainId, editCurrentAllow, editCurrentBlock, messaging]);

    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    // A real ref, not `{ current: password }`: Approve runs from the closure
    // captured when the confirm page OPENED, which is before the password on that
    // page has been typed. A fresh object per render leaves that closure holding
    // the empty string, so resolve and cancel both fail as a wrong password.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitResolve = useConfirmSubmit({
        messaging, isHw, signerId: fromAddress?.signerId, passwordRef: passwordValueRef,
        software: 'resolveMarketAction', hardware: 'resolveMarketActionHw',
    });
    const submitCancel = useConfirmSubmit({
        messaging, isHw, signerId: fromAddress?.signerId, passwordRef: passwordValueRef,
        software: 'cancelMarketAction', hardware: 'cancelMarketActionHw',
    });
    const submitEdit = useConfirmSubmit({
        messaging, isHw, signerId: fromAddress?.signerId, passwordRef: passwordValueRef,
        software: 'editBetFeedListsAction', hardware: 'editBetFeedListsActionHw',
    });

    function sourceDescriptor(owner) {
        return {
            address: owner.address,
            publicKey: owner.publicKey,
            derivationPath: owner.derivationPath,
            addressId: owner.id,
            source: owner.source,
            signerId: owner.signerId,
        };
    }

    async function runOracleAction(feed, builder, submit, params) {
        if (actionConfirm.composing || watcherBuildRef.current) return;
        // A demo wallet never composes; the press answers with the refusal.
        if (demoGuard?.blocked) { demoGuard.refuse(); return; }
        const from = sourceDescriptor(feed.owner);
        const selectsFee = builder === 'resolveMarketParams' || builder === 'cancelMarketParams';
        if (selectsFee) {
            const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
            if (feeStop) { setFormError(feeStop.formError); return; }
        }
        const feeOpts = selectsFee && feePerKb != null ? { feePerKb } : {};
        setFormError(null);
        setResult(null);
        try {
            if (isWatcherMode) {
                watcherBuildRef.current = true;
                setWatcherBuilding(true);
                try {
                    const res = await messaging.buildBetActionPsbtRequest({
                        chainId: feed.chainId,
                        from,
                        builder,
                        params,
                        ...feeOpts,
                    });
                    setResult(res);
                } finally {
                    watcherBuildRef.current = false;
                    setWatcherBuilding(false);
                }
                return;
            }
            const res = await actionConfirm.run({
                chainId: feed.chainId,
                from,
                compose: () => messaging.composeBetForConfirm({
                    walletId, chainId: feed.chainId, from, builder, params, ...feeOpts,
                }),
                onApprove: (prebuiltPsbt) => submit({
                    walletId, chainId: feed.chainId, from, params, prebuiltPsbt, ...feeOpts,
                }),
            });
            // The oracle actions once reported NOTHING on
            // success: the list simply reloaded, so publishing a result that pays
            // out an entire pot looked exactly like a click that did nothing. The
            // txid matters most on the losing side of a race - a resolve broadcast
            // as the refund window ends is judged by the block it lands in - and
            // without it there is no handle to look the attempt up by.
            setResult({
                mode: builder === 'cancelMarketParams' ? 'cancel'
                    : builder === 'editFeedListsParams' ? 'edit' : 'resolve',
                feedIndex: String(feed.action_index),
                txid: res?.txid || res?.tx_hash || null,
                queued: !!res?.queued,
            });
            setActive(null);
            setOutcome(null);
            setAllowList('');
            setBlockList('');
            setPassword('');
            onDone?.();
        } catch (err) {
            if (isUserRejection(err)) return;
            // These oracle actions are not fee-bearing, so this form has
            // no native-fee lane to describe - but it can still be handed an SDK
            // params-builder refusal, and those read as log lines until they go
            // through the shared mapper (D-118).
            setFormError(submitFailureMessage(err, { fallback: err?.message || 'Action failed.' }));
        }
    }

    /** Open one action's inline form for a market (`resolve`, `cancel` or `edit`). */
    function begin(feed, mode) {
        formErrors.reset();
        setActive({ ...feed, mode });
        setFeePick({ mode: 'normal' });
        setOutcome(null);
        if (mode === 'edit') {
            setAllowList('');
            setBlockList('');
        }
    }

    // Every oracle mutation goes through the same
    // confirm page every other action form uses. Without this page
    // `actionConfirm.run` opens a phase nothing draws: the oracle action never
    // reaches Approve, and the held confirm singleton makes every other form's
    // confirm reject as busy until the page unmounts.
    //
    // Decoded from what the HOST composed, so the screen names the format that
    // will actually broadcast rather than the row that was clicked.
    let confirmScreen = null;
    if (actionConfirm.open) {
        const cid = active?.chainId;
        // The market the oracle acts on, by its title, else its number.
        const marketName = neutralizeControlText(active?.label, { maxLength: 80 });
        const marketSummary = {
            verb: active?.mode === 'resolve'
                ? t('components.confirmSummary.verbResolveMarket')
                : active?.mode === 'cancel'
                    ? t('components.confirmSummary.verbCancelMarket')
                    : t('components.confirmSummary.verbEditMarket'),
            ...(marketName || active?.action_index != null
                ? { target: marketName || t('components.confirmSummary.marketTarget', { index: String(active.action_index) }) }
                : {}),
            direction: 'none',
            chainId: cid,
            address: fromAddress?.address,
        };
        confirmScreen = (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={marketSummary}
                screenVariant={variant}
                chainLabel={chainRegistry.get(cid)?.displayName || cid}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                hwSource={isHw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={cid}
                getSignerStatus={messaging.getSignerStatus}
                // (c): a resolve pays the pot out, and the composed bytes
                // name the winning outcome only by index. The labels come from
                // the market row being resolved, so the confirm screen states
                // which side the oracle is about to pay.
                outcomeLabels={outcomeLabelsOf(active)}
            />
        );
    }

    // The list picker takes the page like the confirm screen does, through the
    // same slot the hosts already render first.
    if (!confirmScreen && listPickerFor && active?.mode === 'edit') {
        const forAllow = listPickerFor === 'allow';
        confirmScreen = (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={active.chainId}
                addresses={fromAddress ? [fromAddress] : []}
                filterType="2"
                walletId={walletId}
                title={forAllow ? 'Choose Allow-List' : 'Choose Block-List'}
                onSelect={(row) => {
                    const pick = { index: String(row.actionIndex), name: row.name };
                    if (forAllow) { setAllowList(String(row.actionIndex)); setAllowPick(pick); }
                    else { setBlockList(String(row.actionIndex)); setBlockPick(pick); }
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    const unsigned = Boolean(result?.psbtHex && !result?.txid);
    const receipt = result && !unsigned ? (
        <div className={styles.listCard} data-testid="oracle-result">
            <p className={styles.summary}>
                {/* leg (a): signed and NOT broadcast. An oracle told "result sent"
                    for a transaction still sitting in the queue would wait out its own
                    refund window, which costs it the market. */}
                {result.queued
                    ? `Signed, but the ${result.mode === 'cancel' ? 'cancel' : result.mode === 'edit' ? 'list edit' : 'result'} for market `
                      + `#${result.feedIndex} could not reach the network just now. It is waiting in the `
                      + 'queued-transactions banner and only goes out when you broadcast it from there; '
                      + 'the wallet reminds you when the network is back. Do not submit it again.'
                    : result.mode === 'cancel'
                        ? `Cancel sent for market #${result.feedIndex}. Once the network records it, every open position is refunded in full.`
                        : result.mode === 'edit'
                            ? `List edit sent for market #${result.feedIndex}. Once the network records it, the new lists apply to future purchases.`
                            : `Result sent for market #${result.feedIndex}. Once the network records it, the pot is paid out and the positions settle.`}
            </p>
            {result.queued ? null : (
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Transaction ID</dt>
                    <dd className={styles.detailsValue}>{String(result.txid || 'n/a')}</dd>
                </dl>
            )}
        </div>
    ) : null;

    const passwordField = !isWatcherMode && !isHw && !signerReady ? (
        <Input id="oracle-action-password" label="Password" help="The password that unlocks this wallet on this device. It signs the oracle action you send from this page." type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
    ) : null;

    // An edit field's text and clear action: blank shows the market's current
    // list, '0' (the remove sentinel) shows none, anything else is the pick.
    const editListText = (value, pick, current) => {
        if (value === '0') return 'None after this update';
        if (value) return pickedListText(value, pick);
        return current ? pickedListText(String(current), { index: String(current), name: currentListNames[String(current)] }) : null;
    };
    const editListClear = (value, current, setValue, setPick, fieldId) => {
        if (value) return () => { setValue(''); setPick(null); formErrors.clear(fieldId); };
        return current ? () => { setValue('0'); setPick(null); formErrors.clear(fieldId); } : undefined;
    };

    /** The open action's inline form when it belongs to this market, else null. */
    function renderForm(f) {
        const key = `${f.chainId}:${f.action_index}`;
        if (!active || `${active.chainId}:${active.action_index}` !== key) return null;
        const labels = outcomeLabelsOf(f);
        if (active.mode === 'edit') {
            return (
                <FormErrorsContext.Provider value={formErrors}>
                <div className={consoleStyles.inlineForm}>
                    <FormErrorSummary form={formErrors} />
                    {/* Picker fields (G114). Blank keeps the market's current list,
                        shown by name; a pick replaces it; clear undoes a pick or,
                        on the current list, removes it ('0' is the remove sentinel). */}
                    <ListField
                        id="oracle-allow-list"
                        label="Allow list"
                        help="The address list whose members may buy positions. Leave it to keep the current list, or clear it to remove it. Changes affect future purchases only."
                        placeholder="None set"
                        valueText={editListText(allowList, allowPick, f.allow_list)}
                        onOpenPicker={() => setListPickerFor('allow')}
                        onClear={editListClear(allowList, f.allow_list, setAllowList, setAllowPick, 'oracle-allow-list')}
                        clearLabel={allowList || !f.allow_list ? 'Clear allow list' : 'Remove allow list'}
                    />
                    <ListField
                        id="oracle-block-list"
                        label="Block list"
                        help="The address list whose members may not buy positions. Leave it to keep the current list, or clear it to remove it. Changes affect future purchases only."
                        placeholder="None set"
                        valueText={editListText(blockList, blockPick, f.block_list)}
                        onOpenPicker={() => setListPickerFor('block')}
                        onClear={editListClear(blockList, f.block_list, setBlockList, setBlockPick, 'oracle-block-list')}
                        clearLabel={blockList || !f.block_list ? 'Clear block list' : 'Remove block list'}
                    />
                    {passwordField}
                    <Button
                        variant="success"
                        icon={<Icon.PencilIcon />}
                        loading={actionConfirm.composing || watcherBuilding}
                        onClick={() => {
                            if (!formErrors.validate({
                                'oracle-allow-list': !allowList.trim() && !blockList.trim()
                                    ? 'Choose an allow-list or block-list change.'
                                    : null,
                            })) return;
                            runOracleAction(f, 'editFeedListsParams', submitEdit, {
                                feedActionIndex: f.action_index,
                                allowList: allowList.trim(),
                                blockList: blockList.trim(),
                            });
                        }}
                    >
                        {isWatcherMode ? 'Create Unsigned Transaction' : 'Update Lists'}
                    </Button>
                </div>
                </FormErrorsContext.Provider>
            );
        }
        if (active.mode === 'resolve') {
            return (
                <FormErrorsContext.Provider value={formErrors}>
                <div className={consoleStyles.inlineForm}>
                    <FormErrorSummary form={formErrors} />
                    <div id={`winning-outcome-${key}`} className={consoleStyles.groupLabel}>
                        Which outcome actually happened?
                        <InfoTip label="The outcome that really happened. Publishing it settles the market." />
                    </div>
                    {/* Same colour-only selection as the place-bet picker, and worse
                        consequences: this choice pays the whole pot out one way and
                        cannot be undone. The selected outcome has to be announced.
                        The payout lines are the confirm screen's warnings card; a
                        watcher build has no confirm screen, so it shows them here. */}
                    {isWatcherMode ? <ActionWarningsCard ids={['MARKET_RESOLVE']} /> : null}
                    <div id={`oracle-outcome-${key}`} role="group" aria-label="Winning outcome" aria-describedby={`winning-outcome-${key}`} className={consoleStyles.outcomeRow}>
                        {labels.map((l, i) => {
                            const outcomeText = safeOutcomeLabel(l) || `Outcome ${i}`;
                            return (
                                <Button
                                    key={i}
                                    variant={outcome === i ? 'primary' : 'ghost'}
                                    size="md"
                                    icon={<Icon.CheckIcon />}
                                    aria-pressed={outcome === i}
                                    onClick={() => { setOutcome(i); formErrors.clear(`oracle-outcome-${key}`); }}
                                >
                                    {outcomeText}
                                </Button>
                            );
                        })}
                    </div>
                    <FeeSection
                        id="oracle-resolve-fee"
                        chainId={active.chainId}
                        coinTicker={protocolCoinTickerFor(active.chainId)}
                        tiers={feeTiers}
                        value={feePick}
                        onChange={(next) => { setFeePick(next); setFormError(null); }}
                        customEstimate={feeCustomEstimate}
                        advanced={false}
                        defaultOpen
                    />
                    {passwordField}
                    <Button
                        variant="success"
                        icon={<Icon.CheckIcon />}
                        loading={actionConfirm.composing || watcherBuilding}
                        onClick={() => {
                            if (!formErrors.validate({
                                [`oracle-outcome-${key}`]: outcome === null ? 'Choose the winning outcome.' : null,
                            })) return;
                            runOracleAction(f, 'resolveMarketParams', submitResolve, {
                                feedActionIndex: f.action_index, outcome, outcomes: labels,
                            });
                        }}
                    >
                        {isWatcherMode ? 'Create Unsigned Transaction' : 'Publish Result'}
                    </Button>
                </div>
                </FormErrorsContext.Provider>
            );
        }
        if (active.mode === 'cancel') {
            return (
                <div className={consoleStyles.inlineForm}>
                    <FeeSection
                        id="oracle-cancel-fee"
                        chainId={active.chainId}
                        coinTicker={protocolCoinTickerFor(active.chainId)}
                        tiers={feeTiers}
                        value={feePick}
                        onChange={(next) => { setFeePick(next); setFormError(null); }}
                        customEstimate={feeCustomEstimate}
                        advanced={false}
                        defaultOpen
                    />
                    {passwordField}
                    {/* The refund line is the confirm screen's warnings card; a
                        watcher build has no confirm screen, so it shows it here. */}
                    {isWatcherMode ? <ActionWarningsCard ids={['MARKET_CANCEL']} /> : null}
                    <Button
                        variant="danger"
                        icon={<Icon.XIcon />}
                        loading={actionConfirm.composing || watcherBuilding}
                        disabled={watcherBuilding}
                        onClick={() => runOracleAction(f, 'cancelMarketParams', submitCancel, {
                            feedActionIndex: f.action_index,
                        })}
                    >
                        {isWatcherMode ? 'Create Unsigned Transaction' : 'Cancel Market'}
                    </Button>
                </div>
            );
        }
        return null;
    }

    return {
        nowSec,
        active,
        begin,
        formError,
        result,
        unsigned,
        receipt,
        confirmScreen,
        renderForm,
        /** Leave the unsigned-transaction page (Build Another). */
        reset: () => { setResult(null); setActive(null); },
    };
}

/**
 * The operator's own betting markets as a standalone list: what each one is
 * waiting for, and the actions only its oracle can take. Bet Markets' My
 * markets tab no longer draws this console; it lists the same markets as its
 * plain cards, and each market's own page carries these actions on its owner
 * Actions tab (both through the hooks above).
 *
 * A market left unresolved past its refund window refunds everyone, which is
 * the honest outcome but a permanent mark on the address's public record.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {(chainId: string, feedIndex: string | number) => void} [props.onOpenMarket]
 * @param {(chainId: string, feedIndex: string | number) => void} [props.onDuplicate]  open a new market pre-filled from this one
 * @param {() => void} props.onBack
 */
export function OracleConsole({ walletId, accountId, onOpenMarket, onDuplicate, onBack }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);

    const markets = useOracleMarkets({ walletId, accountId, messaging });
    const { rows, error, refreshing } = markets;
    const actions = useOracleMarketActions({ walletId, demoGuard, onDone: () => markets.reload(true) });
    const { nowSec } = actions;

    const header = <PageHeader onBack={onBack} title="My Markets" />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (actions.confirmScreen) return actions.confirmScreen;

    if (actions.unsigned) {
        return wrap(
            <ListPage>
                <ResultScreen
                    state="unsigned"
                    result={actions.result}
                    onBuildAnother={actions.reset}
                    onDone={onBack}
                />
            </ListPage>,
        );
    }

    const refreshButton = (
        <Button type="button" variant="ghost" size="sm" icon={<Icon.RefreshIcon />} disabled={refreshing} onClick={() => markets.reload(true)}>
            {refreshing ? 'Refreshing Markets…' : 'Refresh Markets'}
        </Button>
    );

    return wrap(
        <ListPage notices={demoGuard.note || error || actions.formError ? (
            <>
                {demoGuard.note}
                {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
                {actions.formError ? <StatusMessage variant="error">{actions.formError}</StatusMessage> : null}
            </>
        ) : null} toolbar={refreshButton}>
            {demoGuard.dialog}
            {!rows ? <p>Loading your markets…</p> : null}
            {rows && rows.length === 0 && !error ? (
                <EmptyState
                    title="No markets yet"
                    body="Prediction markets created by this wallet appear here."
                />
            ) : null}
            {actions.receipt}
            {rows && rows.length > 0 ? (
                <div className={consoleStyles.marketList}>
                    {rows.map((f) => {
                        const key = `${f.chainId}:${f.action_index}`;
                        const { canResolve, canCancel, canEdit } = oracleActionLegality(f, nowSec);
                        const timing = oracleTimingText(f, nowSec);
                        const openMode = actions.active
                            && `${actions.active.chainId}:${actions.active.action_index}` === key
                            ? actions.active.mode
                            : null;
                        // One action list under each market's card (G101), in
                        // the market page's order: view, the result, cancel
                        // (danger), the lists, then the copy. A row that opens
                        // an inline form says so with aria-expanded.
                        const items = [
                            ...(onOpenMarket ? [{
                                id: 'view',
                                title: 'View market',
                                description: 'Open the market page with its positions and result',
                                icon: <Icon.EyeIcon />,
                                onClick: () => onOpenMarket(f.chainId, f.action_index),
                            }] : []),
                            ...(canResolve ? [{
                                id: 'resolve',
                                title: 'Resolve',
                                description: 'Publish the winning outcome so the market pays out',
                                icon: <Icon.CheckIcon />,
                                'aria-expanded': openMode === 'resolve',
                                onClick: () => actions.begin(f, 'resolve'),
                            }] : []),
                            ...(canCancel ? [{
                                id: 'cancel',
                                title: 'Cancel and refund',
                                description: 'End the market and refund every position',
                                icon: <Icon.XIcon />,
                                tone: 'danger',
                                'aria-expanded': openMode === 'cancel',
                                onClick: () => actions.begin(f, 'cancel'),
                            }] : []),
                            ...(canEdit ? [{
                                id: 'edit',
                                title: 'Edit lists',
                                description: 'Change the allow and block lists for participants',
                                icon: <Icon.PencilIcon />,
                                'aria-expanded': openMode === 'edit',
                                onClick: () => actions.begin(f, 'edit'),
                            }] : []),
                            // Terms stay immutable. This path copies them into a new market.
                            ...(onDuplicate ? [{
                                id: 'copy',
                                title: 'Copy to a new market',
                                description: 'Start a new market from these terms',
                                icon: <Icon.CopyIcon />,
                                onClick: () => onDuplicate(f.chainId, f.action_index),
                            }] : []),
                        ];
                        return (
                            <div key={key} className={consoleStyles.market} data-oracle-market={key}>
                                <div className={`${styles.listCard} ${consoleStyles.card}`}>
                                    <div className={consoleStyles.marketHeader}>
                                        <strong className={consoleStyles.marketTitle}>
                                            Market number: #{String(f.action_index)};{' '}
                                            {neutralizeControlText(f.label, { maxLength: 250 }) || 'Untitled market'}
                                        </strong>
                                        <span className={styles.hint}>Market status: {marketStatusLabel(f.feed_status)}</span>
                                    </div>
                                    {timing ? <div className={styles.hint}>{timing}</div> : null}
                                </div>
                                {items.length ? (
                                    <ActionList label={`Market #${String(f.action_index)} actions`} items={items} />
                                ) : null}
                                {actions.renderForm(f)}
                            </div>
                        );
                    })}
                </div>
            ) : null}
            {rows && rows.length > 0 ? <p className={styles.hint}>
                Your record as an oracle is public and tied to this address. Leaving a market unresolved
                refunds everyone, but it stays visible to anyone deciding whether to buy a position with you again.
            </p> : null}
        </ListPage>,
    );
}
