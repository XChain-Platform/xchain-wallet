// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { Screen, PageHeader, Icon } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { DetailCard } from './History.jsx';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import styles from './History.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} props
 * @param {any} props.entry                   the history entry the user clicked
 * @param {string} props.walletId
 * @param {number} [props.chainTip]           latest known block on the entry's chain (drives confirmation count)
 * @param {number} [props.indexerWatermark]   latest indexed block on the entry's chain (drives the Indexed stage)
 * @param {() => void} props.onBack
 */
export function ActionDetail({ entry, walletId, chainTip, indexerWatermark, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    // Local peer cache: fetched once on mount when the entry is one
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
                <PageHeader onBack={onBack} backLabel="Back to history" title="Action" />
            )}>
                <p className={styles.empty}>No action selected.</p>
            </Screen>
        );
    }

    const descriptor = entry.chainId ? chainRegistry.get(entry.chainId) : null;
    const iconUrl = descriptor ? branding.chainIconSmallUrl(descriptor.id) : null;
    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to history"
            title={`${actionDisplayLabel(entry.action)} #${Number(entry.actionIndex || 0).toLocaleString('en-US')}`}
            titleIcon={iconUrl ? (
                <img
                    src={iconUrl}
                    alt=""
                    aria-hidden="true"
                    className={styles.titleChainIcon}
                    width={18}
                    height={18}
                />
            ) : null}
        />
    );

    return (
        <Screen variant={variant} header={header}>
            <div className={styles.body}>
                <DetailCard
                    entry={entry}
                    peerCache={peerCache}
                    chainTip={chainTip}
                    indexerWatermark={indexerWatermark}
                    walletId={walletId}
                />
            </div>
        </Screen>
    );
}
