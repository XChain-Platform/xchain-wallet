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
import { readMsgUnread, MSG_UNREAD_EVENT } from '../utils/msgReadMemory.js';

// App-level unread-message count for the active wallet + account. Reads the
// snapshot the inbox publishes to localStorage (see msgReadMemory.js) and keeps
// it fresh by listening for the inbox's same-document write event, the cross-tab
// `storage` event, and tab refocus. It does not load the inbox itself, so the
// figure is whatever the last sweep recorded; brand-new arrivals surface through
// the OS notification path and reconcile here on the next inbox load or focus.
//
// @param {string | null | undefined} walletId
// @param {string | null | undefined} accountId
// @returns {number}
export function useMessagingUnread(walletId, accountId) {
    const [count, setCount] = useState(() => readMsgUnread(walletId, accountId));

    useEffect(() => {
        const refresh = () => setCount(readMsgUnread(walletId, accountId));
        refresh();
        if (typeof window === 'undefined') return undefined;
        const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
        window.addEventListener(MSG_UNREAD_EVENT, refresh);
        window.addEventListener('storage', refresh);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.removeEventListener(MSG_UNREAD_EVENT, refresh);
            window.removeEventListener('storage', refresh);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [walletId, accountId]);

    return count;
}
