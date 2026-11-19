// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The body of the edit-order and cancel-order routes (EditOrderForm.jsx and
// CancelOrderForm.jsx): Order detail's Edit and Cancel open them like every
// other action form has its own route (contract-withdraw, stake-form,
// list-transfer). Each route is given the order by chain and
// action index, reads it with the same fixed reads Order detail makes
// (loadOrderDetail), and draws the standard Edit Order or Cancel Order form
// pre-filled from it. A broadcast cancel leaves the session's Cancelling mark,
// so Order detail and My Orders show it at once when Back returns there.

import { useEffect, useState } from 'react';
import { EmptyState, FormPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { markOrderCancelBroadcast } from '../utils/orderCancelMarks.js';
import { loadOrderDetail } from './OrderDetail.jsx';
import { OrderActionPanel } from './OrderActionPanel.jsx';

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
export function OrderActionRoute({ type, walletId, accountId, chainId, actionIndex, onBack, onDone = onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [data, setData] = useState(/** @type {{ item: any, chainAddresses: any[] } | undefined} */ (undefined));

    useEffect(() => {
        let cancelled = false;
        setData(undefined);
        loadOrderDetail(messaging, { walletId, accountId, chainId, actionIndex })
            .catch(() => ({ item: null, chainAddresses: [] }))
            .then((result) => { if (!cancelled) setData(result); });
        return () => { cancelled = true; };
    }, [messaging, walletId, accountId, chainId, actionIndex]);

    const title = type === 'edit' ? 'Edit Order' : 'Cancel Order';
    const label = type === 'edit' ? 'Edit order' : 'Cancel order';
    const page = (status, body = null) => (
        <Screen variant={variant} header={<PageHeader onBack={onBack} title={title} />}>
            <FormPage as="div" label={label} status={status}>{body}</FormPage>
        </Screen>
    );

    if (data === undefined) return page(<StatusMessage variant="status">Loading order…</StatusMessage>);
    const item = data.item;
    // A failed read shows the plain not-found state, as Order detail does:
    // the reachability banner reports network trouble once (G91).
    if (!item) return page(null, <EmptyState title="Order not found" body="It may not be indexed yet." />);
    // Only the address that placed the order can sign its edit or cancel.
    if (!item.owner) {
        return page(
            <StatusMessage variant="error">
                This order was placed by an address that is not in this wallet, so this wallet cannot change it.
            </StatusMessage>,
        );
    }
    return (
        <OrderActionPanel
            type={type}
            item={item}
            chainAddresses={data.chainAddresses}
            variant={variant}
            walletId={walletId}
            messaging={messaging}
            onDone={onDone}
            onCancelBroadcast={() => markOrderCancelBroadcast(messaging, item.key)}
            onBack={onBack}
        />
    );
}
