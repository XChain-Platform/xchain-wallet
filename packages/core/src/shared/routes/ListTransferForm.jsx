// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import {
    AddressText,
    Button,
    ChainBadge,
    Input,
    PageHeader,
    Screen,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { airdrop as airdropLib, registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { preferredSourceId } from '../addressSelection.js';
import { listFormatSupport } from '../../flows/listFormatSupport.js';
import { findListOwner } from '../../flows/listMembership.js';
import { memoLengthError, MEMO_HINT } from '../utils/memoLimit.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();
const SDK_REASON = "This wallet's SDK cannot build a list transfer yet; it arrives with the next SDK update.";

function shortAddress(value) {
    const address = String(value || '');
    return address.length > 16 ? `${address.slice(0, 8)}...${address.slice(-6)}` : address;
}

/**
 * Transfer ownership of an existing list with LIST format 3.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {{ chainId: string, actionIndex: string | number, source?: string | null, parentIndex?: string | number | null, state?: { owner?: string | null } }} props.listRef
 * @param {() => void} props.onBack
 * @param {() => void} [props.onDone]
 */
export function ListTransferForm({ walletId, listRef, onBack, onDone = onBack }) {
    const chainId = listRef.chainId;
    const listActionIndex = String(listRef.actionIndex);
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const descriptor = chainRegistry.get(chainId);
    const signerReady = useSignerReady(walletId);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any> | null} */ (null),
    );
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [owner, setOwner] = useState(/** @type {string | null | undefined} */ (undefined));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [sdkSupported, setSdkSupported] = useState(/** @type {boolean | null} */ (null));
    const [destination, setDestination] = useState('');
    const [memo, setMemo] = useState('');
    const [typedConfirm, setTypedConfirm] = useState('');
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
        ]).then(([byChain, active]) => {
            if (cancelled) return;
            setAddressesByChain(byChain || {});
            setActiveByChain(active || {});
            if (!(byChain?.[chainId] || []).length) {
                setLoadError('No address on this chain yet. Use Receive to generate one first.');
            }
        }).catch((err) => {
            if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
        });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        let cancelled = false;
        const readList = (actionIndex) => messaging.getListByActionIndex({ chainId, actionIndex });
        const supplied = {
            source: listRef.source,
            list_action_index: listRef.parentIndex,
            state: listRef.state,
        };
        const initial = typeof messaging.getListByActionIndex === 'function'
            ? Promise.resolve().then(() => readList(listActionIndex)).then((detail) => detail || supplied)
            : Promise.resolve(supplied);
        initial
            .then((detail) => findListOwner({ detail, readList }))
            .then((value) => { if (!cancelled) setOwner(value); })
            .catch(() => { if (!cancelled) setOwner(null); });
        return () => { cancelled = true; };
    }, [chainId, listActionIndex, listRef.source, listRef.parentIndex, listRef.state, messaging]);

    useEffect(() => {
        let cancelled = false;
        const sdkRegistry = {
            get: () => ({
                getActionFormats: (action) => messaging.getActionFormats({ chainId, action }),
            }),
        };
        Promise.resolve().then(() => listFormatSupport({ sdkRegistry, chainId }))
            .then((support) => {
                if (!cancelled) setSdkSupported(support?.transfer === true);
            })
            .catch(() => { if (!cancelled) setSdkSupported(false); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    const ownerRecord = useMemo(() => {
        if (!owner || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((record) => record.address === owner) || null;
    }, [owner, addressesByChain, chainId]);

    useEffect(() => {
        if (!addressesByChain || !activeByChain || fromAddressId) return;
        const all = addressesByChain[chainId] || [];
        const funding = all.filter((record) => record.role !== 'dispenser');
        const picked = preferredSourceId(funding, activeByChain[chainId]) || funding[0]?.id || all[0]?.id;
        if (picked) setFromAddressId(picked);
    }, [addressesByChain, activeByChain, chainId, fromAddressId]);

    useEffect(() => {
        if (ownerRecord) setFromAddressId(ownerRecord.id);
    }, [ownerRecord]);

    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((record) => record.id === fromAddressId) || null;
    }, [fromAddressId, addressesByChain, chainId]);

    const lane = useOwnerActionLane({
        messaging,
        walletId,
        chainId,
        owner: fromAddress,
        software: 'createList',
        hardware: 'createListHw',
    });
    const typedConfirmOk = typedConfirm.trim().toUpperCase() === 'TRANSFER';
    const trimmedDestination = destination.trim();
    const trimmedMemo = memo.trim();

    function validate() {
        if (sdkSupported !== true) { setFormError(SDK_REASON); return false; }
        if (!fromAddress) { setFormError('No signing address available on this chain.'); return false; }
        const candidates = airdropLib.parsePaste(trimmedDestination);
        const classified = airdropLib.classifyRecipients(candidates, descriptor);
        if (candidates.length !== 1 || classified.valid.length !== 1) {
            setFormError(`Destination must be one valid address for ${descriptor?.displayName || chainId}.`);
            return false;
        }
        if (owner && trimmedDestination.toLowerCase() === owner.toLowerCase()) {
            setFormError('Destination must be different from the current owner.');
            return false;
        }
        if (!typedConfirmOk) { setFormError('Type TRANSFER to confirm.'); return false; }
        if (/[|;]/.test(memo)) { setFormError('Memo cannot contain | or ; characters.'); return false; }
        const memoTooLong = memoLengthError(trimmedMemo);
        if (memoTooLong) { setFormError(memoTooLong); return false; }
        return true;
    }

    async function handleReview(event) {
        event.preventDefault();
        if (!validate()) return;
        setFormError(null);
        const params = {
            VERSION: '3',
            LIST_ACTION_INDEX: listActionIndex,
            DESTINATION: trimmedDestination,
            MEMO: trimmedMemo,
        };
        try {
            const next = await lane.run({
                actionData: { action: 'LIST', params },
                submitExtra: { params },
            });
            setResult(next || {});
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId,
                fallback: err?.message || 'List transfer failed.',
            }));
        }
    }

    const header = <PageHeader onBack={onBack} title="Transfer list" />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (lane.open) {
        return (
            <ActionConfirmScreen
                {...lane.confirmProps}
                walletId={walletId}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                signerReady={signerReady}
                credentialsReady={(lane.hw
                    ? lane.confirmProps.hwStatus === 'available'
                    : (signerReady || lane.confirmProps.password.length > 0)) && typedConfirmOk}
                extraCredentials={(
                    <Input
                        label='Type "TRANSFER" to confirm'
                        hint="List ownership changes permanently when this transaction confirms."
                        value={typedConfirm}
                        onChange={(event) => setTypedConfirm(event.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                )}
                hintClassName={styles.hint}
            />
        );
    }

    if (loadError) return wrap(<StatusMessage variant="error">{loadError}</StatusMessage>);
    if (!addressesByChain || owner === undefined || sdkSupported === null) {
        return wrap(<p className={styles.hint}>Loading...</p>);
    }

    if (result) {
        return wrap(
            <>
                <StatusMessage variant="success">
                    {result.psbtHex && !result.txid ? 'Unsigned list transfer created.' : 'List transfer submitted.'}
                </StatusMessage>
                <p className={styles.hint}>The new owner takes control when the transfer confirms.</p>
                <div className={styles.actions}>
                    <Button type="button" variant="primary" onClick={onDone}>Done</Button>
                </div>
            </>,
        );
    }

    const missingOwner = owner && !ownerRecord;
    return wrap(
        <form onSubmit={handleReview} noValidate>
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>List</dt>
                <dd className={styles.detailsValue}>#{listActionIndex}</dd>
                <dt className={styles.detailsLabel}>Chain</dt>
                <dd className={styles.detailsValue}>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                </dd>
                <dt className={styles.detailsLabel}>From</dt>
                <dd className={styles.detailsValue}>
                    {fromAddress ? <AddressText address={fromAddress.address} /> : 'Unavailable'}
                </dd>
            </dl>

            {missingOwner ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        The current owner, {shortAddress(owner)}, is not an address in this wallet.
                        A transfer signed by another address will be refused by the network.
                    </p>
                </div>
            ) : null}

            <Input
                label="Destination"
                hint={`New owner's address on ${descriptor?.displayName || chainId}.`}
                value={destination}
                onChange={(event) => { setDestination(event.target.value); setFormError(null); }}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={sdkSupported !== true}
            />
            <Input
                label="Memo (optional)"
                hint={MEMO_HINT}
                value={memo}
                onChange={(event) => { setMemo(event.target.value); setFormError(null); }}
                autoComplete="off"
                disabled={sdkSupported !== true}
            />

            <div className={styles.warnings}>
                <p className={styles.warning}>
                    From the block this transfer confirms, only the new owner can edit, share, or transfer the list.
                </p>
                <p className={styles.warning}>The sender cannot undo the transfer.</p>
                <p className={styles.warning}>A transfer cannot rescue a list whose owner key is lost.</p>
                <p className={styles.warning}>
                    A shared list keeps working on every chain because its versions carry members, never the owner.
                </p>
            </div>

            <Input
                label="Type TRANSFER to confirm"
                hint="Ownership transfer is permanent."
                value={typedConfirm}
                onChange={(event) => { setTypedConfirm(event.target.value); setFormError(null); }}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={sdkSupported !== true}
            />

            {sdkSupported === false ? <StatusMessage variant="error">{SDK_REASON}</StatusMessage> : null}
            {formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="danger"
                    block
                    loading={lane.composing}
                    disabled={sdkSupported !== true || !typedConfirmOk || !fromAddress || lane.composing}
                >
                    Review
                </Button>
            </div>
        </form>,
    );
}
