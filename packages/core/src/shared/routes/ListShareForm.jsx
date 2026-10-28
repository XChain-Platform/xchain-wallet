// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    AddressText,
    Button,
    ChainBadge,
    FormNotice,
    FormPage,
    Input,
    ListPage,
    PageHeader,
    Screen,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { listFormatSupport } from '../../flows/listFormatSupport.js';
import {
    isShareConfirmed,
    listShareEligibility,
} from '../../flows/listShareEligibility.js';
import { currentListMemberCount, findListOwner, recheckListOwner } from '../../flows/listMembership.js';
import { memoLengthError, MEMO_HINT } from '../utils/memoLimit.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { explorerReadFailure } from '../../sdk/explorerErrors.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();
const SDK_REASON = "This wallet's SDK cannot build a list share yet; it arrives with the next SDK update.";
const TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

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

/**
 * Share an existing token or address list with LIST format 2.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {{ chainId: string, actionIndex: string | number }} props.listRef
 * @param {() => void} props.onBack
 * @param {() => void} [props.onDone]
 */
export function ListShareForm(props) {
    const { walletId, listRef } = props;
    const formKey = `${walletId}:${listRef.chainId}:${String(listRef.actionIndex)}`;
    return <ListShareFormScreen key={formKey} {...props} />;
}

function ListShareFormScreen({ walletId, listRef, onBack, onDone = onBack }) {
    const chainId = listRef.chainId;
    const listActionIndex = String(listRef.actionIndex);
    const listActionIndexValid = /^[1-9][0-9]*$/.test(listActionIndex);
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);
    const descriptor = chainRegistry.get(chainId);
    const coinTicker = TICKER_BY_COIN[descriptor?.coin] || '';
    const signerReady = useSignerReady(walletId);
    const nativeFee = useNativeFee(coinTicker);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [detail, setDetail] = useState(/** @type {any | null} */ (null));
    const [owner, setOwner] = useState(/** @type {string | null | undefined} */ (undefined));
    const [sharedRows, setSharedRows] = useState(/** @type {any[] | null} */ (null));
    const [sdkSupported, setSdkSupported] = useState(/** @type {boolean | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [memo, setMemo] = useState('');
    const [typedConfirm, setTypedConfirm] = useState('');
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const submitInFlightRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId).then((byChain) => {
            if (cancelled) return;
            setAddressesByChain(byChain || {});
            if (!(byChain?.[chainId] || []).length) {
                setLoadError('No address on this network yet. Use Receive to generate one first.');
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
            if (!cancelled) setLoadError(
                explorerReadFailure(err, `load list #${listActionIndex}`)?.message
                || `Couldn't load list #${listActionIndex}. Try again.`,
            );
        });
        return () => { cancelled = true; };
    }, [chainId, listActionIndex, messaging]);

    useEffect(() => {
        let cancelled = false;
        const sdkRegistry = {
            get: () => ({
                getActionFormats: (action) => messaging.getActionFormats({ chainId, action }),
            }),
        };
        Promise.resolve().then(() => listFormatSupport({ sdkRegistry, chainId }))
            .then((support) => {
                if (!cancelled) setSdkSupported(support?.share === true);
            })
            .catch(() => { if (!cancelled) setSdkSupported(false); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    const ownerRecord = useMemo(() => {
        if (!owner || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((record) => record.address === owner) || null;
    }, [owner, addressesByChain, chainId]);

    const alreadyShared = useMemo(() => (
        (sharedRows || []).some((row) => isHomeRowForList(
            row, listActionIndex, descriptor, chainId,
        ))
    ), [sharedRows, listActionIndex, descriptor, chainId]);
    const memberCount = currentListMemberCount(detail);
    const eligibility = listShareEligibility({
        type: detail?.type,
        memberCount,
        isShared: alreadyShared,
    });
    const typedConfirmOk = isShareConfirmed(typedConfirm);
    const trimmedMemo = memo.trim();
    const lane = useOwnerActionLane({
        messaging,
        walletId,
        chainId,
        owner: ownerRecord,
        software: 'createList',
        hardware: 'createListHw',
    });

    function validate() {
        if (!listActionIndexValid) { setFormError('List reference must be a positive whole number.'); return false; }
        if (sdkSupported !== true) { setFormError(SDK_REASON); return false; }
        if (!eligibility.ok) { setFormError(eligibility.reasons[0].text); return false; }
        if (!ownerRecord) {
            setFormError(owner
                ? 'This list is owned by an address that is not in this wallet, so this wallet cannot share it.'
                : 'The current owner could not be verified, so this wallet cannot share this list.');
            return false;
        }
        if (!typedConfirmOk) { setFormError('Type SHARE exactly to confirm.'); return false; }
        if (/[|;]/.test(memo)) { setFormError('Memo cannot contain | or ; characters.'); return false; }
        const memoTooLong = memoLengthError(trimmedMemo);
        if (memoTooLong) { setFormError(memoTooLong); return false; }
        return true;
    }

    async function handleReview(event) {
        event.preventDefault();
        if (submitInFlightRef.current) return;
        if (!validate()) return;
        submitInFlightRef.current = true;
        setFormError(null);
        const params = {
            VERSION: '2',
            LIST_ACTION_INDEX: listActionIndex,
            MEMO: trimmedMemo,
        };
        try {
            if (true) {
                const ownerCheck = await recheckListOwner({
                    readList: (actionIndex) => messaging.getListByActionIndex({ chainId, actionIndex }),
                    actionIndex: listActionIndex,
                    owner,
                });
                if (!ownerCheck.ok) {
                    setOwner(ownerCheck.owner);
                    setFormError(ownerCheck.message);
                    return;
                }
            }
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
                fallback: err?.message || 'List share failed.',
            }));
        } finally {
            submitInFlightRef.current = false;
        }
    }

    const header = <PageHeader onBack={onBack} title="Share list" />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
    );

    if (lane.open) {
        return (
            <ActionConfirmScreen
                {...lane.confirmProps}
                walletId={walletId}
                screenVariant={variant}
                chainLabel={null}
                chainId={chainId}
                coinTicker={coinTicker}
                signerReady={signerReady}
                credentialsReady={(lane.hw
                    ? lane.confirmProps.hwStatus === 'available'
                    : (signerReady || lane.confirmProps.password.length > 0)) && typedConfirmOk}
                extraCredentials={(
                    <Input
                        label='Type "SHARE" to confirm'
                        hint="Sharing is permanent and cannot be undone."
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
    if (!addressesByChain || !detail || owner === undefined || !sharedRows || sdkSupported === null) {
        return wrap(<p className={styles.hint}>Loading...</p>);
    }

    if (result) {
        // Signed but held in the broadcast queue: nothing is on the network yet.
        if (result.queued) return wrap(<QueuedResultPanel onDone={onDone} what="list share" unsaved={result.unsaved} />);
        if (result.psbtHex && !result.txid) {
            return wrap(
                <ListPage>
                    <WatcherResultPanel
                        result={result}
                        onBuildAnother={() => setResult(null)}
                        onDone={onDone}
                    />
                </ListPage>,
            );
        }
        return wrap(
            <ListPage>
                <StatusMessage variant="success">
                    {result.psbtHex && !result.txid ? 'Unsigned list share created.' : 'List share submitted.'}
                </StatusMessage>
                <p className={styles.hint}>The list becomes shared when this transaction confirms.</p>
                <div className={styles.actions}>
                    <Button type="button" variant="primary" onClick={onDone}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    const ownershipReason = !owner
        ? 'The current owner could not be verified, so this wallet cannot share this list.'
        : !ownerRecord
            ? `The current owner, ${shortAddress(owner)}, is not an address in this wallet. A share signed by another address will be refused by the network, so this wallet cannot share it.`
            : null;
    // Why the form cannot be submitted, in one notice: the owner first, then the list itself.
    const blockers = [ownershipReason, ...eligibility.reasons.map((reason) => reason.text)].filter(Boolean);
    const formDisabled = sdkSupported !== true || !eligibility.ok || Boolean(ownershipReason);
    return wrap(
        <FormPage
            demoGuard={demoGuard}
            label="Share list"
            onSubmit={handleReview}
            status={(sdkSupported === false || formError) ? (
                <>
                    {sdkSupported === false ? <StatusMessage variant="error">{SDK_REASON}</StatusMessage> : null}
                    {formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
                </>
            ) : null}
            actions={(
                <Button
                    type="submit"
                    variant="danger"
                    loading={lane.composing}
                    disabled={formDisabled || !typedConfirmOk || !ownerRecord || lane.composing}
                >
                    {lane.isWatcherMode ? 'Create unsigned transaction' : 'Review'}
                </Button>
            )}
        >
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>List</dt>
                <dd className={styles.detailsValue}>#{listActionIndex}</dd>
                {typeof detail.name === 'string' && detail.name.length > 0 ? (
                    <>
                        <dt className={styles.detailsLabel}>Name</dt>
                        <dd className={styles.detailsValue}>{neutralizeControlText(detail.name)}</dd>
                    </>
                ) : null}
                <dt className={styles.detailsLabel}>Network</dt>
                <dd className={styles.detailsValue}>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="sm" showName={false} /> : 'Selected network'}
                </dd>
                <dt className={styles.detailsLabel}>Current members</dt>
                <dd className={styles.detailsValue}>{eligibility.countKnown ? memberCount : 'Unavailable'}</dd>
                <dt className={styles.detailsLabel}>From</dt>
                <dd className={styles.detailsValue}>
                    {ownerRecord ? <AddressText address={ownerRecord.address} /> : 'Unavailable'}
                </dd>
            </dl>

            {blockers.length > 0 ? (
                <FormNotice variant="warning" role="alert" lines={blockers} />
            ) : null}

            <Input
                label="Memo (optional)"
                hint={MEMO_HINT}
                value={memo}
                onChange={(event) => { setMemo(event.target.value); setFormError(null); }}
                autoComplete="off"
                disabled={formDisabled}
            />

            <FormNotice
                variant="warning"
                role={null}
                lines={[
                    'Sharing is permanent. A shared list cannot be unshared.',
                    'The hubs carry every later edit to this list to every chain.',
                    'Each later edit costs LIST_SHARED_EDIT_BASE plus LIST_SHARED_EDIT_PER_ITEM for every item added or removed.',
                ]}
            />

            <NativeFeeToggle
                {...nativeFee.toggleProps}
                coinTicker={coinTicker}
                disabled={formDisabled}
            />

            <Input
                label="Type SHARE to confirm"
                hint="Enter SHARE exactly."
                value={typedConfirm}
                onChange={(event) => { setTypedConfirm(event.target.value); setFormError(null); }}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={formDisabled}
            />

        </FormPage>,
    );
}
