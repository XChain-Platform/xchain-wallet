// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useGetChainAddress: the GET_ADDRESS of a cross-chain offer, which names a
// destination on the chain the counterparty delivers to, not the chain the
// offer is signed on. Defaults to the wallet's newest address on that chain
// and stops auto-filling once the user has typed their own; picking a
// different get chain resets the override so the default follows the chain.

import { useCallback, useEffect, useState } from 'react';

/**
 * @param {object} opts
 * @param {any} opts.messaging          from useMessaging()
 * @param {string} opts.walletId
 * @param {string | null} opts.getChainId   chain the GET side settles on
 * @returns {{ getAddress: string, setGetAddress: (v: string) => void, resetGetAddress: () => void }}
 */
export function useGetChainAddress({ messaging, walletId, getChainId }) {
    const [getAddress, setAddress] = useState('');
    const [touched, setTouched] = useState(false);

    useEffect(() => {
        if (!getChainId || touched) return undefined;
        if (typeof messaging?.getNewestAddress !== 'function') return undefined;
        let cancelled = false;
        messaging.getNewestAddress(walletId, getChainId)
            .then((rec) => {
                if (cancelled) return;
                if (rec?.address) setAddress(rec.address);
            })
            .catch(() => { /* non-fatal; the user can enter one */ });
        return () => { cancelled = true; };
    }, [walletId, getChainId, touched, messaging]);

    const setGetAddress = useCallback((value) => {
        setAddress(value);
        setTouched(true);
    }, []);

    // A chain switch re-arms the default: an address typed for the previous
    // chain is not valid on the new one.
    const resetGetAddress = useCallback(() => {
        setAddress('');
        setTouched(false);
    }, []);

    return { getAddress, setGetAddress, resetGetAddress };
}
