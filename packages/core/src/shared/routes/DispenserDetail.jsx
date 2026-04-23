import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Dispenser detail page — §40.7.1 management surface for a single
 * dispenser. Step 22a surfaces:
 *
 *   - Static metadata (rate, give/get coins + ticks, creator, memo,
 *     block + status) pulled via `dispensers.byActionIndex`.
 *   - Recent dispense events (fills) via `dispenses.query` with
 *     type='source' scoped to the dispenser's source address — the
 *     explorer doesn't yet have a by-dispenser-action-index dispense
 *     query.
 *   - For owners (source address is one of the wallet's addresses),
 *     a "Cancel dispenser" button that runs Step 21's v1 lane via
 *     `messaging.dispenserAction` with a password re-prompt.
 *
 * Live escrow balance + remaining-fills counts are deferred — the
 * indexer surface doesn't expose them yet (see xchain-explorer/src/
 * db.js getDispensers TODO).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.actionIndex
 * @param {() => void} props.onBack
 * @param {() => void} [props.onCanceled]           called after a successful cancel broadcast
 */
export function DispenserDetail({ walletId, chainId, actionIndex, onBack, onCanceled }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [dispenser, setDispenser] = useState(/** @type {any | null} */ (null));
    const [action, setAction] = useState(/** @type {any | null} */ (null));
    const [dispenses, setDispenses] = useState(/** @type {any[]} */ ([]));
    const [ownerAddress, setOwnerAddress] = useState(
        /** @type {any | null} */ (null),
    );
    const [buyerAddresses, setBuyerAddresses] = useState(/** @type {any[]} */ ([]));
    const [buyerAddressId, setBuyerAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [cancelStage, setCancelStage] = useState(
        /** @type {'idle' | 'confirm' | 'submitting' | 'done'} */ ('idle'),
    );
    const [password, setPassword] = useState('');
    const [cancelError, setCancelError] = useState(/** @type {string | null} */ (null));
    const [cancelResult, setCancelResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Buy-one-fill state (token-paid lane only; coin-paid uses the
    // instructions panel rather than a signed XChain SEND).
    const [fills, setFills] = useState('1');
    const [buyStage, setBuyStage] = useState(
        /** @type {'idle' | 'confirm' | 'submitting' | 'done'} */ ('idle'),
    );
    const [buyPassword, setBuyPassword] = useState('');
    const [buyError, setBuyError] = useState(/** @type {string | null} */ (null));
    const [buyResult, setBuyResult] = useState(/** @type {any | null} */ (null));
    const buyPasswordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const [copied, setCopied] = useState(/** @type {string | null} */ (null));

    const descriptor = chainRegistry.get(chainId);

    // Load the dispenser action + wallet addresses (to detect ownership)
    // in parallel. Recent dispenses come on a best-effort basis —
    // failure there still lets the user see the dispenser metadata.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        Promise.all([
            messaging.getDispenserByActionIndex({ chainId, actionIndex })
                .then((resp) => (cancelled ? null : resp))
                .catch((err) => { if (!cancelled) throw err; }),
            messaging.getAddressesByChain(walletId)
                .then((byChain) => (cancelled ? null : byChain))
                .catch(() => null),
        ]).then(([resp, addrsByChain]) => {
            if (cancelled) return;
            const act = pickAction(resp);
            const disp = pickDispenser(resp);
            if (!act) {
                setLoadError('Action not found.');
                setLoading(false);
                return;
            }
            setAction(act);
            setDispenser(disp);

            const source = disp?.source || act?.source;
            if (addrsByChain) {
                const onChain = (addrsByChain[chainId] || []);
                if (source) {
                    const matches = onChain.find((a) => a.address === source);
                    if (matches) setOwnerAddress(matches);
                }
                // Pre-populate the buyer-address picker with this wallet's
                // HD addresses on the dispenser's chain. Non-HD (watch-
                // only) addresses are filtered out because they can't
                // sign. The default is the newest external address,
                // matching the convention used by Send / MintForm.
                const spendable = onChain.filter(
                    (a) => a.source === 'hd'
                        && a.derivationPath?.split('/')?.[4] === '0',
                );
                setBuyerAddresses(spendable);
                if (spendable.length > 0) {
                    const sorted = [...spendable].sort((a, b) => {
                        const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                        const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                        return bi - ai;
                    });
                    setBuyerAddressId(sorted[0].id);
                }
            }
            setLoading(false);

            if (source) {
                messaging.getDispenses({ chainId, query: source, type: 'source' })
                    .then((d) => { if (!cancelled) setDispenses(extractRows(d)); })
                    .catch(() => { /* best-effort; detail still usable without dispenses */ });
            }
        }).catch((err) => {
            if (!cancelled) {
                setLoadError(err?.message || 'Failed to load dispenser.');
                setLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [walletId, chainId, actionIndex, messaging]);

    useEffect(() => {
        if (cancelStage === 'confirm') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [cancelStage]);

    useEffect(() => {
        if (buyStage === 'confirm') {
            setTimeout(() => buyPasswordRef.current?.focus(), 0);
        }
    }, [buyStage]);

    const cancelParams = useMemo(() => ({
        VERSION: '1',
        DISPENSER_ACTION_INDEX: String(actionIndex),
    }), [actionIndex]);

    const decodedCancel = useMemo(() => {
        if (cancelStage !== 'confirm' && cancelStage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'DISPENSER',
            params: cancelParams,
            chainId,
            chainRegistry,
        });
    }, [cancelStage, cancelParams, chainId]);

    // Buyer lanes:
    //   - Token-paid (dispenser.get_tick non-empty): triggered by an
    //     XChain SEND of GET_TICK to the dispenser address. Uses the
    //     existing messaging.sendAsset flow, so the wallet signs +
    //     broadcasts through the standard pipeline.
    //   - Coin-paid (dispenser.get_coin set, dispenser.get_tick empty):
    //     triggered by a bare native-coin payment to the dispenser
    //     address — "no XChain action needed from the buyer" per
    //     DISPENSER.md. The wallet doesn't yet have a bare-coin-send
    //     path, so this lane renders a pay-here instruction panel that
    //     works with any native coin wallet (including this one, via
    //     future native-send infrastructure).
    const getTick = dispenser?.get_tick || '';
    const getCoin = dispenser?.get_coin || '';
    const getAmount = dispenser?.get_amount;
    const giveTick = dispenser?.give_tick;
    const giveAmount = dispenser?.give_amount;
    const dispAddr = dispenser?.address;
    const isTokenPaid = Boolean(getTick) && !!getAmount;
    const isCoinPaid = !getTick && Boolean(getCoin) && !!getAmount;
    const canBuyWithSend = isTokenPaid && buyerAddresses.length > 0 && !ownerAddress;
    const showPayHere = isCoinPaid && !ownerAddress;

    const fillsNum = useMemo(() => {
        const n = Number(String(fills).trim());
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }, [fills]);

    const totalPayAmount = useMemo(() => {
        if (!getAmount || fillsNum <= 0) return null;
        const base = Number(getAmount);
        if (!Number.isFinite(base)) return null;
        // Protocol `GET_AMOUNT` is a string; multiplying with floats is
        // precision-risky for small satoshi fractions, but the detail
        // page is display-only — downstream SEND composition sends the
        // exact stringified value and relies on the SDK for precision.
        return (base * fillsNum).toString();
    }, [getAmount, fillsNum]);

    const totalReceive = useMemo(() => {
        if (!giveAmount || fillsNum <= 0) return null;
        const base = Number(giveAmount);
        if (!Number.isFinite(base)) return null;
        return (base * fillsNum).toString();
    }, [giveAmount, fillsNum]);

    async function handleCopy(text, label) {
        try {
            await navigator.clipboard?.writeText(text);
            setCopied(label);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            /* swallow — older browsers or locked-down contexts */
        }
    }

    const buyerAddress = useMemo(() => {
        if (!buyerAddressId) return null;
        return buyerAddresses.find((a) => a.id === buyerAddressId) || null;
    }, [buyerAddressId, buyerAddresses]);

    async function handleBuy(event) {
        event.preventDefault();
        if (buyStage === 'submitting' || buyPassword.length === 0 || !buyerAddress) return;
        if (!isTokenPaid || !dispAddr || !totalPayAmount) return;
        setBuyStage('submitting');
        setBuyError(null);
        try {
            const res = await messaging.sendAsset({
                walletId,
                password: buyPassword,
                chainId,
                from: {
                    address: buyerAddress.address,
                    publicKey: buyerAddress.publicKey,
                    derivationPath: buyerAddress.derivationPath,
                    addressId: buyerAddress.id,
                },
                to: dispAddr,
                asset: getTick,
                amount: totalPayAmount,
            });
            setBuyResult(res);
            setBuyPassword('');
            setBuyStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setBuyError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Buy failed.',
            );
            setBuyStage('confirm');
            buyPasswordRef.current?.focus();
            buyPasswordRef.current?.select();
        }
    }

    async function handleCancel(event) {
        event.preventDefault();
        if (cancelStage === 'submitting' || password.length === 0 || !ownerAddress) return;
        setCancelStage('submitting');
        setCancelError(null);
        try {
            const res = await messaging.dispenserAction({
                walletId,
                password,
                chainId,
                from: {
                    address: ownerAddress.address,
                    publicKey: ownerAddress.publicKey,
                    derivationPath: ownerAddress.derivationPath,
                    addressId: ownerAddress.id,
                },
                params: cancelParams,
            });
            setCancelResult(res);
            setPassword('');
            setCancelStage('done');
            onCanceled?.();
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setCancelError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Cancel failed.',
            );
            setCancelStage('confirm');
            passwordRef.current?.focus();
            passwordRef.current?.select();
        }
    }

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back"
            >
                ← Back
            </button>
            <span className={styles.title}>
                {cancelStage === 'confirm' || cancelStage === 'submitting'
                    ? 'Confirm cancel'
                    : buyStage === 'confirm' || buyStage === 'submitting'
                        ? 'Review buy'
                        : 'Dispenser detail'}
            </span>
            <span className={styles.spacer} />
        </div>
    );

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loading) return wrap(<p className={styles.hint}>Loading…</p>);
    if (loadError) return wrap(<div role="alert" className={styles.error}>{loadError}</div>);

    if (cancelStage === 'done') {
        const txid = cancelResult?.txid || cancelResult?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Cancel submitted</h2>
                <p className={styles.hint}>
                    The dispenser enters a 1-hour close window before remaining escrow is released.
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (buyStage === 'done') {
        const txid = buyResult?.txid || buyResult?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Buy submitted</h2>
                <p className={styles.hint}>
                    You paid {totalPayAmount} {getTick}. If the dispenser is still open
                    when this confirms, you should receive {totalReceive} {giveTick}.
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (buyStage === 'confirm' || buyStage === 'submitting') {
        return wrap(
            <form onSubmit={handleBuy} noValidate>
                <p className={styles.summary}>
                    Buy {fillsNum} fill{fillsNum === 1 ? '' : 's'} — pay {totalPayAmount} {getTick}
                    {' '}→ receive ~{totalReceive} {giveTick}
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={buyerAddress?.address || ''} />
                    </dd>
                    <dt className={styles.detailsLabel}>Dispenser</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={dispAddr || ''} />
                    </dd>
                    <dt className={styles.detailsLabel}>Per-fill price</dt>
                    <dd className={styles.detailsValue}>{getAmount} {getTick}</dd>
                    <dt className={styles.detailsLabel}>Per-fill give</dt>
                    <dd className={styles.detailsValue}>{giveAmount} {giveTick}</dd>
                </dl>
                <p className={styles.hint}>
                    The dispenser triggers when this SEND confirms. If the dispenser closes
                    or runs out before confirmation, the payment reaches the creator but
                    no {giveTick} is released — an inherent risk of UTXO-chain buys.
                </p>
                <Input
                    ref={buyPasswordRef}
                    type="password"
                    label="Password"
                    hint="Required to sign."
                    value={buyPassword}
                    onChange={(e) => {
                        setBuyPassword(e.target.value);
                        if (buyError) setBuyError(null);
                    }}
                    autoComplete="current-password"
                    disabled={buyStage === 'submitting'}
                    error={buyError || undefined}
                />
                <div className={styles.actions}>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setBuyStage('idle')}
                        disabled={buyStage === 'submitting'}
                    >
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={buyStage === 'submitting'}
                        disabled={buyPassword.length === 0}
                    >
                        {descriptor ? `Sign buy on ${descriptor.displayName}` : 'Sign buy'}
                    </Button>
                </div>
            </form>,
        );
    }

    if (cancelStage === 'confirm' || cancelStage === 'submitting') {
        return wrap(
            <form onSubmit={handleCancel} noValidate>
                <p className={styles.summary}>{decodedCancel?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={ownerAddress?.address || ''} />
                    </dd>
                    {(decodedCancel?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                </dl>
                {decodedCancel && decodedCancel.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decodedCancel.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                <Input
                    ref={passwordRef}
                    type="password"
                    label="Password"
                    hint="Required to sign the cancel."
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        if (cancelError) setCancelError(null);
                    }}
                    autoComplete="current-password"
                    disabled={cancelStage === 'submitting'}
                    error={cancelError || undefined}
                />
                <div className={styles.actions}>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setCancelStage('idle')}
                        disabled={cancelStage === 'submitting'}
                    >
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="danger"
                        loading={cancelStage === 'submitting'}
                        disabled={password.length === 0}
                    >
                        Sign cancel
                    </Button>
                </div>
            </form>,
        );
    }

    const rate = rateLabel(dispenser);
    const source = dispenser?.source || action?.source;
    const dispAddress = dispenser?.address;
    const matchingDispenses = dispenses.filter(
        (d) => String(d.get_tick || dispenser?.get_tick) === String(dispenser?.get_tick)
            && String(d.give_tick || dispenser?.give_tick) === String(dispenser?.give_tick),
    );

    return wrap(
        <>
            <p className={styles.summary}>
                {dispenser?.give_tick ? `${dispenser.give_tick} Dispenser` : 'Dispenser'}
                {descriptor ? ` on ${descriptor.displayName}` : ''}
            </p>
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Rate</dt>
                <dd className={styles.detailsValue}>{rate}</dd>
                {source ? (
                    <>
                        <dt className={styles.detailsLabel}>Creator</dt>
                        <dd className={styles.detailsValue}>
                            <AddressText address={source} />
                            {ownerAddress ? ' (you)' : ''}
                        </dd>
                    </>
                ) : null}
                {dispAddress && dispAddress !== source ? (
                    <>
                        <dt className={styles.detailsLabel}>Dispenser address</dt>
                        <dd className={styles.detailsValue}>
                            <AddressText address={dispAddress} />
                        </dd>
                    </>
                ) : null}
                <dt className={styles.detailsLabel}>Status</dt>
                <dd className={styles.detailsValue}>{String(dispenser?.status || '—')}</dd>
                {dispenser?.block_index ? (
                    <>
                        <dt className={styles.detailsLabel}>Opened at block</dt>
                        <dd className={styles.detailsValue}>{dispenser.block_index}</dd>
                    </>
                ) : null}
                {dispenser?.memo ? (
                    <>
                        <dt className={styles.detailsLabel}>Memo</dt>
                        <dd className={styles.detailsValue}>{dispenser.memo}</dd>
                    </>
                ) : null}
                <dt className={styles.detailsLabel}>Action index</dt>
                <dd className={styles.detailsValue}>#{actionIndex}</dd>
            </dl>

            <p className={styles.hint}>
                Remaining escrow and dispense count aren't published by the indexer yet.
                Watch this surface for updates as the indexer fills in dispenser state.
            </p>

            {matchingDispenses.length > 0 ? (
                <section style={{ marginTop: '1rem' }}>
                    <p className={styles.successLabel}>Recent dispenses</p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {matchingDispenses.slice(0, 10).map((d) => (
                            <li key={String(d.action_index)} style={{ padding: '0.25rem 0' }}>
                                <code>#{d.action_index}</code>
                                {' '}
                                {d.give_amount ?? '?'} {d.give_tick || ''}
                                {' → '}
                                <AddressText address={d.destination || d.address || '?'} />
                                {d.status ? ` (${d.status})` : ''}
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            {canBuyWithSend ? (
                <section style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid var(--xc-border)', borderRadius: '4px' }}>
                    <p className={styles.successLabel}>Buy from this dispenser</p>
                    <p className={styles.hint}>
                        Send {getAmount} {getTick} per fill. Tokens dispense when the SEND
                        confirms and the dispenser is still open.
                    </p>
                    {buyerAddresses.length > 1 ? (
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                            <span className={styles.detailsLabel}>Pay from</span>
                            <select
                                value={buyerAddressId || ''}
                                onChange={(e) => setBuyerAddressId(e.target.value)}
                                style={{ marginLeft: '0.5rem' }}
                            >
                                {buyerAddresses.map((a) => (
                                    <option key={a.id} value={a.id}>{a.address}</option>
                                ))}
                            </select>
                        </label>
                    ) : buyerAddress ? (
                        <p className={styles.entryDescription}>
                            Paying from <AddressText address={buyerAddress.address} />
                        </p>
                    ) : null}
                    <Input
                        label="Fills"
                        hint="Multiply per-fill amounts by this number (integer ≥ 1)."
                        inputMode="numeric"
                        value={fills}
                        onChange={(e) => setFills(e.target.value)}
                        autoComplete="off"
                    />
                    <Button
                        variant="primary"
                        onClick={() => setBuyStage('confirm')}
                        disabled={fillsNum <= 0 || !buyerAddress || !dispAddr}
                    >
                        Buy {fillsNum > 0 ? `${fillsNum} ` : ''}fill{fillsNum === 1 ? '' : 's'}
                    </Button>
                </section>
            ) : null}

            {showPayHere ? (
                <section style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid var(--xc-border)', borderRadius: '4px' }}>
                    <p className={styles.successLabel}>Pay to buy</p>
                    <p className={styles.hint}>
                        This dispenser accepts bare {getCoin} payments — any {getCoin} wallet
                        can trigger a fill. Send exactly {getAmount} {getCoin} per fill to
                        the dispenser address.
                    </p>
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Send to</dt>
                        <dd className={styles.detailsValue}>
                            <code style={{ wordBreak: 'break-all' }}>{dispAddr}</code>
                            {' '}
                            <button
                                type="button"
                                onClick={() => handleCopy(dispAddr, 'address')}
                                style={{ marginLeft: '0.5rem' }}
                            >
                                {copied === 'address' ? 'Copied' : 'Copy'}
                            </button>
                        </dd>
                        <dt className={styles.detailsLabel}>Send exactly</dt>
                        <dd className={styles.detailsValue}>
                            <code>{getAmount} {getCoin}</code>
                            {' '}
                            <button
                                type="button"
                                onClick={() => handleCopy(String(getAmount), 'amount')}
                                style={{ marginLeft: '0.5rem' }}
                            >
                                {copied === 'amount' ? 'Copied' : 'Copy amount'}
                            </button>
                            {' per fill'}
                        </dd>
                        <dt className={styles.detailsLabel}>Per-fill give</dt>
                        <dd className={styles.detailsValue}>{giveAmount} {giveTick}</dd>
                    </dl>
                    <p className={styles.hint}>
                        Native-coin sending from this wallet is on the roadmap; for now,
                        use any {getCoin} wallet to trigger the dispense.
                    </p>
                </section>
            ) : null}

            <div className={styles.actions}>
                <Button variant="ghost" onClick={onBack}>Back</Button>
                {ownerAddress ? (
                    <Button
                        variant="danger"
                        onClick={() => setCancelStage('confirm')}
                    >
                        Cancel dispenser
                    </Button>
                ) : null}
            </div>
        </>,
    );
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}

function rateLabel(row) {
    if (!row) return '—';
    const give = `${row.give_amount ?? '?'} ${row.give_tick || '?'}`;
    const coin = row.get_coin || '';
    const tick = row.get_tick || '';
    const amt = row.get_amount ?? '?';
    const payAsset = tick || coin || '?';
    return `${give} per ${amt} ${payAsset}`;
}

function pickAction(resp) {
    if (!resp) return null;
    if (resp.action) return resp.action;
    if (Array.isArray(resp.data) && resp.data.length > 0) return resp.data[0];
    return resp;
}

function pickDispenser(resp) {
    if (!resp) return null;
    if (resp.dispenser) return resp.dispenser;
    if (resp.data && resp.data.dispenser) return resp.data.dispenser;
    // Many explorer endpoints flatten DISPENSER fields onto the action.
    if (resp.give_tick || resp.get_amount) return resp;
    if (Array.isArray(resp.data) && resp.data.length > 0) return resp.data[0];
    return null;
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}
