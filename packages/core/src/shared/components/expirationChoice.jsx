// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ClockIcon, PencilIcon } from '../../ui/icons/index.jsx';
import { Input } from '../../ui/Input.jsx';
import { Select } from '../../ui/Select.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

/**
 * The Expiration choice on the trade forms' terms (Swap, Create Order,
 * Cross-Chain Swap, Cross-Chain Order, Dispenser): common terms plus "Expire
 * at a specific time", as the standard icon dropdown (G44), never radio
 * buttons. The Expires date and time always shows beside it and follows the
 * choice (operator 2026-11-13); editing it switches the choice to the
 * specific time.
 *
 * 'default' is 3 months, sent as no EXPIRATION at all so the indexer applies
 * its standard window, which is 90 days and inside the free period, so it is
 * 90 days here too rather than a calendar quarter that would cost a fee.
 */
export const EXPIRATION_FREE_DAYS = 90;
const DAY_SECONDS = 86400;

const PRESET_DAYS = Object.freeze({ default: 90, '6m': 180, '9m': 270, '1y': 365 });

export const EXPIRATION_OPTIONS = Object.freeze([
    { value: 'default', label: t('components.expiration.threeMonths'), icon: <ClockIcon /> },
    { value: '6m', label: t('components.expiration.sixMonths'), icon: <ClockIcon /> },
    { value: '9m', label: t('components.expiration.nineMonths'), icon: <ClockIcon /> },
    { value: '1y', label: t('components.expiration.oneYear'), icon: <ClockIcon /> },
    { value: 'custom', label: t('components.expiration.specificTime'), icon: <PencilIcon /> },
]);

/** The days a preset runs for; null for 'custom'. */
export function expirationPresetDays(mode) {
    return PRESET_DAYS[mode] ?? null;
}

/** A Unix time as a datetime-local value, in local time to the minute. */
export function toLocalDateTimeInput(unixSeconds) {
    const d = new Date(unixSeconds * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The Expires value a preset sets, counted from now. */
export function presetExpiresInput(mode, nowSec = Math.floor(Date.now() / 1000)) {
    const days = expirationPresetDays(mode);
    return days === null ? '' : toLocalDateTimeInput(nowSec + days * DAY_SECONDS);
}

/**
 * The EXPIRATION the action carries: none for 'default' (the indexer's own
 * window), else the Expires field's time, in Unix seconds as a string.
 */
export function expirationParam(mode, input) {
    if (mode === 'default' || !String(input || '').trim()) return null;
    const ms = Date.parse(String(input).trim());
    return Number.isFinite(ms) ? String(Math.floor(ms / 1000)) : null;
}

/**
 * Whether the expiry sits inside the protocol's free period, so the
 * trade costs no protocol fee. The protocol rounds the days to the nearest
 * whole day, so 90.4 days is still free.
 */
export function expirationWithinFreePeriod(mode, input, nowSec = Math.floor(Date.now() / 1000)) {
    if (mode === 'default') return true;
    const param = expirationParam(mode, input);
    if (param === null) return false;
    return Math.round((Number(param) - nowSec) / DAY_SECONDS) <= EXPIRATION_FREE_DAYS;
}

/**
 * The Expiration dropdown and the always-shown Expires field.
 *
 * @param {object} props
 * @param {string} props.name           the dropdown's name
 * @param {string} props.mode           'default' | '6m' | '9m' | '1y' | 'custom'
 * @param {string} props.input          the Expires datetime-local value
 * @param {(mode: string, input: string) => void} props.onChange
 * @param {string} props.help           the Expiration tip
 * @param {string} [props.expiresHelp]  the Expires tip
 * @param {string} [props.id]           the Expires field's id
 */
export function ExpirationFields({ name, mode, input, onChange, help, expiresHelp, id }) {
    // 'default' sends no time, so its Expires is shown from now each render.
    const shown = mode === 'default' ? presetExpiresInput('default') : input;
    return (
        <>
            <Select
                label={t('components.expiration.label')}
                help={help}
                name={name}
                value={mode}
                onChange={(event) => {
                    const next = event.target.value;
                    // A preset sets Expires; the specific time keeps what is there.
                    onChange(next, next === 'custom' ? (shown || '') : presetExpiresInput(next));
                }}
                options={EXPIRATION_OPTIONS}
            />
            <Input
                id={id}
                label={t('components.expiration.expires')}
                type="datetime-local"
                help={expiresHelp || t('components.expiration.expiresHelp')}
                value={shown}
                onChange={(event) => onChange('custom', event.target.value)}
            />
        </>
    );
}
