// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The body of the edit-swap and cancel-swap routes (EditSwapForm.jsx and
// CancelSwapForm.jsx): Swap Details' Edit and Cancel open them like every
// other action form has its own route, the twins of
// edit-order and cancel-order. Each route is given the swap by chain and
// action index, reads it with the same fixed reads Swap Details makes
// (loadSwapDetail), and draws the standard Edit Swap or Cancel Swap form
// pre-filled from it. A broadcast cancel leaves the session's Cancelling
// mark, so Swap Details and My Swaps show it at once when Back returns there.

import { useEffect, useState } from 'react';
import { EmptyState, FormPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { markSwapCancelBroadcast } from '../utils/swapCancelMarks.js';
import { loadSwapDetail } from './SwapDetail.jsx';
import { SwapActionPanel } from './MySwapsView.jsx';

/**
 * @param {object} props
 * @param {'edit' | 'cancel'} props.type
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {string} props.chainId
 * @param {string} props.actionIndex
 * @param {() => void} props.onBack
 * @param {() => void} [props.onDone]   after the result; defaults to Back
 */
export function SwapActionRoute({ type, walletId, accountId, chainId, actionIndex, onBack, onDone = onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [loaded, setLoaded] = useState(/** @type {{ item: any, addresses: any[] } | null | undefined} */ (undefined));

    useEffect(() => {
        let cancelled = false;
        setLoaded(undefined);
        loadSwapDetail({ messaging, walletId, accountId, chainId, actionIndex })
            .catch(() => null)
            .then((result) => { if (!cancelled) setLoaded(result); });
        return () => { cancelled = true; };
    }, [messaging, walletId, accountId, chainId, actionIndex]);

    const title = type === 'edit' ? 'Edit Swap' : 'Cancel Swap';
    const label = type === 'edit' ? 'Edit swap' : 'Cancel swap';
    const page = (status, body = null) => (
        <Screen variant={variant} header={<PageHeader onBack={onBack} title={title} />}>
            <FormPage as="div" label={label} status={status}>{body}</FormPage>
        </Screen>
    );

    if (loaded === undefined) return page(<StatusMessage variant="status">Loading swap…</StatusMessage>);
    const item = loaded?.item;
    // A failed read shows the plain not-found state, as Swap Details does:
    // the reachability banner reports network trouble once (G91).
    if (!item) return page(null, <EmptyState title="Swap not found" body="It may not be indexed yet." />);
    // Only the address that placed the swap can sign its edit or cancel.
    if (!item.demo && !item.ownerRecord) {
        return page(
            <StatusMessage variant="error">
                This swap was placed by an address that is not in this wallet, so this wallet cannot change it.
            </StatusMessage>,
        );
    }
    return (
        <SwapActionPanel
            type={type}
            item={item}
            chainAddresses={loaded.addresses}
            variant={variant}
            walletId={walletId}
            messaging={messaging}
            onDone={onDone}
            onCancelBroadcast={() => markSwapCancelBroadcast(messaging, item.key)}
            onBack={onBack}
        />
    );
}
