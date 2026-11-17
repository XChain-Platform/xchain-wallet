// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Icon, ListPage, PageHeader, Screen, SectionHeader } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/actionsMenu.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';

const SIGNER_ACTION_IDS = new Set(['sign-psbt', 'sign-message', 'verify-signature']);

export const ENTRY_ICON = {
    issue: Icon.PlusIcon,
    mint: Icon.MintIcon,
    destroy: Icon.TrashIcon,
    sweep: Icon.SweepIcon,
    lock: Icon.LockIcon,
    description: Icon.PencilIcon,
    transfer: Icon.HandshakeIcon,
    broadcast: Icon.BroadcastIcon,
    oracle: Icon.ClockIcon,
    dispenser: Icon.TokenIcon,
    'dispensers-list': Icon.TokenListIcon,
    'dispenser-explorer': Icon.SearchIcon,
    dividend: Icon.DollarIcon,
    airdrop: Icon.UsersIcon,
    coinpay: Icon.SendIcon,
    swap: Icon.SwapIcon,
    'create-order': Icon.MarketIcon,
    'my-orders': Icon.MarketIcon,
    'my-swaps': Icon.SwapIcon,
    'publish-file': Icon.FileTypeIcon,
    link: Icon.LinkIcon,
    batch: Icon.MenuIcon,
    'cross-chain-swap': Icon.SwapIcon,
    'cross-chain-order': Icon.MarketIcon,
    'bridge-move': Icon.MigrateIcon,
    'bridge-settings': Icon.GearIcon,
    'multisig-create': Icon.MultisigIcon,
    'governance-polls': Icon.ThumbsUpIcon,
    'bet-markets': Icon.LineChartIcon,
    'cosigner-accounts': Icon.UserIcon,
    contacts: Icon.BookIcon,
    'sign-message': Icon.SignIcon,
    'verify-signature': Icon.VerifyIcon,
    'sign-psbt': Icon.KeyIcon,
    'lock-address': Icon.LockIcon,
    'pair-signer': Icon.UsbIcon,
};

/**
 * Actions menu: secondary authoring surface listed in §40.
 *
 * Home keeps the common three actions (Send / Receive / Create a token)
 * above the fold; everything else (standalone ISSUE §40.2, MINT §40.3,
 * DESTROY §40.4, token admin §40.5, BROADCAST §40.6, dispenser §40.7.1,
 * …) lands here. Until the Token detail page (§36 / §33) exists, this
 * menu also plays the role those per-token menus will eventually play.
 *
 * Entries are passed in as a prop so each host (popup, web) can choose
 * which items to surface and wire each one to its own sub-route.
 *
 * @typedef {{ id: string, label: string, description?: string, group?: string, groupLabel?: string, onSelect?: () => void, disabled?: boolean, disabledReason?: string }} ActionEntry
 *
 * @param {object} props
 * @param {ActionEntry[]} props.entries
 * @param {() => void} props.onBack
 */
export function ActionsMenu({ entries, onBack }) {
    const { shell } = useMessaging();
    const { isSignerMode } = useWalletMode();
    const variant = screenVariantFor(shell);
    const visibleEntries = entries.filter((entry) => {
        if (isSignerMode && !SIGNER_ACTION_IDS.has(entry.id)) return false;
        return typeof entry.onSelect === 'function'
            || (entry.disabled === true && Boolean(entry.disabledReason));
    });
    const groups = [];
    for (const entry of visibleEntries) {
        const groupId = entry.group || 'other';
        let group = groups.find((candidate) => candidate.id === groupId);
        if (!group) {
            group = { id: groupId, label: entry.groupLabel || t('actionsMenu.more'), entries: [] };
            groups.push(group);
        }
        group.entries.push(entry);
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title={t('actionsMenu.title')}
        />
    );
    return (
        <Screen variant={variant} header={header}>
            <ListPage>
                {groups.map((group) => {
                    const headingId = `action-group-${group.id}`;
                    return (
                        <section key={group.id} aria-labelledby={headingId}>
                            <SectionHeader id={headingId} title={group.label} />
                            {/* One ActionList per group (G101): icon square, title,
                                description and chevron; an unavailable entry stays as
                                an off row whose line says why. */}
                            <ActionList label={group.label}>
                                {group.entries.map((entry) => {
                                    const EntryIcon = ENTRY_ICON[entry.id]
                                        || Icon.iconForLabel(entry.label)
                                        || Icon.MoreIcon;
                                    return (
                                        <ActionListItem
                                            key={entry.id}
                                            icon={<EntryIcon />}
                                            title={entry.label}
                                            description={entry.description}
                                            onClick={entry.onSelect}
                                            disabled={entry.disabled === true}
                                            disabledReason={entry.disabledReason
                                                ? t('actionsMenu.unavailable', { reason: entry.disabledReason })
                                                : undefined}
                                        />
                                    );
                                })}
                            </ActionList>
                        </section>
                    );
                })}
            </ListPage>
        </Screen>
    );
}
