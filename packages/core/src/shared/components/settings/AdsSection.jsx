// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AdsSection: Settings > Automatic donations (§36, operator ruling
// 2026-11-14, layout 4 under layout 1's header). One wallet-wide queue in
// fiat (settings.ads): the header states the per-transaction amount and the
// rule in one line; the Donation group changes Per transaction, Send at and
// Donate to in place on SettingsInlineRow rows (None turns donations off, so
// there is no switch, and Custom opens an amount field in place); the Totals
// group shows what is queued and what has been donated.

import { useEffect, useId, useState } from 'react';
import { Icon, Input, Notice, Select } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { formatFiatAmount } from '../../utils/fiatAmountFormat.js';
import {
    ADS_PER_TRANSACTION_MAX,
    ADS_PER_TRANSACTION_OPTIONS,
    ADS_RECIPIENTS,
    ADS_DEFAULT_SEND_AT,
    ADS_SEND_AT_MAX,
    ADS_SEND_AT_MIN,
    ADS_SEND_AT_OPTIONS,
    isAdsPerTransaction,
    isAdsSendAt,
} from '../../../schemas/settings.js';
import { adsSettingsOf } from '../../../flows/ads.js';
import { compareDecimalStrings } from '../../utils/amountFormat.js';
import { donationRecipientLabel } from '../../utils/adsDonationLine.js';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/settings.js';
import '../../../i18n/locales/en/send.js';
import '../../../i18n/locales/en/ui.js';
import { InlineRowFrame, SettingsInlineRow } from './SettingsInlineRow.jsx';
import { SettingsLoadError, STACK, Status } from './_settingsPrimitives.jsx';
import groupListStyles from '../../routes/CoSignerAccountList.module.css';
import styles from './AdsSection.module.css';

const CUSTOM = 'custom';
const GROUP_ICON_CSS = '[data-settings-group-icon] svg { width: var(--xc-icon-xl); height: var(--xc-icon-xl); }';
const RECIPIENT_ICONS = {
    protocol: Icon.LandmarkIcon,
    community: Icon.UsersIcon,
    explorer: Icon.SearchIcon,
};

// The recipient's name, the same words the confirm screen's donation line uses.
const adsRecipientLabel = (recipient) => donationRecipientLabel(recipient) || donationRecipientLabel('protocol');
// "None" and "Custom" read as everywhere else in the wallet.
const noneLabel = () => t('send.advanced.none');
const customLabel = () => t('ui.feeSelector.custom');

// The currency the page shows and writes: the queue's own, except while
// nothing is queued or donated, when it follows the display currency (the
// engine adopts it on the next send for the same reason).
function pageCurrency(settings) {
    const ads = adsSettingsOf(settings);
    const empty = compareDecimalStrings(ads.queued, '0') === 0 && compareDecimalStrings(ads.donated, '0') === 0;
    return empty && settings?.fiatCurrency ? settings.fiatCurrency : ads.currency;
}

/** An amount in the page's currency, always two decimals ("$5.00"). */
function money(value, currency) {
    return formatFiatAmount(value, currency);
}

// A preset choice as the dropdown lists it: whole amounts without cents
// ("$5"), the rest as money ("$0.05").
function presetLabel(value, currency) {
    if (/^\d+$/.test(value)) {
        try {
            return new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency,
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(Number(value));
        } catch {
            return money(value, currency);
        }
    }
    return money(value, currency);
}

/**
 * The typed amount in the stored form ("05." -> "5", ".5" -> "0.5",
 * "0.10" -> "0.1"), or null when it is not a plain amount.
 */
export function normalizeAdsAmount(raw) {
    const text = String(raw ?? '').trim();
    const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
    if (!match || (match[1] === '' && !match[2])) return null;
    const whole = (match[1] || '0').replace(/^0+(?=\d)/, '');
    const frac = (match[2] || '').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
}

/** The patch that saves one donation field, carrying the currency it is in. */
function adsPatch(settings, fields) {
    return { ads: { ...fields, currency: pageCurrency(settings) } };
}

/**
 * Per transaction and Send at: a preset dropdown on the row, and a Custom
 * choice that opens an amount field in place under it.
 */
function AmountRow({ row, leading, settings, update }) {
    const { field, presets, isValid, errorText, presetText } = row.amount;
    const ads = adsSettingsOf(settings);
    const currency = pageCurrency(settings);
    const stored = ads[field];
    const storedIsPreset = presets.includes(stored);
    const [customOpen, setCustomOpen] = useState(!storedIsPreset);
    const [draft, setDraft] = useState(storedIsPreset ? '' : stored);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const fieldId = useId();
    useEffect(() => {
        // A value saved elsewhere (another window) closes or refills the field.
        if (!presets.includes(stored)) {
            setCustomOpen(true);
            setDraft(stored);
        }
    }, [stored, presets]);

    const save = async (value) => {
        setError(null);
        try {
            await update(adsPatch(settings, { [field]: value }));
            return true;
        } catch (err) {
            setError(t('settings.ads.saveFailed'));
            // eslint-disable-next-line no-console
            console.error(`settings ads.${field} update failed:`, err);
            return false;
        }
    };
    const commitDraft = async () => {
        const value = normalizeAdsAmount(draft);
        if (value === null || !isValid(value)) {
            setError(errorText);
            return;
        }
        if (value === stored) { setError(null); return; }
        await save(value);
    };

    const options = [
        ...presets.map((value) => ({ value, label: presetText(value, currency), icon: <Icon.DollarIcon /> })),
        { value: CUSTOM, label: customLabel(), icon: <Icon.PencilIcon /> },
    ];
    const selected = customOpen ? CUSTOM : stored;
    return (
        <InlineRowFrame
            leading={leading}
            title={row.title}
            help={row.help}
            line={row.line}
            kind="select"
            after={customOpen || error ? (
                <div className={styles.custom}>
                    {customOpen ? (
                        <Input
                            id={fieldId}
                            label={t('settings.ads.customAmount', { currency })}
                            help={row.help}
                            type="text"
                            inputMode="decimal"
                            enterKeyHint="done"
                            autoComplete="off"
                            value={draft}
                            error={error || undefined}
                            onChange={(e) => { setDraft(e.target.value); if (error) setError(null); }}
                            onBlur={commitDraft}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            data-testid={`ads-custom-${field}`}
                        />
                    ) : null}
                    {!customOpen && error ? <span role="alert">{error}</span> : null}
                </div>
            ) : null}
        >
            <div className={styles.select}>
                <Select
                    value={selected}
                    options={options}
                    aria-label={row.title}
                    data-testid={`ads-select-${field}`}
                    onChange={(event) => {
                        const next = event.target.value;
                        if (next === CUSTOM) {
                            setCustomOpen(true);
                            setDraft(stored);
                            return;
                        }
                        setCustomOpen(false);
                        setDraft('');
                        save(next);
                    }}
                />
            </div>
        </InlineRowFrame>
    );
}

function leadingIcon(RowIcon) {
    return (
        <span
            className={groupListStyles.rowIcon}
            aria-hidden="true"
            data-settings-group-icon=""
            style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
        >
            <RowIcon />
        </span>
    );
}

/** One labelled group card of inline rows, as on every Settings group page. */
function AdsGroup({ label, rows, settings, update }) {
    return (
        <div className={styles.group}>
            <div className={styles.groupLabel}>{label}</div>
            {/* Safari needs an explicit list role because this class removes list styling. */}
            <ul
                className={groupListStyles.list}
                role="list"
                aria-label={label}
                style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', background: 'var(--xc-surface)', overflow: 'visible' }}
            >
                {rows.map((r) => (
                    <li key={r.id} data-settings-row-id={r.id}>
                        <SettingsInlineRow row={r} leading={leadingIcon(r.icon)} settings={settings} update={update} />
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function AdsSection() {
    const { settings, loading, error, update } = useSettings();
    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const ads = adsSettingsOf(settings);
    const currency = pageCurrency(settings);
    const on = compareDecimalStrings(ads.perTransaction, '0') === 1;
    const recipient = adsRecipientLabel(ads.recipient);

    const donationRows = [
        {
            id: 'ads-per-transaction',
            title: t('settings.ads.perTransaction'),
            line: t('settings.ads.perTransactionLine'),
            help: t('settings.help.ads.perTransaction'),
            icon: Icon.CoinsIcon,
            amount: {
                field: 'perTransaction',
                presets: ADS_PER_TRANSACTION_OPTIONS,
                isValid: isAdsPerTransaction,
                errorText: t('settings.ads.customPerTransactionError', { max: money(ADS_PER_TRANSACTION_MAX, currency) }),
                presetText: (value, cur) => (value === '0' ? noneLabel() : presetLabel(value, cur)),
            },
            control: { kind: 'custom', Component: AmountRow },
        },
        {
            id: 'ads-send-at',
            title: t('settings.ads.sendAt'),
            line: t('settings.ads.sendAtLine'),
            help: t('settings.help.ads.sendAt', { sendAt: money(ADS_DEFAULT_SEND_AT, currency) }),
            icon: Icon.TargetIcon,
            amount: {
                field: 'sendAt',
                presets: ADS_SEND_AT_OPTIONS,
                isValid: isAdsSendAt,
                errorText: t('settings.ads.customSendAtError', {
                    min: money(ADS_SEND_AT_MIN, currency),
                    max: money(ADS_SEND_AT_MAX, currency),
                }),
                presetText: presetLabel,
            },
            control: { kind: 'custom', Component: AmountRow },
        },
        {
            id: 'ads-donate-to',
            title: t('settings.ads.donateTo'),
            line: t('settings.ads.donateToLine'),
            help: t('settings.help.ads.donateTo'),
            icon: Icon.LandmarkIcon,
            control: {
                kind: 'select',
                value: (st) => adsSettingsOf(st).recipient,
                options: () => ADS_RECIPIENTS.map((value) => {
                    const RecipientIcon = RECIPIENT_ICONS[value];
                    return { value, label: adsRecipientLabel(value), icon: <RecipientIcon /> };
                }),
                patch: (value, st) => adsPatch(st, { recipient: value }),
            },
        },
    ];
    const totalRows = [
        {
            id: 'ads-queued',
            title: t('settings.ads.queued'),
            line: t('settings.ads.queuedLine', { sendAt: money(ads.sendAt, currency) }),
            icon: Icon.InboxIcon,
            control: { kind: 'static', value: (st) => money(adsSettingsOf(st).queued, pageCurrency(st)) },
        },
        {
            id: 'ads-donated',
            title: t('settings.ads.donatedSoFar'),
            line: t('settings.ads.donationCount', { count: ads.donationCount }),
            icon: Icon.HeartIcon,
            control: { kind: 'static', value: (st) => money(adsSettingsOf(st).donated, pageCurrency(st)) },
        },
    ];

    return (
        <div style={STACK} data-testid="ads-page">
            <style>{GROUP_ICON_CSS}</style>
            <Notice
                tone="info"
                role="note"
                icon={<Icon.HeartIcon />}
                className={styles.heroNotice}
                title={on
                    ? t('settings.page.adsPerTransaction', { amount: money(ads.perTransaction, currency) })
                    : t('settings.ads.offTitle')}
                testId="ads-hero"
            >
                {on
                    ? t('settings.ads.summaryLine', {
                        perTransaction: money(ads.perTransaction, currency),
                        sendAt: money(ads.sendAt, currency),
                        recipient,
                    })
                    : t('settings.ads.offLine')}
            </Notice>
            <AdsGroup label={t('settings.ads.groupDonation')} rows={donationRows} settings={settings} update={update} />
            <AdsGroup label={t('settings.ads.groupTotals')} rows={totalRows} settings={settings} update={update} />
        </div>
    );
}
