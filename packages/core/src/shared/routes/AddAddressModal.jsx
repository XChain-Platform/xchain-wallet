// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AddAddressModal: the "Add address" affordance on the Addresses page.
// A small overlay popup with three fields, coin, address type, and how
// many addresses to generate, then batch-derives that many receive
// addresses for the active account.
//
// Generation is SEQUENTIAL: each generateReceiveAddress call computes the
// next BIP44 index from the already-persisted records, so running them in
// parallel would make several derive the same index. We await each before
// the next. For software wallets the shared host injects the unlocked
// session signer (no password); for hardware wallets each derivation is a
// device round-trip.

import { useMemo, useState } from 'react';
import { Button, ChainPicker } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging } from '../useMessaging.js';
import styles from './AddAddressModal.module.css';

const chainRegistry = registryLib.defaultRegistry();
const MAX_ADDRESSES = 25;

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]              active account; new addresses are scoped to it
 * @param {string[]} props.chainIds               the account's active chainIds (the coin options)
 * @param {() => void} props.onClose
 * @param {(count: number) => void} [props.onGenerated]   called after a successful batch
 */
export function AddAddressModal({ walletId, accountId, chainIds, onClose, onGenerated }) {
    const { messaging } = useMessaging();

    // Coin options come from the chains the account is already on.
    const coinOptions = useMemo(() => (chainIds || [])
        .map((cid) => chainRegistry.get(cid))
        .filter(Boolean)
        .map((d) => ({
            chainId: d.id,
            displayName: d.displayName,
            addressTypes: d.addressTypes,
            defaultAddressType: d.defaultAddressType,
        })), [chainIds]);

    const [chainId, setChainId] = useState(coinOptions[0]?.chainId || '');
    const selected = coinOptions.find((c) => c.chainId === chainId) || coinOptions[0] || null;
    const [addressType, setAddressType] = useState(selected?.defaultAddressType || '');
    const [count, setCount] = useState('1');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(0);
    const [error, setError] = useState(/** @type {string | null} */ (null));

    // Changing the coin resets the type to that chain's default, since
    // each chain supports a different address-type set.
    function changeCoin(nextChainId) {
        setChainId(nextChainId);
        const d = coinOptions.find((c) => c.chainId === nextChainId);
        setAddressType(d?.defaultAddressType || '');
        setError(null);
    }

    async function handleGenerate(event) {
        event.preventDefault();
        if (busy) return;
        const n = Math.floor(Number(count));
        if (!chainId) { setError('Pick a coin.'); return; }
        if (!Number.isInteger(n) || n < 1 || n > MAX_ADDRESSES) {
            setError(`Enter a number between 1 and ${MAX_ADDRESSES}.`);
            return;
        }
        setBusy(true);
        setError(null);
        setDone(0);
        try {
            for (let i = 0; i < n; i += 1) {
                // eslint-disable-next-line no-await-in-loop -- sequential by design (see header)
                await messaging.generateReceiveAddress({ walletId, chainId, accountId, addressType });
                setDone(i + 1);
            }
            onGenerated?.(n);
            onClose();
        } catch (err) {
            setError(
                err?.message
                || 'Could not generate addresses. Make sure the wallet is unlocked (or your hardware device is connected).',
            );
            setBusy(false);
        }
    }

    const countNum = Math.floor(Number(count));
    const generateLabel = Number.isInteger(countNum) && countNum > 1 ? `Generate ${countNum}` : 'Generate';

    return (
        <div
            className={styles.backdrop}
            role="dialog"
            aria-modal="true"
            aria-label="Add addresses"
            onClick={busy ? undefined : onClose}
        >
            <div className={styles.card} onClick={(e) => e.stopPropagation()}>
                <h2 className={styles.title}>Add addresses</h2>
                {coinOptions.length === 0 ? (
                    <>
                        <p className={styles.empty}>No chains are active for this account yet.</p>
                        <div className={styles.actions}>
                            <Button type="button" variant="primary" size="md" onClick={onClose}>Close</Button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={handleGenerate} noValidate>
                        <div className={styles.field}>
                            <ChainPicker
                                label="Coin"
                                value={chainId}
                                onChange={changeCoin}
                                chainIds={coinOptions.map((c) => c.chainId)}
                                chainRegistry={chainRegistry}
                                disabled={busy}
                            />
                        </div>
                        <label className={styles.field}>
                            <span className={styles.label}>Type</span>
                            <select
                                className={styles.select}
                                value={addressType}
                                onChange={(e) => { setAddressType(e.target.value); setError(null); }}
                                disabled={busy || !selected}
                            >
                                {(selected?.addressTypes || []).map((t) => (
                                    <option key={t} value={t}>{t.toUpperCase()}</option>
                                ))}
                            </select>
                        </label>
                        <label className={styles.field}>
                            <span className={styles.label}>Number of addresses</span>
                            <input
                                className={styles.select}
                                type="number"
                                inputMode="numeric"
                                aria-label="Number of addresses"
                                min={1}
                                max={MAX_ADDRESSES}
                                value={count}
                                onChange={(e) => { setCount(e.target.value); setError(null); }}
                                disabled={busy}
                            />
                        </label>
                        {error ? <div role="alert" className={styles.error}>{error}</div> : null}
                        {busy ? <p className={styles.progress}>Generating {done}/{countNum}…</p> : null}
                        <div className={styles.actions}>
                            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                                Cancel
                            </Button>
                            <Button type="submit" variant="primary" size="md" loading={busy} disabled={busy || !chainId}>
                                {generateLabel}
                            </Button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
