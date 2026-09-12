// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useActionForm: the shared machinery every single-action form (MINT,
// DESTROY, ISSUE, DIVIDEND, AIRDROP and the rest) needs, in one place
// rather than inlined per form:
//
//   1. Source loading + default selection. `getAddressesByChain`, the
//      chain default (explicit, then last-used, then first; unless a
//      token context locks the chain), and the chain's active (operating)
//      address as the default source, falling back to the newest
//      change-index-0 HD address.
//   2. The `from` descriptor. The exact { address, publicKey,
//      derivationPath, addressId, source, signerId } object handed to
//      every submit path.
//   3. Three-way signer dispatch. watcher -> encode-only
//      `buildActionPsbtRequest`; hardware -> the form's `hw` method;
//      software -> the form's `software` method (with the password).
//
// Held in one place, a contract-level change (a renamed field on `from`,
// a new dispatch branch, a payload key the watcher path must forward) is
// one edit rather than two dozen, and the emitted payload is a single
// testable surface.
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
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId, recordLastUsedChain } from '../chainSelection.js';

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
 * @property {string} [initialChainId]             Open on this chain. Wins over the last-used chain and the first-key fallback.
 * @property {string} [initialFromAddress]         Pre-select this source address (by `address`) when it exists on the chosen chain.
 * @property {boolean} [lockedToken=false]         Chain is externally locked (ManageToken per-token context); the loader never touches it.
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
    // getActiveAddresses()[chainId], loaded alongside the address list.
    // Stays null until the load settles so the default-from effect below
    // never picks a fallback address and then swaps it out under the user.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [chainId, setChainId] = useState(
        /** @type {string | null} */ (initialChainId || null),
    );
    // An EXPLICIT source pick only (the form's source picker, or a caller
    // that set one). The default is not stored here - see Block 1b for why.
    const [pickedFromId, setPickedFromId] = useState(
        /** @type {string | null} */ (null),
    );
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // Block 1a: load the account's addresses + the active-address map,
    // default the chain. The active map and the settings read are
    // best-effort: a host that does not implement `getActiveAddresses` or
    // `getSettings`, or one whose call fails, must still yield a usable
    // form, so those legs resolve to `{}` / null instead of rejecting.
    // Settings ride the same load so the last-used chain is known in the
    // render that first shows the form, never applied a beat later.
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
            typeof messaging.getSettings === 'function'
                ? Promise.resolve(messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([byChain, active, settings]) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                setActiveByChain(active || {});
                if (!Object.keys(byChain)[0]) {
                    setLoadError(noAddressMessage);
                    return;
                }
                // Honor an externally-locked chain (token context) instead
                // of clobbering it with the picked chain.
                if (!lockedToken) {
                    setChainId(pickDefaultChainId(byChain, {
                        explicitChainId: initialChainId,
                        settings,
                    }));
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
        // noAddressMessage / lockedToken / initialChainId are read-once
        // inputs; re-running on their (usually inline) identity would
        // refetch pointlessly.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [walletId, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;

    // Block 1b: the fee-paying address for the chosen chain. Prefer an
    // explicit pick, then an `initialFromAddress` (a token/owner context the
    // caller resolved); otherwise the chain's ACTIVE address, the one Home
    // and Send operate on and the one holding the balance on a wallet that
    // has generated more than one address (D-57). Falls back to
    // the newest HD receive-branch address when no active address applies.
    //
    // DERIVED, not stored. This used to be an effect that wrote
    // the default into state, which meant the load landed in TWO commits:
    // the first painted the fully loaded form with no source at all - the
    // red "No address on this chain. Use Receive to generate one first."
    // alert under a wallet that has one, and a dead Submit - and the second,
    // one passive-effect flush later, corrected it. Users saw a false
    // no-address flash; tests saw an intermittently disabled Submit, because
    // "the form has loaded" (the destination field exists) and "the form is
    // usable" (a source resolved) were true in different commits, and the
    // gap between them is a scheduler task whose length is a property of the
    // machine. That is what made SweepForm.formErrors flake on a busy CI
    // venue and pass on every dev box. Deriving it collapses the two commits
    // into one: `addressesByChain` and `activeByChain` are set in the same
    // batch, so the first render that has a chain's addresses also has its
    // source.
    const fromAddress = useMemo(() => {
        if (!chainId || !addressesByChain) return null;
        const all = addressesByChain[chainId] || [];
        // An explicit pick holds only while it belongs to this chain, so a
        // chain switch re-defaults instead of pointing at a foreign address.
        const picked = pickedFromId ? all.find((a) => a.id === pickedFromId) : null;
        if (picked) return picked;
        if (initialFromAddress) {
            const match = all.find((a) => a.address === initialFromAddress);
            if (match) return match;
        }
        // Never default off a half-loaded pair: the active map decides which
        // address wins, so an absent one would pick the HD fallback and then
        // swap it out under the user. Block 1a resolves it to `{}` rather
        // than leaving it null, so this only holds before the load lands.
        if (!activeByChain) return null;
        // Shared helper: reads change/index from the END of the path, so a
        // counterwallet-legacy m/0'/C/I wallet resolves too.
        const id = preferredSourceId(all, activeByChain[chainId]);
        return all.find((a) => a.id === id) || null;
    }, [chainId, addressesByChain, activeByChain, pickedFromId, initialFromAddress]);

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
        let result;
        if (isWatcherMode) {
            result = await messaging.buildActionPsbtRequest({
                chainId,
                from,
                actionData: { action, params },
                ...(encoderOpts ? { encoderOpts } : {}),
            });
        } else if (isHwSource) {
            result = await messaging[submitMethods.hw]({ ...base, signerId: from.signerId });
        } else {
            result = await messaging[submitMethods.software]({ ...base, password });
        }
        // A submit that resolved is real activity on this chain: the next
        // form opened without a chain of its own starts here. Not awaited;
        // the write never rejects and the done screen must not wait on it.
        recordLastUsedChain(messaging, chainId);
        return result;
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
        // The RESOLVED id (default included), not the raw pick, so a caller
        // reading it sees the address the form is actually sourcing from.
        fromAddressId: fromAddress?.id ?? null,
        setFromAddressId: setPickedFromId,
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
