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
import { Button, ChainBadge, ChainPicker, FieldNote, FormPage, FormSection, Input, ListPage, PageHeader, RadioGroup, Screen, Select, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { isCompressedPublicKey, validateCosignerXpub } from '../utils/multisigXpub.js';
import { MAX_MULTISIG_COSIGNERS } from '../../schemas/multisigConfig.js';
import { MultisigCosignerShare } from './MultisigCosignerShare.jsx';
import styles from './IssueTokenForm.module.css';
import cardStyles from '../../ui/Card.module.css';

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

export function parseCosignerSharePayload(value, networkKind) {
    let payload;
    try {
        payload = JSON.parse(value);
    } catch {
        throw new Error('Shared cosigner setup is not valid JSON.');
    }
    if (!payload || payload.type !== 'xchain-multisig-cosigner' || payload.version !== 1) {
        throw new Error('Shared cosigner setup has an unsupported type or version.');
    }
    if (payload.network !== networkKind) {
        throw new Error('Shared cosigner setup is for a different network than this wallet.');
    }
    if (!isCompressedPublicKey(payload.pubkey)) {
        throw new Error('Shared cosigner setup contains an invalid public key.');
    }
    if (!/^[0-9a-fA-F]{8}$/.test(payload.fingerprint || '')) {
        throw new Error('Shared cosigner setup contains an invalid master fingerprint.');
    }
    if (!/^m(?:\/\d+'?)*$/.test(payload.derivationPath || '')) {
        throw new Error('Shared cosigner setup contains an invalid derivation path.');
    }
    if (typeof payload.xpub !== 'string' || payload.xpub.length === 0) {
        throw new Error('Shared cosigner setup does not contain an extended public key.');
    }
    const xpubError = validateCosignerXpub(
        payload.xpub,
        networkKind,
        payload.derivationPath,
        payload.pubkey,
    );
    if (xpubError) throw new Error(`Shared cosigner setup: ${xpubError}`);
    return {
        xpub: payload.xpub,
        pubkey: payload.pubkey.toLowerCase(),
        fingerprint: payload.fingerprint.toLowerCase(),
        derivationPath: payload.derivationPath,
    };
}

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
 *     address record and the master fingerprint from the unlocked
 *     signer (`multisig.cosignerInfo`). At most one row may be local.
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
    // A fresh form is incomplete by definition; the live validation message
    // only shows once the user has changed something, so the screen does not
    // open on a red error.
    const [edited, setEdited] = useState(false);
    const [rows, setRows] = useState(/** @type {CosignerRow[]} */ ([
        { id: newRowId(), origin: 'local', name: 'My signer', pubkey: '', fingerprint: '', derivationPath: '', xpub: '', localSignerId: null, addressId: null },
        { id: newRowId(), origin: 'external-xpub', name: 'Cosigner B', pubkey: '', fingerprint: '', derivationPath: '', xpub: '', localSignerId: null, addressId: null },
    ]));

    const [stage, setStage] = useState(
        /** @type {'compose' | 'review' | 'submitting' | 'done'} */ ('compose'),
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
                console.error('MultisigCreate: load addresses failed:', err); // eslint-disable-line no-console
                if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load addresses.'));
            });
        return () => { cancelled = true; };
    }, [walletId, btcChainIds, messaging]);

    const updateRow = (rowId, patch) => {
        setEdited(true);
        setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
    };

    const removeRow = (rowId) => {
        setEdited(true);
        setRows((rs) => rs.filter((r) => r.id !== rowId));
    };

    const addRow = () => {
        setEdited(true);
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
        // record, then ask the host for the BIP32 master fingerprint,
        // which only the unlocked signer can compute.
        updateRow(rowId, {
            addressId: address?.id || null,
            pubkey: address?.publicKey || '',
            derivationPath: address?.derivationPath || '',
            fingerprint: '',
            fingerprintNote: null,
            // Local cosigner doesn't need a separate signer id slot
            // unless the address is HW-backed; preserve that.
            localSignerId: address?.signerId || `wallet:${walletId}`,
        });
        if (!address?.id || typeof messaging.getMultisigCosignerInfo !== 'function') return;
        messaging.getMultisigCosignerInfo({ walletId, addressId: address.id })
            .then((info) => {
                // Only fill the row if the user has not since picked another address.
                setRows((rs) => rs.map((r) => (r.id === rowId && r.addressId === address.id
                    ? { ...r, fingerprint: info?.fingerprint || '', fingerprintNote: null }
                    : r)));
            })
            .catch((err) => {
                // The field stays editable, so a failed read falls back to typing it in.
                setRows((rs) => rs.map((r) => (r.id === rowId && r.addressId === address.id
                    ? { ...r, fingerprintNote: `${userFacingMessage(err, 'Could not read the master fingerprint.')} Enter it by hand.` }
                    : r)));
            });
    };

    const composeError = useMemo(() => {
        if (rows.length < 2) return 'Need at least 2 cosigners.';
        // The host's table, so the form never offers a row count it refuses.
        const maxCosigners = MAX_MULTISIG_COSIGNERS[scheme];
        if (rows.length > maxCosigners) {
            return `${schemeLabel(scheme)} supports at most ${maxCosigners} cosigners.`;
        }
        const rawThreshold = threshold.trim();
        if (!rawThreshold) return 'Threshold is required.';
        if (!/^-?\d+(?:\.\d+)?$/.test(rawThreshold)) return 'Threshold must be a whole number.';
        const t = Number(rawThreshold);
        if (!Number.isInteger(t)) return 'Threshold must be a whole number.';
        if (t <= 0) return 'Threshold must be at least 1.';
        if (t > rows.length) return 'Threshold must be ≤ cosigner count.';
        // MuSig2 is n-of-n: a T<N Taproot-MuSig2 address can never be signed by
        // fewer than N cosigners, so the funds would be permanently locked.
        // Steer the user to P2WSH for a genuine T-of-N policy.
        if (scheme === 'taproot-musig2' && t !== rows.length) {
            return `Taproot multi-signature requires all ${rows.length} cosigners to sign (set the threshold to ${rows.length}). To let ${t} of ${rows.length} sign, pick SegWit multi-signature instead.`;
        }
        // Only one cosigner can be this wallet's own key: local signing
        // signs for exactly one, so a second could never add its signature.
        if (rows.filter((r) => r.origin === 'local').length > 1) {
            return 'Only one cosigner can be this wallet\'s own key. Add the others as external cosigners.';
        }
        const selectedAddresses = chainId ? (addressesByChain?.[chainId] || []) : [];
        const ownPubkeys = new Set(
            Object.values(addressesByChain || {})
                .flat()
                .map((address) => String(address?.publicKey || '').toLowerCase())
                .filter(Boolean),
        );
        const seenPubkeys = new Set();
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i];
            const tag = `Cosigner ${i + 1}`;
            if (!r.name.trim()) return `${tag}: name is required.`;
            if (!isCompressedPublicKey(r.pubkey)) {
                return `${tag}: public key must be a 33-byte compressed key in hex.`;
            }
            const normalizedPubkey = r.pubkey.toLowerCase();
            if (seenPubkeys.has(normalizedPubkey)) return 'Two cosigners share the same public key.';
            seenPubkeys.add(normalizedPubkey);
            if (r.origin !== 'local' && ownPubkeys.has(normalizedPubkey)) {
                return `${tag}: this is one of the current wallet's own keys. Select it as the local cosigner instead.`;
            }
            if (r.origin === 'local') {
                const selected = selectedAddresses.find((address) => address.id === r.addressId);
                if (!selected) return `${tag}: select a local address on the chosen network.`;
                if (String(selected.publicKey || '').toLowerCase() !== normalizedPubkey
                    || selected.derivationPath !== r.derivationPath) {
                    return `${tag}: local key details do not match the selected address.`;
                }
            }
            if (!r.fingerprint || !/^[0-9a-fA-F]{8}$/.test(r.fingerprint)) return `${tag}: fingerprint must be 8 hex chars (4 bytes).`;
            if (!/^m(?:\/\d+'?)*$/.test(r.derivationPath)) return `${tag}: enter a valid derivation path starting with m.`;
            if (r.origin === 'external-xpub') {
                if (!r.xpub) return `${tag}: xpub is required for external-xpub origin.`;
                const descriptor = chainId ? chainRegistry.get(chainId) : null;
                const xpubError = validateCosignerXpub(
                    r.xpub,
                    descriptor?.networkKind,
                    r.derivationPath,
                    r.pubkey,
                );
                if (xpubError) return `${tag}: ${xpubError}`;
            }
        }
        return null;
    }, [rows, threshold, scheme, chainId, addressesByChain]);

    function handleReview(event) {
        event?.preventDefault();
        if (composeError || !chainId) return;
        setSubmitError(null);
        setStage('review');
    }

    async function handleSubmit(event) {
        event?.preventDefault();
        if (stage !== 'review') return;
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
            console.error('MultisigCreate: create multisig failed:', err); // eslint-disable-line no-console
            setSubmitError(userFacingMessage(err, 'Failed to create multisig configuration.'));
            setStage('review');
        }
    }

    const header = (
        <PageHeader
            onBack={stage === 'review' || stage === 'submitting' ? () => setStage('compose') : onBack}
            backDisabled={stage === 'submitting'}
            title={stage === 'review' || stage === 'submitting' ? 'Review multisig' : 'Create multisig'}
        />
    );
    // The review always opens at its top instead of inheriting how far the
    // form was scrolled; the form keeps its own position for Back.
    const wrap = (children) => (
        <Screen
            variant={variant}
            header={header}
            restoreScroll={!(stage === 'review' || stage === 'submitting')}
        >
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </ListPage>,
        );
    }

    if (!addressesByChain || !chainId) {
        return wrap(<ListPage><p className={styles.hint}>Loading wallet…</p></ListPage>);
    }

    if (stage === 'done') {
        const config = result?.config;
        return wrap(
            <ListPage>
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
                </dl>
                <p className={styles.hint}>
                    The shared address now appears on the Receive screen. Spending
                    from it opens a signing session where each cosigner approves in
                    turn, in the app or by scanning the transaction QR code.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    const descriptor = chainRegistry.get(chainId);
    const localAddresses = (addressesByChain[chainId] || []);

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <FormPage
                label="Review multisig"
                onSubmit={handleSubmit}
                status={submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <div className={styles.actions}>
                        {/* Prevent the reconciled button from submitting the compose form. */}
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={stage === 'submitting'}
                            onClick={(event) => { event.preventDefault(); setStage('compose'); }}
                        >
                            Edit
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            loading={stage === 'submitting'}
                        >
                            Confirm multisig
                        </Button>
                    </div>
                )}
            >
                <p className={styles.summary}>
                    Verify the network, approval threshold, and every cosigner key.
                    These values determine the shared address and cannot be corrected
                    after funds are sent to it.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Network</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" showName={false} /> : 'Selected network'}
                    </dd>
                    <dt className={styles.detailsLabel}>Configuration</dt>
                    <dd className={styles.detailsValue}>
                        {Number(threshold)}-of-{rows.length} {schemeLabel(scheme)}
                    </dd>
                </dl>
                {rows.map((row, index) => (
                    <ReviewCosigner key={row.id} row={row} index={index} />
                ))}
            </FormPage>,
        );
    }

    return wrap(
        <FormPage
            label="Create multisig"
            onSubmit={handleReview}
            sectioned
            status={(edited && composeError) || submitError ? (
                <>
                    {edited && composeError ? (
                        <StatusMessage variant="error">{composeError}</StatusMessage>
                    ) : null}
                    {submitError ? (
                        <StatusMessage variant="error">{submitError}</StatusMessage>
                    ) : null}
                </>
            ) : null}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    disabled={Boolean(composeError) || stage === 'submitting'}
                    loading={stage === 'submitting'}
                >
                    Review
                </Button>
            )}
        >
            <FormSection title="Cosigners">
                <details>
                    <summary>How multisig setup works</summary>
                    <p className={styles.hint}>
                        Multisig is available only on Bitcoin networks. Add at least 2 cosigners.
                        The current wallet contributes the local cosigner; add external cosigners
                        by pasting an xpub or pairing hardware. To join another multisig, open
                        Share this wallet as a cosigner and send them the values.
                    </p>
                </details>
                <ChainPicker
                    label="Network"
                    value={chainId}
                    onChange={(value) => { setEdited(true); setChainId(value); }}
                    chainIds={btcChainIds.filter((cid) => Array.isArray(addressesByChain[cid]) && addressesByChain[cid].length > 0)}
                    chainRegistry={chainRegistry}
                    hideNetworkKind
                />
                {rows.map((row, i) => (
                    <CosignerRow
                        key={row.id}
                        index={i}
                        row={row}
                        addresses={localAddresses}
                        networkKind={descriptor?.networkKind}
                        onChange={(patch) => updateRow(row.id, patch)}
                        onRemove={() => removeRow(row.id)}
                        canRemove={rows.length > 2}
                        onLocalAddressPick={(addr) => handleLocalAddressPick(row.id, addr)}
                    />
                ))}
                <div style={{ marginTop: 'var(--xc-space-2)' }}>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={addRow}
                        disabled={rows.length >= MAX_MULTISIG_COSIGNERS[scheme]}
                    >
                        + Add cosigner
                    </Button>
                </div>
                <MultisigCosignerShare
                    key={chainId}
                    walletId={walletId}
                    addresses={localAddresses}
                    networkKind={descriptor?.networkKind}
                />
            </FormSection>

            <FormSection title="Scheme">
                <RadioGroup
                    legend={<span className="sr-only">Scheme</span>}
                    name="scheme"
                    value={scheme}
                    onChange={(value) => { setEdited(true); setScheme(value); }}
                    options={SCHEMES.map((option) => ({
                        ...option,
                        label: <strong>{option.label}</strong>,
                    }))}
                />
            </FormSection>

            <FormSection title="Configuration">
                <Input
                    label={`Threshold (1..${rows.length})`}
                    value={threshold}
                    onChange={(e) => { setEdited(true); setThreshold(e.target.value); }}
                    inputMode="numeric"
                />

                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Network</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" showName={false} /> : 'Selected network'}
                    </dd>
                    <dt className={styles.detailsLabel}>Configuration</dt>
                    <dd className={styles.detailsValue}>
                        {threshold || '?'}-of-{rows.length} {schemeLabel(scheme)}
                    </dd>
                </dl>
            </FormSection>
        </FormPage>,
    );
}

function ReviewCosigner({ index, row }) {
    return (
        <fieldset className={cardStyles.card} style={fieldsetStyle}>
            <legend style={legendStyle}>Cosigner {index + 1}: {row.name}</legend>
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Origin</dt>
                <dd className={styles.detailsValue}>{originLabel(row.origin)}</dd>
                <dt className={styles.detailsLabel}>Public key</dt>
                <dd className={styles.detailsValue}><code style={keyValueStyle}>{row.pubkey.toLowerCase()}</code></dd>
                {row.origin === 'external-xpub' ? (
                    <>
                        <dt className={styles.detailsLabel}>xpub</dt>
                        <dd className={styles.detailsValue}><code style={keyValueStyle}>{row.xpub}</code></dd>
                    </>
                ) : null}
                <dt className={styles.detailsLabel}>Master fingerprint</dt>
                <dd className={styles.detailsValue}><code style={keyValueStyle}>{row.fingerprint.toLowerCase()}</code></dd>
                <dt className={styles.detailsLabel}>Derivation path</dt>
                <dd className={styles.detailsValue}><code style={keyValueStyle}>{row.derivationPath}</code></dd>
            </dl>
        </fieldset>
    );
}

function CosignerRow({ index, row, addresses, networkKind, onChange, onRemove, canRemove, onLocalAddressPick }) {
    return (
        <fieldset className={cardStyles.card} style={{ ...fieldsetStyle, marginBottom: 'var(--xc-space-2)' }}>
            <legend style={legendStyle}>Cosigner {index + 1}</legend>

            <Input
                label="Name"
                value={row.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="My signer / Bob's Trezor / cold-storage xpub"
            />

            <Select
                label="Origin"
                hint={ORIGIN_HINTS[row.origin]}
                value={row.origin}
                onChange={(e) => onChange({
                    origin: e.target.value,
                    // Clear origin-specific fields when switching.
                    xpub: '',
                    addressId: null,
                    localSignerId: null,
                    fingerprintNote: null,
                    // Keys auto-filled from this wallet must not ride along
                    // into an external cosigner row.
                    ...(row.origin === 'local' ? { pubkey: '', fingerprint: '', derivationPath: '' } : {}),
                })}
            >
                <option value="local">Local signer</option>
                <option value="external-xpub">External xpub</option>
                <option value="external-hardware">External hardware</option>
            </Select>

            {row.origin === 'local' ? (
                <Select
                    label="Use one of this wallet's addresses"
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
                </Select>
            ) : null}

            {row.origin === 'external-xpub' ? (
                <>
                    <Textarea
                        label="Shared cosigner setup (optional)"
                        value={row.sharePayload || ''}
                        onChange={(e) => onChange({ sharePayload: e.target.value, shareError: null })}
                        rows={3}
                    />
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                            try {
                                onChange({
                                    ...parseCosignerSharePayload(row.sharePayload || '', networkKind),
                                    shareError: null,
                                });
                            } catch (err) {
                                onChange({ shareError: err.message });
                            }
                        }}
                    >
                        Import shared setup
                    </Button>
                    {row.shareError ? <FieldNote variant="error">{row.shareError}</FieldNote> : null}
                    <Input
                        label="xpub"
                        value={row.xpub}
                        onChange={(e) => onChange({ xpub: e.target.value.trim() })}
                        placeholder="xpub6CUGRUonZSQ4..."
                    />
                </>
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
            {row.fingerprintNote ? (
                <p className={styles.hint} style={{ textAlign: 'left' }}>{row.fingerprintNote}</p>
            ) : null}

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
 *   fingerprintNote?: string | null,
 * }} CosignerRow
 */

function schemeLabel(value) {
    const found = SCHEMES.find((s) => s.value === value);
    return found ? found.label : value;
}

// The option labels stay short enough to show whole in a narrow select; what each
// origin means sits under the field instead.
const ORIGIN_HINTS = {
    local: 'A software account or paired hardware signer in this wallet.',
    'external-xpub': 'Paste the xpub from another wallet.',
    'external-hardware': 'Sign through file transfer.',
};

function originLabel(origin) {
    if (origin === 'local') return 'Local signer';
    if (origin === 'external-xpub') return 'External xpub';
    return 'External hardware';
}

const fieldsetStyle = {
    margin: '0 0 var(--xc-space-3) 0',
};

const legendStyle = {
    fontWeight: 600,
    padding: '0 var(--xc-space-2)',
};

const keyValueStyle = {
    display: 'block',
    fontFamily: 'var(--xc-font-mono)',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
};
