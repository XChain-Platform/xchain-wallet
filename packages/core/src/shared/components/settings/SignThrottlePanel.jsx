// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SignThrottlePanel: Settings > Privacy and Sites > Connected Sites > Options
// (operator ruling 2026-11-14, layout 1). The sign-request throttle:
//   - an "In effect now" card that states the limit in a sentence and any
//     site that is waiting, with the time until it can ask again
//   - Limits: Requests per site and Window as inline rows with the themed
//     dropdown (an icon per option, and a Custom choice that opens a field in
//     place); each choice applies at once, with no Save button
//   - Sites using it now: one row per site, used of the limit and its wait
// The live per-site counts live in the background throttle, so one host read
// (getSignThrottleStatus) supplies them, and a shell with no throttle shows
// the limit and window from settings with "No sites are waiting".
// Each choice writes settings.signThrottle { burst, windowMs }, the same pair
// the old Apply Throttle form wrote.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon, Input, ListRow, Select } from '@xchain-wallet/core/ui';
import { useMessaging } from '../../useMessaging.js';
import { useSettings } from '../../hooks/useSettings.js';
import { SiteIcon } from '../SiteIcon.jsx';
import { neutralizeControlText } from '../../utils/textHardening.js';
import { formatWithThousands } from '../../utils/amountFormat.js';
import {
    SIGN_THROTTLE_BURST_MIN,
    SIGN_THROTTLE_BURST_MAX,
    SIGN_THROTTLE_WINDOW_MS_MIN,
    SIGN_THROTTLE_WINDOW_MS_MAX,
} from '../../../schemas/settings.js';
import {
    SIGN_THROTTLE_DEFAULT_BURST,
    SIGN_THROTTLE_DEFAULT_WINDOW_MS,
} from '../../../flows/signThrottle.js';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/settings.js';
import '../../../i18n/locales/en/ui.js';
import { InlineRowFrame } from './SettingsInlineRow.jsx';
import groupListStyles from '../../routes/CoSignerAccountList.module.css';
import styles from './SignThrottlePanel.module.css';

const CUSTOM = 'custom';
const BURST_PRESETS = [1, 3, 5, 10, 20, 50, 100];
const WINDOW_PRESETS_MS = [10_000, 30_000, 60_000, 300_000, 900_000, 3_600_000, 86_400_000];
/** How often the live per-site counts are read again while the page is open. */
const STATUS_REFRESH_MS = 5000;

/** A window or wait as short text: 38 s, 5 min, 1 h. */
export function formatThrottleDuration(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000 - 1e-9));
    if (seconds >= 3600 && seconds % 3600 === 0) return t('settings.connectedSites.durationHours', { n: seconds / 3600 });
    if (seconds >= 60 && seconds % 60 === 0) return t('settings.connectedSites.durationMinutes', { n: seconds / 60 });
    return t('settings.connectedSites.durationSeconds', { n: seconds });
}

/** The window as the card's sentence names it: a minute, or the duration. */
function windowWord(ms) {
    return ms === 60_000 ? t('settings.connectedSites.throttleUnitMinute') : formatThrottleDuration(ms);
}

/** A waiting site's time left, rounded up, never 0. */
function formatWait(ms) {
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    if (seconds > 120) return t('settings.connectedSites.durationMinutes', { n: Math.ceil(seconds / 60) });
    return t('settings.connectedSites.durationSeconds', { n: seconds });
}

function formatWindowSeconds(windowMs) {
    return String(windowMs / 1000);
}

/** Seconds typed as "90" or "0.5" in milliseconds, or null (at most three decimals). */
function parseWindowSeconds(value) {
    const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
    if (!match) return null;
    return Number(match[1]) * 1000 + Number((match[2] || '').padEnd(3, '0'));
}

const siteLabel = (origin) => neutralizeControlText(origin, { maxLength: 2048 });

/**
 * One limit row: the themed dropdown with an icon per preset, and a Custom
 * choice that opens a field in place for a value outside the presets.
 */
function ThrottleRow({ title, line, help, leading, field, presets, optionText, optionIcon, custom, stored, save }) {
    const storedIsPreset = presets.includes(stored);
    const [customOpen, setCustomOpen] = useState(!storedIsPreset);
    const [draft, setDraft] = useState(storedIsPreset ? '' : custom.toText(stored));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const fieldId = useId();
    useEffect(() => {
        // A value saved elsewhere (another window) closes or refills the field.
        if (!presets.includes(stored)) {
            setCustomOpen(true);
            setDraft(custom.toText(stored));
        }
        // `custom` is rebuilt each render and only formats the stored value.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stored, presets]);

    const run = async (value) => {
        setError(null);
        if (!(await save(field, value))) setError(t('settings.connectedSites.throttleSaveFailed'));
    };
    const commitDraft = async () => {
        const value = custom.parse(draft);
        if (value === null) {
            setError(custom.errorText);
            return;
        }
        if (value === stored) { setError(null); return; }
        await run(value);
    };

    const options = [
        ...presets.map((value) => ({ value: String(value), label: optionText(value), icon: optionIcon })),
        { value: CUSTOM, label: t('ui.feeSelector.custom'), icon: <Icon.PencilIcon /> },
    ];
    return (
        <InlineRowFrame
            leading={leading}
            title={title}
            help={help}
            line={line}
            kind="select"
            after={customOpen || error ? (
                <div className={styles.custom}>
                    {customOpen ? (
                        <Input
                            id={fieldId}
                            label={custom.label}
                            help={custom.help}
                            type="text"
                            inputMode={custom.inputMode}
                            enterKeyHint="done"
                            autoComplete="off"
                            value={draft}
                            error={error || undefined}
                            onChange={(e) => { setDraft(e.target.value); if (error) setError(null); }}
                            onBlur={commitDraft}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            data-testid={`throttle-custom-${field}`}
                        />
                    ) : null}
                    {!customOpen && error ? <span role="alert">{error}</span> : null}
                </div>
            ) : null}
        >
            <div className={styles.select}>
                <Select
                    value={customOpen ? CUSTOM : String(stored)}
                    options={options}
                    aria-label={title}
                    data-testid={`throttle-select-${field}`}
                    onChange={(event) => {
                        const next = event.target.value;
                        if (next === CUSTOM) {
                            setCustomOpen(true);
                            setDraft(custom.toText(stored));
                            return;
                        }
                        setCustomOpen(false);
                        setDraft('');
                        run(Number(next));
                    }}
                />
            </div>
        </InlineRowFrame>
    );
}

function rowIcon(RowIcon) {
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

function Group({ label, children }) {
    return (
        <div className={styles.group}>
            <div className={styles.groupLabel}>{label}</div>
            {children}
        </div>
    );
}

export function SignThrottlePanel() {
    const { messaging } = useMessaging();
    const { settings, update } = useSettings({ reportsOwnError: true });
    const [status, setStatus] = useState(/** @type {{ burst?: number, windowMs?: number, sites?: Array<{ origin: string, used: number, waitMs: number }> } | null} */ (null));

    // One bulk host read for every site; a shell with no throttle has none.
    const hasStatusRead = typeof messaging?.getSignThrottleStatus === 'function';
    useEffect(() => {
        if (!hasStatusRead) return undefined;
        let alive = true;
        const load = async () => {
            try {
                const next = await messaging.getSignThrottleStatus();
                if (alive && next && typeof next === 'object') setStatus(next);
            } catch {
                // Keep the last reading; the next tick tries again.
            }
        };
        load();
        const timer = setInterval(load, STATUS_REFRESH_MS);
        return () => { alive = false; clearInterval(timer); };
    }, [hasStatusRead, messaging]);

    const burst = settings?.signThrottle?.burst
        ?? (Number.isInteger(status?.burst) ? status.burst : SIGN_THROTTLE_DEFAULT_BURST);
    const windowMs = settings?.signThrottle?.windowMs
        ?? (Number.isFinite(status?.windowMs) ? status.windowMs : SIGN_THROTTLE_DEFAULT_WINDOW_MS);
    const sites = Array.isArray(status?.sites) ? status.sites : [];
    const waiting = sites.filter((s) => s.waitMs > 0);

    // Both fields are written together, as the Apply form wrote them. Writes
    // build on the pair the last write sent, so two quick choices (one per
    // row) before settings refresh never put the older value back.
    const sent = useRef(/** @type {{ burst: number, windowMs: number } | null} */ (null));
    const inFlight = useRef(0);
    const save = useCallback(async (field, value) => {
        const next = { ...(sent.current || { burst, windowMs }), [field]: value };
        sent.current = next;
        inFlight.current += 1;
        try {
            await update({ signThrottle: next });
            return true;
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`settings signThrottle.${field} update failed:`, err);
            return false;
        } finally {
            inFlight.current -= 1;
            // Idle again: the settings in hand are the truth.
            if (inFlight.current === 0) sent.current = null;
        }
    }, [update, burst, windowMs]);

    const burstCustom = {
        label: t('settings.connectedSites.throttleCustomRequests'),
        help: t('settings.connectedSites.throttleCustomRequestsHelp', {
            min: formatWithThousands(String(SIGN_THROTTLE_BURST_MIN)),
            max: formatWithThousands(String(SIGN_THROTTLE_BURST_MAX)),
        }),
        inputMode: 'numeric',
        toText: (value) => String(value),
        parse: (text) => {
            if (!/^\d+$/.test(text.trim())) return null;
            const n = Number(text.trim());
            return n >= SIGN_THROTTLE_BURST_MIN && n <= SIGN_THROTTLE_BURST_MAX ? n : null;
        },
        errorText: t('settings.privacy.enterAWholeNumberFrom', {
            min: formatWithThousands(String(SIGN_THROTTLE_BURST_MIN)),
            max: formatWithThousands(String(SIGN_THROTTLE_BURST_MAX)),
        }),
    };
    const windowCustom = {
        label: t('settings.connectedSites.throttleCustomWindow'),
        help: t('settings.connectedSites.throttleCustomWindowHelp', {
            min: formatWithThousands(String(SIGN_THROTTLE_WINDOW_MS_MIN / 1000)),
            max: formatWithThousands(String(SIGN_THROTTLE_WINDOW_MS_MAX / 1000)),
        }),
        inputMode: 'decimal',
        toText: (value) => formatWindowSeconds(value),
        parse: (text) => {
            const ms = parseWindowSeconds(text);
            return ms !== null && ms >= SIGN_THROTTLE_WINDOW_MS_MIN && ms <= SIGN_THROTTLE_WINDOW_MS_MAX ? ms : null;
        },
        errorText: t('settings.connectedSites.throttleCustomWindowError', {
            min: formatWithThousands(String(SIGN_THROTTLE_WINDOW_MS_MIN / 1000)),
            max: formatWithThousands(String(SIGN_THROTTLE_WINDOW_MS_MAX / 1000)),
        }),
    };

    const summary = burst === 1
        ? t('settings.connectedSites.throttleSummaryOne', { window: windowWord(windowMs) })
        : t('settings.connectedSites.throttleSummary', {
            burst: formatWithThousands(String(burst)),
            window: windowWord(windowMs),
        });
    // "in the last 60 s" reads better than "in the last 1 min" for short windows.
    const windowText = windowMs <= 120_000
        ? t('settings.connectedSites.durationSeconds', { n: windowMs / 1000 })
        : formatThrottleDuration(windowMs);
    const ready = Boolean(settings);

    return (
        <div className={styles.stack} data-testid="sign-throttle-panel" aria-busy={!ready}>
            <section
                className={styles.status}
                aria-label={t('settings.connectedSites.signRequestThrottle')}
                data-testid="throttle-status"
            >
                <div className={styles.kicker}>
                    <Icon.VerifyIcon aria-hidden="true" />
                    <span>{t('settings.connectedSites.throttleInEffect')}</span>
                </div>
                <p className={styles.big}>{summary}</p>
                <p className={styles.muted}>{t('settings.connectedSites.throttleSummaryLine')}</p>
                {waiting.length > 0 ? waiting.map((s) => (
                    <p className={styles.callout} key={s.origin} data-testid="throttle-waiting">
                        <Icon.PauseIcon aria-hidden="true" />
                        <span>{t('settings.connectedSites.throttleSiteWaiting', { site: siteLabel(s.origin), wait: formatWait(s.waitMs) })}</span>
                    </p>
                )) : (
                    <p className={styles.muted} data-testid="throttle-none-waiting">{t('settings.connectedSites.throttleNoneWaiting')}</p>
                )}
            </section>

            <Group label={t('settings.connectedSites.throttleLimits')}>
                {/* Safari needs an explicit list role because this class removes list styling. */}
                <ul
                    className={`${groupListStyles.list} ${styles.groupList}`}
                    role="list"
                    aria-label={t('settings.connectedSites.signRequestThrottleControls')}
                >
                    <li data-settings-row-id="throttle-burst">
                        <ThrottleRow
                            title={t('settings.connectedSites.throttleRequestsTitle')}
                            line={t('settings.connectedSites.throttleRequestsLine')}
                            help={t('settings.connectedSites.burstHelp')}
                            leading={rowIcon(Icon.SignIcon)}
                            field="burst"
                            presets={BURST_PRESETS}
                            optionText={(n) => String(n)}
                            optionIcon={<Icon.SignIcon />}
                            custom={burstCustom}
                            stored={burst}
                            save={save}
                        />
                    </li>
                    <li data-settings-row-id="throttle-window">
                        <ThrottleRow
                            title={t('settings.connectedSites.throttleWindowTitle')}
                            line={t('settings.connectedSites.throttleWindowLine')}
                            help={t('settings.connectedSites.windowSecondsHelp')}
                            leading={rowIcon(Icon.ClockIcon)}
                            field="windowMs"
                            presets={WINDOW_PRESETS_MS}
                            optionText={formatThrottleDuration}
                            optionIcon={<Icon.ClockIcon />}
                            custom={windowCustom}
                            stored={windowMs}
                            save={save}
                        />
                    </li>
                </ul>
            </Group>

            <Group label={t('settings.connectedSites.throttleSitesLabel')}>
                {sites.length === 0 ? (
                    <p className={styles.muted} data-testid="throttle-no-sites">{t('settings.connectedSites.throttleNoSites')}</p>
                ) : (
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul
                        className={`${groupListStyles.list} ${styles.groupList}`}
                        role="list"
                        aria-label={t('settings.connectedSites.throttleSitesLabel')}
                    >
                        {sites.map((s) => (
                            <li key={s.origin} data-testid="throttle-site">
                                <ListRow
                                    leading={<SiteIcon origin={s.origin} context="list" />}
                                    title={<span className={styles.origin}>{siteLabel(s.origin)}</span>}
                                    subtitle={s.waitMs > 0
                                        ? <span className={styles.red}>{t('settings.connectedSites.throttleSiteLimit', { wait: formatWait(s.waitMs) })}</span>
                                        : t('settings.connectedSites.throttleSiteUsed', {
                                            used: formatWithThousands(String(s.used)),
                                            burst: formatWithThousands(String(burst)),
                                            window: windowText,
                                        })}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </Group>
        </div>
    );
}
