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

/**
 * Browser connectivity is a fast local signal, not proof that a backend is
 * healthy. A definite `false` still matters: network work should stop at once,
 * while the online event gives callers an immediate opportunity to retry.
 */
export function isNavigatorOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function useOnlineStatus() {
    const [online, setOnline] = useState(isNavigatorOnline);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onOnline = () => setOnline(true);
        const onOffline = () => setOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        setOnline(isNavigatorOnline());
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, []);

    return online;
}
