// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ConnectedSitesSection: §35.1 + §43.5 Connected Sites panel.
//
// Lists ConnectedSite records sorted by lastUsedAt desc. Each row:
//   - origin / appName / lastUsedAt
//   - expandable permissions summary (chains, accounts, sign-message,
//     per-action signAction map)
//   - Disconnect button that confirms revocation, then deletes the record
//   - Block button that adds the origin to the blocklist (§12 / G009)
//     and evicts the record so any in-flight session stops signing.
//
// A "Blocked origins" subsection at the bottom lists user-blocked
// origins with Unblock buttons, plus an inline form to manually
// block an origin without it being connected first.
//
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Button,
    EmptyState,
    FormErrorSummary,
    FormSection,
    Input,
} from '@xchain-wallet/core/ui';
import { useMessaging } from '../../useMessaging.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useConfirmModal } from '../../hooks/useConfirmModal.js';
import { ConfirmModal } from '../ConfirmModal.jsx';
import { useToast } from '../ToastHost.jsx';
import { ROW_HINT, STACK, SettingsInlineForm, Status } from './_settingsPrimitives.jsx';
import cardStyles from '../../../ui/Card.module.css';
import { actionDisplayLabel } from '../../utils/actionDisplayLabel.js';
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
import local from './ConnectedSitesSection.module.css';
import { blurNumberInputOnWheel } from '../../utils/formInput.js';
import { neutralizeControlText } from '../../utils/textHardening.js';
import { t } from '../../../i18n/index.js';

// A connected site names itself, so its name and origin are hostile input:
// bidi overrides would reorder the name, and a 240-character host would run
// past the card edge where the user cannot read the whole origin.
const siteName = (site) => neutralizeControlText(site.appName || site.origin, { maxLength: 120 });
const siteOrigin = (site) => neutralizeControlText(site.origin, { maxLength: 2048 });
const SITE_ORIGIN_STYLE = { display: 'block', overflowWrap: 'anywhere', unicodeBidi: 'isolate' };

// Each part of the page is one shared card, like the rows on every other Settings page.
function SettingsCard({ children }) {
    return <div className={cardStyles.card}>{children}</div>;
}

export function ConnectedSitesSection() {
    const { messaging } = useMessaging();
    const { showToast } = useToast();
    const confirmDialog = useConfirmModal();
    const [sites, setSites] = useState(/** @type {any[] | null} */ (null));
    const [blocked, setBlocked] = useState(/** @type {string[]} */ ([]));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [expanded, setExpanded] = useState(/** @type {Set<string>} */ (new Set()));
    const [manualBlock, setManualBlock] = useState('');
    const [pendingAction, setPendingAction] = useState(/** @type {string | null} */ (null));
    const loadSequence = useRef(0);
    const loadedFrom = useRef(null);

    const blocklistWired = typeof messaging?.listBlockedOrigins === 'function'
        && typeof messaging?.blockOrigin === 'function'
        && typeof messaging?.unblockOrigin === 'function';

    const reload = useCallback(async () => {
        const sequence = ++loadSequence.current;
        if (typeof messaging?.listConnectedSites !== 'function') {
            loadedFrom.current = messaging;
            setError('Connected sites are unavailable in this app.');
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const [siteList, blockedList] = await Promise.all([
                messaging.listConnectedSites(),
                blocklistWired ? messaging.listBlockedOrigins() : Promise.resolve([]),
            ]);
            if (sequence !== loadSequence.current) return;
            loadedFrom.current = messaging;
            setSites(Array.isArray(siteList) ? siteList : []);
            setBlocked(Array.isArray(blockedList) ? blockedList : []);
            setError(null);
        } catch (err) {
            if (sequence !== loadSequence.current) return;
            loadedFrom.current = messaging;
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            if (sequence === loadSequence.current) setLoading(false);
        }
    }, [blocklistWired, messaging]);

    useEffect(() => {
        reload();
        return () => { loadSequence.current += 1; };
    }, [reload]);

    const onDisconnect = async (id) => {
        if (pendingAction) return;
        // §37.2 / Cluster D FOLLOWUP 1: snapshot the full ConnectedSite
        // record before tearing it down so the Undo toast can re-create
        // it with the same permissions / lastUsedAt / appName instead
        // of forcing the dApp to re-prompt.
        const snapshot = sites ? sites.find((s) => s.id === id) : null;
        if (!snapshot) return;
        const confirmed = await confirmDialog.confirm({
            title: t('settings.connectedSites.disconnectTitle', { name: siteName(snapshot) }),
            message: t('settings.connectedSites.disconnectMessage', { origin: siteOrigin(snapshot) }),
            confirmLabel: t('settings.connectedSites.disconnectSite'),
            danger: true,
        });
        if (!confirmed) return;
        setPendingAction(`disconnect:${id}`);
        try {
            await messaging.deleteConnectedSite({ id });
            await reload();
            if (snapshot && typeof messaging.restoreConnectedSite === 'function') {
                showToast({
                    message: t('settings.connectedSites.disconnectedToast', { name: siteName(snapshot) }),
                    actionLabel: t('settings.connectedSites.undo'),
                    onAction: async () => {
                        try {
                            await messaging.restoreConnectedSite({ site: snapshot });
                            await reload();
                        } catch (err) {
                            setError(err instanceof Error ? err.message : String(err));
                        }
                    },
                });
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setPendingAction(null);
        }
    };

    const onBlock = async (origin, pendingKey = `block:${origin}`) => {
        if (pendingAction) return false;
        const confirmed = await confirmDialog.confirm({
            title: t('settings.connectedSites.blockTitle', { origin: neutralizeControlText(origin, { maxLength: 2048 }) }),
            message: t('settings.connectedSites.blockMessage'),
            confirmLabel: t('settings.connectedSites.blockSite'),
            danger: true,
        });
        if (!confirmed) return false;
        setPendingAction(pendingKey);
        try {
            await messaging.blockOrigin({ origin });
            await reload();
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            return false;
        } finally {
            setPendingAction(null);
        }
    };

    const onUnblock = async (origin) => {
        if (pendingAction) return;
        setPendingAction(`unblock:${origin}`);
        try {
            await messaging.unblockOrigin({ origin });
            await reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setPendingAction(null);
        }
    };

    const onManualBlockSubmit = async (e) => {
        e.preventDefault();
        const trimmed = manualBlock.trim();
        if (!trimmed || pendingAction) return;
        const blockedOrigin = await onBlock(trimmed, 'block:manual');
        if (blockedOrigin) {
            setManualBlock('');
        }
    };

    if (loading || loadedFrom.current !== messaging) return <Status text={t('common.loading')} />;
    if (error) return <Status text={t('settings.connectedSites.connectedSitesUnavailable', { error })} tone="error" />;

    return (
        <div role="group" aria-label={t('settings.connectedSites.connectedSitesAndDappPermissions')} style={STACK}>
            <SettingsCard>
            <FormSection
                title={t('settings.connectedSites.allowedSites')}
                description={t('settings.page.reviewDappConnectionsAndControl')}
            >
                {(!sites || sites.length === 0) ? (
                    <EmptyState
                        title={t('settings.connectedSites.noSitesConnectedYet')}
                        body={t('settings.connectedSites.whenAWebsiteAsksTo')}
                        titleAs="p"
                    />
                ) : (
                    sites.map((site) => {
                        const isOpen = expanded.has(site.id);
                        return (
                            <FormSection
                                key={site.id}
                                headingLevel="h3"
                                title={siteName(site)}
                                description={(
                                    <>
                                        {/* A site with no app name is titled by its
                                            origin, so the origin line would repeat it. */}
                                        {site.appName && site.appName !== site.origin ? (
                                            <span dir="ltr" style={SITE_ORIGIN_STYLE}>{siteOrigin(site)}</span>
                                        ) : null}
                                        <span style={ROW_HINT}>
                                            {t('settings.connectedSites.lastUsed')} {formatLastUsed(site.lastUsedAt)} {t('settings.connectedSites.connected')} {formatLastUsed(site.connectedAt)}
                                        </span>
                                    </>
                                )}
                            >
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--xc-space-1)' }}>
                                    <Button
                                        type="button"
                                        aria-expanded={isOpen}
                                        onClick={() => setExpanded((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(site.id)) next.delete(site.id); else next.add(site.id);
                                            return next;
                                        })}
                                        size="sm"
                                        variant="secondary"
                                    >
                                        {isOpen ? t('settings.developer.hide') : t('settings.connectedSites.permissions')}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="danger"
                                        onClick={() => onDisconnect(site.id)}
                                        loading={pendingAction === `disconnect:${site.id}`}
                                        disabled={pendingAction !== null}
                                    >
                                        {t('settings.connectedSites.disconnect')}
                                    </Button>
                                    {blocklistWired ? (
                                        <Button
                                            size="sm"
                                            variant="danger"
                                            onClick={() => onBlock(site.origin)}
                                            loading={pendingAction === `block:${site.origin}`}
                                            disabled={pendingAction !== null}
                                        >
                                            {t('settings.connectedSites.block')}
                                        </Button>
                                    ) : null}
                                </div>
                                {isOpen ? <PermissionsSummary permissions={site.permissions} /> : null}
                            </FormSection>
                        );
                    })
                )}
            </FormSection>
            </SettingsCard>
            {blocklistWired ? (
                <BlockedOriginsPanel
                    blocked={blocked}
                    manualBlock={manualBlock}
                    setManualBlock={setManualBlock}
                    onSubmit={onManualBlockSubmit}
                    onUnblock={onUnblock}
                    pendingAction={pendingAction}
                />
            ) : null}
            {blocklistWired
                && typeof messaging?.listBlocklistAuditLog === 'function' ? (
                    <BlocklistAuditPanel confirm={confirmDialog.confirm} />
                ) : null}
            <SignThrottlePanel />
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
        </div>
    );
}

// Cluster S FOLLOWUP 4: Blocklist audit-log panel.
// Reads the persisted ring-buffer via messaging.listBlocklistAuditLog,
// renders newest-first, and exposes a clear-history button.
function BlocklistAuditPanel({ confirm }) {
    const { messaging } = useMessaging();
    const [entries, setEntries] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [clearing, setClearing] = useState(false);
    const reloadRequestRef = useRef(0);

    const reload = useCallback(async () => {
        const request = ++reloadRequestRef.current;
        try {
            const list = await messaging.listBlocklistAuditLog();
            if (request !== reloadRequestRef.current) return;
            setEntries(Array.isArray(list) ? list : []);
            setError(null);
        } catch (err) {
            if (request !== reloadRequestRef.current) return;
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [messaging]);

    useEffect(() => {
        reload();
        return () => { reloadRequestRef.current += 1; };
    }, [reload]);

    const onClear = async () => {
        if (clearing) return;
        const confirmed = await confirm({
            title: t('settings.connectedSites.clearHistoryTitle'),
            message: t('settings.connectedSites.clearHistoryMessage'),
            confirmLabel: t('settings.connectedSites.clearHistory'),
            danger: true,
        });
        if (!confirmed) return;
        setClearing(true);
        try {
            await messaging.clearBlocklistAuditLog();
            await reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setClearing(false);
        }
    };

    if (entries === null) return null;
    return (
        <SettingsInlineForm error={error}>
        <SettingsCard>
        <FormSection
            headingLevel="h3"
            title={t('settings.connectedSites.siteBlockHistory')}
            description={t('settings.connectedSites.showsThe50MostRecent')}
        >
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                    type="button"
                    onClick={onClear}
                    disabled={clearing || entries.length === 0}
                    size="sm"
                    variant="danger"
                >
                    {clearing ? t('settings.connectedSites.clearing') : t('settings.connectedSites.clearHistory')}
                </Button>
            </div>
            {entries.length === 0 ? (
                <EmptyState
                    title={t('settings.connectedSites.noSiteBlockHistory')}
                    body={t('settings.connectedSites.sitesYouBlockOrUnblock')}
                    titleAs="p"
                />
            ) : (
                // The style guide has no compact audit-list primitive, so this remains a semantic list.
                <ul
                    style={{
                        margin: 0,
                        padding: 0,
                        listStyle: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--xc-space-1)',
                    }}
                >
                    {[...entries].reverse().map((entry, idx) => (
                        <li
                            key={`${entry.at}:${idx}`}
                            style={{
                                display: 'flex',
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 'var(--xc-space-2)',
                                fontSize: 'var(--xc-text-xs)',
                            }}
                        >
                            {/* Native list items preserve audit-log list semantics because the kit has no list primitive. */}
                            <span style={{ color: 'var(--xc-text-muted)', minWidth: '6.5rem' }}>
                                {formatLastUsed(new Date(entry.at).toISOString())}
                            </span>
                            <span style={{ color: entry.action === 'add' ? 'var(--xc-danger-fg)' : 'var(--xc-text)' }}>
                                {entry.action === 'add' ? t('settings.connectedSites.blocked') : t('settings.connectedSites.unblocked')}
                            </span>
                            <span style={{ color: 'var(--xc-text)', flex: 1, wordBreak: 'break-all', textAlign: 'right' }}>
                                {entry.entry}
                                {Array.isArray(entry.evictedSiteIds) && entry.evictedSiteIds.length > 0 ? (
                                    <span style={{ color: 'var(--xc-text-muted)', marginLeft: 4 }}>
                                        {t('settings.connectedSites.evictedCount', { count: entry.evictedSiteIds.length })}
                                    </span>
                                ) : null}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </FormSection>
        </SettingsCard>
        </SettingsInlineForm>
    );
}

// Cluster S FOLLOWUP 1: Sign-request throttle limits panel.
// Reads / edits `settings.signThrottle.{burst, windowMs}`. Empty values
// write the documented defaults because the settings patcher deep-merges
// nested objects and cannot remove an existing nested key.
function SignThrottlePanel() {
    const { settings, update } = useSettings();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [validationAttempt, setValidationAttempt] = useState(0);

    const currentBurst = settings?.signThrottle?.burst;
    const currentWindowMs = settings?.signThrottle?.windowMs;

    const [burstInput, setBurstInput] = useState(
        typeof currentBurst === 'number' ? String(currentBurst) : '',
    );
    const [windowSecondsInput, setWindowSecondsInput] = useState(
        typeof currentWindowMs === 'number' ? formatWindowSeconds(currentWindowMs) : '',
    );

    useEffect(() => {
        setBurstInput(typeof currentBurst === 'number' ? String(currentBurst) : '');
        setWindowSecondsInput(
            typeof currentWindowMs === 'number' ? formatWindowSeconds(currentWindowMs) : '',
        );
    }, [currentBurst, currentWindowMs]);

    const onApply = async (e) => {
        e.preventDefault();
        setValidationAttempt((attempt) => attempt + 1);
        if (submitting) return;
        setError(null);
        const patch = {};
        if (burstInput.trim() === '') {
            patch.burst = SIGN_THROTTLE_DEFAULT_BURST;
        } else {
            const burstN = Number(burstInput);
            if (!/^\d+$/.test(burstInput.trim())
                || !Number.isFinite(burstN)
                || burstN < SIGN_THROTTLE_BURST_MIN
                || burstN > SIGN_THROTTLE_BURST_MAX) {
                setError(`Burst must be an integer between ${SIGN_THROTTLE_BURST_MIN} and ${SIGN_THROTTLE_BURST_MAX}.`);
                return;
            }
            patch.burst = burstN;
        }
        if (windowSecondsInput.trim() === '') {
            patch.windowMs = SIGN_THROTTLE_DEFAULT_WINDOW_MS;
        } else {
            const ms = parseWindowSeconds(windowSecondsInput);
            if (ms === null
                || ms < SIGN_THROTTLE_WINDOW_MS_MIN
                || ms > SIGN_THROTTLE_WINDOW_MS_MAX) {
                const minS = SIGN_THROTTLE_WINDOW_MS_MIN / 1000;
                const maxS = SIGN_THROTTLE_WINDOW_MS_MAX / 1000;
                setError(`Window must be between ${minS} and ${maxS} seconds with at most three decimal places.`);
                return;
            }
            patch.windowMs = ms;
        }
        try {
            setSubmitting(true);
            await update({ signThrottle: patch });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    };

    const effectiveBurst = typeof currentBurst === 'number' ? currentBurst : SIGN_THROTTLE_DEFAULT_BURST;
    const effectiveWindowSec = typeof currentWindowMs === 'number'
        ? formatWindowSeconds(currentWindowMs)
        : SIGN_THROTTLE_DEFAULT_WINDOW_MS / 1000;

    const throttleErrorTarget = /^Burst /i.test(error || '')
        ? { id: 'sign-throttle-burst', label: 'Burst' }
        : /^Window /i.test(error || '')
            ? { id: 'sign-throttle-window', label: 'Window' }
            : undefined;
    const throttleErrors = error ? [{ ...throttleErrorTarget, message: error }] : [];
    return (
        <SettingsInlineForm>
        <FormErrorSummary errors={throttleErrors} focusKey={validationAttempt} />
        <SettingsCard>
        <FormSection
            headingLevel="h3"
            title={t('settings.connectedSites.signRequestThrottle')}
            description={t('settings.connectedSites.limitsHowManySigningRequests', { SIGN_THROTTLE_DEFAULT_BURST, value: SIGN_THROTTLE_DEFAULT_WINDOW_MS / 1000 })}
        >
            <p style={ROW_HINT}>
                {t('settings.connectedSites.currentlyInEffect')} <strong>{effectiveBurst}</strong> {t('settings.connectedSites.per')}{' '}
                <strong>{effectiveWindowSec} s</strong>.
            </p>
            <form
                aria-label={t('settings.connectedSites.signRequestThrottleControls')}
                onSubmit={onApply}
                className={local.controlRow}
            >
                <Input
                    id="sign-throttle-burst"
                    size="md"
                    label={t('settings.connectedSites.burst')}
                    type="number"
                    inputMode="numeric"
                    enterKeyHint="next"
                    autoComplete="off"
                    min={SIGN_THROTTLE_BURST_MIN}
                    max={SIGN_THROTTLE_BURST_MAX}
                    step={1}
                    value={burstInput}
                    onChange={(e) => {
                        setBurstInput(e.target.value);
                        if (error) setError(null);
                    }}
                    onWheel={blurNumberInputOnWheel}
                    placeholder={String(SIGN_THROTTLE_DEFAULT_BURST)}
                    aria-label={t('settings.connectedSites.signThrottleBurstMaxRequests')}
                    style={{ width: '5rem' }}
                />
                <Input
                    id="sign-throttle-window"
                    size="md"
                    label={t('settings.connectedSites.windowSeconds')}
                    type="number"
                    inputMode="decimal"
                    enterKeyHint="go"
                    autoComplete="off"
                    min={SIGN_THROTTLE_WINDOW_MS_MIN / 1000}
                    max={SIGN_THROTTLE_WINDOW_MS_MAX / 1000}
                    step={0.001}
                    value={windowSecondsInput}
                    onChange={(e) => {
                        setWindowSecondsInput(e.target.value);
                        if (error) setError(null);
                    }}
                    onWheel={blurNumberInputOnWheel}
                    placeholder={String(SIGN_THROTTLE_DEFAULT_WINDOW_MS / 1000)}
                    aria-label={t('settings.connectedSites.signThrottleWindowInSeconds')}
                    style={{ width: '5rem' }}
                />
                <Button
                    type="submit"
                    disabled={submitting}
                    size="md"
                    variant="primary"
                >
                    {submitting ? t('settings.connectedSites.applying') : t('settings.connectedSites.apply')}
                </Button>
            </form>
        </FormSection>
        </SettingsCard>
        </SettingsInlineForm>
    );
}

function BlockedOriginsPanel({ blocked, manualBlock, setManualBlock, onSubmit, onUnblock, pendingAction }) {
    return (
        <SettingsCard>
        <FormSection
            headingLevel="h3"
            title={t('settings.connectedSites.blockedSites')}
            description={(
                <>
                    {t('settings.connectedSites.blockPatternLead')}{' '}
                    <code style={{ fontFamily: 'var(--xc-font-mono, monospace)' }}>{t('settings.connectedSites.exampleCom')}</code>{' '}
                    {t('settings.connectedSites.blockPatternJoin')}{' '}
                    <code style={{ fontFamily: 'var(--xc-font-mono, monospace)' }}>{t('settings.connectedSites.exampleCom2')}</code>.
                </>
            )}
        >
                {blocked.length === 0 ? (
                    <EmptyState
                        title={t('settings.connectedSites.noBlockedSites')}
                        body={t('settings.connectedSites.sitesYouBlockAppearHere')}
                        titleAs="p"
                    />
                ) : (
                    // The style guide has no compact origin-list primitive, so this remains a semantic list.
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-1)' }}>
                        {blocked.map((origin) => (
                            <li
                                key={origin}
                                style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--xc-space-2)' }}
                            >
                                {/* Native list items preserve blocked-origin list semantics because the kit has no list primitive. */}
                                <span dir="ltr" style={{ color: 'var(--xc-text)', overflowWrap: 'anywhere', unicodeBidi: 'isolate' }}>{neutralizeControlText(origin, { maxLength: 2048 })}</span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => onUnblock(origin)}
                                    loading={pendingAction === `unblock:${origin}`}
                                    disabled={pendingAction !== null}
                                >
                                    {t('settings.connectedSites.unblock')}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
                <form onSubmit={onSubmit} className={`${local.controlRow} ${local.blockRow}`}>
                    <Input
                        type="text"
                        size="md"
                        enterKeyHint="go"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={manualBlock}
                        onChange={(e) => setManualBlock(e.target.value)}
                        placeholder={t('settings.connectedSites.httpsExampleComOrExample')}
                        aria-label={t('settings.connectedSites.originOrWildcardToBlock')}
                    />
                    <Button
                        type="submit"
                        size="md"
                        variant="danger"
                        loading={pendingAction === 'block:manual'}
                        disabled={!manualBlock.trim() || pendingAction !== null}
                    >
                        {t('settings.connectedSites.block')}
                    </Button>
                </form>
        </FormSection>
        </SettingsCard>
    );
}

function PermissionsSummary({ permissions }) {
    if (!permissions) {
        return <div style={ROW_HINT}>{t('settings.connectedSites.noPermissionRecord')}</div>;
    }
    const chains = permissions.chains || [];
    const accounts = permissions.accounts || [];
    const actions = permissions.canSignAction || {};
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-1)', fontSize: 'var(--xc-text-xs)' }}>
            <PermRow label={t('extension.connect.chains')} text={chains.length === 0 ? t('send.advanced.none') : chains.join(', ')} />
            <PermRow label={t('accountPicker.title')} text={accounts.length === 0 ? t('send.advanced.none') : accounts.join(', ')} />
            <PermRow
                label={t('settings.connectedSites.signMessages')}
                text={permissions.canSignMessage ? t('settings.connectedSites.alwaysAllow') : t('settings.connectedSites.askEveryTime')}
            />
            {Object.keys(actions).length === 0 ? (
                <PermRow label={t('settings.connectedSites.signActions')} text={t('settings.connectedSites.askEveryTime')} />
            ) : (
                <div>
                    <div style={{ color: 'var(--xc-text-muted)' }}>{t('settings.connectedSites.signActions')}</div>
                    {/* The style guide has no compact permission-list primitive, so this remains a semantic list. */}
                    <ul style={{ margin: 0, paddingLeft: 'var(--xc-space-3)', listStyle: 'disc' }}>
                        {Object.entries(actions).map(([action, perm]) => (
                            <li key={action} style={{ color: 'var(--xc-text)' }}>
                                {/* Native list items preserve permission-list semantics because the kit has no list primitive. */}
                                {actionDisplayLabel(action)}
                                {': '}
                                <span style={{ color: permColor(perm) }}>{permissionLabel(perm)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function PermRow({ label, text }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--xc-text-muted)' }}>{label}</span>
            <span style={{ color: 'var(--xc-text)', wordBreak: 'break-all' }}>{text}</span>
        </div>
    );
}

function permColor(perm) {
    if (perm === 'always') return 'var(--xc-success, #2a8)';
    if (perm === 'never') return 'var(--xc-danger-fg)';
    return 'var(--xc-text-muted)';
}

function permissionLabel(perm) {
    if (perm === 'always') return t('settings.connectedSites.alwaysAllow');
    if (perm === 'never') return t('settings.connectedSites.permNever');
    return t('settings.connectedSites.askEveryTime');
}

function formatWindowSeconds(windowMs) {
    return String(windowMs / 1000);
}

function parseWindowSeconds(value) {
    const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
    if (!match) return null;
    const wholeMs = Number(match[1]) * 1000;
    const fractionalMs = Number((match[2] || '').padEnd(3, '0'));
    return wholeMs + fractionalMs;
}

function formatLastUsed(iso) {
    if (!iso) return 'never';
    try {
        const d = new Date(iso);
        const now = Date.now();
        const diff = (now - d.getTime()) / 1000;
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 86400 * 14) return `${Math.floor(diff / 86400)}d ago`;
        return d.toISOString().slice(0, 10);
    } catch {
        return iso;
    }
}
