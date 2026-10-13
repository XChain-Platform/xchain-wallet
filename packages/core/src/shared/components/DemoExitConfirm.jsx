// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { ConfirmModal } from './ConfirmModal.jsx';

export const DEMO_EXIT_MESSAGE = 'This permanently deletes the demo wallet and its sample accounts, addresses, and history from this device. If it is the only wallet, the app also clears its local wallet data and returns you to wallet setup. This cannot be undone.';

/**
 * Shared destructive confirmation for every user-triggered demo exit.
 *
 * @param {object} props
 * @param {boolean} props.busy
 * @param {string | null} props.error
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 * @param {string} [props.message]
 */
export function DemoExitConfirm({ busy, error, onConfirm, onCancel, message = DEMO_EXIT_MESSAGE }) {
    return (
        <ConfirmModal
            title="Exit demo and delete its data?"
            message={message}
            confirmLabel="Exit demo & wipe"
            danger
            busy={busy}
            error={error}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    );
}
