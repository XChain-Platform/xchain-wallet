import { useCallback, useEffect, useState } from 'react';
import { Screen, Button } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import {
    lockWallet,
    listWallets,
    getWalletBalances,
} from '../messaging.js';
import { useAutoLock } from '../hooks/useAutoLock.js';
import { ChainBalanceCard } from '../components/ChainBalanceCard.jsx';
import styles from './Home.module.css';

// Same defaultRegistry used by the background; since descriptors are
// pure data this is cheap and saves a round trip per descriptor lookup.
const chainRegistry = registryLib.defaultRegistry();

/**
 * Home screen — the landing view for an unlocked wallet. Phase 1 lays
 * out:
 *   - Header with wallet name + Lock button
 *   - Per-chain balance cards (populated from `balances.wallet`)
 *   - Action buttons: Receive (piece 7), Send (Batch 4, disabled here)
 *
 * Auto-lock is foreground-only; see `useAutoLock` for the scope
 * limitation. Balance rows render error fallbacks while the SDK is
 * still stubbed — that's the expected shape, not a bug.
 *
 * @param {object} props
 * @param {() => void} [props.onLocked]   refresh upstream state machine
 */
export function Home({ onLocked }) {
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

    // Load wallet list → pick first → fetch balances. The Phase 1 popup
    // works against a single wallet; a picker lands in a later piece.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const list = await listWallets();
                if (cancelled) return;
                setWallets(list);
                if (!Array.isArray(list) || list.length === 0) {
                    setLoadError('No wallets found.');
                    return;
                }
                const walletId = list[0].id;
                setActiveWalletId(walletId);
                try {
                    const b = await getWalletBalances(walletId);
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
    }, []);

    const handleLock = useCallback(async () => {
        if (locking) return;
        setLocking(true);
        try {
            await lockWallet();
            onLocked?.();
        } catch (err) {
            // Lock is expected to succeed; surface errors rather than
            // silently no-op so diagnosis is possible.
            setLoadError(err?.message || 'Lock failed.');
            setLocking(false);
        }
    }, [locking, onLocked]);

    useAutoLock(handleLock, { enabled: !locking });

    const activeWallet = wallets && activeWalletId
        ? wallets.find((w) => w.id === activeWalletId)
        : null;
    const walletName = activeWallet?.name || branding.PRODUCT_NAME;

    return (
        <Screen
            variant="popup"
            header={
                <div className={styles.header}>
                    <span className={styles.name} title={walletName}>
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
            }
        >
            <div className={styles.body}>
                {loadError ? (
                    <div role="alert" className={styles.error}>
                        {loadError}
                    </div>
                ) : null}

                {balances === null && !loadError ? (
                    <p className={styles.hint}>Loading balances…</p>
                ) : null}

                {balances
                    ? Object.entries(balances).map(([chainId, entries]) => {
                        const descriptor = chainRegistry.get(chainId);
                        if (!descriptor) return null;
                        return (
                            <ChainBalanceCard
                                key={chainId}
                                descriptor={descriptor}
                                entries={entries}
                            />
                        );
                    })
                    : null}

                {balances && Object.keys(balances).length === 0 ? (
                    <p className={styles.hint}>
                        No addresses yet. Use Receive to generate one.
                    </p>
                ) : null}
            </div>

            <div className={styles.actions}>
                <Button variant="primary" block disabled>
                    Send
                </Button>
                <Button variant="secondary" block disabled>
                    Receive
                </Button>
                <p className={styles.note}>
                    Send ships in Batch 4; Receive wires up in piece 7.
                </p>
            </div>
        </Screen>
    );
}
