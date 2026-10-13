// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, Input, ListPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { outcomeLabelsOf } from '../utils/betOutcomeLabels.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import styles from './IssueTokenForm.module.css';
import consoleStyles from './OracleConsole.module.css';

const chainRegistry = registryLib.defaultRegistry();

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

function unwrap(resp) {
    if (!resp) return null;
    if (Array.isArray(resp)) return resp[0] || null;
    if (Array.isArray(resp.data)) return resp.data[0] || null;
    if (resp.data && typeof resp.data === 'object') return resp.data;
    return resp;
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
    if (status === 'open') return 'Taking bets';
    if (status === 'closed') return 'Betting closed, waiting for your result';
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
 * The operator's own betting markets: what each one is waiting for, and the
 * actions only its oracle can take.
 *
 * Resolve is only legal between the deadline and the end of the refund window,
 * and cancel only before the market reaches a terminal state, so each button is
 * offered only where the chain would actually accept it. A market left
 * unresolved past its refund window refunds everyone, which is the honest
 * outcome but a permanent mark on the address's public record.
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
    const variant = screenVariantFor(shell);
    const { isWatcherMode } = useWalletMode();

    const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));
    const [active, setActive] = useState(/** @type {any} */ (null));
    const [outcome, setOutcome] = useState(/** @type {number | null} */ (null));
    const [allowList, setAllowList] = useState('');
    const [blockList, setBlockList] = useState('');
    const [password, setPassword] = useState('');
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {{mode: string, feedIndex: string, txid: string | null, queued: boolean} | null} */ (null));
    const [refreshing, setRefreshing] = useState(false);
    const loadSequence = useRef(0);

    useEffect(() => {
        const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30000);
        return () => clearInterval(t);
    }, []);

    const load = useCallback(async (background = false) => {
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
        load(false);
        const timer = setInterval(() => load(true), 30_000);
        return () => {
            clearInterval(timer);
            loadSequence.current += 1;
        };
    }, [load]);

    const fromAddress = active?.owner || null;
    const isHw = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const signerReady = useSignerReady(walletId);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

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

    const outcomesOf = useMemo(() => (feed) => outcomeLabelsOf(feed), []);

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

    // Every flow composes through the SDK host-side, so the confirm
    // screen decodes what was actually composed. Params are derived once per
    // flow and handed to both compose and submit.
    //
    // No native-fee lane here on purpose: edit (v4), resolve (v3), and cancel
    // (v1) are FREE by protocol design. Resolve and cancel credits were pre-funded
    // when the bet was placed. Only the two fee-bearing formats carry the toggle
    // (create in CreateBetFeedForm, place in BetFeedDetail); adding it here would
    // ask a user to pay a fee the chain never charges.
    async function runOracleAction(feed, builder, submit, params) {
        const from = sourceDescriptor(feed.owner);
        setFormError(null);
        setResult(null);
        try {
            if (isWatcherMode) {
                const res = await messaging.buildBetActionPsbtRequest({
                    chainId: feed.chainId,
                    from,
                    builder,
                    params,
                });
                setResult(res);
                return;
            }
            const res = await actionConfirm.run({
                chainId: feed.chainId,
                from,
                compose: () => messaging.composeBetForConfirm({
                    walletId, chainId: feed.chainId, from, builder, params,
                }),
                onApprove: (prebuiltPsbt) => submit({
                    walletId, chainId: feed.chainId, from, params, prebuiltPsbt,
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
            load(true);
        } catch (err) {
            if (isUserRejection(err)) return;
            // These oracle actions are not fee-bearing, so this form has
            // no native-fee lane to describe - but it can still be handed an SDK
            // params-builder refusal, and those read as log lines until they go
            // through the shared mapper (D-118).
            setFormError(submitFailureMessage(err, { fallback: err?.message || 'Action failed.' }));
        }
    }

    const header = <PageHeader onBack={onBack} title="My markets" />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    // Every oracle mutation goes through the same
    // confirm page every other action form uses. Without this branch
    // `actionConfirm.run` opens a phase nothing draws: the oracle action never
    // reaches Approve, and the held confirm singleton makes every other form's
    // confirm reject as busy until this screen unmounts.
    //
    // Decoded from what the HOST composed, so the screen names the format that
    // will actually broadcast rather than the row that was clicked.
    if (actionConfirm.open) {
        const cid = active?.chainId;
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
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
                outcomeLabels={outcomesOf(active)}
            />
        );
    }

    if (result?.psbtHex && !result?.txid) {
        return wrap(
            <ListPage>
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={() => { setResult(null); setActive(null); }}
                    onDone={onBack}
                />
            </ListPage>,
        );
    }

    return wrap(
        <ListPage toolbar={(
            <Button type="button" variant="ghost" disabled={refreshing} onClick={() => load(true)}>
                {refreshing ? 'Refreshing markets…' : 'Refresh markets'}
            </Button>
        )}>
            {error ? <StatusMessage variant="error" className={styles.error}>{error}</StatusMessage> : null}
            {!rows ? <p>Loading your markets…</p> : null}
            {rows && rows.length === 0 && !error ? (
                <EmptyState
                    title="No markets yet"
                    body="Betting markets created by this wallet appear here."
                />
            ) : null}
            {formError ? <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage> : null}
            {result ? (
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
                                ? `Cancel sent for market #${result.feedIndex}. Once the network records it, every open bet is refunded in full.`
                                : result.mode === 'edit'
                                    ? `List edit sent for market #${result.feedIndex}. Once the network records it, the new lists apply to future bets.`
                                : `Result sent for market #${result.feedIndex}. Once the network records it, the pot is paid out and the bets settle.`}
                    </p>
                    {result.queued ? null : (
                        <dl className={styles.detailsList}>
                            <dt className={styles.detailsLabel}>Transaction ID</dt>
                            <dd className={styles.detailsValue}>{String(result.txid || 'n/a')}</dd>
                        </dl>
                    )}
                </div>
            ) : null}
            {rows && rows.length > 0 ? <div className={consoleStyles.marketList}>
                {rows.map((f) => {
                    const key = `${f.chainId}:${f.action_index}`;
                    const labels = outcomesOf(f);
                    // Resolve is legal only once betting has closed and before the
                    // refund window ends; cancel only before a terminal state.
                    const canResolve = f.feed_status === 'closed' && Number(f.expire_at) > nowSec;
                    const canCancel = f.feed_status === 'open' || f.feed_status === 'closed';
                    const canEdit = f.feed_status === 'open'
                        && String(f.source || '') === String(f.owner?.address || '');
                    const isActive = active && `${active.chainId}:${active.action_index}` === key;
                    return (
                        <div key={key} className={`${styles.listCard} ${consoleStyles.card}`}>
                            <div className={consoleStyles.marketHeader}>
                                <strong className={consoleStyles.marketTitle}>Market number: #{String(f.action_index)}; {f.label || 'Untitled market'}</strong>
                                <span className={styles.hint}>Market status: {marketStatusLabel(f.feed_status)}</span>
                            </div>
                            {/* Only while those two clocks still mean something. A
                                terminal market kept counting down to a close that
                                cannot happen and a refund that already did:
                                "Betting closes in 1h 12m · refunds everyone in 1d 1h
                                if unresolved", printed beside the word `cancelled`. */}
                            {canCancel ? (
                                <div className={styles.hint}>
                                    Betting closes {countdownLabel(f.deadline, nowSec)}; refunds everyone {countdownLabel(f.expire_at, nowSec)} if unresolved
                                </div>
                            ) : null}
                            <div className={`${styles.actions} ${consoleStyles.actionRow}`}>
                                {onOpenMarket ? (
                                    <Button variant="ghost" onClick={() => onOpenMarket(f.chainId, f.action_index)}>View market</Button>
                                ) : null}
                                {/* Terms stay immutable. This path copies them into a new market. */}
                                {onDuplicate ? (
                                    <Button variant="ghost" onClick={() => onDuplicate(f.chainId, f.action_index)}>Copy to a new market</Button>
                                ) : null}
                            </div>

                            {(canResolve || canCancel || canEdit) ? (
                                <div className={`${styles.actions} ${consoleStyles.actionRow}`}>
                                    {canEdit ? (
                                        <Button
                                            variant="ghost"
                                            onClick={() => {
                                                setActive({ ...f, mode: 'edit' });
                                                setOutcome(null);
                                                setAllowList('');
                                                setBlockList('');
                                            }}
                                        >
                                            Edit lists
                                        </Button>
                                    ) : null}
                                    {canResolve ? (
                                        <Button variant="primary" onClick={() => { setActive({ ...f, mode: 'resolve' }); setOutcome(null); }}>Resolve</Button>
                                    ) : null}
                                    {canCancel ? (
                                        <Button variant="ghost" onClick={() => { setActive({ ...f, mode: 'cancel' }); setOutcome(null); }}>Cancel and refund</Button>
                                    ) : null}
                                </div>
                            ) : null}

                            {isActive && active.mode === 'edit' ? (
                                <div className={consoleStyles.inlineForm}>
                                    <p className={styles.hint}>
                                        Leave a field blank to keep its current list, enter 0 to detach it, or enter
                                        a list action index to replace it. Changes affect future bets only.
                                    </p>
                                    <Input
                                        label="New allow-list index"
                                        value={allowList}
                                        placeholder={f.allow_list ? `Current: ${f.allow_list}` : 'No current allow list'}
                                        onChange={(e) => setAllowList(e.target.value)}
                                    />
                                    <Input
                                        label="New block-list index"
                                        value={blockList}
                                        placeholder={f.block_list ? `Current: ${f.block_list}` : 'No current block list'}
                                        onChange={(e) => setBlockList(e.target.value)}
                                    />
                                    {!isWatcherMode && !isHw && !signerReady ? (
                                        <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                                    ) : null}
                                    <Button
                                        variant="primary"
                                        disabled={!allowList.trim() && !blockList.trim()}
                                        onClick={() => runOracleAction(f, 'editFeedListsParams', submitEdit, {
                                            feedActionIndex: f.action_index,
                                            allowList: allowList.trim(),
                                            blockList: blockList.trim(),
                                        })}
                                    >
                                        {isWatcherMode ? 'Create unsigned transaction' : 'Review list edit'}
                                    </Button>
                                </div>
                            ) : null}

                            {isActive && active.mode === 'resolve' ? (
                                <div className={consoleStyles.inlineForm}>
                                    <div className={styles.hint}>Which outcome actually happened?</div>
                                    {/* Same colour-only selection as the place-bet picker, and worse
                                        consequences: this choice pays the whole pot out one way and
                                        cannot be undone. The selected outcome has to be announced. */}
                                    <div role="group" aria-label="Winning outcome" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', margin: '0.35rem 0' }}>
                                        {labels.map((l, i) => (
                                            <Button key={i} variant={outcome === i ? 'primary' : 'ghost'} aria-pressed={outcome === i} onClick={() => setOutcome(i)}>{l}</Button>
                                        ))}
                                    </div>
                                    {!isWatcherMode && !isHw && !signerReady ? (
                                        <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                                    ) : null}
                                    <p className={styles.hint}>
                                        This pays the market out. Everyone backing this outcome splits the pot and
                                        everyone else loses their stake. It cannot be undone or corrected.
                                    </p>
                                    <Button
                                        variant="primary"
                                        disabled={outcome === null}
                                        onClick={() => runOracleAction(f, 'resolveMarketParams', submitResolve, {
                                            feedActionIndex: f.action_index, outcome,
                                        })}
                                    >
                                        {isWatcherMode ? 'Create unsigned transaction' : 'Review resolve'}
                                    </Button>
                                </div>
                            ) : null}

                            {isActive && active.mode === 'cancel' ? (
                                <div className={consoleStyles.inlineForm}>
                                    {!isWatcherMode && !isHw && !signerReady ? (
                                        <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                                    ) : null}
                                    <p className={styles.hint}>
                                        Every open bet is refunded in full and the market is over. This is the honest
                                        exit for an event that was postponed or never happened.
                                    </p>
                                    <Button
                                        variant="primary"
                                        onClick={() => runOracleAction(f, 'cancelMarketParams', submitCancel, {
                                            feedActionIndex: f.action_index,
                                        })}
                                    >
                                        {isWatcherMode ? 'Create unsigned transaction' : 'Review cancel'}
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div> : null}
            {rows && rows.length > 0 ? <p className={styles.hint}>
                Your record as an oracle is public and tied to this address. Leaving a market unresolved
                refunds everyone, but it stays visible to anyone deciding whether to bet with you again.
            </p> : null}
        </ListPage>,
    );
}
