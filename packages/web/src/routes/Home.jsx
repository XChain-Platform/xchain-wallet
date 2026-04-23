import { useCallback, useEffect, useState } from 'react';
import { Screen, Button, ChainBadge } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import {
    lockWallet,
    listWallets,
    getWalletBalances,
} from '../messaging.js';
import styles from './Home.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Web Home screen — full-layout counterpart to the extension popup's
 * Home. Reads wallets + balances through the in-page MessageHost;
 * picks the first wallet while multi-wallet UX is deferred.
 *
 * @param {object} props
 * @param {() => void} [props.onLocked]
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
            setLoadError(err?.message || 'Lock failed.');
            setLocking(false);
        }
    }, [locking, onLocked]);

    const activeWallet = wallets && activeWalletId
        ? wallets.find((w) => w.id === activeWalletId)
        : null;
    const walletName = activeWallet?.name || branding.PRODUCT_NAME;

    return (
        <Screen
            variant="full"
            header={
                <div className={styles.header}>
                    <span className={styles.title}>{walletName}</span>
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

                {balances ? (
                    <div className={styles.grid}>
                        {Object.entries(balances).map(([chainId, entries]) => {
                            const descriptor = chainRegistry.get(chainId);
                            if (!descriptor) return null;
                            const allError =
                                entries.length > 0 && entries.every((e) => e.error);
                            return (
                                <section key={chainId} className={styles.card}>
                                    <header className={styles.cardHeader}>
                                        <ChainBadge descriptor={descriptor} size="md" />
                                        <span className={styles.count}>
                                            {entries.length === 1
                                                ? '1 address'
                                                : `${entries.length} addresses`}
                                        </span>
                                    </header>
                                    <p className={styles.cardBody}>
                                        {allError
                                            ? `Balance unavailable — ${entries[0].error}`
                                            : 'Balance details ship in a later piece.'}
                                    </p>
                                </section>
                            );
                        })}
                    </div>
                ) : null}

                {balances && Object.keys(balances).length === 0 ? (
                    <p className={styles.hint}>
                        No addresses yet. Use Receive to generate one.
                    </p>
                ) : null}

                <div className={styles.actions}>
                    <Button variant="primary" disabled>
                        Send
                    </Button>
                    <Button variant="secondary" disabled>
                        Receive
                    </Button>
                </div>
                <p className={styles.note}>
                    Send + Receive ship in pieces 13 (send) and a later
                    shared-routes cleanup.
                </p>
            </div>
        </Screen>
    );
}
