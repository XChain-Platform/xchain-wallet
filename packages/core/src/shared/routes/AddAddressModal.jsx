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
// active on the current network. Building it from the account's
// chains alone made the screen a dead end for an account with none: no
// options, so no way to derive a first address anywhere.
//
// Generation is SEQUENTIAL: each generateReceiveAddress call computes the
// next BIP44 index from the already-persisted records, so running them in
// parallel would make several derive the same index. We await each before
// the next. For software wallets the shared host injects the unlocked
// session signer (no password); for hardware wallets each derivation is a
// device round-trip.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Button, EmptyState, FormPage, Icon, Input, NetworkField, PageHeader, Screen, Select, StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { blurNumberInputOnWheel } from '../utils/formInput.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { offeredAddressType } from '../utils/supportedAddressTypes.js';
import { useSupportedAddressTypes } from '../hooks/useSupportedAddressTypes.js';
import styles from './AddAddressModal.module.css';

const chainRegistry = registryLib.defaultRegistry();
const MAX_ADDRESSES = 25;
const MAX_DERIVATION_INDEX = 0x7fffffff;

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]              active account; new addresses are scoped to it
 * @param {string[]} props.chainIds the chains the account is already on; the coin options are these UNION the chains active on the current network
 * @param {string} [props.initialChainId]         chain to pre-select (Receive passes its active chain)
 * @param {() => void} props.onClose
 * @param {(count: number) => void} [props.onGenerated]   called with the number persisted, including a partial batch
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
        testnet: { p2pkh: 'm.../n...', 'p2sh-p2wpkh': '2...', p2wpkh: 'tltc1...' },
        regtest: { p2pkh: 'm.../n...', 'p2sh-p2wpkh': '2...', p2wpkh: 'rltc1...' },
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

export function AddAddressModal({ walletId, accountId, chainIds, initialChainId, onClose, onGenerated }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const { settings } = useSettings();

    // Coin options: the chains the account is already on, PLUS every chain
    // active on the current network. Offering only occupied chains
    // meant an account with no addresses had no options at all - "No chains
    // are active for this account yet." with a Close button, and no other
    // surface could break the tie. An account can only get its first address
    // on a chain if this list can name that chain.
    const offeredChainIds = useMemo(
        () => flowsLib.offerableChainIds({ occupied: chainIds, settings, chainRegistry }),
        [chainIds, settings],
    );

    // Which type to pre-select depends on the WALLET, not just the chain:
    // a counterwallet-legacy wallet holds its balances on p2pkh, so
    // offering the chain's modern default would default a migrating user
    // into an address format their old wallet never showed them.
    const [walletFormat, setWalletFormat] = useState(undefined);
    useEffect(() => {
        let live = true;
        if (typeof messaging.listWallets !== 'function') return undefined;
        messaging.listWallets()
            .then((list) => {
                if (!live) return;
                setWalletFormat((list || []).find((w) => w.id === walletId)?.format);
            })
            .catch(() => { /* fall back to the chain default */ });
        return () => { live = false; };
    }, [messaging, walletId]);

    const coinOptions = useMemo(() => offeredChainIds
        .map((cid) => chainRegistry.get(cid))
        .filter(Boolean)
        .map((d) => ({
            chainId: d.id,
            addressTypes: d.addressTypes,
            defaultAddressType: flowsLib.defaultAddressTypeForFormat(d, walletFormat),
            coin: d.coin,
            networkKind: d.networkKind,
        })), [offeredChainIds, walletFormat]);

    // A caller that already has a chain (Receive) seeds it; an unknown one
    // falls back to the first option through `selected` below.
    const [chainId, setChainId] = useState(initialChainId || coinOptions[0]?.chainId || '');
    // Settings land after the first render, so the option list can grow from
    // empty. Fall back to the first option until the user picks one.
    const selected = coinOptions.find((c) => c.chainId === chainId) || coinOptions[0] || null;
    const effectiveChainId = selected?.chainId || chainId || '';
    // Left empty on purpose: both the coin options and the wallet format
    // land after the first render, so seeding this from that render's
    // `selected` would freeze in a default computed before either arrived.
    // `effectiveAddressType` below supplies the default until the user picks.
    const [addressType, setAddressType] = useState('');
    // Same late-arrival guard as the coin: an untouched type field follows the
    // selected chain's default rather than staying empty.
    // Only the types the installed SDK can generate; a stale pick falls back to the default.
    const offeredTypes = useSupportedAddressTypes(selected ? chainRegistry.get(selected.chainId) : null);
    const effectiveAddressType = offeredAddressType(
        addressType || selected?.defaultAddressType,
        offeredTypes,
        selected?.defaultAddressType,
    );
    const [purpose, setPurpose] = useState(/** @type {'receive' | 'dispenser'} */ ('receive'));
    const [count, setCount] = useState('1');
    const [derivationIndex, setDerivationIndex] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(0);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const generateLockRef = useRef(false);

    // Changing the coin resets the type to that chain's default, since
    // each chain supports a different address-type set.
    function changeCoin(nextChainId) {
        setChainId(nextChainId);
        const d = coinOptions.find((c) => c.chainId === nextChainId);
        setAddressType(d?.defaultAddressType || '');
        setError(null);
    }

    // The optional Address index: blank generates the next address; a value
    // derives the address at exactly that index (the former "Generate at
    // Index" flow, same validation and the same host duplicate check).
    const hasIndex = derivationIndex.trim() !== '';

    async function handleGenerate(event) {
        event.preventDefault();
        if (generateLockRef.current) return;
        const n = hasIndex ? 1 : Number(count);
        if (!effectiveChainId) { setError('Pick a coin.'); return; }
        if (hasIndex) {
            const index = Number(derivationIndex);
            if (!Number.isInteger(index) || index < 0 || index > MAX_DERIVATION_INDEX) {
                setError(`Enter an address number from 0 to ${MAX_DERIVATION_INDEX}.`);
                return;
            }
            if (purpose === 'dispenser') {
                setError('An address index works with the Receive purpose only.');
                return;
            }
            if (typeof messaging.generateReceiveAddress !== 'function') {
                setError('Address generation is not available in this shell.');
                return;
            }
            generateLockRef.current = true;
            setBusy(true);
            setError(null);
            setDone(0);
            try {
                await messaging.generateReceiveAddress({
                    walletId,
                    chainId: effectiveChainId,
                    accountId,
                    addressType: effectiveAddressType,
                    derivationIndex: index,
                });
                onGenerated?.(1);
                onClose();
            } catch (err) {
                setError(userFacingMessage(
                    err,
                    'Could not generate that address. Check the address number and try again.',
                ));
            } finally {
                generateLockRef.current = false;
                setBusy(false);
            }
            return;
        }
        if (!Number.isInteger(n) || n < 1 || n > MAX_ADDRESSES) {
            setError(`Enter a number between 1 and ${MAX_ADDRESSES}.`);
            return;
        }
        generateLockRef.current = true;
        setBusy(true);
        setError(null);
        setDone(0);
        let generated = 0;
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
                generated = i + 1;
                setDone(generated);
            }
            onGenerated?.(generated);
            onClose();
        } catch (err) {
            // A completed iteration is already in the vault, so refresh the
            // parent list even though the modal stays open for the error.
            if (generated > 0) onGenerated?.(generated);
            setError(userFacingMessage(
                err,
                'Could not generate addresses. Make sure the wallet is unlocked or your hardware device is connected.',
            ));
        } finally {
            generateLockRef.current = false;
            setBusy(false);
        }
    }

    const countNum = Number(count);
    const generateLabel = !hasIndex && Number.isInteger(countNum) && countNum > 1
        ? `Add ${countNum} Addresses`
        : 'Add Address';

    const header = (
        <PageHeader
            nested
            onBack={busy ? undefined : onClose}
            title="Add Addresses"        />
    );
    const footer = coinOptions.length > 0 ? (
        <form aria-label="Generate addresses" onSubmit={handleGenerate}>
            <Button
                type="submit"
                variant="primary"
                size="md"
                block
                loading={busy}
                data-testid="add-address-generate"
            >
                <Icon.PlusIcon aria-hidden="true" />
                {generateLabel}
            </Button>
        </form>
    ) : null;
    return (
        <Screen variant={variant} header={header} footer={footer}>
            {coinOptions.length === 0 ? (
                <EmptyState
                    title="No coins available"
                    body="Coins become available when the wallet is unlocked and a supported network is enabled."
                />
            ) : (
                <FormPage
                    label="Add addresses"
                    onSubmit={handleGenerate}
                    status={(error || busy) ? (
                        <>
                            {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
                            {busy ? <p className={styles.progress}>Generating {done}/{countNum}…</p> : null}
                        </>
                    ) : null}
                >
                        <NetworkField
                            label="Coin"
                            help="The coin network for the addresses you generate. Each address is added to this account on that network."
                            value={effectiveChainId}
                            onChange={changeCoin}
                            chainIds={coinOptions.map((c) => c.chainId)}
                            chainRegistry={chainRegistry}
                            disabled={busy}
                        />
                        <Select
                            label="Type"
                            help="The address format to generate. Each type starts with its own prefix, and every type receives coins on this network."
                            value={effectiveAddressType}
                            onChange={(e) => { setAddressType(e.target.value); setError(null); }}
                            disabled={busy || !selected}
                        >
                            {offeredTypes.map((t) => {
                                const hint = addressTypeHint(selected, t);
                                return (
                                    <Select.Option key={t} value={t} icon={<Icon.AddressIcon />}>
                                        {t.toUpperCase()}{hint ? ` (starts with ${hint})` : ''}
                                    </Select.Option>
                                );
                            })}
                        </Select>
                        {typeof messaging.generateDispenserAddress === 'function' ? (
                            <Select
                                label="Purpose"
                                value={purpose}
                                onChange={(e) => {
                                    setPurpose(/** @type {'receive' | 'dispenser'} */ (e.target.value));
                                    setError(null);
                                }}
                                disabled={busy}
                                data-testid="add-address-purpose"
                                help={purpose === 'dispenser'
                                    ? 'Listed under Misc on the Addresses page and offered when opening a dispenser.'
                                    : 'What the new addresses are for. Receive addresses are listed with this account and offered for payments.'}
                            >
                                <Select.Option value="receive" icon={<Icon.ReceiveIcon />}>Receive</Select.Option>
                                <Select.Option value="dispenser" icon={<Icon.TokenIcon />}>Dispenser</Select.Option>
                            </Select>
                        ) : null}
                        <Input
                            label="Number of addresses"
                            help={`How many new addresses to add at once, up to ${MAX_ADDRESSES}. They come next in order from your recovery phrase.`}
                            type="number"
                            inputMode="numeric"
                            enterKeyHint="go"
                            autoComplete="off"
                            min={1}
                            max={MAX_ADDRESSES}
                            value={count}
                            onChange={(e) => { setCount(e.target.value); setError(null); }}
                            onWheel={blurNumberInputOnWheel}
                            disabled={busy || hasIndex}
                        />
                        <Input
                            label="Address index"
                            optional
                            type="number"
                            inputMode="numeric"
                            enterKeyHint="go"
                            autoComplete="off"
                            min={0}
                            max={MAX_DERIVATION_INDEX}
                            step={1}
                            value={derivationIndex}
                            onChange={(e) => { setDerivationIndex(e.target.value); setError(null); }}
                            onWheel={blurNumberInputOnWheel}
                            help="Leave blank to add the next address. Enter a number to add the address at that exact index of your recovery phrase instead (advanced)."
                            disabled={busy}
                            data-testid="add-address-index"
                        />
                </FormPage>
            )}
        </Screen>
    );
}
