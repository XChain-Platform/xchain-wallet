// Full-screen page for a single history entry. The History timeline
// used to expand each row inline; clicking now routes here instead so
// the user gets a dedicated surface with breathing room for decoded
// action data, status timeline, RBF actions, save-as-contact, and the
// peer-side panel for cross-chain LINK pairs.

import { useEffect, useState } from 'react';
import { Screen, Icon } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { DetailCard } from './History.jsx';
import styles from './History.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} props
 * @param {any} props.entry                   the history entry the user clicked
 * @param {string} props.walletId
 * @param {number} [props.chainTip]           latest known block on the entry's chain (drives confirmation count)
 * @param {() => void} props.onBack
 */
export function ActionDetail({ entry, walletId, chainTip, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    // Local peer cache — fetched once on mount when the entry is one
    // side of a cross-chain LINK pair. DetailCard handles loading +
    // error rendering off the same shape History uses for its inline
    // expansion.
    const [peerCache, setPeerCache] = useState({});

    useEffect(() => {
        if (!entry?.link?.peerChainId || !entry?.link?.peerActionIndex) return undefined;
        const peerChainId = entry.link.peerChainId;
        const peerActionIndex = String(entry.link.peerActionIndex);
        const pKey = `${peerChainId}:${peerActionIndex}`;
        let cancelled = false;
        setPeerCache({ [pKey]: { loading: true, action: null, error: null } });
        messaging.getActionByIndex({ chainId: peerChainId, actionIndex: peerActionIndex })
            .then((action) => {
                if (cancelled) return;
                setPeerCache({ [pKey]: { loading: false, action, error: null } });
            })
            .catch((err) => {
                if (cancelled) return;
                setPeerCache({
                    [pKey]: {
                        loading: false,
                        action: null,
                        error: err?.message || String(err),
                    },
                });
            });
        return () => { cancelled = true; };
    }, [entry, messaging]);

    if (!entry) {
        return (
            <Screen variant={variant} header={(
                <div className={styles.header}>
                    <button type="button" onClick={onBack} className={styles.back} aria-label="Back to history">
                        <Icon.BackIcon />
                    </button>
                    <span className={styles.title}>Action</span>
                    <span className={styles.spacer} />
                </div>
            )}>
                <p className={styles.empty}>No action selected.</p>
            </Screen>
        );
    }

    const descriptor = entry.chainId ? chainRegistry.get(entry.chainId) : null;
    const iconUrl = descriptor ? branding.chainIconSmallUrl(descriptor.id) : null;
    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back to history"
            >
                <Icon.BackIcon />
            </button>
            <span className={styles.title}>
                {iconUrl ? (
                    <img
                        src={iconUrl}
                        alt=""
                        aria-hidden="true"
                        className={styles.titleChainIcon}
                        width={18}
                        height={18}
                    />
                ) : null}
                {entry.action} #{Number(entry.actionIndex || 0).toLocaleString('en-US')}
            </span>
            <span className={styles.spacer} />
        </div>
    );

    return (
        <Screen variant={variant} header={header}>
            <div className={styles.body}>
                <DetailCard
                    entry={entry}
                    peerCache={peerCache}
                    chainTip={chainTip}
                    walletId={walletId}
                />
            </div>
        </Screen>
    );
}
