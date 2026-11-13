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
    // Network and From come from the standard FromSection.
    Button,
    FormNotice,
    FormPage,
    Icon,
    Input,
    PageHeader,
    Screen,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/components.js';
import { listLabel } from '../utils/listLabel.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { estimateNativeSendFee } from '../../flows/feeEstimate.js';
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
import { findListOwner, recheckListOwner } from '../../flows/listMembership.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { explorerReadFailure } from '../../sdk/explorerErrors.js';
import styles from './IssueTokenForm.module.css';
// The form sits in the Wallet Form Standard frame: From, the Rename
// section, an optional Memo section, the Network fee row, the status slot
// and the action.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    joinSummary,
    useFormSections,
} from '../components/formStandard/index.js';
import { formatCoinBaseUnits } from '../../flows/feesCard.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';

const chainRegistry = registryLib.defaultRegistry();
const SDK_REASON = "This wallet's SDK cannot build a list rename yet; it arrives with the next SDK update.";

/**
 * The protocol fee for the closed Network fee summary, in the coin
 * the Fees card charges it in, or null while it is unknown or free.
 */
function protocolFeeSummary({ quote, pending, payInNative, coinTicker }) {
    if (pending) return null;
    const fee = normalizeProtocolFee(quote);
    if (!fee.known || fee.free) return null;
    if (payInNative) {
        const native = formatCoinBaseUnits(quote?.requiredFeeSats);
        return native ? `${native} ${coinTicker}`.trim() : null;
    }
    return fee.amount ? `${fee.amount} XCHAIN` : null;
}
const TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
const META_ERROR_TEXT = {
    pipe: 'Cannot contain the | character.',
    semicolon: 'Cannot contain the ; character.',
    unsafe: 'Cannot contain control, text-direction, or zero-width characters.',
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

export function ListRenameForm(props) {
    const { walletId, listRef } = props;
    const formKey = `${walletId}:${listRef.chainId}:${String(listRef.actionIndex)}`;
    return <ListRenameFormScreen key={formKey} {...props} />;
}

function ListRenameFormScreen({ walletId, listRef, onBack, onDone = onBack }) {
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
    const feeEstimate = useMemo(
        () => estimateNativeSendFee({ chainId, chainRegistry }),
        [chainId],
    );

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
    const [fromPickerOpen, setFromPickerOpen] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const submitInFlightRef = useRef(false);
    // The standard sections' open state, held above the picker
    // early return so it survives it; a counter of Rename attempts reopens
    // the section that holds the error on every attempt.
    const formSections = useFormSections({ from: false, rename: true, memo: false, fee: false });
    const [reviewAttempt, setReviewAttempt] = useState(0);

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
    const actionParams = useMemo(() => ({
        VERSION: '5',
        LIST_ACTION_INDEX: listActionIndex,
        NAME: trimmedName,
        DESCRIPTION: trimmedDescription,
        MEMO: trimmedMemo,
    }), [listActionIndex, trimmedDescription, trimmedMemo, trimmedName]);
    const quoteActionData = useMemo(() => {
        const hasChange = trimmedName !== '' || trimmedDescription !== '';
        const memoValid = !/[|;]/.test(memo) && !memoLengthError(trimmedMemo);
        if (!alreadyShared || !listActionIndexValid || sdkSupported !== true || !fromAddress
            || nameError || descriptionError || !hasChange || !memoValid) return null;
        return { action: 'LIST', params: actionParams };
    }, [actionParams, alreadyShared, descriptionError, fromAddress, listActionIndexValid,
        memo, nameError, sdkSupported, trimmedDescription, trimmedMemo, trimmedName]);
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: quoteActionData,
    });
    const lane = useOwnerActionLane({
        messaging,
        walletId,
        chainId,
        owner: fromAddress,
        software: 'createList',
        hardware: 'createListHw',
    });

    function validate() {
        if (!listActionIndexValid) { setFormError('List reference must be a positive whole number.'); return false; }
        if (sdkSupported !== true) { setFormError(SDK_REASON); return false; }
        if (!fromAddress) { setFormError('No signing address available on this network.'); return false; }
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
        if (submitInFlightRef.current) return;
        setReviewAttempt((n) => n + 1); // Reopens the section holding an error.
        if (!validate()) return;
        submitInFlightRef.current = true;
        setFormError(null);
        try {
            if (typeof owner === 'string' && owner) {
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
                actionData: { action: 'LIST', params: actionParams },
                encoderOpts: { payFeeInNativeCoin: nativeFee.flag || undefined },
                submitExtra: { params: actionParams, payFeeInNativeCoin: nativeFee.flag },
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
        } finally {
            submitInFlightRef.current = false;
        }
    }

    const header = <PageHeader onBack={onBack} title="Rename List" />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
    );

    if (lane.open) {
        return (
            <ActionConfirmScreen
                {...lane.confirmProps}
                summary={{
                    verb: t('components.confirmSummary.verbRenameList'),
                    target: listLabel(listActionIndex, detail?.name),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                }}
                walletId={walletId}
                screenVariant={variant}
                chainLabel={null}
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

    // The load error, the loading line and the submitted result lay out
    // through FormPage like the form stage, so the page edge and rhythm match.
    // The load error is the template's body, not its status slot, so it draws
    // its own box and the shell's "Some balances may be out of date" steps
    // aside: one message per page.
    if (loadError) {
        return wrap(
            <FormPage as="div" label="Rename list">
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </FormPage>,
        );
    }
    if (!addressesByChain || !detail || owner === undefined || !sharedRows || sdkSupported === null) {
        return wrap(
            <FormPage as="div" label="Rename list">
                <p className={styles.hint}>Loading...</p>
            </FormPage>,
        );
    }

    if (result) {
        // Signed but held in the broadcast queue: nothing is on the network yet.
        if (result.queued) return wrap(<ResultScreen state="signed-not-broadcast" onDone={onDone} what="list rename" unsaved={result.unsaved} />);
        if (result.psbtHex && !result.txid) {
            return wrap(
                <ResultScreen
                    state="unsigned"
                    result={result}
                    onBuildAnother={() => setResult(null)}
                    onDone={onDone}
                />,
            );
        }
        return wrap(
            <FormPage
                as="div"
                label="Rename list"
                status={(
                    <StatusMessage variant="success">
                        {result.psbtHex && !result.txid ? 'Unsigned list rename created.' : 'List rename submitted.'}
                    </StatusMessage>
                )}
                actions={<Button type="button" variant="primary" onClick={onDone}>Done</Button>}
            >
                <p className={styles.hint}>The new list details appear when this transaction confirms.</p>
                {result.txid ? (
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Transaction ID</dt>
                        <dd className={styles.detailsValue}><code className={styles.txid}>{String(result.txid)}</code></dd>
                    </dl>
                ) : null}
            </FormPage>,
        );
    }

    // Judged only once the wallet addresses have loaded, and on a picked From
    // address, so the warning never flashes while the owner lookup settles.
    const missingOwner = Boolean(owner && addressesByChain
        && (!ownerRecord || (fromAddress && fromAddress.address !== owner)));
    const formDisabled = sdkSupported !== true;
    if (fromPickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={chainId}
                lockNetwork
                onPick={(address) => {
                    setFromAddressId(address.id);
                    setFromPickerOpen(false);
                    setFormError(null);
                }}
                onBack={() => setFromPickerOpen(false)}
            />
        );
    }
    // Which section holds the form error, so that section reopens on
    // every Rename attempt even after the user closed it.
    const errorSection = !formError ? null
        : /memo/i.test(formError) ? 'memo'
            : /signing address/i.test(formError) ? 'from'
                : 'rename';
    const sectionErrorKey = (id) => (errorSection === id ? reviewAttempt + 1 : 0);
    const renameSummary = joinSummary(
        `List #${listActionIndex}`,
        trimmedName ? `name ${trimmedName === '-' ? 'cleared' : trimmedName}` : null,
        trimmedDescription ? `description ${trimmedDescription === '-' ? 'cleared' : 'changed'}` : null,
    );
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Rename list"
            onSubmit={handleReview}
            status={[
                sdkSupported === false ? <StatusMessage key="sdk" variant="error">{SDK_REASON}</StatusMessage> : null,
                formError ? <StatusMessage key="error" variant="error">{formError}</StatusMessage> : null,
            ]}
            action={(
                <FormAction
                    icon={lane.isWatcherMode ? <Icon.SignIcon /> : <Icon.PencilIcon />}
                    loading={lane.composing}
                    disabled={formDisabled || !fromAddress || lane.composing}
                >
                    {lane.isWatcherMode ? 'Create Unsigned Transaction' : 'Rename List'}
                </FormAction>
            )}
            /* From (closed) holds the list's locked network and the
               signing address, which starts as the owner's. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainRegistry={chainRegistry}
                    lockNetwork
                    networkHelp={t('routes.listRename.networkHelp')}
                    address={fromAddress?.address || null}
                    addressLabel="From"
                    addressHelp="Only the address that owns this list can rename it. The network refuses a rename signed from any other address."
                    onOpenPicker={() => setFromPickerOpen(true)}
                    pickerLabel="Choose source address"
                    revealKey={sectionErrorKey('from')}
                />
            )}
            /* One Network fee row in FeeSection's fixed-fee mode (no
               speed picker). A shared list carries the Fees card (network and
               shared-edit fee, native-fee switch); an unshared rename shows
               the network fee estimate. */
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    fixedFee={feeEstimate?.coinAmount ?? null}
                    etaMinutes={feeEstimate?.etaMinutes}
                    protocolSummary={alreadyShared ? (protocolFeeSummary({
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        payInNative: nativeFee.toggleProps.checked,
                        coinTicker,
                    }) || undefined) : undefined}
                    fees={alreadyShared ? {
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        tiers: feeEstimate ? { normal: feeEstimate } : undefined,
                        nativeFeeProps: { ...nativeFee.toggleProps, coinTicker, disabled: formDisabled },
                    } : undefined}
                >
                    {alreadyShared ? (
                        <p className={styles.hint}>
                            Renaming this shared list pays the shared-list edit fee.
                        </p>
                    ) : (
                        <p className={styles.hint}>An estimate. The exact fee is set when the rename is built for review.</p>
                    )}
                </FeeSection>
            )}
        >
            <FormSection
                id="rename"
                title="Rename"
                icon={Icon.PencilIcon}
                {...formSections.bind('rename')}
                revealKey={sectionErrorKey('rename')}
                summary={renameSummary}
            >
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
            </dl>

            {missingOwner ? (
                <FormNotice variant="warning" role="alert">
                    {`The current owner, ${shortAddress(owner)}, is not an address in this wallet. A rename signed by another address will be refused by the network.`}
                </FormNotice>
            ) : null}

            <Input
                label="Name"
                help={`Leave this empty to keep the current name. Clear sets the name to nothing on the chain. The name is public and can be at most ${LIST_META_NAME_MAX_BYTES} bytes.`}
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
                label="Description"
                help={`Leave this empty to keep the current description. Clear sets the description to nothing on the chain. The description is public and can be at most ${LIST_META_DESCRIPTION_MAX_BYTES} bytes.`}
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
            </FormSection>

            {/* Memo is its own optional section, closed until used. */}
            <FormSection
                id="memo"
                title="Memo"
                icon={Icon.MessageIcon}
                optional
                {...formSections.bind('memo')}
                revealKey={sectionErrorKey('memo')}
                summary={trimmedMemo || 'None'}
            >
            <Input
                label="Memo"
                maxLength={MAX_MEMO_LENGTH}
                help="A note stored with this rename transaction. It is public on the chain and cannot be changed afterwards."
                value={memo}
                onChange={(event) => { setMemo(event.target.value); setFormError(null); }}
                autoComplete="off"
                disabled={formDisabled}
            />
            </FormSection>
        </FormFrame>,
    );
}
