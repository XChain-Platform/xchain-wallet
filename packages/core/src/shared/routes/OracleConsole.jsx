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
import { Screen, PageHeader, Button, Input } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { outcomeLabelsOf } from '../utils/betOutcomeLabels.js';
import styles from './IssueTokenForm.module.css';

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
    if (d <= 0) return 'passed';
    const days = Math.floor(d / 86400);
    const hours = Math.floor((d % 86400) / 3600);
    const mins = Math.floor((d % 3600) / 60);
    if (days > 0) return `in ${days}d ${hours}h`;
    if (hours > 0) return `in ${hours}h ${mins}m`;
    return `in ${mins}m`;
}

/**
 * The operator's own betting markets: what each one is waiting for, and the two
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
    const [password, setPassword] = useState('');
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30000);
        return () => clearInterval(t);
    }, []);

    const load = useCallback(async () => {
        if (typeof messaging?.getAddressesByChain !== 'function' || typeof messaging?.betFeeds !== 'function') {
            setRows([]); return;
        }
        setRows(null);
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
                .catch(() => ({ p, feeds: [] }))));
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
        } catch (err) {
            setError(err?.message || 'Failed to load your markets.');
            setRows([]);
        }
    }, [walletId, accountId, messaging]);

    useEffect(() => { load(); }, [load]);

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

    // Both flows compose through the SDK's own builder host-side, so the confirm
    // screen decodes what was actually composed. Params are derived once per
    // flow and handed to both compose and submit.
    //
    // No native-fee lane here on purpose : resolve (v3) and cancel (v1)
    // are FREE by protocol design, because every credit they emit was pre-funded
    // when the bet was placed. Only the two fee-bearing formats carry the toggle
    // (create in CreateBetFeedForm, place in BetFeedDetail); adding it here would
    // ask a user to pay a fee the chain never charges.
    async function runOracleAction(feed, builder, submit, params) {
        const from = sourceDescriptor(feed.owner);
        setFormError(null);
        try {
            await actionConfirm.run({
                chainId: feed.chainId,
                from,
                compose: () => messaging.composeBetForConfirm({
                    walletId, chainId: feed.chainId, from, builder, params,
                }),
                onApprove: (prebuiltPsbt) => submit({
                    walletId, chainId: feed.chainId, from, params, prebuiltPsbt,
                }),
            });
            setActive(null);
            setOutcome(null);
            setPassword('');
            load();
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(err?.message || 'Action failed.');
        }
    }

    const header = <PageHeader onBack={onBack} title="My markets" />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    // Resolve and cancel both settle real money, so they go through the same
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

    if (error) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{error}</div>
            </>,
        );
    }
    if (!rows) return wrap(<p>Loading your markets…</p>);
    if (rows.length === 0) {
        return wrap(<p className={styles.hint}>You have not created any betting markets.</p>);
    }

    return wrap(
        <>
            {formError ? <div role="alert" className={styles.error}>{formError}</div> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {rows.map((f) => {
                    const key = `${f.chainId}:${f.action_index}`;
                    const labels = outcomesOf(f);
                    // Resolve is legal only once betting has closed and before the
                    // refund window ends; cancel only before a terminal state.
                    const canResolve = f.feed_status === 'closed' && Number(f.expire_at) > nowSec;
                    const canCancel = f.feed_status === 'open' || f.feed_status === 'closed';
                    const isActive = active && `${active.chainId}:${active.action_index}` === key;
                    return (
                        <div key={key} className={styles.card}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                                <strong>#{String(f.action_index)} {f.label || '(untitled)'}</strong>
                                <span className={styles.hint}>{f.feed_status}</span>
                            </div>
                            {/* Only while those two clocks still mean something. A
                                terminal market kept counting down to a close that
                                cannot happen and a refund that already did:
                                "Betting closes in 1h 12m · refunds everyone in 1d 1h
                                if unresolved", printed beside the word `cancelled`. */}
                            {canCancel ? (
                                <div className={styles.hint}>
                                    Betting closes {countdown(f.deadline, nowSec)} · refunds everyone {countdown(f.expire_at, nowSec)} if unresolved
                                </div>
                            ) : null}
                            <div className={styles.actions} style={{ gap: '0.5rem' }}>
                                {onOpenMarket ? (
                                    <Button variant="ghost" onClick={() => onOpenMarket(f.chainId, f.action_index)}>View market</Button>
                                ) : null}
                                {/* A market cannot be edited, so fixing wrong terms means
                                    cancelling and opening a corrected copy. This is that
                                    path: it pre-fills the create form from these terms. */}
                                {onDuplicate ? (
                                    <Button variant="ghost" onClick={() => onDuplicate(f.chainId, f.action_index)}>Copy to a new market</Button>
                                ) : null}
                            </div>

                            {!isWatcherMode && (canResolve || canCancel) ? (
                                <div className={styles.actions} style={{ gap: '0.5rem' }}>
                                    {canResolve ? (
                                        <Button variant="primary" onClick={() => { setActive({ ...f, mode: 'resolve' }); setOutcome(null); }}>Resolve</Button>
                                    ) : null}
                                    {canCancel ? (
                                        <Button variant="ghost" onClick={() => { setActive({ ...f, mode: 'cancel' }); setOutcome(null); }}>Cancel and refund</Button>
                                    ) : null}
                                </div>
                            ) : null}

                            {/* Say why the buttons are gone. Removing them silently leaves an
                                oracle staring at a market it opened with no way to finish it and
                                no reason given, and the cost of not knowing is real: an
                                unresolved market refunds every bet at expiry and earns no fee.
                                CreateBetFeedForm already says this plainly for its own case. */}
                            {isWatcherMode && (canResolve || canCancel) ? (
                                <div className={styles.hint}>
                                    This wallet is in watcher mode, so it cannot resolve or cancel this market.
                                    Both need the key that opened it.
                                </div>
                            ) : null}

                            {isActive && active.mode === 'resolve' ? (
                                <div style={{ marginTop: '0.5rem' }}>
                                    <div className={styles.hint}>Which outcome actually happened?</div>
                                    {/* Same colour-only selection as the place-bet picker, and worse
                                        consequences: this choice pays the whole pot out one way and
                                        cannot be undone. The selected outcome has to be announced. */}
                                    <div role="group" aria-label="Winning outcome" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', margin: '0.35rem 0' }}>
                                        {labels.map((l, i) => (
                                            <Button key={i} variant={outcome === i ? 'primary' : 'ghost'} aria-pressed={outcome === i} onClick={() => setOutcome(i)}>{l}</Button>
                                        ))}
                                    </div>
                                    {!isHw && !signerReady ? (
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
                                        Review resolve
                                    </Button>
                                </div>
                            ) : null}

                            {isActive && active.mode === 'cancel' ? (
                                <div style={{ marginTop: '0.5rem' }}>
                                    {!isHw && !signerReady ? (
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
                                        Review cancel
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
            <p className={styles.hint}>
                Your record as an oracle is public and tied to this address. Leaving a market unresolved
                refunds everyone, but it stays visible to anyone deciding whether to bet with you again.
            </p>
        </>,
    );
}
