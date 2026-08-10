// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { Button, ChainBadge, ChainPicker, Icon, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Multisig is BTC-only at launch (§22 + §10.3). The form gates the
// chain picker to BTC chains only; staking + contracts use the same
// gate but via useBtcAddressesPresent; here we filter inline because
// the multisig flow needs the BTC chainId before any address picker.
const MULTISIG_COIN = 'bitcoin';

const SCHEMES = [
    {
        value: 'p2sh-multisig',
        label: 'Classic multi-signature',
        description: 'The original multi-signature format. Works with virtually every wallet, hardware signer and block explorer, but costs the most in transaction fees.',
    },
    {
        value: 'p2wsh-multisig',
        label: 'SegWit multi-signature (lower fees)',
        description: 'Signs exactly like Classic but costs less in transaction fees. Supported by most current wallets and hardware signers.',
    },
    {
        value: 'taproot-musig2',
        label: 'Taproot multi-signature (most private)',
        description: 'The most private option: on the blockchain it looks like an ordinary single-signature wallet, and it is usually the cheapest to spend from. Every device that signs must support this newer scheme (Ledger Bitcoin app 2.4.0 or later; Trezor Model T on current firmware).',
    },
];

let _idCounter = 0;
const newRowId = () => `cosigner-${++_idCounter}`;

/**
 * §22 + §42.9 multisig wallet creation coordinator (Step 17).
 *
 * Wizard-style flow that gathers N cosigners, lets the user pick
 * scheme + threshold, and persists the resulting MultisigConfig onto
 * the chosen Wallet record's `multisig` slot via
 * `messaging.createMultisigConfig`.
 *
 * Multisig is BTC-only at launch per §22 + §10.3; the chain
 * dropdown lists only the wallet's BTC chains.
 *
 * Cosigners come in three flavors per §22.2:
 *   - **local**: a software account or paired HW signer that the
 *     wallet already owns. Picked by selecting one of the wallet's
 *     own addresses; pubkey + derivationPath auto-fill from the
 *     address record.
 *   - **external-xpub**: an xpub copied in from another wallet. The
 *     wallet can build PSBTs but cannot sign for this cosigner.
 *   - **external-hardware**: a HW device controlled by someone else.
 *     Signs via file transfer.
 *
 * For Taproot-MuSig2 the bg handler aggregates the cosigner pubkeys
 * via `sdk.musig2.aggregateKeys` (BIP327) and stashes the resulting
 * x-only aggregated pubkey in `scriptTemplate` as `musig2:<hex>`. For
 * P2SH/P2WSH the scriptTemplate carries the cosigner pubkey list as
 * `multi:<T>:<pk1>:<pk2>:...`; the actual redeem-script bytes are
 * built at PSBT-construction time (Step 19).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function MultisigCreate({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const btcChainIds = useMemo(
        () => chainRegistry.byCoin(MULTISIG_COIN).map((d) => d.id),
        [],
    );
    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));

    const [scheme, setScheme] = useState(/** @type {'p2sh-multisig' | 'p2wsh-multisig' | 'taproot-musig2'} */ ('p2wsh-multisig'));
    const [threshold, setThreshold] = useState('2');
    const [rows, setRows] = useState(/** @type {CosignerRow[]} */ ([
        { id: newRowId(), origin: 'local', name: 'My signer', pubkey: '', fingerprint: '', derivationPath: '', xpub: '', localSignerId: null, addressId: null },
        { id: newRowId(), origin: 'external-xpub', name: 'Cosigner B', pubkey: '', fingerprint: '', derivationPath: '', xpub: '', localSignerId: null, addressId: null },
    ]));

    const [stage, setStage] = useState(
        /** @type {'compose' | 'submitting' | 'done'} */ ('compose'),
    );
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const btcWithAddresses = btcChainIds.find(
                    (cid) => Array.isArray(byChain?.[cid]) && byChain[cid].length > 0,
                );
                if (!btcWithAddresses) {
                    // Spec §10.3: multisig is Bitcoin-only at launch.
                    setLoadError(
                        'Multisig is available on Bitcoin only for now. Use Receive on a Bitcoin network to generate an address first.',
                    );
                    return;
                }
                setChainId(btcWithAddresses);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load wallet addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, btcChainIds, messaging]);

    const updateRow = (rowId, patch) => {
        setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
    };

    const removeRow = (rowId) => {
        setRows((rs) => rs.filter((r) => r.id !== rowId));
    };

    const addRow = () => {
        setRows((rs) => [...rs, {
            id: newRowId(),
            origin: 'external-xpub',
            name: `Cosigner ${String.fromCharCode(65 + rs.length)}`,
            pubkey: '',
            fingerprint: '',
            derivationPath: '',
            xpub: '',
            localSignerId: null,
            addressId: null,
        }]);
    };

    const handleLocalAddressPick = (rowId, address) => {
        // Auto-fill pubkey + derivationPath from the picked address
        // record. Fingerprint is left for the user to fill in; deriving the
        // BIP32 master fingerprint requires unlocking the seed, which
        // is out of Step 17's scope. The user can copy the value from
        // their wallet's "Show xpub" surface.
        updateRow(rowId, {
            addressId: address?.id || null,
            pubkey: address?.publicKey || '',
            derivationPath: address?.derivationPath || '',
            // Local cosigner doesn't need a separate signer id slot
            // unless the address is HW-backed; preserve that.
            localSignerId: address?.signerId || `wallet:${walletId}`,
        });
    };

    const composeError = useMemo(() => {
        if (rows.length < 2) return 'Need at least 2 cosigners.';
        const t = Number(threshold);
        if (!Number.isInteger(t) || t <= 0) return 'Threshold must be a positive integer.';
        if (t > rows.length) return 'Threshold must be ≤ cosigner count.';
        // MuSig2 is n-of-n: a T<N Taproot-MuSig2 address can never be signed by
        // fewer than N cosigners, so the funds would be permanently locked.
        // Steer the user to P2WSH for a genuine T-of-N policy.
        if (scheme === 'taproot-musig2' && t !== rows.length) {
            return `Taproot multi-signature requires all ${rows.length} cosigners to sign (set the threshold to ${rows.length}). To let ${t} of ${rows.length} sign, pick SegWit multi-signature instead.`;
        }
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i];
            const tag = `Cosigner ${i + 1}`;
            if (!r.name) return `${tag}: name is required.`;
            if (!r.pubkey || !/^[0-9a-fA-F]+$/.test(r.pubkey)) return `${tag}: pubkey must be hex.`;
            if (!r.fingerprint || !/^[0-9a-fA-F]{8}$/.test(r.fingerprint)) return `${tag}: fingerprint must be 8 hex chars (4 bytes).`;
            if (!r.derivationPath) return `${tag}: derivation path is required.`;
            if (r.origin === 'external-xpub' && !r.xpub) return `${tag}: xpub is required for external-xpub origin.`;
        }
        const seen = new Set();
        for (const r of rows) {
            const key = r.pubkey.toLowerCase();
            if (seen.has(key)) return 'Two cosigners share the same pubkey.';
            seen.add(key);
        }
        return null;
    }, [rows, threshold, scheme]);

    async function handleSubmit() {
        if (composeError) return;
        if (!chainId) return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const r = await messaging.createMultisigConfig({
                walletId,
                chainId,
                scheme,
                threshold: Number(threshold),
                cosigners: rows.map((row) => ({
                    name: row.name,
                    pubkey: row.pubkey,
                    fingerprint: row.fingerprint,
                    origin: row.origin,
                    localSignerId: row.origin === 'local' ? row.localSignerId : null,
                    xpub: row.origin === 'external-xpub' ? row.xpub : null,
                    derivationPath: row.derivationPath,
                })),
            });
            setResult(r);
            setStage('done');
        } catch (err) {
            setSubmitError(err?.message || 'Failed to create multisig configuration.');
            setStage('compose');
        }
    }

        const header = (
        <PageHeader
            onBack={onBack}
            title="Create multisig"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
                <div className={styles.actions}>
                </div>
            </>,
        );
    }

    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (stage === 'done') {
        const config = result?.config;
        return wrap(
            <>
                <p className={styles.successTitle}>Multisig configured</p>
                <p className={styles.hint}>
                    Wallet "{result?.wallet?.name || walletId}" now has a{' '}
                    {config?.threshold}-of-{config?.cosigners?.length}{' '}
                    {schemeLabel(config?.scheme)} multisig configuration.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Scheme</dt>
                    <dd className={styles.detailsValue}>{config?.scheme || 'N/A'}</dd>
                    <dt className={styles.detailsLabel}>Threshold</dt>
                    <dd className={styles.detailsValue}>
                        {config?.threshold} of {config?.cosigners?.length}
                    </dd>
                    <dt className={styles.detailsLabel}>scriptTemplate</dt>
                    <dd className={styles.detailsValue} style={{ fontFamily: 'var(--xc-font-mono, monospace)', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                        {config?.scriptTemplate || 'N/A'}
                    </dd>
                </dl>
                <p className={styles.hint}>
                    Address derivation, transaction construction, QR transport, and
                    HW MuSig2 wiring land in Steps 18–22. The persisted
                    `MultisigConfig` is the structural prerequisite; later
                    steps consume it.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    const descriptor = chainRegistry.get(chainId);
    const localAddresses = (addressesByChain[chainId] || []);

    return wrap(
        <>
            <p className={styles.hint} style={{ textAlign: 'left' }}>
                Multisig is Bitcoin-only at launch (§10.3). Pick the BTC
                network this multisig configuration belongs to, then add at
                least 2 cosigners. The current wallet contributes the
                "local" cosigner; external cosigners come in via xpub paste
                or hardware-pairing.
            </p>

            <ChainPicker
                label="Network"
                value={chainId}
                onChange={setChainId}
                chainIds={btcChainIds.filter((cid) => Array.isArray(addressesByChain[cid]) && addressesByChain[cid].length > 0)}
                chainRegistry={chainRegistry}
            />

            <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>Cosigners</legend>
                {rows.map((row, i) => (
                    <CosignerRow
                        key={row.id}
                        index={i}
                        row={row}
                        addresses={localAddresses}
                        onChange={(patch) => updateRow(row.id, patch)}
                        onRemove={() => removeRow(row.id)}
                        canRemove={rows.length > 2}
                        onLocalAddressPick={(addr) => handleLocalAddressPick(row.id, addr)}
                    />
                ))}
                <div style={{ marginTop: 'var(--xc-space-2)' }}>
                    <Button type="button" variant="secondary" onClick={addRow}>
                        + Add cosigner
                    </Button>
                </div>
            </fieldset>

            <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>Scheme</legend>
                {SCHEMES.map((s) => (
                    <label key={s.value} className={styles.checkRow} style={{ alignItems: 'flex-start' }}>
                        <input
                            type="radio"
                            name="scheme"
                            value={s.value}
                            checked={scheme === s.value}
                            onChange={() => setScheme(s.value)}
                        />
                        <span>
                            <strong>{s.label}</strong>
                            <span style={{ display: 'block', fontSize: '0.85em', color: 'var(--xc-text-muted)' }}>
                                {s.description}
                            </span>
                        </span>
                    </label>
                ))}
            </fieldset>

            <Input
                label={`Threshold (1..${rows.length})`}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
            />

            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Network</dt>
                <dd className={styles.detailsValue}>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                </dd>
                <dt className={styles.detailsLabel}>Configuration</dt>
                <dd className={styles.detailsValue}>
                    {threshold || '?'}-of-{rows.length} {schemeLabel(scheme)}
                </dd>
            </dl>

            {composeError ? (
                <StatusMessage variant="error" className={styles.error}>{composeError}</StatusMessage>
            ) : null}
            {submitError ? (
                <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
            ) : null}

            <div className={styles.actions}>
                <Button
                    type="button"
                    variant="primary"
                    onClick={handleSubmit}
                    disabled={Boolean(composeError) || stage === 'submitting'}
                    loading={stage === 'submitting'}
                >
                    Create multisig
                </Button>
            </div>
        </>,
    );
}

function CosignerRow({ index, row, addresses, onChange, onRemove, canRemove, onLocalAddressPick }) {
    return (
        <fieldset style={{ ...fieldsetStyle, background: 'var(--xc-surface-raised)', marginBottom: 'var(--xc-space-2)' }}>
            <legend style={legendStyle}>Cosigner {index + 1}</legend>

            <Input
                label="Name"
                value={row.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="My signer / Bob's Trezor / cold-storage xpub"
            />

            <label className={styles.pickerLabel}>
                <span>Origin</span>
                <select
                    className={styles.picker}
                    value={row.origin}
                    onChange={(e) => onChange({
                        origin: e.target.value,
                        // Clear origin-specific fields when switching.
                        xpub: '',
                        addressId: null,
                        localSignerId: null,
                    })}
                >
                    <option value="local">Local (software account or paired HW signer)</option>
                    <option value="external-xpub">External xpub (paste from another wallet)</option>
                    <option value="external-hardware">External hardware (sign via file transfer)</option>
                </select>
            </label>

            {row.origin === 'local' ? (
                <label className={styles.pickerLabel}>
                    <span>Use one of this wallet's addresses</span>
                    <select
                        className={styles.picker}
                        value={row.addressId || ''}
                        onChange={(e) => {
                            const a = addresses.find((x) => x.id === e.target.value);
                            onLocalAddressPick(a || null);
                        }}
                    >
                        <option value="">Select address</option>
                        {addresses.map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.address} {a.label ? `· ${a.label}` : ''}
                            </option>
                        ))}
                    </select>
                </label>
            ) : null}

            {row.origin === 'external-xpub' ? (
                <Input
                    label="xpub"
                    value={row.xpub}
                    onChange={(e) => onChange({ xpub: e.target.value.trim() })}
                    placeholder="xpub6CUGRUonZSQ4..."
                />
            ) : null}

            <Input
                label="Public key (hex, 33-byte compressed)"
                value={row.pubkey}
                onChange={(e) => onChange({ pubkey: e.target.value.trim() })}
                placeholder="02abcdef…"
            />

            <Input
                label="Master fingerprint (4 bytes hex)"
                value={row.fingerprint}
                onChange={(e) => onChange({ fingerprint: e.target.value.trim() })}
                placeholder="73c5da0a"
            />

            <Input
                label="Derivation path"
                value={row.derivationPath}
                onChange={(e) => onChange({ derivationPath: e.target.value.trim() })}
                placeholder="m/48'/0'/0'/2'/0/0"
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="button" variant="ghost" onClick={onRemove} disabled={!canRemove}>
                    Remove
                </Button>
            </div>
        </fieldset>
    );
}

/** @typedef {{
 *   id: string,
 *   origin: 'local' | 'external-xpub' | 'external-hardware',
 *   name: string,
 *   pubkey: string,
 *   fingerprint: string,
 *   derivationPath: string,
 *   xpub: string,
 *   localSignerId: string | null,
 *   addressId: string | null,
 * }} CosignerRow
 */

function schemeLabel(value) {
    const found = SCHEMES.find((s) => s.value === value);
    return found ? found.label : value;
}

const fieldsetStyle = {
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    padding: 'var(--xc-space-3)',
    margin: '0 0 var(--xc-space-3) 0',
    background: 'var(--xc-bg-muted)',
};

const legendStyle = {
    fontWeight: 600,
    padding: '0 var(--xc-space-2)',
};
