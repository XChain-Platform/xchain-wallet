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
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { preferredSourceId } from '../addressSelection.js';
import { listMetaSupported } from '../../flows/listFormatSupport.js';
import {
    LIST_META_DESCRIPTION_MAX_BYTES,
    LIST_META_NAME_MAX_BYTES,
    listMetaInputError,
    utf8ByteLength,
} from '../../flows/listMetaInput.js';
import { findListOwner } from '../../flows/listMembership.js';
import { memoLengthError, MEMO_HINT } from '../utils/memoLimit.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();
const SDK_REASON = "This wallet's SDK cannot build a list rename yet; it arrives with the next SDK update.";
const TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
const META_ERROR_TEXT = {
    pipe: 'Cannot contain the | character.',
    semicolon: 'Cannot contain the ; character.',
    length: 'Too long.',
    format: 'Invalid format.',
};

function rowsFromSharedLists(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.lists)) return value.lists;
    if (Array.isArray(value?.data)) return value.data;
    return [];
}

function isHomeRowForList(row, listActionIndex, descriptor, chainId) {
    if (row?.kind !== 'home') return false;
    const rowIndex = row.home_list_index ?? row.local_list_index ?? row.bindTarget;
    if (String(rowIndex) !== String(listActionIndex)) return false;
    if (row.home_chain == null || row.home_chain === '') return true;
    const homes = new Set([
        String(chainId).toUpperCase(),
        String(descriptor?.coin || '').toUpperCase(),
        String(TICKER_BY_COIN[descriptor?.coin] || '').toUpperCase(),
    ]);
    return homes.has(String(row.home_chain).toUpperCase());
}

function shortAddress(value) {
    const address = String(value || '');
    return address.length > 16 ? `${address.slice(0, 8)}...${address.slice(-6)}` : address;
}

function metaFieldError(field, value) {
    const code = listMetaInputError(field, value, { isCreate: false });
    return code ? META_ERROR_TEXT[code] : null;
}

export function ListRenameForm({ walletId, listRef, onBack, onDone = onBack }) {
    const chainId = listRef.chainId;
    const listActionIndex = String(listRef.actionIndex);
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const descriptor = chainRegistry.get(chainId);
    const coinTicker = TICKER_BY_COIN[descriptor?.coin] || '';
    const signerReady = useSignerReady(walletId);
    const nativeFee = useNativeFee(coinTicker);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any> | null} */ (null),
    );
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [detail, setDetail] = useState(/** @type {any | null} */ (null));
    const [owner, setOwner] = useState(/** @type {string | null | undefined} */ (undefined));
    const [sharedRows, setSharedRows] = useState(/** @type {any[] | null} */ (null));
    const [sdkSupported, setSdkSupported] = useState(/** @type {boolean | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [memo, setMemo] = useState('');
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
        Promise.all([
            readList(listActionIndex),
            messaging.getSharedLists({ chainId }),
        ]).then(async ([nextDetail, shared]) => {
            const nextOwner = await findListOwner({ detail: nextDetail, readList });
            if (cancelled) return;
            if (!nextDetail) {
                setLoadError(`List #${listActionIndex} could not be read.`);
                return;
            }
            setDetail(nextDetail);
            setSharedRows(rowsFromSharedLists(shared));
            setOwner(nextOwner);
        }).catch((err) => {
            if (!cancelled) setLoadError(err?.message || `Failed to load list #${listActionIndex}.`);
        });
        return () => { cancelled = true; };
    }, [chainId, listActionIndex, messaging]);

    useEffect(() => {
        let cancelled = false;
        setSdkSupported(null);
        const sdkRegistry = {
            get: () => ({
                getActionFormats: (action) => messaging.getActionFormats({ chainId, action }),
            }),
        };
        Promise.resolve().then(() => listMetaSupported({ sdkRegistry, chainId }))
            .then((supported) => {
                if (!cancelled) setSdkSupported(supported === true);
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

    const alreadyShared = useMemo(() => (
        (sharedRows || []).some((row) => isHomeRowForList(
            row, listActionIndex, descriptor, chainId,
        ))
    ), [sharedRows, listActionIndex, descriptor, chainId]);
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    const trimmedMemo = memo.trim();
    const nameError = metaFieldError('name', trimmedName);
    const descriptionError = metaFieldError('description', trimmedDescription);
    const lane = useOwnerActionLane({
        messaging,
        walletId,
        chainId,
        owner: fromAddress,
        software: 'createList',
        hardware: 'createListHw',
    });

    function validate() {
        if (sdkSupported !== true) { setFormError(SDK_REASON); return false; }
        if (!fromAddress) { setFormError('No signing address available on this chain.'); return false; }
        if (nameError || descriptionError) {
            setFormError('Fix the list name and description first.');
            return false;
        }
        if (trimmedName === '' && trimmedDescription === '') {
            setFormError('No change entered. Add a name or description, or use Clear.');
            return false;
        }
        if (/[|;]/.test(memo)) {
            setFormError('Memo cannot contain | or ; characters.');
            return false;
        }
        const memoTooLong = memoLengthError(trimmedMemo);
        if (memoTooLong) { setFormError(memoTooLong); return false; }
        return true;
    }

    async function handleReview(event) {
        event.preventDefault();
        if (!validate()) return;
        setFormError(null);
        const params = {
            VERSION: '5',
            LIST_ACTION_INDEX: listActionIndex,
            NAME: trimmedName,
            DESCRIPTION: trimmedDescription,
            MEMO: trimmedMemo,
        };
        try {
            const next = await lane.run({
                actionData: { action: 'LIST', params },
                encoderOpts: { payFeeInNativeCoin: nativeFee.flag || undefined },
                submitExtra: { params, payFeeInNativeCoin: nativeFee.flag },
            });
            setResult(next || {});
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: err?.message || 'List rename failed.',
            }));
        }
    }

    const header = <PageHeader onBack={onBack} title="Rename list" />;
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
                chainId={chainId}
                coinTicker={coinTicker}
                signerReady={signerReady}
                credentialsReady={lane.hw
                    ? lane.confirmProps.hwStatus === 'available'
                    : (signerReady || lane.confirmProps.password.length > 0)}
                hintClassName={styles.hint}
            />
        );
    }

    if (loadError) return wrap(<StatusMessage variant="error">{loadError}</StatusMessage>);
    if (!addressesByChain || !detail || owner === undefined || !sharedRows || sdkSupported === null) {
        return wrap(<p className={styles.hint}>Loading...</p>);
    }

    if (result) {
        return wrap(
            <>
                <StatusMessage variant="success">
                    {result.psbtHex && !result.txid ? 'Unsigned list rename created.' : 'List rename submitted.'}
                </StatusMessage>
                <p className={styles.hint}>The new list details appear when this transaction confirms.</p>
                <div className={styles.actions}>
                    <Button type="button" variant="primary" onClick={onDone}>Done</Button>
                </div>
            </>,
        );
    }

    const missingOwner = owner && !ownerRecord;
    const formDisabled = sdkSupported !== true;
    return wrap(
        <form onSubmit={handleReview} noValidate>
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>List</dt>
                <dd className={styles.detailsValue}>#{listActionIndex}</dd>
                <dt className={styles.detailsLabel}>Current name</dt>
                <dd className={styles.detailsValue}>
                    {detail.name ? neutralizeControlText(detail.name) : 'Not set'}
                </dd>
                <dt className={styles.detailsLabel}>Current description</dt>
                <dd className={styles.detailsValue}>
                    {detail.description ? neutralizeControlText(detail.description) : 'Not set'}
                </dd>
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
                        A rename signed by another address will be refused by the network.
                    </p>
                </div>
            ) : null}

            <Input
                label="Name (empty means unchanged)"
                hint={`${utf8ByteLength(trimmedName)} / ${LIST_META_NAME_MAX_BYTES} bytes`}
                error={nameError || undefined}
                value={name}
                onChange={(event) => { setName(event.target.value); setFormError(null); }}
                autoComplete="off"
                disabled={formDisabled}
            />
            <Button
                type="button"
                variant="ghost"
                aria-label="Clear name"
                onClick={() => { setName('-'); setFormError(null); }}
                disabled={formDisabled}
            >
                Clear
            </Button>
            <Input
                label="Description (empty means unchanged)"
                hint={`${utf8ByteLength(trimmedDescription)} / ${LIST_META_DESCRIPTION_MAX_BYTES} bytes`}
                error={descriptionError || undefined}
                value={description}
                onChange={(event) => { setDescription(event.target.value); setFormError(null); }}
                autoComplete="off"
                disabled={formDisabled}
            />
            <Button
                type="button"
                variant="ghost"
                aria-label="Clear description"
                onClick={() => { setDescription('-'); setFormError(null); }}
                disabled={formDisabled}
            >
                Clear
            </Button>
            <Input
                label="Memo (optional)"
                hint={MEMO_HINT}
                value={memo}
                onChange={(event) => { setMemo(event.target.value); setFormError(null); }}
                autoComplete="off"
                disabled={formDisabled}
            />

            {alreadyShared ? (
                <p className={styles.hint}>
                    Renaming this shared list pays the shared-list edit fee.
                </p>
            ) : null}

            <NativeFeeToggle
                {...nativeFee.toggleProps}
                coinTicker={coinTicker}
                disabled={formDisabled}
            />

            {sdkSupported === false ? <StatusMessage variant="error">{SDK_REASON}</StatusMessage> : null}
            {formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={lane.composing}
                    disabled={formDisabled || !fromAddress || lane.composing}
                >
                    Review
                </Button>
            </div>
        </form>,
    );
}
