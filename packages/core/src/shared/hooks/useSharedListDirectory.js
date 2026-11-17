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
import { registry as registryLib } from '@xchain-wallet/core';
import { tickerForCoin } from '../../registry/coinTicker.js';

const chainRegistry = registryLib.defaultRegistry();

/**
 * The directory's list type, from the indexer's number or word.
 *
 * @param {unknown} type
 * @returns {string}
 */
export function listType(type) {
    const value = String(type ?? '').toLowerCase();
    if (value === '1' || value === 'token') return 'token';
    if (value === '2' || value === 'address') return 'address';
    return value;
}

function normalizeEntry(entry) {
    return {
        ...entry,
        name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : null,
        homeChain: entry.homeChain ?? entry.home_chain,
        homeListIndex: entry.homeListIndex ?? entry.home_list_index,
        type: listType(entry.type),
        memberCount: entry.memberCount ?? entry.member_count,
        shareBlock: entry.shareBlock ?? entry.share_block,
        bindTarget: entry.bindTarget ?? entry.bind_target ?? null,
        maintainedByPlatform: entry.maintainedByPlatform ?? entry.maintained_by_platform ?? false,
    };
}

function isEntryRecord(entry) {
    return entry !== null && typeof entry === 'object' && !Array.isArray(entry);
}

// A row the directory can show names a list type, a home chain and a list
// index; anything less renders as a phantom row nobody can open. The index
// text itself is shown neutralized, so its content is not checked here.
function isDirectoryRow(entry) {
    return (entry.type === 'token' || entry.type === 'address')
        && entry.homeChain != null && String(entry.homeChain).length > 0
        && entry.homeListIndex != null && String(entry.homeListIndex).length > 0;
}

/**
 * The chain a shared list lives on: its home chain id, or the chain of the
 * viewing network whose ticker or coin the directory names.
 *
 * @param {unknown} homeChain
 * @param {string} viewingChainId
 */
export function homeDescriptor(homeChain, viewingChainId) {
    const direct = chainRegistry.get(String(homeChain));
    if (direct) return direct;

    const networkKind = chainRegistry.get(viewingChainId)?.networkKind;
    const descriptors = networkKind
        ? chainRegistry.byNetworkKind(networkKind)
        : chainRegistry.supportedChains();
    const value = String(homeChain ?? '').toUpperCase();
    return descriptors.find((descriptor) => (
        tickerForCoin(descriptor.coin).toUpperCase() === value
        || descriptor.coin.toUpperCase() === value
    )) ?? null;
}

/**
 * The one loader of the shared-list directory, used by the Shared lists
 * screen and by My lists' "Shared with me" view. A malformed row does not
 * discard the valid rows returned beside it.
 *
 * @param {object} args
 * @param {any} args.messaging
 * @param {string | null | undefined} args.chainId   the viewing chain
 * @param {boolean} [args.enabled]                   false skips the read
 * @param {string} [args.scopeKey]                   reloads when the wallet changes
 * @returns {{ directory: { lists: any[], unavailable: string[] } | null, loadError: string | null, reload: () => void }}
 */
export function useSharedListDirectory({ messaging, chainId, enabled = true, scopeKey = '' }) {
    const [directory, setDirectory] = useState(/** @type {{ lists: any[], unavailable: string[] } | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [reloadCount, setReloadCount] = useState(0);

    useEffect(() => {
        if (!enabled || !chainId) return undefined;
        let cancelled = false;
        setDirectory(null);
        setLoadError(null);
        Promise.resolve().then(() => messaging.getSharedLists({ chainId }))
            .then((response) => {
                if (cancelled) return;
                setDirectory({
                    lists: Array.isArray(response?.lists)
                        ? response.lists.filter(isEntryRecord).map(normalizeEntry).filter(isDirectoryRow)
                        : [],
                    unavailable: Array.isArray(response?.unavailable) ? response.unavailable : [],
                });
            })
            .catch((error) => {
                if (!cancelled) setLoadError(error?.message || 'Failed to load shared lists.');
            });
        return () => { cancelled = true; };
    }, [chainId, messaging, scopeKey, reloadCount, enabled]);

    return { directory, loadError, reload: () => setReloadCount((value) => value + 1) };
}
