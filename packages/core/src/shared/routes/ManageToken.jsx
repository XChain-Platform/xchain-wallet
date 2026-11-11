// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useState } from 'react';
import { AddressText, Button, CopyButton, Icon, ListPage, PageHeader, Screen, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
import { flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { useIsTokenIssuer } from '../hooks/useIsTokenIssuer.js';
import { TickerIcon } from '../components/TickerIcon.jsx';
import {
    BranchIcon,
    BridgeIcon,
    LightningIcon,
    PictureIcon,
    StorefrontIcon,
    TagIcon,
} from '../components/manageTokenIcons.jsx';
import styles from './ManageToken.module.css';
import { formatTokenQuantity } from '../utils/amountFormat.js';
import { t } from '../../i18n/index.js';
import { UNKNOWN_TOKEN_ISSUER_MESSAGE } from '../utils/tokenIssuerEligibility.js';
import '../../i18n/locales/en/gatedPublish.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/issue.js';
import '../../i18n/locales/en/palette.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/ui.js';
import '../../i18n/locales/en/walletDetails.js';

// The seven independent ISSUE v3 lock flags mirror TokenAdminForm.
const LOCK_FLAG_KEYS = ['max_supply', 'max_mint', 'mint', 'mint_supply', 'description', 'sleep', 'callback'];

// The /issues endpoint emits rows either as keyed objects (some
// adapters) or as the explorer's collapsed array
// `[count, block_index, timestamp, source, tick, max_supply, max_mint,
//  locks, status, action_index]` (see xchain-explorer
// XChainExplorer.js line 793). Normalize either into a stable shape so
// the Genesis section can render the same fields against either path.
// Exported so tests can pin the array vs keyed paths.
export function normalizeGenesisRow(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) {
        return {
            blockIndex: raw[1] != null ? Number(raw[1]) : null,
            timestamp: raw[2] != null ? Number(raw[2]) : null,
            source: typeof raw[3] === 'string' ? raw[3] : null,
            actionIndex: raw[9] != null ? String(raw[9]) : null,
        };
    }
    return {
        blockIndex: raw.block_index != null ? Number(raw.block_index) : null,
        timestamp: raw.timestamp != null ? Number(raw.timestamp) : (raw.block_time != null ? Number(raw.block_time) : null),
        source: typeof raw.source === 'string' ? raw.source : null,
        actionIndex: raw.action_index != null ? String(raw.action_index) : (raw.actionIndex != null ? String(raw.actionIndex) : null),
    };
}

export function ManageToken({
    walletId,
    chainId,
    tick,
    divisibility: divisibilityProp = null,
    onBack,
    onIssueSubtoken,
    onMint,
    onDestroy,
    onLock,
    onMintSettings,
    onCallbackSettings,
    onExecuteCallback,
    onAccessLists,
    onUseSharedBlockList,
    onBridgeSettings,
    onPauseToken,
    onUpdateDescription,
    onAttachContent,
    onGatedContent,
    onManageRoster,
    onTransferOwnership,
    onSellOwnership,
    onCreateDispenser,
    onPayDividend,
    onAirdrop,
    onBroadcast,
    onBindController,
    onIssuerResolved,
}) {
    const { messaging, shell } = useMessaging();
    const approvedTabsId = useId();
    const variant = screenVariantFor(shell);
    const assetInfo = useTokenInfo({ chainId, tick });
    const tokenLocks = assetInfo?.locks || {};
    const owner = assetInfo?.creator || null;
    const description = assetInfo?.description || '';
    const displayName = assetInfo?.displayName || assetInfo?.name || tick;
    const totalSupply = assetInfo?.totalSupply ?? assetInfo?.supply ?? null;
    const maxSupply = assetInfo?.maxSupply ?? null;
    const divisibility = assetInfo?.divisibility != null
        && Number.isFinite(Number(assetInfo.divisibility))
        ? Number(assetInfo.divisibility)
        : divisibilityProp;
    const isOwner = useIsTokenIssuer({ messaging, walletId, chainId, issuerAddress: owner });
    const blockIssuerActions = isOwner !== true;
    const allLocksSet = LOCK_FLAG_KEYS.every((key) => !!tokenLocks[key]);
    const bridgeFrozen = assetInfo?.lockBridge === true;
    const [approvedActiveTab, setApprovedActiveTab] = useState('actions');
    const [approvedSleepRow, setApprovedSleepRow] = useState(null);
    const [approvedSleepHeight, setApprovedSleepHeight] = useState(null);
    const [approvedGenesis, setApprovedGenesis] = useState(null);

    useEffect(() => {
        if (typeof onIssuerResolved === 'function') onIssuerResolved(owner || null);
    }, [owner, onIssuerResolved]);

    useEffect(() => {
        if (!chainId || !tick || typeof messaging?.sleepState !== 'function') {
            setApprovedSleepRow(null);
            setApprovedSleepHeight(null);
            return undefined;
        }
        let cancelled = false;
        Promise.all([
            messaging.sleepState({ chainId, query: tick, type: 'token' }).catch(() => null),
            typeof messaging.getIndexerWatermark === 'function'
                ? messaging.getIndexerWatermark({ chainId }).catch(() => null)
                : Promise.resolve(null),
        ]).then(([row, watermark]) => {
            if (cancelled) return;
            setApprovedSleepRow(row || null);
            setApprovedSleepHeight(watermark?.watermark != null ? Number(watermark.watermark) : null);
        });
        return () => { cancelled = true; };
    }, [chainId, tick, messaging]);

    useEffect(() => {
        if (typeof messaging?.getGenesisForToken !== 'function') return undefined;
        let cancelled = false;
        messaging.getGenesisForToken({ chainId, tick })
            .then((row) => { if (!cancelled) setApprovedGenesis(normalizeGenesisRow(row)); })
            .catch(() => { if (!cancelled) setApprovedGenesis(null); });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick]);

    const sleepState = flowsLib.interpretSleep(
        approvedSleepRow ? approvedSleepRow.resumeBlock : null,
        approvedSleepHeight,
    );
    const ownerBlockedReason = t('routes.manageToken.ownerActionUnavailable');
    const unavailableReason = t('routes.manageToken.actionUnavailable');
    const ownerAction = (handler) => ({
        onSelect: blockIssuerActions ? undefined : handler,
        disabled: blockIssuerActions || typeof handler !== 'function',
        disabledReason: blockIssuerActions ? ownerBlockedReason : unavailableReason,
    });
    const actions = approvedManageActions({
        assetInfo,
        tokenLocks,
        allLocksSet,
        bridgeFrozen,
        blockIssuerActions,
        ownerBlockedReason,
        unavailableReason,
        sleepState,
        ownerAction,
        onIssueSubtoken,
        onMint,
        onDestroy,
        onLock,
        onMintSettings,
        onCallbackSettings,
        onExecuteCallback,
        onAccessLists,
        onUseSharedBlockList,
        onBridgeSettings,
        onPauseToken,
        onUpdateDescription,
        onAttachContent,
        onGatedContent,
        onManageRoster,
        onTransferOwnership,
        onSellOwnership,
        onCreateDispenser,
        onPayDividend,
        onAirdrop,
        onBroadcast,
        onBindController,
    });
    const panelId = `${approvedTabsId}-panel`;
    const header = (
        <PageHeader
            onBack={onBack}
            backLabel={t('routes.manageToken.backToMyTokens')}
            title={t('routes.manageToken.manageToken')}
        />
    );

    return (
        <Screen variant={variant} header={header}>
            <ListPage className={styles.approvedBody}>
                {assetInfo && !assetInfo.loadError && !owner ? (
                    <StatusMessage variant="warning" role="status">
                        {UNKNOWN_TOKEN_ISSUER_MESSAGE}
                    </StatusMessage>
                ) : null}
                <section className={styles.approvedHero} aria-label={t('routes.manageToken.tokenIdentity')}>
                    <TickerIcon chainId={chainId} tick={tick} context="list" />
                    <div className={styles.approvedHeroText}>
                        <h2 className={styles.approvedHeroName}>{displayName}</h2>
                        {description ? <p className={styles.approvedHeroDescription}>{description}</p> : null}
                    </div>
                </section>
                <Tabs
                    id={approvedTabsId}
                    items={[
                        { id: 'actions', label: t('routes.manageToken.actions') },
                        { id: 'details', label: t('components.reachabilityLine.details') },
                    ]}
                    value={approvedActiveTab}
                    onChange={setApprovedActiveTab}
                    panelId={panelId}
                    aria-label={t('routes.manageToken.manageTokenView')}
                />
                <div
                    id={panelId}
                    role="tabpanel"
                    aria-labelledby={`${approvedTabsId}-tab-${approvedActiveTab}`}
                    className={styles.approvedTabPanel}
                >
                    {approvedActiveTab === 'actions' ? (
                        <div className={styles.approvedActionGrid} aria-label={t('routes.manageToken.actions')}>
                            {actions.map((action) => (
                                <Button
                                    key={action.id}
                                    type="button"
                                    variant={action.danger ? 'danger' : 'secondary'}
                                    className={styles.approvedActionTile}
                                    icon={<action.Icon />}
                                    onClick={action.onSelect}
                                    disabled={action.disabled}
                                    title={action.disabled ? action.disabledReason : undefined}
                                >
                                    {action.label}
                                </Button>
                            ))}
                        </div>
                    ) : (
                        <ApprovedDetailsCard
                            tick={tick}
                            owner={owner}
                            issuer={approvedGenesis?.source || owner}
                            totalSupply={totalSupply}
                            maxSupply={maxSupply}
                            divisibility={divisibility}
                            tokenLocks={tokenLocks}
                            lockBridge={bridgeFrozen}
                            paused={sleepState.paused}
                            createdBlock={approvedGenesis?.blockIndex ?? assetInfo?.blockIndex ?? assetInfo?.block_index ?? null}
                        />
                    )}
                </div>
            </ListPage>
        </Screen>
    );
}

function approvedManageActions(options) {
    const {
        assetInfo,
        tokenLocks,
        allLocksSet,
        bridgeFrozen,
        blockIssuerActions,
        ownerBlockedReason,
        unavailableReason,
        sleepState,
        ownerAction,
    } = options;
    const reason = (special) => special || (blockIssuerActions ? ownerBlockedReason : unavailableReason);
    return [
        { id: 'issue-subtoken', label: t('routes.manageToken.issueSubtoken'), Icon: BranchIcon, ...ownerAction(options.onIssueSubtoken) },
        { id: 'dividend', label: t('routes.manageToken.dividend'), Icon: Icon.DollarIcon, onSelect: options.onPayDividend, disabled: typeof options.onPayDividend !== 'function', disabledReason: unavailableReason },
        { id: 'airdrop', label: t('palette.createAirdrop.title'), Icon: Icon.UsersIcon, onSelect: options.onAirdrop, disabled: typeof options.onAirdrop !== 'function', disabledReason: unavailableReason },
        {
            id: 'mint', label: t('routes.manageToken.mint'), Icon: Icon.PrinterIcon,
            ...ownerAction(options.onMint),
            disabled: blockIssuerActions || !!tokenLocks.mint || typeof options.onMint !== 'function',
            disabledReason: reason(tokenLocks.mint ? t('routes.manageToken.mintLocked') : null),
        },
        { id: 'mint-settings', label: t('routes.manageToken.mintSettings'), Icon: Icon.GearIcon, ...ownerAction(options.onMintSettings) },
        {
            id: 'lock-settings', label: t('routes.manageToken.lockSettings'), Icon: Icon.LockIcon,
            ...ownerAction(options.onLock),
            disabled: blockIssuerActions || allLocksSet || typeof options.onLock !== 'function',
            disabledReason: reason(allLocksSet ? t('routes.manageToken.allLocksSet') : null),
        },
        { id: 'destroy', label: t('routes.manageToken.destroy'), Icon: Icon.TrashIcon, onSelect: options.onDestroy, disabled: typeof options.onDestroy !== 'function', disabledReason: unavailableReason, danger: true },
        { id: 'dispenser', label: t('routes.manageToken.dispenser'), Icon: StorefrontIcon, onSelect: options.onCreateDispenser, disabled: typeof options.onCreateDispenser !== 'function', disabledReason: unavailableReason },
        { id: 'sell-name', label: t('routes.manageToken.sellName'), Icon: TagIcon, ...ownerAction(options.onSellOwnership) },
        {
            id: 'description', label: t('routes.manageToken.description'), Icon: Icon.PencilIcon,
            ...ownerAction(options.onUpdateDescription),
            disabled: blockIssuerActions || !!tokenLocks.description || typeof options.onUpdateDescription !== 'function',
            disabledReason: reason(tokenLocks.description ? t('routes.manageToken.descriptionLocked') : null),
        },
        { id: 'artwork', label: t('routes.manageToken.artwork'), Icon: PictureIcon, ...ownerAction(options.onAttachContent) },
        { id: 'gated-content', label: t('gatedPublish.gatedContent'), Icon: Icon.KeyIcon, ...ownerAction(options.onGatedContent) },
        { id: 'official-list', label: t('routes.manageToken.officialList'), Icon: Icon.BookIcon, ...ownerAction(options.onManageRoster) },
        { id: 'broadcast', label: t('routes.manageToken.broadcast'), Icon: Icon.BroadcastIcon, ...ownerAction(options.onBroadcast) },
        { id: 'transfer', label: t('routes.manageToken.transfer'), Icon: Icon.HandshakeIcon, ...ownerAction(options.onTransferOwnership) },
        { id: 'controller', label: t('routes.manageToken.controller'), Icon: Icon.LinkIcon, ...ownerAction(options.onBindController) },
        { id: 'callback-settings', label: t('routes.manageToken.callbackSettings'), Icon: Icon.GearIcon, ...ownerAction(options.onCallbackSettings) },
        {
            id: 'execute-callback', label: t('routes.manageToken.executeCallback'), Icon: LightningIcon,
            ...ownerAction(options.onExecuteCallback),
            disabled: blockIssuerActions || !assetInfo?.callbackTick || typeof options.onExecuteCallback !== 'function',
            disabledReason: reason(!assetInfo?.callbackTick ? t('routes.manageToken.callbackNotConfigured') : null),
            danger: true,
        },
        { id: 'access-lists', label: t('routes.manageToken.accessLists'), Icon: Icon.TokenListIcon, ...ownerAction(options.onAccessLists) },
        { id: 'shared-block-list', label: t('routes.manageToken.sharedBlockList'), Icon: Icon.TokenListIcon, ...ownerAction(options.onUseSharedBlockList ?? options.onAccessLists) },
        {
            id: 'bridge', label: t('routes.manageToken.bridge'), Icon: BridgeIcon,
            ...ownerAction(options.onBridgeSettings),
            disabled: blockIssuerActions || bridgeFrozen || typeof options.onBridgeSettings !== 'function',
            disabledReason: reason(bridgeFrozen ? t('routes.manageToken.bridgeLocked') : null),
        },
        {
            id: 'pause-token',
            label: sleepState.paused ? t('routes.manageToken.resumeToken') : t('routes.manageToken.pauseToken'),
            Icon: sleepState.paused ? Icon.UnlockIcon : Icon.PauseIcon,
            ...ownerAction(options.onPauseToken),
        },
    ];
}

function ApprovedDetailsCard({ tick, owner, issuer, totalSupply, maxSupply, divisibility, tokenLocks, lockBridge, paused, createdBlock }) {
    const lockRows = [
        ['max_supply', t('routes.manageToken.lockMaxSupply')],
        ['max_mint', t('routes.manageToken.lockMaxPerMint')],
        ['mint', t('routes.manageToken.lockMinting')],
        ['mint_supply', t('palette.createMint.title')],
        ['description', t('routes.manageToken.description')],
        ['sleep', t('ui.animatedQrFrames.pause')],
        ['callback', t('routes.manageToken.lockCallback')],
        ['bridge', t('palette.createBridgeSettings.title')],
    ];
    return (
        <section className={styles.approvedDetailsCard} aria-label={t('routes.manageToken.tokenDetails')}>
            <dl className={styles.approvedDetailsList}>
                <ApprovedDetailRow label={t('issue.ticker')} value={tick} mono />
                <ApprovedDetailRow
                    label={t('routes.manageToken.owner')}
                    value={owner ? (
                        <span className={styles.approvedAddressValue}>
                            <AddressText address={owner} />
                            <CopyButton value={owner} ariaLabel={t('routes.manageToken.copyOwnerAddress')} iconOnly />
                        </span>
                    ) : '-'}
                />
                <ApprovedDetailRow label={t('routes.manageToken.issuer')} value={issuer ? <AddressText address={issuer} /> : '-'} />
                <ApprovedDetailRow label={t('issue.supply')} value={approvedFormatQuantity(maxSupply, divisibility)} mono />
                <ApprovedDetailRow label={t('routes.manageToken.issued')} value={approvedFormatQuantity(totalSupply, divisibility)} mono />
                <ApprovedDetailRow
                    label={t('routes.manageToken.divisible')}
                    value={Number(divisibility) > 0
                        ? t('routes.manageToken.divisiblePlaces', { places: Number(divisibility) })
                        : t('routes.manageToken.no')}
                />
                {lockRows.map(([key, label]) => (
                    <ApprovedLockRow
                        key={key}
                        label={label}
                        locked={key === 'bridge' ? lockBridge : !!tokenLocks[key]}
                    />
                ))}
                <ApprovedDetailRow label={t('history.filters.statusHeader')} value={paused ? t('routes.manageToken.paused') : t('settings.developer.active')} />
                <ApprovedDetailRow
                    label={t('walletDetails.created')}
                    value={createdBlock != null
                        ? t('history.row.block', { block: Number(createdBlock).toLocaleString('en-US') })
                        : '-'}
                />
            </dl>
        </section>
    );
}

function ApprovedDetailRow({ label, value, mono = false }) {
    return (
        <div className={styles.approvedDetailRow}>
            <dt>{label}</dt>
            <dd className={mono ? styles.approvedMono : undefined}>{value}</dd>
        </div>
    );
}

function ApprovedLockRow({ label, locked }) {
    const state = locked ? t('routes.manageToken.locked') : t('routes.manageToken.editable');
    return (
        <ApprovedDetailRow
            label={label}
            value={(
                <span className={locked ? styles.approvedLocked : styles.approvedEditable} aria-label={`${label}: ${state}`}>
                    {locked ? <Icon.LockIcon /> : <Icon.UnlockIcon />}
                    {state}
                </span>
            )}
        />
    );
}

function approvedFormatQuantity(value, divisibility) {
    return value != null ? formatTokenQuantity(value, divisibility) : '-';
}
