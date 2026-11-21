// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The token issuer's actions and facts on the one asset page (TokenDetail).
// They were the Manage token page; the operator ruled 2026-11-15 that a coin
// and a token are one page with one layout, so the issuer's actions are now
// headed action lists in that page's Actions tab (after the actions every
// holder has) and their facts are rows of its Details card.

import { useEffect, useState } from 'react';
import { AddressText, Icon, SectionHeader } from '@xchain-wallet/core/ui';
import { flows as flowsLib } from '@xchain-wallet/core';
import {
    BranchIcon,
    BridgeIcon,
    LightningIcon,
    PictureIcon,
    StorefrontIcon,
    TagIcon,
} from './manageTokenIcons.jsx';
import { ActionList, ActionListItem } from './ActionList.jsx';
import { formatTokenQuantity } from '../utils/amountFormat.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/gatedPublish.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/palette.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/tokenDetail.js';
import '../../i18n/locales/en/ui.js';
import '../../i18n/locales/en/walletDetails.js';

// The seven independent ISSUE v3 lock flags mirror TokenAdminForm.
export const LOCK_FLAG_KEYS = ['max_supply', 'max_mint', 'mint', 'mint_supply', 'description', 'sleep', 'callback'];

// The issuer's group actions that spend the token, so they need a balance of it.
const NEEDS_BALANCE_OWNER_IDS = new Set(['destroy', 'dispenser', 'airdrop']);

// The /issues endpoint emits rows either as keyed objects (some
// adapters) or as the explorer's collapsed array
// `[count, block_index, timestamp, source, tick, max_supply, max_mint,
//  locks, status, action_index]` (see xchain-explorer
// XChainExplorer.js line 793). Normalize either into a stable shape so
// the Details rows can render the same fields against either path.
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

/**
 * The issuer facts the owner groups read: the pause state (the indexer's
 * sleep row against its watermark) and the token's genesis row. Nothing is
 * read while `enabled` is false.
 */
export function useTokenOwnerState({ messaging, chainId, tick, enabled }) {
    const [approvedSleepRow, setApprovedSleepRow] = useState(null);
    const [approvedSleepHeight, setApprovedSleepHeight] = useState(null);
    const [approvedGenesis, setApprovedGenesis] = useState(null);

    useEffect(() => {
        if (!enabled || !chainId || !tick || typeof messaging?.sleepState !== 'function') {
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
    }, [enabled, chainId, tick, messaging]);

    useEffect(() => {
        if (!enabled || typeof messaging?.getGenesisForToken !== 'function') return undefined;
        let cancelled = false;
        messaging.getGenesisForToken({ chainId, tick })
            .then((row) => { if (!cancelled) setApprovedGenesis(normalizeGenesisRow(row)); })
            .catch(() => { if (!cancelled) setApprovedGenesis(null); });
        return () => { cancelled = true; };
    }, [enabled, messaging, chainId, tick]);

    const sleepState = flowsLib.interpretSleep(
        approvedSleepRow ? approvedSleepRow.resumeBlock : null,
        approvedSleepHeight,
    );
    return { sleepState, genesis: approvedGenesis };
}

/**
 * The issuer's action groups for one token, each action with its handler,
 * its locked state and the reason it is locked.
 *
 * @param {object} args
 * @param {any} args.assetInfo
 * @param {{ paused: boolean }} args.sleepState
 * @param {Record<string, Function | undefined>} args.handlers  the shell's owner handlers
 *   (onMint, onDestroy, ...); each is called with `{ issuer }`
 * @param {string | null} args.owner        the token's issuer address
 * @param {string | null} [args.blockedReason]  a reason every action is locked for
 *   (a watch-only wallet, no network), or null
 * @param {string | null} [args.noBalanceReason]  given when the wallet holds none of the token:
 *   the actions that spend it (Destroy, Dispenser, Airdrop) are locked with this reason, after
 *   any watch-only or network reason
 * @param {string | null} [args.destroyRefusalReason]  given when the indexer refuses every DESTROY of
 *   this token on this chain (destroyPolicy: XCHAIN off Bitcoin, a bridged copy): Destroy is locked
 *   with this reason, after any watch-only, network or balance reason, as the registry tile does
 * @param {any[]} [args.extraActions]       more issuer actions (the registry's) to group
 */
export function buildTokenOwnerGroups({ assetInfo, sleepState, handlers, owner, blockedReason = null, noBalanceReason = null, destroyRefusalReason = null, extraActions = [] }) {
    const tokenLocks = assetInfo?.locks || {};
    const allLocksSet = LOCK_FLAG_KEYS.every((key) => !!tokenLocks[key]);
    const bridgeFrozen = assetInfo?.lockBridge === true;
    const unavailableReason = t('routes.manageToken.actionUnavailable');
    // Each handler opens its form with the issuer this page resolved, so
    // the form never has to look it up again.
    const issuerContext = owner ? { issuer: owner } : {};
    const options = {};
    for (const [name, handler] of Object.entries(handlers || {})) {
        options[name] = typeof handler === 'function' ? () => handler(issuerContext) : undefined;
    }
    const ownerAction = (handler) => ({
        onSelect: handler,
        disabled: typeof handler !== 'function',
        disabledReason: unavailableReason,
    });
    const actions = [
        ...approvedManageActions({
            ...options,
            assetInfo,
            tokenLocks,
            allLocksSet,
            bridgeFrozen,
            unavailableReason,
            sleepState,
            ownerAction,
        }),
        ...extraActions,
    ];
    const rowReason = (action) => {
        if (!action.disabled) return undefined;
        return action.disabledReason;
    };
    const withState = (action) => (blockedReason && !action.disabled
        ? { ...action, disabled: true, disabledReason: blockedReason, onSelect: undefined }
        : action);
    // Applied after withState, so a watch-only or offline reason reads first,
    // as it does on the holder's own rows.
    const withBalance = (action) => (noBalanceReason && !action.disabled && NEEDS_BALANCE_OWNER_IDS.has(action.id)
        ? { ...action, disabled: true, disabledReason: noBalanceReason, onSelect: undefined }
        : action);
    const withDestroyPolicy = (action) => (destroyRefusalReason && !action.disabled && action.id === 'destroy'
        ? { ...action, disabled: true, disabledReason: destroyRefusalReason, onSelect: undefined }
        : action);
    return groupManageActions(actions.map(withState).map(withBalance).map(withDestroyPolicy)).map((group) => ({
        ...group,
        actions: group.actions.map((action) => ({ ...action, reason: rowReason(action) })),
    }));
}

function approvedManageActions(options) {
    const {
        assetInfo,
        tokenLocks,
        allLocksSet,
        bridgeFrozen,
        unavailableReason,
        sleepState,
        ownerAction,
    } = options;
    const reason = (special) => special || unavailableReason;
    const withDescriptions = (list) => list.map((action) => ({
        ...action,
        description: manageActionDescription(action.id, sleepState.paused),
    }));
    return withDescriptions([
        { id: 'issue-subtoken', label: t('routes.manageToken.issueSubtoken'), Icon: BranchIcon, ...ownerAction(options.onIssueSubtoken) },
        { id: 'dividend', label: t('routes.manageToken.dividend'), Icon: Icon.DollarIcon, onSelect: options.onPayDividend, disabled: typeof options.onPayDividend !== 'function', disabledReason: unavailableReason },
        { id: 'airdrop', label: t('palette.createAirdrop.title'), Icon: Icon.UsersIcon, onSelect: options.onAirdrop, disabled: typeof options.onAirdrop !== 'function', disabledReason: unavailableReason },
        {
            id: 'mint', label: t('routes.manageToken.mint'), Icon: Icon.PrinterIcon,
            ...ownerAction(options.onMint),
            disabled: !!tokenLocks.mint || typeof options.onMint !== 'function',
            disabledReason: reason(tokenLocks.mint ? t('routes.manageToken.mintLocked') : null),
        },
        { id: 'mint-settings', label: t('routes.manageToken.mintSettings'), Icon: Icon.GearIcon, ...ownerAction(options.onMintSettings) },
        {
            id: 'lock-settings', label: t('routes.manageToken.lockSettings'), Icon: Icon.LockIcon,
            ...ownerAction(options.onLock),
            disabled: allLocksSet || typeof options.onLock !== 'function',
            disabledReason: reason(allLocksSet ? t('routes.manageToken.allLocksSet') : null),
        },
        { id: 'destroy', label: t('routes.manageToken.destroy'), Icon: Icon.TrashIcon, onSelect: options.onDestroy, disabled: typeof options.onDestroy !== 'function', disabledReason: unavailableReason, danger: true },
        { id: 'dispenser', label: t('routes.manageToken.dispenser'), Icon: StorefrontIcon, onSelect: options.onCreateDispenser, disabled: typeof options.onCreateDispenser !== 'function', disabledReason: unavailableReason },
        { id: 'sell-name', label: t('routes.manageToken.sellName'), Icon: TagIcon, ...ownerAction(options.onSellOwnership) },
        {
            id: 'description', label: t('routes.manageToken.description'), Icon: Icon.PencilIcon,
            ...ownerAction(options.onUpdateDescription),
            disabled: !!tokenLocks.description || typeof options.onUpdateDescription !== 'function',
            disabledReason: reason(tokenLocks.description ? t('routes.manageToken.descriptionLocked') : null),
        },
        { id: 'artwork', label: t('routes.manageToken.artwork'), Icon: PictureIcon, ...ownerAction(options.onAttachContent) },
        { id: 'gated-content', label: t('gatedPublish.gatedContent'), Icon: Icon.KeyIcon, ...ownerAction(options.onGatedContent) },
        { id: 'official-list', label: t('routes.manageToken.officialList'), Icon: Icon.BookIcon, ...ownerAction(options.onManageRoster) },
        { id: 'broadcast', label: t('routes.manageToken.broadcast'), Icon: Icon.BroadcastIcon, ...ownerAction(options.onBroadcast) },
        { id: 'transfer', label: t('routes.manageToken.transfer'), Icon: Icon.HandshakeIcon, ...ownerAction(options.onTransferOwnership) },
        { id: 'controller', label: t('routes.manageToken.controller'), Icon: Icon.LinkIcon, ...ownerAction(options.onBindController) },
        { id: 'controller-unbind', label: t('routes.manageToken.unbindController'), Icon: Icon.UnlinkIcon, ...ownerAction(options.onUnbindController) },
        { id: 'callback-settings', label: t('routes.manageToken.callbackSettings'), Icon: Icon.GearIcon, ...ownerAction(options.onCallbackSettings) },
        {
            id: 'execute-callback', label: t('routes.manageToken.executeCallback'), Icon: LightningIcon,
            ...ownerAction(options.onExecuteCallback),
            disabled: !assetInfo?.callbackTick || typeof options.onExecuteCallback !== 'function',
            disabledReason: reason(!assetInfo?.callbackTick ? t('routes.manageToken.callbackNotConfigured') : null),
            danger: true,
        },
        { id: 'access-lists', label: t('routes.manageToken.accessLists'), Icon: Icon.TokenListIcon, ...ownerAction(options.onAccessLists) },
        { id: 'shared-block-list', label: t('routes.manageToken.sharedBlockList'), Icon: Icon.TokenListIcon, ...ownerAction(options.onUseSharedBlockList ?? options.onAccessLists) },
        {
            id: 'bridge', label: t('routes.manageToken.bridge'), Icon: BridgeIcon,
            ...ownerAction(options.onBridgeSettings),
            disabled: bridgeFrozen || typeof options.onBridgeSettings !== 'function',
            disabledReason: reason(bridgeFrozen ? t('routes.manageToken.bridgeLocked') : null),
        },
        {
            id: 'pause-token',
            label: sleepState.paused ? t('routes.manageToken.resumeToken') : t('routes.manageToken.pauseToken'),
            Icon: sleepState.paused ? Icon.UnlockIcon : Icon.PauseIcon,
            ...ownerAction(options.onPauseToken),
        },
    ]);
}

// The one line under each action row's title (G101): what the action does.
const MANAGE_ACTION_DESCRIPTION_KEYS = {
    destroy: 'routes.manageToken.descriptions.destroy',
    'issue-subtoken': 'routes.manageToken.descriptions.issueSubtoken',
    'lock-settings': 'routes.manageToken.descriptions.lockSettings',
    mint: 'routes.manageToken.descriptions.mint',
    'mint-settings': 'routes.manageToken.descriptions.mintSettings',
    airdrop: 'routes.manageToken.descriptions.airdrop',
    broadcast: 'routes.manageToken.descriptions.broadcast',
    dispenser: 'routes.manageToken.descriptions.dispenser',
    dividend: 'routes.manageToken.descriptions.dividend',
    artwork: 'routes.manageToken.descriptions.artwork',
    description: 'routes.manageToken.descriptions.description',
    'gated-content': 'routes.manageToken.descriptions.gatedContent',
    'official-list': 'routes.manageToken.descriptions.officialList',
    controller: 'routes.manageToken.descriptions.controller',
    'controller-unbind': 'routes.manageToken.descriptions.unbindController',
    'sell-name': 'routes.manageToken.descriptions.sellName',
    transfer: 'routes.manageToken.descriptions.transfer',
    'access-lists': 'routes.manageToken.descriptions.accessLists',
    bridge: 'routes.manageToken.descriptions.bridge',
    'callback-settings': 'routes.manageToken.descriptions.callbackSettings',
    'execute-callback': 'routes.manageToken.descriptions.executeCallback',
    'shared-block-list': 'routes.manageToken.descriptions.sharedBlockList',
};

function manageActionDescription(id, paused) {
    if (id === 'pause-token') {
        return paused
            ? t('routes.manageToken.descriptions.resumeToken')
            : t('routes.manageToken.descriptions.pauseToken');
    }
    const key = MANAGE_ACTION_DESCRIPTION_KEYS[id];
    return key ? t(key) : undefined;
}

// The issuer's action groups, in page order. Any action not named here
// lands in a last "More" group so nothing is ever dropped.
const MANAGE_ACTION_GROUPS = [
    { id: 'supply', title: 'Supply', ids: ['destroy', 'issue-subtoken', 'lock-settings', 'mint', 'mint-settings'] },
    { id: 'distribute', title: 'Distribute', ids: ['airdrop', 'broadcast', 'dispenser', 'dividend', 'oracle'] },
    { id: 'page', title: 'Token page', ids: ['artwork', 'description', 'gated-content', 'official-list'] },
    { id: 'ownership', title: 'Ownership', ids: ['controller', 'controller-unbind', 'sell-name', 'transfer'] },
    { id: 'rules', title: 'Rules and automation', ids: ['access-lists', 'bridge', 'callback-settings', 'execute-callback', 'pause-token', 'shared-block-list'] },
];

/** Every action id the issuer's groups carry, for the page to leave out of its main list. */
export const TOKEN_OWNER_GROUP_ACTION_IDS = new Set(MANAGE_ACTION_GROUPS.flatMap((group) => group.ids));

function groupManageActions(actions) {
    const byLabel = (a, b) => String(a.label).localeCompare(String(b.label));
    const named = new Set(MANAGE_ACTION_GROUPS.flatMap((group) => group.ids));
    const groups = MANAGE_ACTION_GROUPS
        .map((group) => ({ ...group, actions: actions.filter((action) => group.ids.includes(action.id)).sort(byLabel) }));
    const rest = actions.filter((action) => !named.has(action.id)).sort(byLabel);
    if (rest.length) groups.push({ id: 'more', title: 'More', actions: rest });
    return groups.filter((group) => group.actions.length > 0);
}

/**
 * The issuer's groups as the Actions tab draws every action set (G101): a
 * heading over one action list per group, never collapsed (an info page has
 * no collapsible sections). A locked row says why in place of its description.
 */
export function TokenOwnerActionGroups({ groups, sectionClassName }) {
    return groups.map((group) => (
        <section key={group.id} className={sectionClassName} aria-label={group.title} data-owner-group={group.id}>
            <SectionHeader title={group.title} />
            <ActionList label={group.title}>
                {group.actions.map((action) => (
                    <ActionListItem
                        key={action.id}
                        data-action-id={action.id}
                        icon={<action.Icon />}
                        title={action.label}
                        description={action.description}
                        onClick={action.onSelect}
                        tone={action.danger ? 'danger' : 'default'}
                        disabled={action.disabled}
                        disabledReason={action.reason}
                    />
                ))}
            </ActionList>
        </section>
    ));
}

/**
 * The issuer's facts as rows for the page's one Details card: the issuer
 * when it differs from the creator, the supply cap, the eight lock states,
 * whether the token is paused, and its creation block. A row whose value is
 * unknown is left out, never drawn with a dash.
 *
 * @returns {{ id: string, label: string, value: import('react').ReactNode, ariaLabel?: string }[]}
 */
export function tokenOwnerDetailRows({ creator, issuer, maxSupply, divisibility, tokenLocks, lockBridge, paused, createdBlock, lockedClassName, editableClassName }) {
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
    const rows = [];
    if (issuer && issuer !== creator) {
        rows.push({ id: 'issuer', label: t('routes.manageToken.issuer'), value: <AddressText address={issuer} /> });
    }
    if (maxSupply != null) {
        rows.push({ id: 'max-supply', label: t('tokenDetail.details.supplyCap'), value: formatTokenQuantity(maxSupply, divisibility) });
    }
    for (const [key, label] of lockRows) {
        const locked = key === 'bridge' ? lockBridge === true : !!tokenLocks?.[key];
        const state = locked ? t('routes.manageToken.locked') : t('routes.manageToken.editable');
        rows.push({
            id: `lock-${key}`,
            label: t('tokenDetail.details.lockRow', { name: label }),
            value: (
                <span className={locked ? lockedClassName : editableClassName} aria-label={`${label}: ${state}`}>
                    {locked ? <Icon.LockIcon /> : <Icon.UnlockIcon />}
                    {state}
                </span>
            ),
        });
    }
    rows.push({
        id: 'state',
        label: t('tokenDetail.details.state'),
        value: paused ? t('routes.manageToken.paused') : t('settings.developer.active'),
    });
    if (createdBlock != null) {
        rows.push({
            id: 'created',
            label: t('walletDetails.created'),
            value: t('history.row.block', { block: Number(createdBlock).toLocaleString('en-US') }),
        });
    }
    return rows;
}
