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
 */
export function Home({ onLocked, onSend, onReceive, onCreateToken, onActions }) {
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
