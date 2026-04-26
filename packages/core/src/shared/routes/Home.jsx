import { useCallback, useEffect, useState } from 'react';
import { Screen, Button, Icon } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useAutoLock } from '../hooks/useAutoLock.js';
import { UnifiedBalanceList } from '../components/UnifiedBalanceList.jsx';
import { HeaderActionMenu } from '../components/HeaderActionMenu.jsx';
import { AlertsOverlay } from '../components/AlertsOverlay.jsx';
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
 * @param {() => void} [props.onStaking]       navigate to the Staking dashboard (§42.7.4) — BTC-only, App.jsx gates the prop
 * @param {() => void} [props.onHistory]       navigate to the History route (§23 + §23.5 cross-chain threading)
 * @param {() => void} [props.onMigrateToBip39]           navigate to the §40.13 migration wizard when the active wallet is counterwallet-legacy
 * @param {Array<{ id: string, label: string, description?: string, onSelect?: () => void }>} [props.extraActions]   §40+ entries surfaced in the small-mode pancake drawer; in full mode the host renders these via the dedicated ActionsMenu route
 */
export function Home({ onLocked, onSend, onReceive, onCreateToken, onActions, onMarkets, onResumeAirdrop, onResumeCoinpay, onMessaging, onContracts, onStaking, onHistory, onAddresses, onMigrateToBip39, extraActions }) {
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
    const [multisig, setMultisig] = useState(
        /** @type {{ threshold: number, cosignerCount: number, scheme: string } | null} */ (null),
    );
    const [loadError, setLoadError] = useState(
        /** @type {string | null} */ (null),
    );
    const [locking, setLocking] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [alertsOpen, setAlertsOpen] = useState(false);

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
                // §22 multisig indicator (Step 22). Best-effort — the
                // call fails when no multisig is configured, which is
                // the typical state for a fresh wallet.
                if (typeof messaging.getMultisigReceiveAddress === 'function') {
                    const btcChain = chainRegistry.byCoin('bitcoin')[0]?.id;
                    if (btcChain) {
                        messaging.getMultisigReceiveAddress({ walletId, chainId: btcChain })
                            .then((r) => {
                                if (cancelled) return;
                                if (r && Number.isInteger(r.threshold)) {
                                    setMultisig({
                                        threshold: r.threshold,
                                        cosignerCount: r.cosignerCount,
                                        scheme: r.scheme,
                                    });
                                }
                            })
                            .catch(() => { /* no multisig configured — silent */ });
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

    // Wallet-level alerts surfaced in the pancake's Alerts panel.
    // Computed each render from the available signals; future alerts
    // (incoming message, order match settled, MuSig2 round needs
    // attention, etc.) drop into this array as they wire through
    // their own sources.
    const alerts = [];
    if (activeWallet?.format === 'counterwallet-legacy' && onMigrateToBip39) {
        alerts.push({
            id: 'legacy-format',
            severity: 'info',
            title: 'Legacy FreeWallet format',
            message: 'This wallet uses the 12-word Counterwallet format. Migrate to BIP39 for broader interop and stronger derivation.',
            action: { label: 'Migrate to BIP39', onSelect: onMigrateToBip39 },
        });
    }

    const brandBlock = (
        <img
            src={branding.logoUrl()}
            alt={branding.PRODUCT_NAME}
            className={isFull ? styles.brandLogoFull : styles.brandLogoPopup}
        />
    );

    const headerInner = isFull ? (
        <div className={styles.headerFull}>
            {brandBlock}
            <div className={styles.headerRight}>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLock}
                    loading={locking}
                    icon={<Icon.LockIcon />}
                >
                    Lock
                </Button>
            </div>
        </div>
    ) : (
        <div className={styles.headerPopup}>
            {brandBlock}
            <button
                type="button"
                className={styles.menuBtn}
                onClick={() => setMenuOpen(true)}
                aria-label="Open menu"
                aria-haspopup="dialog"
                aria-expanded={menuOpen ? 'true' : 'false'}
            >
                <Icon.MenuIcon />
            </button>
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

                {/* Inline notice removed — surfaces in the Alerts panel
                    of the pancake menu instead so the main view stays
                    focused on balances + work, not status banners. */}

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
                    <UnifiedBalanceList
                        chainRegistry={chainRegistry}
                        balances={balances}
                        multisig={multisig}
                        multisigChainId={chainRegistry.byCoin('bitcoin')[0]?.id}
                    />
                ) : null}

                {balances && Object.keys(balances).length === 0 ? (
                    <p className={styles.hint}>
                        No addresses yet. Use Receive to generate one.
                    </p>
                ) : null}

                {/* Action button grid is full-mode only. In small mode the
                    actions live in the pancake menu, freeing the body for
                    the balance list. */}
                {isFull ? (
                <div className={styles.actionsFull}>
                    <Button
                        variant="primary"
                        block={!isFull}
                        onClick={onSend}
                        disabled={!onSend}
                        icon={<Icon.SendIcon />}
                    >
                        Send
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onReceive}
                        disabled={!onReceive}
                        icon={<Icon.ReceiveIcon />}
                    >
                        Receive
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onCreateToken}
                        disabled={!onCreateToken}
                        icon={<Icon.TokenIcon />}
                    >
                        Create token
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onMarkets}
                        disabled={!onMarkets}
                        icon={<Icon.MarketIcon />}
                    >
                        Markets
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onMessaging}
                        disabled={!onMessaging}
                        icon={<Icon.MessageIcon />}
                    >
                        Messaging
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onHistory}
                        disabled={!onHistory}
                        icon={<Icon.HistoryIcon />}
                    >
                        History
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onAddresses}
                        disabled={!onAddresses}
                        icon={<Icon.AddressIcon />}
                    >
                        Addresses
                    </Button>
                    {onContracts ? (
                        <Button
                            variant="secondary"
                            block={!isFull}
                            onClick={onContracts}
                            icon={<Icon.ContractIcon />}
                        >
                            Contracts
                        </Button>
                    ) : null}
                    {onStaking ? (
                        <Button
                            variant="secondary"
                            block={!isFull}
                            onClick={onStaking}
                            icon={<Icon.StakeIcon />}
                        >
                            Staking
                        </Button>
                    ) : null}
                    <Button
                        variant="ghost"
                        block={!isFull}
                        onClick={onActions}
                        disabled={!onActions}
                        icon={<Icon.MoreIcon />}
                    >
                        More actions
                    </Button>
                </div>
                ) : null}
            </div>
            {/* Pancake menu lives at the route level (not inside Screen)
                so it overlays the entire viewport. */}
            {!isFull && menuOpen ? (
                <HeaderActionMenu
                    onClose={() => setMenuOpen(false)}
                    onAlerts={() => setAlertsOpen(true)}
                    alertCount={alerts.length}
                    onSend={onSend}
                    onReceive={onReceive}
                    onCreateToken={onCreateToken}
                    onMarkets={onMarkets}
                    onMessaging={onMessaging}
                    onHistory={onHistory}
                    onAddresses={onAddresses}
                    onContracts={onContracts}
                    onStaking={onStaking}
                    extraActions={extraActions}
                    onLock={handleLock}
                    locking={locking}
                />
            ) : null}
            {alertsOpen ? (
                <AlertsOverlay
                    alerts={alerts}
                    onClose={() => setAlertsOpen(false)}
                />
            ) : null}
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
