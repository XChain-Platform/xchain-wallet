// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_PREFIX = 'xc:homeFilters:';
const DEFAULT_FILTERS = Object.freeze({ networkFilter: 'all', tokenQuery: '' });

function storageKey(walletId) {
    return `${STORAGE_PREFIX}${walletId}`;
}

function readWalletFilters(walletId) {
    if (!walletId) return DEFAULT_FILTERS;
    try {
        const parsed = JSON.parse(globalThis.localStorage?.getItem(storageKey(walletId)) || 'null');
        return {
            networkFilter: typeof parsed?.networkFilter === 'string' && parsed.networkFilter
                ? parsed.networkFilter
                : 'all',
            tokenQuery: typeof parsed?.tokenQuery === 'string' ? parsed.tokenQuery : '',
        };
    } catch {
        return DEFAULT_FILTERS;
    }
}

function writeWalletFilters(walletId, filters) {
    if (!walletId) return;
    try {
        globalThis.localStorage?.setItem(storageKey(walletId), JSON.stringify({
            networkFilter: filters.networkFilter,
            tokenQuery: filters.tokenQuery,
        }));
    } catch {
        // Storage can be unavailable in privacy-restricted shells.
    }
}

/**
 * Keeps the Home network and token filters together and scoped to a wallet.
 * Returning the newly selected wallet's stored value during render prevents
 * one wallet's filter from flashing on another while the effect catches up.
 */
export function useWalletFilters(walletId) {
    const walletKey = walletId || null;
    const [snapshot, setSnapshot] = useState(() => ({
        walletId: walletKey,
        ...readWalletFilters(walletKey),
    }));
    const filters = snapshot.walletId === walletKey
        ? snapshot
        : { walletId: walletKey, ...readWalletFilters(walletKey) };

    useEffect(() => {
        setSnapshot((current) => current.walletId === walletKey
            ? current
            : { walletId: walletKey, ...readWalletFilters(walletKey) });
    }, [walletKey]);

    const update = useCallback((field, value) => {
        setSnapshot((current) => {
            const base = current.walletId === walletKey
                ? current
                : { walletId: walletKey, ...readWalletFilters(walletKey) };
            const next = { ...base, [field]: value };
            writeWalletFilters(walletKey, next);
            return next;
        });
    }, [walletKey]);

    const setNetworkFilter = useCallback((value) => {
        update('networkFilter', typeof value === 'string' && value ? value : 'all');
    }, [update]);
    const setTokenQuery = useCallback((value) => {
        update('tokenQuery', typeof value === 'string' ? value : '');
    }, [update]);

    return { networkFilter: filters.networkFilter, tokenQuery: filters.tokenQuery, setNetworkFilter, setTokenQuery };
}
