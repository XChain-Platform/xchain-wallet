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
import { AddressField, Button, ChainBadge, FieldNote, FormPage, Icon, InfoTip, Input, ListPage, NetworkField, PageHeader, Screen, SectionHeader, Select, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { isCompressedPublicKey, validateCosignerXpub } from '../utils/multisigXpub.js';
import { MAX_MULTISIG_COSIGNERS } from '../../schemas/multisigConfig.js';
import { MultisigCosignerShare, unavailableAddressReason } from './MultisigCosignerShare.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import sharedStyles from './IssueTokenForm.module.css';
import styles from './MultisigCreate.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Multisig is BTC-only at launch (§22 + §10.3). The form gates the
// chain picker to BTC chains only; staking + contracts use the same
// gate but via useBtcAddressesPresent; here we filter inline because
// the multisig flow needs the BTC chainId before any address picker.
const MULTISIG_COIN = 'bitcoin';
const FORM_KEY = 'form';

const SCHEMES = [
    {
        value: 'p2sh-multisig',
        label: 'Classic',
    },
    {
        value: 'p2wsh-multisig',
        label: 'SegWit',
    },
    {
        value: 'taproot-musig2',
        label: 'Taproot',
    },
];

const TYPE_HELP = 'Classic works with every Bitcoin wallet. SegWit has lower fees and is the common choice. Taproot is the most private and every cosigner must sign.';

let _idCounter = 0;
const newRowId = () => `cosigner-${++_idCounter}`;

export function clampThreshold({ chosen, cosignerCount, scheme }) {
    const count = Math.max(0, Math.floor(Number(cosignerCount) || 0));
    if (scheme === 'taproot-musig2') return count;
    const value = Number(chosen);
    if (!Number.isFinite(value)) return count > 0 ? 1 : 0;
    return Math.min(Math.max(Math.floor(value), 1), count);
}

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
    const [touched, setTouched] = useState(/** @type {Set<string>} */ (() => new Set()));
    const touch = (key) => setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
    const [rows, setRows] = useState(/** @type {CosignerRow[]} */ ([
        { id: newRowId(), origin: 'local', name: 'My signer', pubkey: '', fingerprint: '', derivationPath: '', xpub: '', localSignerId: null, addressId: null },
        { id: newRowId(), origin: 'external-xpub', name: 'Cosigner B', pubkey: '', fingerprint: '', derivationPath: '', xpub: '', localSignerId: null, addressId: null },
    ]));
    const [showCosignerShare, setShowCosignerShare] = useState(false);
    const [localPickerRowId, setLocalPickerRowId] = useState(/** @type {string | null} */ (null));
    const [sharePickerOpen, setSharePickerOpen] = useState(false);
    const [shareAddressId, setShareAddressId] = useState('');

    // Keep the selected threshold while the group grows, but never leave it
    // above the number of cosigners or below Taproot's all-signers rule.
    useEffect(() => {
        setThreshold((current) => String(clampThreshold({
            chosen: current,
            cosignerCount: rows.length,
            scheme,
        })));
    }, [rows.length, scheme]);

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

    const updateRow = (rowId, patch, touchFields = Object.keys(patch)) => {
        setEdited(true);
        for (const field of touchFields) touch(`${rowId}:${field}`);
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

    const adjustThreshold = (change) => {
        setEdited(true);
        touch('threshold');
        setThreshold((current) => String(clampThreshold({
            chosen: Number(current) + change,
            cosignerCount: rows.length,
            scheme,
        })));
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
        }, ['addressId']);
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

    // Every problem with the draft, in display order. A problem carries the
    // key of the field it belongs to ("<rowId>:<field>", "threshold") or
    // FORM_KEY when it concerns the draft as a whole.
    const composeProblems = useMemo(() => {
        const problems = [];
        const add = (key, message) => { problems.push({ key, message }); };
        const form = (message) => { add(FORM_KEY, message); return problems; };
        if (rows.length < 2) return form('Need at least 2 cosigners.');
        // The host's table, so the form never offers a row count it refuses.
        const maxCosigners = MAX_MULTISIG_COSIGNERS[scheme];
        if (rows.length > maxCosigners) {
            return form(`${schemeLabel(scheme)} supports at most ${maxCosigners} cosigners.`);
        }
        const rawThreshold = threshold.trim();
        const thresholdProblem = (message) => { add('threshold', message); return problems; };
        if (!rawThreshold) return thresholdProblem('Threshold is required.');
        if (!/^-?\d+(?:\.\d+)?$/.test(rawThreshold)) return thresholdProblem('Threshold must be a whole number.');
        const t = Number(rawThreshold);
        if (!Number.isInteger(t)) return thresholdProblem('Threshold must be a whole number.');
        if (t <= 0) return thresholdProblem('Threshold must be at least 1.');
        if (t > rows.length) return thresholdProblem('Threshold must be ≤ cosigner count.');
        // MuSig2 is n-of-n: a T<N Taproot-MuSig2 address can never be signed by
        // fewer than N cosigners, so the funds would be permanently locked.
        // Steer the user to P2WSH for a genuine T-of-N policy.
        if (scheme === 'taproot-musig2' && t !== rows.length) {
            return form(`Taproot requires all ${rows.length} cosigners to sign (set the threshold to ${rows.length}). To let ${t} of ${rows.length} sign, pick SegWit instead.`);
        }
        // Only one cosigner can be this wallet's own key: local signing
        // signs for exactly one, so a second could never add its signature.
        if (rows.filter((r) => r.origin === 'local').length > 1) {
            return form('Only one cosigner can be this wallet\'s own key. Add the others as external cosigners.');
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
            const at = (field) => `${r.id}:${field}`;
            if (!r.name.trim()) add(at('name'), `${tag}: name is required.`);
            if (!isCompressedPublicKey(r.pubkey)) {
                add(at('pubkey'), `${tag}: public key must be 66 characters starting with 02 or 03.`);
                continue;
            }
            const normalizedPubkey = r.pubkey.toLowerCase();
            if (seenPubkeys.has(normalizedPubkey)) {
                add(at('pubkey'), 'Two cosigners share the same public key.');
                continue;
            }
            seenPubkeys.add(normalizedPubkey);
            if (r.origin !== 'local' && ownPubkeys.has(normalizedPubkey)) {
                add(at('pubkey'), `${tag}: this is one of the current wallet's own keys. Select it as the local cosigner instead.`);
                continue;
            }
            if (r.origin === 'local') {
                const selected = selectedAddresses.find((address) => address.id === r.addressId);
                if (!selected) {
                    add(at('addressId'), `${tag}: select a local address on the chosen network.`);
                    continue;
                }
                if (String(selected.publicKey || '').toLowerCase() !== normalizedPubkey
                    || selected.derivationPath !== r.derivationPath) {
                    add(at('addressId'), `${tag}: local key details do not match the selected address.`);
                    continue;
                }
            }
            if (!r.fingerprint || !/^[0-9a-fA-F]{8}$/.test(r.fingerprint)) add(at('fingerprint'), `${tag}: fingerprint must be 8 characters, using 0 to 9 and a to f.`);
            if (!/^m(?:\/\d+'?)*$/.test(r.derivationPath)) {
                add(at('derivationPath'), `${tag}: enter a valid derivation path starting with m.`);
                continue;
            }
            if (r.origin === 'external-xpub') {
                if (!r.xpub) {
                    add(at('xpub'), `${tag}: enter the account public key from the other wallet.`);
                    continue;
                }
                const descriptor = chainId ? chainRegistry.get(chainId) : null;
                const xpubError = validateCosignerXpub(
                    r.xpub,
                    descriptor?.networkKind,
                    r.derivationPath,
                    r.pubkey,
                );
                if (xpubError) add(at('xpub'), `${tag}: ${xpubError}`);
            }
        }
        return problems;
    }, [rows, threshold, scheme, chainId, addressesByChain]);

    // Fields the user has changed or left. A problem on an untouched field
    // stays silent until Review is blocked on it; the form-wide problems show
    // once anything has been edited.
    const composeError = composeProblems.length > 0;
    const shownProblem = composeProblems.find(
        (p) => (p.key === FORM_KEY ? edited : touched.has(p.key)),
    );
    const shownError = shownProblem ? shownProblem.message : null;
    // A cosigner with any open problem keeps its entry fields on screen; a
    // finished one can fold down to its summary line (Layout 1).
    const rowsWithProblems = new Set(composeProblems
        .filter((p) => p.key !== FORM_KEY)
        .map((p) => String(p.key).split(':')[0]));

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
        return wrap(<ListPage><p className={sharedStyles.hint}>Loading wallet…</p></ListPage>);
    }

    if (stage === 'done') {
        const config = result?.config;
        return wrap(
            <ListPage>
                <p className={sharedStyles.successTitle}>Multisig configured</p>
                <p className={sharedStyles.hint}>
                    Wallet "{result?.wallet?.name || walletId}" now has a{' '}
                    {config?.threshold}-of-{config?.cosigners?.length}{' '}
                    {schemeLabel(config?.scheme)} multisig configuration.
                </p>
                <dl className={sharedStyles.detailsList}>
                    <dt className={sharedStyles.detailsLabel}>Scheme</dt>
                    <dd className={sharedStyles.detailsValue}>{config?.scheme || 'N/A'}</dd>
                    <dt className={sharedStyles.detailsLabel}>Threshold</dt>
                    <dd className={sharedStyles.detailsValue}>
                        {config?.threshold} of {config?.cosigners?.length}
                    </dd>
                </dl>
                <p className={sharedStyles.hint}>
                    The shared address now appears on the Receive screen. Spending
                    from it opens a signing session where each cosigner approves in
                    turn, in the app or by scanning the transaction QR code.
                </p>
                <div className={sharedStyles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    const descriptor = chainRegistry.get(chainId);
    const localAddresses = (addressesByChain[chainId] || []);

    if (localPickerRowId) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Use one of this wallet's addresses"
                walletId={walletId}
                chainId={chainId}
                lockNetwork
                onPick={(address) => {
                    handleLocalAddressPick(localPickerRowId, address);
                    setLocalPickerRowId(null);
                }}
                onBack={() => setLocalPickerRowId(null)}
            />
        );
    }

    if (sharePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Address to share"
                walletId={walletId}
                chainId={chainId}
                lockNetwork
                unavailableReason={unavailableAddressReason}
                onPick={(address) => {
                    setShareAddressId(address.id);
                    setSharePickerOpen(false);
                }}
                onBack={() => setSharePickerOpen(false)}
            />
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <FormPage
                label="Review multisig"
                onSubmit={handleSubmit}
                status={submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <div className={sharedStyles.actions}>
                        {/* Prevent the reconciled button from submitting the compose form. */}
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={stage === 'submitting'}
                            icon={<Icon.PencilIcon />}
                            onClick={(event) => { event.preventDefault(); setStage('compose'); }}
                        >
                            Edit
                        </Button>
                        <Button
                            type="submit"
                            variant="success"
                            icon={<Icon.CheckIcon />}
                            loading={stage === 'submitting'}
                        >
                            Confirm multisig
                        </Button>
                    </div>
                )}
            >
                <p className={sharedStyles.summary}>
                    Verify the network, approval threshold, and every cosigner key.
                    These values determine the shared address and cannot be corrected
                    after funds are sent to it.
                </p>
                <dl className={sharedStyles.detailsList}>
                    <dt className={sharedStyles.detailsLabel}>Network</dt>
                    <dd className={sharedStyles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" showName={false} /> : 'Selected network'}
                    </dd>
                    <dt className={sharedStyles.detailsLabel}>Configuration</dt>
                    <dd className={sharedStyles.detailsValue}>
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
            status={shownError || submitError ? (
                <>
                    {shownError ? (
                        <StatusMessage variant="error">{shownError}</StatusMessage>
                    ) : null}
                    {submitError ? (
                        <StatusMessage variant="error">{submitError}</StatusMessage>
                    ) : null}
                </>
            ) : null}
        >
            <NetworkField
                label="Network"
                help="The Bitcoin network for this multisig wallet. Every cosigner key must belong to this network."
                value={chainId}
                onChange={(value) => {
                    setEdited(true);
                    setChainId(value);
                    setShareAddressId('');
                }}
                chainIds={btcChainIds.filter((cid) => Array.isArray(addressesByChain[cid]) && addressesByChain[cid].length > 0)}
                chainRegistry={chainRegistry}
            />

            <div className={styles.typeField}>
                <div className={styles.fieldLabelRow}>
                    <label htmlFor="multisig-type">Type</label>
                    <InfoTip aria="About multisig types" label={TYPE_HELP} />
                </div>
                <Select
                    id="multisig-type"
                    value={scheme}
                    onChange={(event) => {
                        setEdited(true);
                        setScheme(event.target.value);
                    }}
                >
                    {SCHEMES.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </Select>
            </div>

            <div className={styles.thresholdField}>
                <div className={styles.fieldLabelRow}>
                    <span className={styles.fieldLabel}>Signatures required</span>
                    <InfoTip
                        aria="About signatures required"
                        label="Choose how many cosigners must approve each payment. Taproot requires every cosigner to approve."
                    />
                </div>
                <div className={styles.thresholdRow}>
                    <div className={styles.stepper} role="group" aria-label="Signatures required">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            icon={<Icon.MinusIcon />}
                            aria-label="Decrease signatures required"
                            onClick={() => adjustThreshold(-1)}
                            disabled={scheme === 'taproot-musig2' || Number(threshold) <= 1}
                        />
                        <output aria-live="polite" className={styles.thresholdValue}>{threshold}</output>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            icon={<Icon.PlusIcon />}
                            aria-label="Increase signatures required"
                            onClick={() => adjustThreshold(1)}
                            disabled={scheme === 'taproot-musig2' || Number(threshold) >= rows.length}
                        />
                    </div>
                    <span>of {rows.length} {rows.length === 1 ? 'cosigner' : 'cosigners'}</span>
                </div>
            </div>

            <section className={styles.cosignersSection} aria-labelledby="multisig-cosigners-heading">
                <SectionHeader as="h2" id="multisig-cosigners-heading" title="Cosigners" />
                <div data-xc-preserve-nested-cards="">
                    <div className={styles.cosignersCard} data-testid="cosigners-card">
                {rows.map((row, i) => (
                    <CosignerRow
                        key={row.id}
                        index={i}
                        row={row}
                        addresses={localAddresses}
                        networkKind={descriptor?.networkKind}
                        onChange={(patch, touchFields) => updateRow(row.id, patch, touchFields)}
                        onRemove={() => removeRow(row.id)}
                        canRemove={rows.length > 2}
                        onOpenLocalAddressPicker={() => setLocalPickerRowId(row.id)}
                        onTouch={(field) => touch(`${row.id}:${field}`)}
                        complete={!rowsWithProblems.has(row.id)}
                    />
                ))}
                        <Button
                            type="button"
                            variant="rowAction"
                            block
                            className={styles.addCosigner}
                            icon={<Icon.PlusIcon />}
                            onClick={addRow}
                            disabled={rows.length >= MAX_MULTISIG_COSIGNERS[scheme]}
                        >
                            Add cosigner
                        </Button>
                    </div>
                </div>
            </section>

            <div className={styles.mainActions}>
                <Button
                    type="submit"
                    variant="success"
                    block
                    icon={<Icon.MultisigIcon />}
                    disabled={composeError || stage === 'submitting'}
                    loading={stage === 'submitting'}
                >
                    Create multisig
                </Button>
                <Button
                    type="button"
                    variant="link"
                    icon={<Icon.UsersIcon />}
                    className={styles.shareLink}
                    aria-expanded={showCosignerShare}
                    onClick={() => setShowCosignerShare((shown) => !shown)}
                >
                    Joining someone else's multisig? Share this wallet as a cosigner
                </Button>
            </div>
            {showCosignerShare ? (
                <MultisigCosignerShare
                    key={chainId}
                    walletId={walletId}
                    addresses={localAddresses}
                    chainId={chainId}
                    networkKind={descriptor?.networkKind}
                    addressId={shareAddressId}
                    onAddressChange={setShareAddressId}
                    onOpenAddressPicker={() => setSharePickerOpen(true)}
                />
            ) : null}
        </FormPage>,
    );
}

function ReviewCosigner({ index, row }) {
    return (
        <fieldset className={sharedStyles.flatFieldset}>
            <legend className={styles.reviewLegend}>Cosigner {index + 1}: {row.name}</legend>
            <dl className={sharedStyles.detailsList}>
                <dt className={sharedStyles.detailsLabel}>Origin</dt>
                <dd className={sharedStyles.detailsValue}>{originLabel(row.origin)}</dd>
                <dt className={sharedStyles.detailsLabel}>Public key</dt>
                <dd className={sharedStyles.detailsValue}><code className={styles.reviewKey}>{row.pubkey.toLowerCase()}</code></dd>
                {row.origin === 'external-xpub' ? (
                    <>
                        <dt className={sharedStyles.detailsLabel}>Account public key</dt>
                        <dd className={sharedStyles.detailsValue}><code className={styles.reviewKey}>{row.xpub}</code></dd>
                    </>
                ) : null}
                <dt className={sharedStyles.detailsLabel}>Master fingerprint</dt>
                <dd className={sharedStyles.detailsValue}><code className={styles.reviewKey}>{row.fingerprint.toLowerCase()}</code></dd>
                <dt className={sharedStyles.detailsLabel}>Account path</dt>
                <dd className={sharedStyles.detailsValue}><code className={styles.reviewKey}>{row.derivationPath}</code></dd>
            </dl>
        </fieldset>
    );
}

function CosignerRow({ index, row, addresses, networkKind, onChange, onRemove, canRemove, onOpenLocalAddressPicker, onTouch, complete = false }) {
    const summaryValue = cosignerSummaryValue(row, addresses);
    // The entry fields open for a cosigner that still needs something and stay
    // open until the user folds the row with Done, so a row never collapses
    // under the cursor the moment its last field becomes valid.
    const [editing, setEditing] = useState(!complete);
    useEffect(() => {
        if (!complete) setEditing(true);
    }, [complete]);
    const KindIcon = row.origin === 'external-hardware' ? Icon.UsbIcon : row.origin === 'local' ? Icon.KeyIcon : Icon.UserIcon;
    return (
        <fieldset className={styles.cosignerRow}>
            <legend className="sr-only">Cosigner {index + 1}</legend>

            <div className={styles.cosignerSummary}>
                <span className={styles.cosignerIcon} aria-hidden="true"><KindIcon /></span>
                <span className={styles.cosignerIdentity}>
                    <strong>{row.name || `Cosigner ${index + 1}`}</strong>
                    <code title={summaryValue || undefined}>{summaryValue || 'Address or key needed'}</code>
                </span>
                <span className={styles.kindTag}>{cosignerKind(row.origin)}</span>
                {complete ? (
                    <Button
                        type="button"
                        variant="link"
                        icon={editing ? <Icon.CheckIcon /> : <Icon.PencilIcon />}
                        aria-expanded={editing}
                        aria-label={`${editing ? 'Done editing' : 'Edit'} cosigner ${index + 1}`}
                        onClick={() => setEditing((open) => !open)}
                    >
                        {editing ? 'Done' : 'Edit'}
                    </Button>
                ) : null}
            </div>

            {editing ? (
            <div className={styles.cosignerEditor}>

            <Input
                label="Name"
                help="This label is visible only to you and helps you tell cosigners apart."
                onBlur={() => onTouch('name')}
                value={row.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="My signer / Bob's Trezor / cold-storage key"
            />

            <Select
                label="Origin"
                help={ORIGIN_HINTS[row.origin]}
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
                }, [])}
            >
                <option value="local">Local signer</option>
                <option value="external-xpub">Another wallet</option>
                <option value="external-hardware">External hardware</option>
            </Select>

            {row.origin === 'local' ? (
                <AddressField
                    label="Use one of this wallet's addresses"
                    help="Choose the address whose key this wallet adds as a cosigner."
                    icon="addresses"
                    value={addresses.find((address) => address.id === row.addressId)?.address || ''}
                    readOnly
                    onChange={() => {}}
                    onIconClick={onOpenLocalAddressPicker}
                    iconLabel="Choose one of this wallet's addresses"
                    placeholder="Select address"
                />
            ) : null}

            {row.origin === 'external-xpub' ? (
                <>
                    <Textarea
                        label="Shared cosigner setup"
                        help="Paste the setup another wallet shared to fill the fields below."
                        optional
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
                        label="Account public key"
                        help="Enter the xpub from the other wallet."
                        onBlur={() => onTouch('xpub')}
                        value={row.xpub}
                        onChange={(e) => onChange({ xpub: e.target.value.trim() })}
                        placeholder="xpub6CUGRUonZSQ4..."
                    />
                </>
            ) : null}

            <Input
                label="Public key"
                help="Enter the cosigner's compressed public key."
                onBlur={() => onTouch('pubkey')}
                value={row.pubkey}
                onChange={(e) => onChange({ pubkey: e.target.value.trim() })}
                placeholder="02abcdef…"
            />

            <Input
                label="Master fingerprint"
                help="Enter the 8-character fingerprint of the cosigner's wallet, used by signers to find their key."
                onBlur={() => onTouch('fingerprint')}
                value={row.fingerprint}
                onChange={(e) => onChange({ fingerprint: e.target.value.trim() })}
                placeholder="73c5da0a"
            />
            {row.fingerprintNote ? (
                <p className={`${sharedStyles.hint} ${styles.fingerprintNote}`}>{row.fingerprintNote}</p>
            ) : null}

            <Input
                label="Account path"
                help="Enter the derivation path of the cosigner's key."
                onBlur={() => onTouch('derivationPath')}
                value={row.derivationPath}
                onChange={(e) => onChange({ derivationPath: e.target.value.trim() })}
                placeholder="m/48'/0'/0'/2'/0/0"
            />

            <div className={styles.removeRow}>
                <Button type="button" variant="ghost" onClick={onRemove} disabled={!canRemove}>
                    Remove
                </Button>
            </div>
            </div>
            ) : null}
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

function cosignerSummaryValue(row, addresses) {
    if (row.origin === 'local') {
        const address = addresses.find((candidate) => candidate.id === row.addressId);
        return address?.address || row.pubkey;
    }
    return row.xpub || row.pubkey;
}

function cosignerKind(origin) {
    if (origin === 'local') return 'You';
    if (origin === 'external-hardware') return 'Hardware';
    return 'Someone else';
}

// The option labels stay short enough to show whole in a narrow select; the help
// tip explains each origin without crowding the field.
const ORIGIN_HINTS = {
    local: 'A software account or paired hardware signer in this wallet.',
    'external-xpub': 'Paste the account public key from another wallet.',
    'external-hardware': 'Sign through file transfer.',
};

function originLabel(origin) {
    if (origin === 'local') return 'Local signer';
    if (origin === 'external-xpub') return 'Another wallet';
    return 'External hardware';
}
