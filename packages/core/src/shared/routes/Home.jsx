import { useCallback, useEffect, useState } from 'react';
import { Screen, Button } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useAutoLock } from '../hooks/useAutoLock.js';
import { ChainBalanceCard } from '../components/ChainBalanceCard.jsx';
import styles from './Home.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Home screen — landing view for an unlocked wallet. Header shows the
 * wallet name + Lock button; body renders a per-chain balance card
 * grid; footer exposes Send / Receive / Create-a-token action buttons.
 *
 * When the wallet has pending §40.9 airdrops (LIST signed but AIRDROP
 * still pending, either waiting for the LIST to be indexed or ready
 * to sign), Home surfaces a resume card above the balance grid so the
 * user can pick up where they left off.
 *
 * Auto-lock is foreground-only and enabled for the popup shell only;
 * web tabs opt out today because their session lifetime already caps
 * with tab close. See `useAutoLock` for the scope limitation.
 *
 * @param {object} props
 * @param {() => void} [props.onLocked]        refresh upstream state machine
 * @param {() => void} [props.onSend]          navigate to Send sub-route
 * @param {() => void} [props.onReceive]       navigate to Receive sub-route
 * @param {() => void} [props.onCreateToken]   navigate to Token Wizard sub-route (§40.1)
 * @param {() => void} [props.onActions]       navigate to the Actions menu (§40.2+)
 * @param {() => void} [props.onMarkets]       navigate to the Markets list (§41.2)
 * @param {(id: string) => void} [props.onResumeAirdrop]  navigate to AirdropForm with a pending id
 * @param {(ref: { chainId: string, address: string, orderMatchActionIndex: string }) => void} [props.onResumeCoinpay]  navigate to CoinpayForm with a pending obligation (§41.4)
 * @param {() => void} [props.onMessaging]     navigate to the Messaging inbox (§41.7.2)
 * @param {() => void} [props.onContracts]     navigate to the Contracts list (§42.2) — BTC-only, App.jsx gates the prop
 * @param {() => void} [props.onMigrateToBip39]           navigate to the §40.13 migration wizard when the active wallet is counterwallet-legacy
 */
export function Home({ onLocked, onSend, onReceive, onCreateToken, onActions, onMarkets, onResumeAirdrop, onResumeCoinpay, onMessaging, onContracts, onMigrateToBip39 }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [wallets, setWallets] = useState(/** @type {any[] | null} */ (null));
    const [activeWalletId, setActiveWalletId] = useState(
        /** @type {string | null} */ (null),
    );
    const [balances, setBalances] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [pendingAirdrops, setPendingAirdrops] = useState(
        /** @type {any[]} */ ([]),
    );
    const [pendingCoinpays, setPendingCoinpays] = useState(
        /** @type {any[]} */ ([]),
    );
    const [loadError, setLoadError] = useState(
        /** @type {string | null} */ (null),
    );
    const [locking, setLocking] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const list = await messaging.listWallets();
                if (cancelled) return;
                setWallets(list);
                if (!Array.isArray(list) || list.length === 0) {
                    setLoadError('No wallets found.');
                    return;
                }
                const walletId = list[0].id;
                setActiveWalletId(walletId);
                try {
                    const b = await messaging.getWalletBalances(walletId);
                    if (!cancelled) setBalances(b);
                } catch (err) {
                    if (!cancelled) {
                        setLoadError(err?.message || 'Failed to load balances.');
                    }
                }
                if (typeof messaging.listPendingAirdropsForWallet === 'function') {
                    try {
                        const records = await messaging.listPendingAirdropsForWallet({ walletId });
                        if (!cancelled) {
                            const resumable = (records || []).filter(
                                (r) => r.stage === 'waiting-index' || r.stage === 'ready-to-airdrop',
                            );
                            setPendingAirdrops(resumable);
                        }
                    } catch (err) {
                        // Non-fatal — resume card is a convenience, not core functionality.
                    }
                }
                if (typeof messaging.getCoinpayObligationsForAddress === 'function') {
                    try {
                        const byChain = await messaging.getAddressesByChain(walletId);
                        const pairs = [];
                        for (const [cId, addrs] of Object.entries(byChain || {})) {
                            for (const a of addrs) pairs.push({ chainId: cId, address: a.address });
                        }
                        const results = await Promise.all(pairs.map((p) =>
                            messaging.getCoinpayObligationsForAddress({
                                chainId: p.chainId, address: p.address,
                            })
                                .then((resp) => ({ ...p, rows: extractObligationRows(resp) }))
                                .catch(() => ({ ...p, rows: [] }))
                        ));
                        if (cancelled) return;
                        const obligations = [];
                        for (const r of results) {
                            for (const row of r.rows) {
                                if (!isPendingForPayer(row, r.address)) continue;
                                obligations.push({
                                    chainId: r.chainId,
                                    address: r.address,
                                    orderMatchActionIndex: String(row.action_index ?? row.actionIndex),
                                    coinAmount: row.coin_amount,
                                    payeeAddress: row.payee_address || row.payeeAddress,
                                    expiration: row.expiration,
                                });
                            }
                        }
                        setPendingCoinpays(obligations);
                    } catch (err) {
                        // Non-fatal.
                    }
                }
            } catch (err) {
                if (!cancelled) {
                    setLoadError(err?.message || 'Failed to load wallets.');
                }
            }
        })();
        return () => { cancelled = true; };
    }, [messaging]);

    const handleLock = useCallback(async () => {
        if (locking) return;
        setLocking(true);
        try {
            await messaging.lockWallet();
            onLocked?.();
        } catch (err) {
            setLoadError(err?.message || 'Lock failed.');
            setLocking(false);
        }
    }, [locking, onLocked, messaging]);

    useAutoLock(handleLock, { enabled: shell === 'popup' && !locking });

    const activeWallet = wallets && activeWalletId
        ? wallets.find((w) => w.id === activeWalletId)
        : null;
    const walletName = activeWallet?.name || branding.PRODUCT_NAME;

    const headerInner = isFull ? (
        <div className={styles.headerFull}>
            <span className={styles.titleFull}>{walletName}</span>
            <div className={styles.headerRight}>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLock}
                    loading={locking}
                >
                    Lock
                </Button>
            </div>
        </div>
    ) : (
        <div className={styles.headerPopup}>
            <span className={styles.titlePopup} title={walletName}>
                {walletName}
            </span>
            <Button
                variant="ghost"
                size="sm"
                onClick={handleLock}
                loading={locking}
            >
                Lock
            </Button>
        </div>
    );

    return (
        <Screen variant={variant} header={headerInner}>
            <div className={isFull ? styles.bodyFull : styles.bodyPopup}>
                {loadError ? (
                    <div role="alert" className={styles.error}>{loadError}</div>
                ) : null}

                {balances === null && !loadError ? (
                    <p className={styles.hint}>Loading balances…</p>
                ) : null}

                {activeWallet?.format === 'counterwallet-legacy' && onMigrateToBip39 ? (
                    <button
                        type="button"
                        className={styles.legacyBanner}
                        onClick={onMigrateToBip39}
                    >
                        <span className={styles.legacyBannerTitle}>
                            Legacy FreeWallet format
                        </span>
                        <span className={styles.legacyBannerHint}>
                            This wallet uses the 12-word Counterwallet format.
                            Tap to migrate to BIP39 (§40.13).
                        </span>
                    </button>
                ) : null}

                {pendingAirdrops.length > 0 && onResumeAirdrop ? (
                    <div role="group" aria-label="Pending airdrops">
                        {pendingAirdrops.map((rec) => (
                            <button
                                key={rec.id}
                                type="button"
                                className={styles.pendingAirdropCard}
                                onClick={() => onResumeAirdrop(rec.id)}
                            >
                                <span className={styles.pendingAirdropTitle}>
                                    Resume airdrop: {rec.amountPer} {rec.token} × {rec.recipients.length}
                                </span>
                                <span className={styles.pendingAirdropHint}>
                                    {rec.stage === 'waiting-index'
                                        ? 'LIST broadcast — waiting for index'
                                        : 'Ready to sign AIRDROP'}
                                </span>
                            </button>
                        ))}
                    </div>
                ) : null}

                {pendingCoinpays.length > 0 && onResumeCoinpay ? (
                    <div role="group" aria-label="Pending COINPAY obligations">
                        {pendingCoinpays.map((rec) => (
                            <button
                                key={`${rec.chainId}-${rec.orderMatchActionIndex}`}
                                type="button"
                                className={styles.pendingAirdropCard}
                                onClick={() => onResumeCoinpay({
                                    chainId: rec.chainId,
                                    address: rec.address,
                                    orderMatchActionIndex: rec.orderMatchActionIndex,
                                })}
                            >
                                <span className={styles.pendingAirdropTitle}>
                                    Pending COINPAY: pay {rec.coinAmount} for ORDER_MATCH #{rec.orderMatchActionIndex}
                                </span>
                                <span className={styles.pendingAirdropHint}>
                                    Sign COINPAY to settle the native-coin leg of your matched order.
                                </span>
                            </button>
                        ))}
                    </div>
                ) : null}

                {balances ? (
                    <div className={isFull ? styles.grid : styles.stack}>
                        {Object.entries(balances).map(([chainId, entries]) => {
                            const descriptor = chainRegistry.get(chainId);
                            if (!descriptor) return null;
                            return (
                                <ChainBalanceCard
                                    key={chainId}
                                    descriptor={descriptor}
                                    entries={entries}
                                />
                            );
                        })}
                    </div>
                ) : null}

                {balances && Object.keys(balances).length === 0 ? (
                    <p className={styles.hint}>
                        No addresses yet. Use Receive to generate one.
                    </p>
                ) : null}

                <div className={isFull ? styles.actionsFull : styles.actionsPopup}>
                    <Button
                        variant="primary"
                        block={!isFull}
                        onClick={onSend}
                        disabled={!onSend}
                    >
                        Send
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onReceive}
                        disabled={!onReceive}
                    >
                        Receive
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onCreateToken}
                        disabled={!onCreateToken}
                    >
                        Create a token
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onMarkets}
                        disabled={!onMarkets}
                    >
                        Markets
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onMessaging}
                        disabled={!onMessaging}
                    >
                        Messaging
                    </Button>
                    {onContracts ? (
                        <Button
                            variant="secondary"
                            block={!isFull}
                            onClick={onContracts}
                        >
                            Contracts
                        </Button>
                    ) : null}
                    <Button
                        variant="ghost"
                        block={!isFull}
                        onClick={onActions}
                        disabled={!onActions}
                    >
                        More actions
                    </Button>
                </div>
            </div>
        </Screen>
    );
}

function isPendingForPayer(row, address) {
    if (!row || typeof row !== 'object') return false;
    const status = String(row.coinpay_status || row.status || '').toLowerCase();
    if (status !== 'pending_coinpay') return false;
    const payer = row.payer_address || row.payerAddress;
    return typeof payer === 'string' && payer === address;
}

function extractObligationRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.obligations)) return resp.obligations;
    if (Array.isArray(resp.coinpay_obligations)) return resp.coinpay_obligations;
    return [];
}
