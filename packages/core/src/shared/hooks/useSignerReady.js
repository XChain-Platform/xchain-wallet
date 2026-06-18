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
import { flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging } from '../useMessaging.js';

/**
 * Whether the active wallet can sign WITHOUT a password right now (i.e.
 * the session is unlocked AND the background has a pre-unlocked signer
 * for it in the pool ("password only at unlock"). Sign/derive UIs use
 * this to hide their per-action password input.
 *
 * Defaults to `false` (show the password) so the rare empty-pool cases
 * passphrase wallets, or a service-worker restart that couldn't
 * rehydrate the pool; keep prompting and signing still works via the
 * password fallback. Demo wallets are always "ready" (signing is mocked,
 * the generated password is never shown to the user).
 *
 * @param {string | null | undefined} walletId
 * @returns {boolean}
 */
export function useSignerReady(walletId) {
    const { messaging } = useMessaging();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        if (!walletId) {
            setReady(false);
            return undefined;
        }
        if (flowsLib.isDemoWallet(walletId)) {
            setReady(true);
            return undefined;
        }
        if (typeof messaging?.signerReady !== 'function') {
            setReady(false);
            return undefined;
        }
        messaging.signerReady({ walletId })
            .then((r) => { if (!cancelled) setReady(!!r?.ready); })
            .catch(() => { if (!cancelled) setReady(false); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    return ready;
}
