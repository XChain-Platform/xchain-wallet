// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A hardware wallet's own Wallet Details page (hw-4 layout 1): the device
// card, then the Actions and Details toggle. Actions holds Reconnect, Rename,
// Accounts and Unlink as plain rows (G101: a destructive row is never red);
// Unlink opens its own confirm page. A hardware wallet has no recovery
// phrase, backup, export or seed address check, so none of those rows show.
// Details opens with the Device Access note (balances read without the
// device; signing needs it), then the facts.
//
// Accounts are not listed here (G131): the Accounts row opens the shared My
// Accounts page, where a hardware wallet's accounts open, add and rename
// exactly as a local wallet's do. Only where the addresses come from differs
// (the device), which Add Account and Account Details handle.

import { useEffect, useState } from 'react';
import { Icon, ListPage, Notice, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { ActionList, ActionListItem } from './ActionList.jsx';
import { ActionsDetailsToggle } from './ActionsDetailsToggle.jsx';
import { HardwareDeviceCard, hardwareModelName, hardwareVendorName } from './hardware/index.js';
import { UnlinkHardwareWallet } from './UnlinkHardwareWallet.jsx';
import { formatWithThousands } from '../utils/amountFormat.js';
import pickerStyles from '../routes/WalletPicker.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/accountPicker.js';
import '../../i18n/locales/en/hardwareConnect.js';
import '../../i18n/locales/en/hardwareManage.js';
import '../../i18n/locales/en/hardwareSign.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/walletDetails.js';

/** The device status the card shows, from the host's signer status. */
export function cardStatus(signerStatus) {
    const status = typeof signerStatus === 'string' ? signerStatus : signerStatus?.status;
    if (status === 'available') return 'connected';
    if (status === 'locked') return 'unlock';
    return 'not-connected';
}

/**
 * @param {object} props
 * @param {any} props.wallet                  the hardware wallet record
 * @param {number | null} [props.accountCount]
 * @param {() => void} props.onBack
 * @param {(wallet: any) => void} [props.onRename]
 * @param {string | null} [props.activeWalletId]
 * @param {(wallet: any) => void} [props.onMakeActive]
 * @param {(walletId: string) => void} [props.onUnlinked]
 * @param {(wallet: any, signer: any) => void} [props.onReconnect]
 * @param {(wallet: any) => void} [props.onOpenAccounts]  the Accounts row: open the shared My Accounts page for this wallet
 */
export function HardwareWalletDetails({
    wallet,
    accountCount = null,
    onBack,
    onRename,
    activeWalletId = null,
    onMakeActive,
    onUnlinked,
    onReconnect,
    onOpenAccounts,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [signer, setSigner] = useState(/** @type {any} */ (null));
    const [signerStatus, setSignerStatus] = useState(/** @type {any} */ (null));
    const [unlinking, setUnlinking] = useState(false);
    const [accountRecords, setAccountRecords] = useState(/** @type {any[] | null} */ (null));

    // The wallet's accounts, for the count in Details and on the Unlink page.
    useEffect(() => {
        let cancelled = false;
        if (accountCount !== null || typeof messaging.listAccounts !== 'function') return undefined;
        Promise.resolve()
            .then(() => messaging.listAccounts(wallet.id))
            .then((list) => {
                if (cancelled) return;
                setAccountRecords(Array.isArray(list) ? list.filter((a) => !a?.walletId || a.walletId === wallet.id) : []);
            })
            .catch(() => { if (!cancelled) setAccountRecords([]); });
        return () => { cancelled = true; };
    }, [wallet.id, messaging, accountCount]);

    // The wallet's SignerRecord, then whether its device answers right now.
    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listSigners !== 'function') return undefined;
        Promise.resolve()
            .then(() => messaging.listSigners(wallet.id))
            .then(async (list) => {
                const records = Array.isArray(list) ? list : [];
                const record = records.find((r) => r?.walletId === wallet.id) || records[0] || null;
                if (cancelled) return;
                setSigner(record);
                if (!record || typeof messaging.getSignerStatus !== 'function') return;
                const status = await messaging.getSignerStatus({ signerId: record.id }).catch(() => null);
                if (!cancelled) setSignerStatus(status);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [wallet.id, messaging]);

    const count = accountCount ?? accountRecords?.length ?? 0;
    const status = cardStatus(signerStatus);
    const vendorName = hardwareVendorName(signer?.vendor);

    if (unlinking) {
        return (
            <UnlinkHardwareWallet
                wallet={wallet}
                signer={signer}
                status={status}
                accountCount={count}
                activeWalletId={activeWalletId}
                onBack={() => setUnlinking(false)}
                onUnlinked={(id) => (typeof onUnlinked === 'function' ? onUnlinked(id) : onBack())}
            />
        );
    }

    const isActive = wallet.id === activeWalletId;
    const created = wallet.createdAt ? new Date(wallet.createdAt) : null;
    const createdLabel = created && !Number.isNaN(created.getTime()) ? created.toLocaleString() : '';
    const statusLabel = status === 'connected'
        ? t('hardwareConnect.device.connected')
        : status === 'unlock' ? t('hardwareManage.status.unlock') : t('hardwareConnect.device.notConnected');

    const actions = (
        <ActionList label={t('hardwareManage.actionsList')}>
            {!isActive && typeof onMakeActive === 'function' ? (
                <ActionListItem
                    icon={<Icon.CheckIcon />}
                    title={t('hardwareManage.setActive')}
                    description={t('walletDetails.action.setActive')}
                    onClick={() => onMakeActive(wallet)}
                />
            ) : null}
            {typeof onReconnect === 'function' ? (
                <ActionListItem
                    icon={<Icon.RefreshIcon />}
                    title={t('hardwareManage.reconnect')}
                    description={t('hardwareManage.reconnectLine')}
                    onClick={() => onReconnect(wallet, signer)}
                />
            ) : null}
            {typeof onRename === 'function' ? (
                <ActionListItem
                    icon={<Icon.PencilIcon />}
                    title={t('hardwareManage.rename')}
                    description={t('hardwareManage.renameLine')}
                    onClick={() => onRename(wallet)}
                />
            ) : null}
            {typeof onOpenAccounts === 'function' ? (
                <ActionListItem
                    icon={<Icon.WalletIcon />}
                    title={t('accountPicker.title')}
                    description={t('hardwareManage.accountsLine')}
                    onClick={() => onOpenAccounts(wallet)}
                />
            ) : null}
            <ActionListItem
                icon={<Icon.UnlinkIcon />}
                title={t('hardwareManage.unlink')}
                description={t('hardwareManage.unlinkLine')}
                onClick={() => setUnlinking(true)}
            />
        </ActionList>
    );

    // The Device Access note leads the facts: balances read without the
    // device, signing needs it.
    const details = (
        <>
            <Notice tone="info" title={t('hardwareManage.balancesTitle')} role="note">
                {t('hardwareManage.balancesNote')}
            </Notice>
            <dl className={pickerStyles.detailList}>
                <Row label={t('walletDetails.name')} value={wallet.name || vendorName} />
                <Row label={t('hardwareSign.step.device')} value={hardwareModelName(signer?.vendor, signer?.model)} />
                <Row label={t('history.filters.statusHeader')} value={statusLabel} />
                <Row label={t('accountPicker.title')} value={formatWithThousands(String(count))} />
                {createdLabel ? <Row label={t('hardwareManage.detail.added')} value={createdLabel} /> : null}
            </dl>
        </>
    );

    return (
        <Screen variant={variant} header={<PageHeader onBack={onBack} title={t('walletDetails.title')} />}>
            <ListPage style={{ '--xc-section-gap': 'var(--xc-space-2)', gap: 'var(--xc-space-2)' }}>
                <HardwareDeviceCard
                    vendor={signer?.vendor || ''}
                    model={signer?.model}
                    name={wallet.name || vendorName}
                    status={status}
                />
                <ActionsDetailsToggle actions={actions} details={details} />
            </ListPage>
        </Screen>
    );
}

function Row({ label, value }) {
    return (
        <div className={pickerStyles.detailRow}>
            <dt className={pickerStyles.detailLabel}>{label}</dt>
            <dd className={pickerStyles.detailValue}>{value}</dd>
        </div>
    );
}
