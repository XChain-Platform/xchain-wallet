// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// View Address, the detail branch of AddressList (not a route of its own):
// an identity card (label, network icon beside the QR, the address with its
// copy icon), then the shared Actions | Details toggle (G102) with the
// actions as one ActionList (G101). AddressList owns the data and every
// write; this component lays them out and keeps only view state (the Edit
// label form, the copied flag).

import { useId, useState } from 'react';
import { AddressText, ChainBadge, CopyButton, Icon, InfoTip, Input, ListPage, MultisigBadge, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { FormAction, FormFrame, FormSection, useFormSections } from '../components/formStandard/index.js';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { ActionsDetailsToggle } from '../components/ActionsDetailsToggle.jsx';
import { KeyQR } from '../components/KeyQR.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { WarningCard, WarningLine } from '../components/WarningCard.jsx';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import {
    feePreferenceLabel,
    requireMemoLabel,
    dispenserPreferenceLabel,
} from '../../flows/addressPreferences.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/addressList.js';
import '../../i18n/locales/en/multisig.js';
// The token page's identity card and details card.
import tokenPageStyles from './ManageToken.module.css';
import local from './AddressDetail.module.css';

// The QR's pixel size; its frame adds the shared QR padding around it.
const QR_SIZE = 120;

/**
 * @param {object} props
 * @param {'popup' | 'page' | undefined} props.variant
 * @param {() => void} props.onBack
 * @param {any} props.selected   the address row: { chainId, address, label, record, multisig }
 * @param {any} [props.descriptor]   the chain descriptor
 * @param {boolean} props.active   this is the chain's active address
 * @param {string} props.balanceText
 * @param {string} props.typeText
 * @param {string | null} [props.addressFormatText]
 * @param {any | null} props.chainPrefs
 * @param {string | null} props.chainPrefsError
 * @param {boolean} props.chainPrefsPending
 * @param {string | null} props.explorerUrl
 * @param {boolean} props.overCeiling   a multisig past its address type's key limit: no address, QR or copy
 * @param {boolean} props.canSecret
 * @param {() => void} props.onShowSecret   opens the reveal screen, which keeps its own password gate and warnings
 * @param {(() => void) | undefined} props.onReceive
 * @param {(() => void) | undefined} props.onEditPreferences
 * @param {((label: string) => Promise<boolean>) | undefined} props.onSaveLabel   resolves true once saved
 * @param {boolean} props.labelSaving
 * @param {(() => void) | undefined} props.onToggleHidden
 * @param {boolean} props.visibilitySaving
 * @param {(() => void) | undefined} props.onSetActive   present only while the address is not the active one
 * @param {(() => void) | undefined} props.onDelete
 * @param {'use' | 'delete' | null} props.detailAction
 * @param {import('react').ReactNode} [props.children]   overlays (the delete confirm)
 */
export function AddressDetail({
    variant,
    onBack,
    selected,
    descriptor,
    active,
    balanceText,
    typeText,
    addressFormatText = null,
    chainPrefs,
    chainPrefsError,
    chainPrefsPending,
    explorerUrl,
    overCeiling,
    canSecret,
    onShowSecret,
    onReceive,
    onEditPreferences,
    onSaveLabel,
    labelSaving,
    onToggleHidden,
    visibilitySaving,
    onSetActive,
    onDelete,
    detailAction,
    children,
}) {
    const prefsHeadingId = useId();
    const [copied, setCopied] = useState(false);
    const [editing, setEditing] = useState(false);
    const [labelDraft, setLabelDraft] = useState('');
    const sections = useFormSections({ label: true });

    const record = selected.record || null;
    const label = selected.label || t('addressList.detail.unlabelled');
    // A watch-only address has no key here: its Secret key row stays, locked.
    const watchOnly = !!record && !selected.multisig && record.source === 'watch-only';
    const hidden = record?.hidden === true;

    if (editing && onSaveLabel) {
        const unchanged = labelDraft.trim() === (selected.label || '');
        const submit = async (event) => {
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
            if (labelSaving || unchanged) return;
            if (await onSaveLabel(labelDraft.trim())) setEditing(false);
        };
        return (
            <Screen
                variant={variant}
                header={<PageHeader onBack={() => setEditing(false)} backDisabled={labelSaving} title={t('addressList.detail.editTitle')} nested />}
            >
                {/* One Form Standard section: the label, then Save Label. */}
                <FormFrame
                    label={t('addressList.detail.editTitle')}
                    onSubmit={submit}
                    action={(
                        <FormAction icon={<Icon.SaveIcon />} loading={labelSaving} disabled={unchanged}>
                            {t('addressList.detail.saveLabel')}
                        </FormAction>
                    )}
                >
                    <FormSection
                        id="label"
                        title={t('addressList.detail.labelSection')}
                        icon={Icon.PencilIcon}
                        {...sections.bind('label')}
                        summary={labelDraft.trim() || t('addressList.detail.unlabelled')}
                    >
                        <Input
                            label={t('addressList.detail.labelField')}
                            help={t('addressList.detail.labelHelp')}
                            value={labelDraft}
                            onChange={(e) => setLabelDraft(e.target.value)}
                            placeholder={t('addressList.detail.labelPlaceholder')}
                            autoComplete="off"
                            disabled={labelSaving}
                        />
                    </FormSection>
                </FormFrame>
            </Screen>
        );
    }

    const facts = [];
    if (descriptor) {
        facts.push({ id: 'network', label: t('addressList.detail.network'), value: <ChainBadge descriptor={descriptor} size="sm" showName /> });
    }
    facts.push({ id: 'balance', label: t('addressList.detail.balance'), value: balanceText });
    facts.push({ id: 'type', label: t('addressList.detail.type'), value: typeText });
    if (addressFormatText) {
        facts.push({ id: 'address-format', label: t('addressList.detail.addressFormat'), value: addressFormatText, hint: t('addressList.detail.addressFormatHelp') });
    }
    if (record?.derivationPath) {
        facts.push({ id: 'derivation-path', label: t('addressList.detail.derivationPath'), value: record.derivationPath, hint: t('addressList.detail.derivationPathHelp'), mono: true });
    }
    if (selected.multisig) {
        // The badge, not a template string: interpolating .scheme printed the
        // stored identifier ("2-of-2 (taproot-musig2)") (XC review #4384).
        facts.push({
            id: 'multisig',
            label: t('addressList.detail.multisig'),
            value: (
                <MultisigBadge
                    threshold={selected.multisig.threshold}
                    cosignerCount={selected.multisig.cosignerCount}
                    scheme={selected.multisig.scheme}
                />
            ),
        });
    }

    const nativeTick = tickerForDescriptor(descriptor);

    return (
        <Screen variant={variant} header={<PageHeader onBack={onBack} title={t('addressList.detail.title')} nested />}>
            <ListPage
                className={tokenPageStyles.approvedBody}
                notices={overCeiling ? (
                    <WarningCard role="alert">
                        <WarningLine critical>{t('multisig.overCeilingNotice')}</WarningLine>
                    </WarningCard>
                ) : null}
            >
                {/* The identity card: the label as its title, the network icon
                    beside the QR, then the address with its copy icon. */}
                <section className={`${tokenPageStyles.approvedHero} ${local.card}`} aria-label={t('addressList.detail.card')}>
                    <h2 className={tokenPageStyles.approvedHeroName} data-testid="address-detail-label">{label}</h2>
                    {overCeiling ? null : (
                        <>
                            <div className={local.pair} data-testid="address-detail-pair">
                                {descriptor && nativeTick ? (
                                    <span className={local.networkIcon} data-testid="address-detail-network-icon">
                                        <TickerIcon chainId={selected.chainId} tick={nativeTick} context="hero" />
                                    </span>
                                ) : null}
                                <span className={local.qr} data-testid="address-detail-qr">
                                    <KeyQR value={selected.address} size={QR_SIZE} bare alt={t('addressList.detail.qr')} />
                                </span>
                            </div>
                            <div className={local.addressRow} data-testid="address-detail-address">
                                <AddressText address={selected.address} fit className={local.addressText} />
                                <span className={local.copy}>
                                    <CopyButton
                                        value={selected.address}
                                        label={copied ? t('addressList.detail.copied') : t('addressList.detail.copy')}
                                        iconOnly
                                        appearance="outlined"
                                        onCopied={() => {
                                            setCopied(true);
                                            setTimeout(() => setCopied(false), 1200);
                                        }}
                                    />
                                </span>
                            </div>
                        </>
                    )}
                </section>

                <ActionsDetailsToggle
                    label={t('addressList.detail.view')}
                    actions={(
                        <ActionList label={t('addressList.detail.actions')}>
                            {onReceive ? (
                                <ActionListItem
                                    icon={<Icon.ReceiveIcon />}
                                    onClick={onReceive}
                                    title={t('addressList.detail.receive')}
                                    description={t('addressList.detail.receiveDescription')}
                                />
                            ) : null}
                            {onSaveLabel ? (
                                <ActionListItem
                                    icon={<Icon.PencilIcon />}
                                    onClick={() => {
                                        setLabelDraft(selected.label || '');
                                        setEditing(true);
                                    }}
                                    title={t('addressList.detail.editLabel')}
                                    description={t('addressList.detail.editLabelDescription')}
                                />
                            ) : null}
                            {onEditPreferences ? (
                                <ActionListItem
                                    icon={<Icon.GearIcon />}
                                    onClick={onEditPreferences}
                                    title={t('addressList.detail.onChainPrefs')}
                                    description={t('addressList.detail.onChainPrefsDescription')}
                                />
                            ) : null}
                            {onToggleHidden ? (
                                <ActionListItem
                                    icon={hidden ? <Icon.EyeIcon /> : <Icon.EyeOffIcon />}
                                    onClick={onToggleHidden}
                                    disabled={visibilitySaving}
                                    title={hidden ? t('addressList.detail.unhide') : t('addressList.detail.hide')}
                                    description={hidden ? t('addressList.detail.unhideDescription') : t('addressList.detail.hideDescription')}
                                />
                            ) : null}
                            {onSetActive && !active ? (
                                <ActionListItem
                                    icon={<Icon.CheckIcon />}
                                    onClick={onSetActive}
                                    disabled={detailAction !== null}
                                    aria-busy={detailAction === 'use'}
                                    title={detailAction === 'use' ? t('addressList.detail.switching') : t('addressList.detail.setActive')}
                                    description={t('addressList.detail.setActiveDescription')}
                                />
                            ) : null}
                            {/* A watch-only address keeps its Secret key row, off, with the reason as its line. */}
                            {watchOnly ? (
                                <ActionListItem
                                    icon={<Icon.KeyIcon />}
                                    disabled
                                    disabledReason={t('addressList.detail.watchOnlyLocked')}
                                    data-testid="address-detail-secret-locked"
                                    title={t('addressList.detail.secretKey')}
                                />
                            ) : canSecret ? (
                                <ActionListItem
                                    icon={<Icon.KeyIcon />}
                                    onClick={onShowSecret}
                                    title={t('addressList.detail.secretKey')}
                                    description={t('addressList.detail.secretKeyDescription')}
                                />
                            ) : null}
                            {explorerUrl ? (
                                <ActionListItem
                                    icon={<Icon.ExternalLinkIcon />}
                                    onClick={() => {
                                        try { window.open(explorerUrl, '_blank', 'noopener,noreferrer'); } catch { /* no-op */ }
                                    }}
                                    title={t('addressList.detail.explorer')}
                                    description={t('addressList.detail.explorerDescription')}
                                />
                            ) : null}
                            {onDelete ? (
                                <ActionListItem
                                    icon={<Icon.TrashIcon />}
                                    tone="danger"
                                    onClick={onDelete}
                                    disabled={detailAction !== null}
                                    aria-busy={detailAction === 'delete'}
                                    title={detailAction === 'delete' ? t('addressList.detail.deleting') : t('addressList.detail.delete')}
                                    description={t('addressList.detail.deleteDescription')}
                                />
                            ) : null}
                        </ActionList>
                    )}
                    details={(
                        <>
                            <section className={tokenPageStyles.approvedDetailsCard} aria-label={t('addressList.detail.details')}>
                                <dl className={tokenPageStyles.approvedDetailsList}>
                                    {facts.map((f) => (
                                        <div key={f.id} className={tokenPageStyles.approvedDetailRow}>
                                            <dt className={local.factLabel}>
                                                {f.label}
                                                {f.hint ? <InfoTip aria={t('addressList.detail.help', { label: f.label })} label={f.hint} /> : null}
                                            </dt>
                                            <dd
                                                className={f.mono ? tokenPageStyles.approvedMono : undefined}
                                                data-testid={`address-detail-${f.id}`}
                                            >
                                                {f.value}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            </section>
                            {/* PC-32: this address's on-chain ADDRESS v0 preferences. */}
                            {chainPrefs || chainPrefsError || chainPrefsPending ? (
                                <section className={tokenPageStyles.approvedDetailsCard} aria-labelledby={prefsHeadingId}>
                                    <h3 id={prefsHeadingId} className={local.groupHeading}>{t('addressList.detail.preferences')}</h3>
                                    {chainPrefs ? (
                                        <dl className={tokenPageStyles.approvedDetailsList}>
                                            <div className={tokenPageStyles.approvedDetailRow}>
                                                <dt>{t('addressList.detail.protocolFee')}</dt>
                                                <dd data-testid="address-detail-protocol-fee">{feePreferenceLabel(chainPrefs.feePreference)}</dd>
                                            </div>
                                            <div className={tokenPageStyles.approvedDetailRow}>
                                                <dt>{t('addressList.detail.incomingSends')}</dt>
                                                <dd data-testid="address-detail-incoming-sends">{requireMemoLabel(chainPrefs.requireMemo)}</dd>
                                            </div>
                                            <div className={tokenPageStyles.approvedDetailRow}>
                                                <dt>{t('addressList.detail.dispensers')}</dt>
                                                <dd data-testid="address-detail-dispensers">{dispenserPreferenceLabel(chainPrefs.dispenserPreference)}</dd>
                                            </div>
                                        </dl>
                                    ) : (
                                        <p className={local.prefsStatus}>
                                            {chainPrefsError || t('addressList.detail.loading')}
                                        </p>
                                    )}
                                </section>
                            ) : null}
                        </>
                    )}
                />
                {children}
            </ListPage>
        </Screen>
    );
}
