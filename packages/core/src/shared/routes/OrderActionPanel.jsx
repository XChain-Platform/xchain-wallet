// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cancel (ORDER v1) and Edit (ORDER v2) for one of the wallet's open orders:
// the Edit Order and Cancel Order forms. The layout is the shared Form
// Standard frame (TradeOwnerActionForm); this file holds what is the
// order's own: its signing flows, copy, checks and fresh re-reads, unchanged
// from when the form lived in MyOrdersView. The edit-order and cancel-order
// routes (OrderActionForms.jsx) and the Order detail page's in-place
// fallback both render it.

import { Icon } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import { deriveStatus, extractRows, fillStateOf, sideAmountText } from '../utils/orderView.js';
import { TradeOwnerActionForm } from './TradeOwnerActionForm.jsx';

const isCanonicalActionIndex = (value, { allowZero = false } = {}) => (
    allowZero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/
).test(String(value ?? '').trim());

/** @type {import('./TradeOwnerActionForm.jsx').TradeOwnerActionKind} */
export const ORDER_KIND = {
    action: 'ORDER',
    indexParam: 'ORDER_ACTION_INDEX',
    noun: 'Order',
    lowerNoun: 'order',
    software: { cancel: 'cancelOrder', edit: 'editOrder' },
    hardware: { cancel: 'cancelOrderHw', edit: 'editOrderHw' },
    icon: Icon.MarketIcon,
    indexLabel: 'Order',
    // Grouped for display ("250,000 PEPE"), full precision kept.
    sideText: (row, side) => sideAmountText(row[`${side}_tick`], row[`${side}_coin`], row[`${side}_amount`], row[`${side}_ownership`]),
    confirmVerb: (type) => (type === 'cancel'
        ? t('components.openOrdersPanel.cancelOrder2')
        : t('components.placeOrderPanel.editOrder')),
    help: {
        network: 'The network this order lives on. Its change is sent and its fee paid on this network.',
        from: 'The address that placed this order. Only it can edit or cancel the order, and it pays the network fee.',
        expiration: 'The date and time this order stops matching. Leave it blank to keep the current expiration; changing it re-charges the expiration fee.',
        allow: 'Only addresses on this list can match the order. Pick a list you own; a field you leave alone keeps the current list.',
        block: 'Addresses on this list cannot match the order. Pick a list you own; a field you leave alone keeps the current list.',
    },
    resultCopy: {
        cancel: 'The order will close and any escrow returns to you once the cancel confirms.',
        edit: 'The order update will take effect once it confirms.',
    },
    resultWhat: { cancel: 'order cancel', edit: 'order edit' },
    confirmChainLabel: 'none',
    validate({ isCancel, actionIndex, editParams, editHasChange, allowListIdx, blockListIdx }) {
        if (!isCanonicalActionIndex(actionIndex)) return 'Order ID must be a positive whole number.';
        if (isCancel) return null;
        if (!editHasChange) return 'Change at least one field (expiration, allow-list, or block-list).';
        if (editParams.EXPIRATION && Number(editParams.EXPIRATION) <= Math.floor(Date.now() / 1000)) {
            return 'Expiration must be a future date and time.';
        }
        if (allowListIdx && !isCanonicalActionIndex(allowListIdx, { allowZero: true })) {
            return 'Allow-list ID must be a whole number.';
        }
        if (blockListIdx && !isCanonicalActionIndex(blockListIdx, { allowZero: true })) {
            return 'Block-list ID must be a whole number.';
        }
        return null;
    },
    // Both reads are fresh, so they never return the page's own answer.
    async recheck({ messaging, item, owner, actionIndex }) {
        const { chainId } = item;
        let freshCancelledKeys = item.cancelledKeys || new Set();
        if (typeof messaging?.getOrderCancelsForAddress === 'function') {
            let response;
            try {
                response = await messaging.getOrderCancelsForAddress({ chainId, address: owner.address, fresh: true });
            } catch {
                return 'Could not refresh this order. Try again.';
            }
            freshCancelledKeys = new Set();
            for (const cancel of extractRows(response)) {
                if (String(cancel.source) === owner.address && String(cancel.status || 'valid') === 'valid') {
                    freshCancelledKeys.add(`${chainId}:${cancel.order_action_index}`);
                }
            }
        }
        if (typeof messaging?.getOrderDetail === 'function') {
            let freshDetail;
            try {
                freshDetail = await messaging.getOrderDetail({ chainId, actionIndex, fresh: true });
            } catch {
                return 'Could not refresh this order. Try again.';
            }
            const freshFill = fillStateOf(freshDetail);
            if (freshFill) {
                const status = deriveStatus({ ...item, fill: freshFill }, freshCancelledKeys, Math.floor(Date.now() / 1000));
                if (status !== 'open') return 'This order is not open. Refresh My orders and try again.';
            }
        }
        if (freshCancelledKeys.has(item.key)) return 'This order is not open. Refresh My orders and try again.';
        return null;
    },
    // cancelOrder takes the memo as `memo`, editOrder as params.MEMO; a blank
    // memo adds neither, so the request is what it was before the Memo field.
    submitExtra: ({ isCancel, actionIndex, editParams, memo }) => (isCancel
        ? { orderActionIndex: actionIndex, ...(memo ? { memo } : {}) }
        : { orderActionIndex: actionIndex, params: memo ? { ...editParams, MEMO: memo } : editParams }),
    failFallback: (_err, isCancel) => `Could not ${isCancel ? 'cancel' : 'edit'} the order. Try again.`,
};

/**
 * Cancel (ORDER v1) or Edit (ORDER v2) an open order, signed from its owner
 * address. The form is the input step; signing happens on the shared confirm
 * page with its network pre-flight, or, in watcher mode, the form builds an
 * unsigned transaction.
 *
 * @param {object} props
 * @param {'cancel' | 'edit'} props.type
 * @param {any} props.item               the order as loadOrderDetail returns it
 * @param {any[]} props.chainAddresses
 * @param {string} props.variant
 * @param {string} props.walletId
 * @param {any} props.messaging
 * @param {() => void} props.onDone
 * @param {() => void} [props.onCancelBroadcast]
 * @param {() => void} props.onBack
 */
export function OrderActionPanel(props) {
    return <TradeOwnerActionForm kind={ORDER_KIND} {...props} />;
}
