// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useConfirmModal: gives `await confirm(...)` ergonomics on top of the in-app
// <ConfirmModal>, so a call site reads almost exactly like the native
// `if (!confirm('...')) return;` it replaces, without blocking the renderer
// thread. `confirm(opts)` opens the dialog and resolves true (confirmed) or
// false (cancelled / Escape / backdrop). The component keeps the JSX out of
// this hook (so it stays a plain .js): render
// `{request ? <ConfirmModal {...request} onConfirm={onConfirm} onCancel={onCancel} /> : null}`.

import { useCallback, useRef, useState } from 'react';

/**
 * @returns {{
 *   confirm: (opts?: { title: string, message?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }) => Promise<boolean>,
 *   request: object | null,
 *   onConfirm: () => void,
 *   onCancel: () => void,
 * }}
 */
export function useConfirmModal() {
    const [request, setRequest] = useState(/** @type {object | null} */ (null));
    const resolverRef = useRef(/** @type {((v: boolean) => void) | null} */ (null));

    const confirm = useCallback((opts = {}) => new Promise((resolve) => {
        resolverRef.current = resolve;
        setRequest(opts);
    }), []);

    const settle = useCallback((result) => {
        setRequest(null);
        const r = resolverRef.current;
        resolverRef.current = null;
        if (r) r(result);
    }, []);

    const onConfirm = useCallback(() => settle(true), [settle]);
    const onCancel = useCallback(() => settle(false), [settle]);

    return { confirm, request, onConfirm, onCancel };
}
