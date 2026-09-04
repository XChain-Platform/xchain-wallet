// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { Screen, PageHeader, Icon, VerifiedBadge } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { DetailCard } from './History.jsx';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { normalizeHistoryRow } from '../utils/historyRow.js';
import { useActionProofVerification } from '../hooks/useProofVerification.js';
import { useSettings } from '../hooks/useSettings.js';
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
export function ActionDetail({ entry: entryProp, walletId, chainTip, indexerWatermark, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    // M2.3: the shells hand this page a SNAPSHOT of the row the user clicked
    // and never revisit it, which is harmless for a confirmed action and wrong
    // for a pending one: the whole point of showing a transaction early is that
    // it is going to change while the user is looking at it. So the page
    // refreshes itself while it is displaying something unconfirmed, on the
    // same 20s beat as the list, and swaps in the confirmed row the moment the
    // explorer has one for the same transaction. The SPV and LINK sections
    // come back with it, because they key off the block this row now has.
    const [confirmed, setConfirmed] = useState(/** @type {any} */ (null));
    const entry = confirmed || entryProp;
    const pendingTxHash = (!(Number(entryProp?.blockIndex) > 0) && entryProp?.txHash)
        ? String(entryProp.txHash).toLowerCase()
        : '';
    useEffect(() => {
        setConfirmed(null);
    }, [entryProp?.key]);
    useEffect(() => {
        if (!pendingTxHash || confirmed) return undefined;
        if (!entryProp?.chainId || !entryProp?.address) return undefined;
        if (typeof messaging.getAddressHistory !== 'function') return undefined;
        const { chainId, address } = entryProp;
        let cancelled = false;
        const look = () => {
            messaging.getAddressHistory({ chainId, address })
                .then((resp) => {
                    if (cancelled) return;
                    const rows = Array.isArray(resp) ? resp : (resp?.data || resp?.rows || []);
                    const hit = rows.find((row) => String(row?.tx_hash ?? row?.txHash ?? '')
                        .toLowerCase() === pendingTxHash);
                    if (!hit) return;
                    const built = normalizeHistoryRow(hit, {
                        chainId,
                        address,
                        link: entryProp.link || null,
                    });
                    // Only an actually-confirmed row is an upgrade. The
                    // explorer can carry the transaction before it has a
                    // block, and swapping to that would lose the pending
                    // detail for nothing.
                    if (built && Number(built.blockIndex) > 0) setConfirmed(built);
                })
                .catch(() => { /* transient; the next tick tries again */ });
        };
        look();
        const id = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            look();
        }, flowsLib.BALANCE_POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(id); };
    }, [pendingTxHash, confirmed, entryProp, messaging]);

    // Local peer cache: fetched once on mount when the entry is one
    // side of a cross-chain LINK pair. DetailCard handles loading +
    // error rendering off the same shape History uses for its inline
    // expansion.
    const [peerCache, setPeerCache] = useState({});

    // M2.3: an entry with no block has not been indexed, so every part of
    // this page keyed to a block is not merely empty but meaningless -
    // there is no action index to name in the title, no checkpoint to
    // verify against, and no LINK peer to fetch. Each is suppressed
    // deliberately below. They used to no-op by accident, which held only
    // for as long as nobody changed the conditions they leaned on.
    const isPending = !(Number(entry?.blockIndex) > 0);

    useEffect(() => {
        if (isPending) return undefined;
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
    }, [entry, messaging, isPending]);

    // PC-50: the same SPV verdict the History list badges, on the detail view
    // the item names. Only a confirmed action with a numeric index is
    // checkpointable, and the verdict is skipped for demo wallets and when the
    // user has opted out of proof traffic (`verifyProofs`, default on).
    const proofSettings = useSettings();
    const verifyEnabled = proofSettings.settings?.verifyProofs !== false
        && !flowsLib.isDemoWallet(walletId);
    const verifyItems = useMemo(() => {
        if (!entry || isPending) return [];
        if (entry.actionIndex == null || entry.actionIndex === '') return [];
        return [{ key: 'detail', chainId: entry.chainId, actionIndex: entry.actionIndex }];
    }, [entry, isPending]);
    const verifyMap = useActionProofVerification({
        messaging, items: verifyItems, enabled: verifyEnabled,
    });
    const verdict = verifyMap.detail || null;

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
            title={isPending
                // A pending action has no index, and the fallback here
                // rendered it as "#0", an index that belongs to a real
                // action on every chain.
                ? actionDisplayLabel(entry.action)
                : `${actionDisplayLabel(entry.action)} #${Number(entry.actionIndex || 0).toLocaleString('en-US')}`}
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
                {verdict ? (
                    <div className={styles.detailVerify}>
                        <VerifiedBadge status={verdict.status} reason={verdict.reason} size="sm" />
                    </div>
                ) : null}
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
