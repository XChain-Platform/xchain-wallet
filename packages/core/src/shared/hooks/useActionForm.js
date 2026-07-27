// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useActionForm (§40 / maintainability G6): the shared machinery every
// single-action form (MINT, DESTROY, ISSUE, DIVIDEND, AIRDROP, …) used
// to inline three near-identical times:
//
//   1. Source loading + default selection. `getAddressesByChain`, the
//      first-chain default (unless a token context locks the chain), and
//      the "newest change-index-0 HD address" default-from rule.
//   2. The `from` descriptor. The exact { address, publicKey,
//      derivationPath, addressId, source, signerId } object handed to
//      every submit path.
//   3. Three-way signer dispatch. watcher -> encode-only
//      `buildActionPsbtRequest`; hardware -> the form's `hw` method;
//      software -> the form's `software` method (with the password).
//
// Copy-pasting these across ~24 forms meant any contract-level change
// (a renamed field on `from`, a new dispatch branch, a payload key the
// watcher path must forward) was a 24-file edit, and a mistake in any
// one copy stayed invisible because the render tests never asserted the
// emitted payload. Centralizing here makes the payload one testable
// surface (see test/unit/routes-render.test.jsx Layer 4).
//
// The hook owns only the shared machinery; per-form state (ticker,
// amount, stage, review copy) stays in the form. `submit()` builds and
// dispatches the payload but does NOT own stage/error transitions: the
// form decides what "submitting"/"done"/"review" mean and what an error
// message reads.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging } from '../useMessaging.js';
import { useSignerReady } from './useSignerReady.js';
import { useWalletMode } from './useWalletMode.js';
import { newestHdExternalId } from '../addressSelection.js';

const chainRegistry = registryLib.defaultRegistry();

/**
 * @typedef {object} ActionSubmitMethods
 * @property {string} hw        Messaging method for the hardware-signer path (e.g. 'mintAssetHw').
 * @property {string} software  Messaging method for the software-signer path (e.g. 'mintToken').
 */

/**
 * @typedef {object} UseActionFormOptions
 * @property {string} walletId
 * @property {string} action                       Protocol ACTION name ('MINT', 'DESTROY', …); forwarded to the watcher-mode encode call.
 * @property {ActionSubmitMethods} submitMethods
 * @property {string} [initialChainId]             When set with a token context, callers pass `lockedToken: true` so the loader won't overwrite it.
 * @property {string} [initialFromAddress]         Pre-select this source address (by `address`) when it exists on the chosen chain.
 * @property {boolean} [lockedToken=false]         Chain is externally locked (ManageToken per-token context); don't auto-pick the first chain.
 * @property {string} [noAddressMessage]           loadError text shown when the wallet has zero addresses on any chain.
 */

/**
 * @param {UseActionFormOptions} opts
 */
export function useActionForm({
    walletId,
    action,
    submitMethods,
    initialChainId,
    initialFromAddress,
    lockedToken = false,
    noAddressMessage = 'No addresses on any chain yet. Use Receive to generate one first.',
}) {
    const { messaging } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const { isWatcherMode } = useWalletMode();

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [chainId, setChainId] = useState(
        /** @type {string | null} */ (initialChainId || null),
    );
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // Block 1a: load the account's addresses, default the chain.
    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(noAddressMessage);
                    return;
                }
                // Honor an externally-locked chain (token context) instead
                // of clobbering it with the first-found chain.
                if (!lockedToken) setChainId(first);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
        // noAddressMessage / lockedToken are read-once inputs; re-running on
        // their (usually inline) identity would refetch pointlessly.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [walletId, messaging]);

    // Block 1b: default the fee-paying address for the chosen chain.
    // Prefer an explicit `initialFromAddress`; otherwise the newest HD
    // receive-branch (change index 0) address, matching Send/issue.
    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        const all = addressesByChain[chainId] || [];
        if (initialFromAddress) {
            const match = all.find((a) => a.address === initialFromAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        // Shared helper: reads change/index from the END of the path, so a
        // counterwallet-legacy m/0'/C/I wallet resolves too .
        setFromAddressId(newestHdExternalId(all));
    }, [chainId, addressesByChain, initialFromAddress]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];
    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';

    // Block 2: the canonical `from` descriptor. One definition so a
    // renamed/added field is a one-line change, not a 24-form sweep.
    const buildFrom = useCallback(() => {
        if (!fromAddress) return null;
        return {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
    }, [fromAddress]);

    // Block 3: three-way signer dispatch. Returns the messaging result;
    // the caller owns stage/error state around it.
    //
    // `extraBase` merges into the hardware/software payloads (e.g. a
    // top-level `payFeeInNativeCoin`); `encoderOpts` rides the watcher
    // (encode-only) call, which does NOT receive `extraBase` because that
    // path builds an unsigned PSBT with a distinct option shape. Keeping
    // both explicit is the guard against a watcher branch silently
    // dropping a fee flag.
    const submit = useCallback(async (
        { params, password, extraBase, encoderOpts } = {},
    ) => {
        const from = buildFrom();
        if (!chainId || !from) throw new Error('Pick a source address first.');
        const base = { walletId, chainId, from, params, ...(extraBase || {}) };
        if (isWatcherMode) {
            return messaging.buildActionPsbtRequest({
                chainId,
                from,
                actionData: { action, params },
                ...(encoderOpts ? { encoderOpts } : {}),
            });
        }
        if (isHwSource) {
            return messaging[submitMethods.hw]({ ...base, signerId: from.signerId });
        }
        return messaging[submitMethods.software]({ ...base, password });
    }, [
        buildFrom, chainId, walletId, isWatcherMode, isHwSource,
        messaging, action, submitMethods,
    ]);

    return {
        chainRegistry,
        addressesByChain,
        loadError,
        chainId,
        setChainId,
        fromAddress,
        fromAddressId,
        setFromAddressId,
        chainsWithAddresses,
        descriptor,
        signerReady,
        isWatcherMode,
        isHwSource,
        hwStatus,
        onHwStatusChange,
        buildFrom,
        submit,
    };
}
