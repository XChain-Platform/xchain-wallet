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
// A small overlay popup with four fields, coin, address type, purpose,
// and how many addresses to generate, then batch-derives that many
// addresses for the active account. Purpose picks the derive flow:
// 'receive' (default) or 'dispenser' (§16), which tags the record
// role='dispenser' so it surfaces under the Misc filter and in the
// Create Dispenser form's existing-address picker. Both draw from the
// same external change=0 index space; dispenser-ness is metadata, not
// a separate branch.
//
// The coin list is the union of the account's own chains and the chains
// active on the current network . Building it from the account's
// chains alone made the screen a dead end for an account with none: no
// options, so no way to derive a first address anywhere.
//
// Generation is SEQUENTIAL: each generateReceiveAddress call computes the
// next BIP44 index from the already-persisted records, so running them in
// parallel would make several derive the same index. We await each before
// the next. For software wallets the shared host injects the unlocked
// session signer (no password); for hardware wallets each derivation is a
// device round-trip.

import { useMemo, useState } from 'react';
import { Button, ChainPicker, Screen, PageHeader, Icon } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import styles from './AddAddressModal.module.css';

const chainRegistry = registryLib.defaultRegistry();
const MAX_ADDRESSES = 25;

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]              active account; new addresses are scoped to it
 * @param {string[]} props.chainIds               the chains the account is already on; the coin options are these UNION the chains active on the current network 
 * @param {() => void} props.onClose
 * @param {(count: number) => void} [props.onGenerated]   called after a successful batch
 */
// Users recognize address formats by their leading characters, not by
// script-type names, so each Type option carries a "starts with ..."
// hint. Keyed by coin family + network kind + type.
const ADDRESS_TYPE_HINT = {
    bitcoin: {
        mainnet: { p2pkh: '1...', 'p2sh-p2wpkh': '3...', p2wpkh: 'bc1q...', p2tr: 'bc1p...' },
        testnet: { p2pkh: 'm.../n...', 'p2sh-p2wpkh': '2...', p2wpkh: 'tb1q...', p2tr: 'tb1p...' },
        regtest: { p2pkh: 'm.../n...', 'p2sh-p2wpkh': '2...', p2wpkh: 'bcrt1q...', p2tr: 'bcrt1p...' },
    },
    litecoin: {
        mainnet: { p2pkh: 'L...', 'p2sh-p2wpkh': 'M...', p2wpkh: 'ltc1...' },
        testnet: { p2pkh: 'm.../n...', 'p2sh-p2wpkh': 'Q...', p2wpkh: 'tltc1...' },
        regtest: { p2pkh: 'm.../n...', 'p2sh-p2wpkh': 'Q...', p2wpkh: 'rltc1...' },
    },
    dogecoin: {
        mainnet: { p2pkh: 'D...' },
        // Dogecoin regtest reuses Bitcoin-testnet base58 prefixes (see the
        // dogecoin descriptor).
        testnet: { p2pkh: 'n...' },
        regtest: { p2pkh: 'm.../n...' },
    },
};

export function addressTypeHint(descriptor, type) {
    return ADDRESS_TYPE_HINT[descriptor?.coin]?.[descriptor?.networkKind]?.[type] || null;
}

export function AddAddressModal({ walletId, accountId, chainIds, onClose, onGenerated }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const { settings } = useSettings();

    // Coin options: the chains the account is already on, PLUS every chain
    // active on the current network . Offering only occupied chains
    // meant an account with no addresses had no options at all - "No chains
    // are active for this account yet." with a Close button, and no other
    // surface could break the tie. An account can only get its first address
    // on a chain if this list can name that chain.
    const offeredChainIds = useMemo(
        () => flowsLib.offerableChainIds({ occupied: chainIds, settings, chainRegistry }),
        [chainIds, settings],
    );

    const coinOptions = useMemo(() => offeredChainIds
        .map((cid) => chainRegistry.get(cid))
        .filter(Boolean)
        .map((d) => ({
            chainId: d.id,
            displayName: d.displayName,
            addressTypes: d.addressTypes,
            defaultAddressType: d.defaultAddressType,
            coin: d.coin,
            networkKind: d.networkKind,
        })), [offeredChainIds]);

    const [chainId, setChainId] = useState(coinOptions[0]?.chainId || '');
    // Settings land after the first render, so the option list can grow from
    // empty. Fall back to the first option until the user picks one.
    const selected = coinOptions.find((c) => c.chainId === chainId) || coinOptions[0] || null;
    const effectiveChainId = chainId || selected?.chainId || '';
    const [addressType, setAddressType] = useState(selected?.defaultAddressType || '');
    // Same late-arrival guard as the coin: an untouched type field follows the
    // selected chain's default rather than staying empty.
    const effectiveAddressType = addressType || selected?.defaultAddressType || '';
    const [purpose, setPurpose] = useState(/** @type {'receive' | 'dispenser'} */ ('receive'));
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
        if (!effectiveChainId) { setError('Pick a coin.'); return; }
        if (!Number.isInteger(n) || n < 1 || n > MAX_ADDRESSES) {
            setError(`Enter a number between 1 and ${MAX_ADDRESSES}.`);
            return;
        }
        setBusy(true);
        setError(null);
        setDone(0);
        try {
            const generate = purpose === 'dispenser'
                ? messaging.generateDispenserAddress
                : messaging.generateReceiveAddress;
            for (let i = 0; i < n; i += 1) {
                // eslint-disable-next-line no-await-in-loop -- sequential by design (see header)
                await generate({
                    walletId,
                    chainId: effectiveChainId,
                    accountId,
                    addressType: effectiveAddressType,
                });
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

    const header = (
        <PageHeader
            onBack={busy ? undefined : onClose}
            title="Add addresses"
            titleIcon={<Icon.PlusIcon />}
        />
    );
    return (
        <Screen variant={variant} header={header}>
            <>
                {coinOptions.length === 0 ? (
                    <>
                        <p className={styles.empty}>
                            No coins are available yet. Unlock the wallet, or turn on a network
                            under Settings.
                        </p>
                        <div className={styles.actions}>
                            <Button type="button" variant="primary" size="md" onClick={onClose}>Close</Button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={handleGenerate} noValidate>
                        <ChainPicker
                            label="Coin"
                            value={effectiveChainId}
                            onChange={changeCoin}
                            chainIds={coinOptions.map((c) => c.chainId)}
                            chainRegistry={chainRegistry}
                            disabled={busy}
                        />
                        <label className={styles.field}>
                            <span className={styles.label}>Type</span>
                            <select
                                className={styles.select}
                                value={effectiveAddressType}
                                onChange={(e) => { setAddressType(e.target.value); setError(null); }}
                                disabled={busy || !selected}
                            >
                                {(selected?.addressTypes || []).map((t) => {
                                    const hint = addressTypeHint(selected, t);
                                    return (
                                        <option key={t} value={t}>
                                            {t.toUpperCase()}{hint ? ` (starts with ${hint})` : ''}
                                        </option>
                                    );
                                })}
                            </select>
                        </label>
                        {typeof messaging.generateDispenserAddress === 'function' ? (
                            <label className={styles.field}>
                                <span className={styles.label}>Purpose</span>
                                <select
                                    className={styles.select}
                                    value={purpose}
                                    onChange={(e) => {
                                        setPurpose(/** @type {'receive' | 'dispenser'} */ (e.target.value));
                                        setError(null);
                                    }}
                                    disabled={busy}
                                >
                                    <option value="receive">Receive</option>
                                    <option value="dispenser">Dispenser</option>
                                </select>
                                {purpose === 'dispenser' ? (
                                    <span className={styles.hint}>
                                        Listed under Misc on the Addresses page and offered when opening a dispenser.
                                    </span>
                                ) : null}
                            </label>
                        ) : null}
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
                            <Button type="submit" variant="primary" size="md" loading={busy} disabled={busy || !effectiveChainId}>
                                {generateLabel}
                            </Button>
                        </div>
                    </form>
                )}
            </>
        </Screen>
    );
}
