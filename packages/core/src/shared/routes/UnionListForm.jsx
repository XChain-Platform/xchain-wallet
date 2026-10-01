// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is also available.

import { useEffect, useMemo, useState } from 'react';
import {
    AddressField,
    Button,
    Input,
    NetworkField,
    PageHeader,
    Screen,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { listFormatSupport } from '../../flows/listFormatSupport.js';
import { currentListItems } from '../../flows/listMembership.js';
import { unionPickState } from '../../flows/unionListPicks.js';
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { memoLengthError, MEMO_HINT } from '../utils/memoLimit.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();
const SDK_REASON = "This wallet's SDK cannot build a union list yet; it arrives with the next SDK update.";

function responseRows(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.rows)) return response.rows;
    return [];
}

function listIndex(row) {
    const value = row?.action_index ?? row?.actionIndex;
    return value == null || value === '' ? null : String(value);
}

function localCandidate(row) {
    const actionIndex = listIndex(row);
    if (!actionIndex) return null;
    return {
        actionIndex,
        type: String(row.type ?? ''),
        members: Array.isArray(row.members) ? row.members : undefined,
        shared: false,
    };
}

function sharedCandidate(row) {
    const value = row?.bindTarget;
    if (value == null || value === '') return null;
    return {
        actionIndex: String(value),
        type: String(row.type ?? ''),
        members: Array.isArray(row.members) ? row.members : undefined,
        shared: true,
        homeChain: String(row.home_chain ?? ''),
        homeListIndex: String(row.home_list_index ?? ''),
    };
}

function mergeCandidates(localRows, sharedRows) {
    const seen = new Set();
    return [...localRows.map(localCandidate), ...sharedRows.map(sharedCandidate)]
        .filter((candidate) => {
            if (!candidate || !['1', '2'].includes(candidate.type) || seen.has(candidate.actionIndex)) return false;
            seen.add(candidate.actionIndex);
            return true;
        });
}

function candidateName(candidate) {
    const kind = candidate.type === '1' ? 'Token' : 'Address';
    if (!candidate.shared) return `${kind} list #${candidate.actionIndex}`;
    const origin = candidate.homeChain && candidate.homeListIndex
        ? ` from ${candidate.homeChain} list #${candidate.homeListIndex}`
        : '';
    return `Shared ${kind.toLowerCase()} list #${candidate.actionIndex}${origin}`;
}

async function readCandidates({ messaging, chainId, addresses }) {
    const [ownedResults, sharedResult] = await Promise.all([
        Promise.all((addresses || []).map((record) => (
            messaging.getListsForSource({ chainId, address: record.address })
        ))),
        messaging.getSharedLists({ chainId }),
    ]);
    const candidates = mergeCandidates(
        ownedResults.flatMap(responseRows),
        Array.isArray(sharedResult?.lists) ? sharedResult.lists : responseRows(sharedResult),
    );
    return Promise.all(candidates.map(async (candidate) => {
        if (Array.isArray(candidate.members) || typeof messaging.getListByActionIndex !== 'function') return candidate;
        try {
            const detail = await messaging.getListByActionIndex({
                chainId,
                actionIndex: candidate.actionIndex,
            });
            const members = currentListItems(detail);
            return Array.isArray(members) ? { ...candidate, members } : candidate;
        } catch {
            return candidate;
        }
    }));
}

/**
 * Create a one-level union from the wallet's lists and shared-list mirrors.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.chainId]
 * @param {string} [props.activeAccountId]
 * @param {() => void} props.onBack
 * @param {() => void} [props.onDone]
 */
export function UnionListForm({ walletId, chainId: initialChainId, activeAccountId, onBack, onDone = onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const signerReady = useSignerReady(walletId);
    const [chainId, setChainId] = useState(initialChainId || null);
    const [addressesByChain, setAddressesByChain] = useState(null);
    const [activeByChain, setActiveByChain] = useState(null);
    const [fromAddressId, setFromAddressId] = useState(null);
    const [candidates, setCandidates] = useState(null);
    const [picked, setPicked] = useState([]);
    const [memo, setMemo] = useState('');
    const [sdkSupported, setSdkSupported] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [formError, setFormError] = useState(null);
    const [result, setResult] = useState(null);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId, activeAccountId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
            typeof messaging.getSettings === 'function'
                ? Promise.resolve(messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ]).then(([byChain, active, settings]) => {
            if (cancelled) return;
            setAddressesByChain(byChain || {});
            setActiveByChain(active || {});
            setChainId((current) => pickDefaultChainId(byChain, {
                explicitChainId: current || initialChainId,
                settings,
            }));
        }).catch((error) => {
            if (!cancelled) setLoadError(error?.message || 'Failed to load addresses.');
        });
        return () => { cancelled = true; };
    }, [walletId, activeAccountId, initialChainId, messaging]);

    useEffect(() => {
        if (!chainId || !addressesByChain) return undefined;
        let cancelled = false;
        setCandidates(null);
        setPicked([]);
        setLoadError(null);
        readCandidates({ messaging, chainId, addresses: addressesByChain[chainId] || [] })
            .then((rows) => { if (!cancelled) setCandidates(rows); })
            .catch((error) => {
                if (!cancelled) setLoadError(error?.message || 'Failed to load lists.');
            });
        return () => { cancelled = true; };
    }, [addressesByChain, chainId, messaging]);

    useEffect(() => {
        if (!chainId) return undefined;
        let cancelled = false;
        setSdkSupported(null);
        const sdkRegistry = {
            get: () => ({
                getActionFormats: (action) => messaging.getActionFormats({ chainId, action }),
            }),
        };
        Promise.resolve().then(() => listFormatSupport({ sdkRegistry, chainId }))
            .then((support) => { if (!cancelled) setSdkSupported(support?.union === true); })
            .catch(() => { if (!cancelled) setSdkSupported(false); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain) return;
        const addresses = addressesByChain[chainId] || [];
        const selected = addresses.some((record) => record.id === fromAddressId);
        if (selected) return;
        setFromAddressId(preferredSourceId(addresses, activeByChain[chainId]) || addresses[0]?.id || null);
    }, [addressesByChain, activeByChain, chainId, fromAddressId]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => (
        (addressesByChain?.[chainId] || []).find((record) => record.id === fromAddressId) || null
    ), [addressesByChain, chainId, fromAddressId]);
    const pickState = useMemo(() => unionPickState({
        picked,
        candidates: candidates || [],
    }), [picked, candidates]);
    const rowState = useMemo(() => new Map(
        pickState.rows.map((row) => [row.actionIndex, row]),
    ), [pickState.rows]);
    const lane = useOwnerActionLane({
        messaging,
        walletId,
        chainId: chainId || '',
        owner: fromAddress,
        software: 'createList',
        hardware: 'createListHw',
    });

    function toggleCandidate(actionIndex) {
        const state = rowState.get(actionIndex);
        if (!state || (state.disabled && !state.picked)) return;
        setPicked((current) => (
            current.includes(actionIndex)
                ? current.filter((value) => value !== actionIndex)
                : [...current, actionIndex]
        ));
        setFormError(null);
    }

    async function handleReview(event) {
        event.preventDefault();
        const trimmedMemo = memo.trim();
        if (sdkSupported !== true) { setFormError(SDK_REASON); return; }
        if (!fromAddress) { setFormError('No signing address available on this chain.'); return; }
        if (!pickState.canReview) {
            setFormError(pickState.overLimit
                ? 'The estimated merged membership is over 10,000.'
                : 'Choose at least one member list.');
            return;
        }
        if (/[|;]/.test(memo)) { setFormError('Memo cannot contain | or ; characters.'); return; }
        const memoTooLong = memoLengthError(trimmedMemo);
        if (memoTooLong) { setFormError(memoTooLong); return; }
        const params = { VERSION: '0', TYPE: '3', MEMO: trimmedMemo, ITEM: picked };
        try {
            setFormError(null);
            const next = await lane.run({
                actionData: { action: 'LIST', params },
                submitExtra: { params },
            });
            setResult(next || {});
        } catch (error) {
            if (isUserRejection(error)) return;
            setFormError(submitFailureMessage(error, {
                chainId,
                fallback: error?.message || 'Create union list failed.',
            }));
        }
    }

    const header = <PageHeader onBack={onBack} title="Create union list" />;
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
            />
        );
    }
    if (loadError) return wrap(<StatusMessage variant="error">{loadError}</StatusMessage>);
    if (!addressesByChain || !chainId || candidates === null || sdkSupported === null) {
        return wrap(<p className={styles.hint}>Loading...</p>);
    }
    if (result) {
        return wrap(
            <>
                <StatusMessage variant="success">
                    {result.psbtHex && !result.txid ? 'Unsigned union list created.' : 'Union list submitted.'}
                </StatusMessage>
                <div className={styles.actions}>
                    <Button type="button" variant="primary" onClick={onDone}>Done</Button>
                </div>
            </>,
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <NetworkField
                value={chainId}
                onChange={(value) => { setChainId(value); setFromAddressId(null); }}
                chainIds={Object.keys(addressesByChain)}
                chainRegistry={chainRegistry}
                disabled={sdkSupported !== true}
            />
            {fromAddress ? (
                <AddressField label="From" value={fromAddress.address} readOnly onChange={() => {}} />
            ) : (
                <StatusMessage variant="error">No address on this chain. Use Receive to generate one first.</StatusMessage>
            )}

            <fieldset disabled={sdkSupported !== true}>
                <legend>Member lists</legend>
                {candidates.length === 0 ? <p className={styles.hint}>No local or shared lists can be used on this chain.</p> : null}
                {candidates.map((candidate) => {
                    const state = rowState.get(candidate.actionIndex);
                    const reason = state?.reason || null;
                    return (
                        <div key={candidate.actionIndex}>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={state?.picked === true}
                                    disabled={sdkSupported !== true || state?.disabled === true}
                                    onChange={() => toggleCandidate(candidate.actionIndex)}
                                />
                                {' '}{candidateName(candidate)}
                            </label>
                            {reason ? <p className={styles.hint}>{reason}</p> : null}
                        </div>
                    );
                })}
            </fieldset>

            <Input
                label="Memo (optional)"
                hint={MEMO_HINT}
                value={memo}
                onChange={(event) => { setMemo(event.target.value); setFormError(null); }}
                autoComplete="off"
                disabled={sdkSupported !== true}
            />

            {picked.length > 0 ? (
                <div>
                    <p>
                        {pickState.mergedCount === null
                            ? 'Estimated merged membership: unavailable'
                            : `Estimated merged membership: ${pickState.mergedCount.toLocaleString()}`}
                    </p>
                    <p className={styles.hint}>
                        This count is an estimate because the indexer judges the merged membership at the create's block.
                    </p>
                </div>
            ) : null}
            <div className={styles.warnings}>
                <p className={styles.warning}>
                    A union follows each member's edits, including a shared list's new versions.
                </p>
                <p className={styles.warning}>A union cannot itself be shared in this release.</p>
            </div>

            {pickState.overLimit ? (
                <StatusMessage variant="error">The estimated merged membership is over 10,000.</StatusMessage>
            ) : null}
            {sdkSupported === false ? <StatusMessage variant="error">{SDK_REASON}</StatusMessage> : null}
            {formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={lane.composing}
                    disabled={sdkSupported !== true || !fromAddress || !pickState.canReview || lane.composing}
                >
                    Review
                </Button>
            </div>
        </form>,
    );
}
