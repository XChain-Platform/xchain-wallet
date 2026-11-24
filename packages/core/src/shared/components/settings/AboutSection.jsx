// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AboutSection (§35.1 "About" + §51.3 release info), Titled Sections layout
// (operator pick 4, 2026-11-15): the logo and intro, then Version and build,
// License, Verification and Support under small section titles. Surfaces wallet
// version, update channel, license, reproducible-build link, release-signatures
// link, and the SECURITY.md disclosure link. Every document opens externally.

import { userFacingMessage } from '../../utils/userFacingMessage.js';
import { useEffect, useRef, useState } from 'react';
import { Icon, ListPage, ListRow, SectionHeader, StatusMessage } from '@xchain-wallet/core/ui';
import { ActionList, ActionListItem } from '../ActionList.jsx';
import {
    WALLET_RELEASE_FEED_URL,
    WEB_WALLET_URL,
    logoUrl,
} from '../../../branding/branding.js';
import { useMessaging } from '../../useMessaging.js';
import { copyText } from '../../clipboard.js';
import { nativePlatformName } from '../../nativeShell.js';
import {
    LICENSE_FILE,
    NOTICE_FILE,
    REPO_FILE_BASE,
    RELEASE_SIGNATURES_DOC,
    REPRODUCIBLE_BUILD_DOC,
    VERIFY_RELEASE_DOC,
    SECURITY_FILE,
    UPDATE_CHANNEL,
    WALLET_VERSION,
} from '../../../buildInfo.js';
import {
    hasDirectUpdateLane,
    isUpdateNoticeEnabled,
    setUpdateNoticeEnabled,
} from '../../../flows/directUpdate.js';
import { getReleaseFeedSource } from '../../../flows/releaseFeedSource.js';
import { ToggleRow, formatByteSize } from './_settingsPrimitives.jsx';
import styles from './AboutSection.module.css';
import { useHapticFeedback } from '../../hooks/useHaptic.js';
import {
    redactDiagnosticText,
    sanitizeDiagnosticValue,
} from '../../../flows/diagnosticDump.js';
import { t } from '../../../i18n/index.js';
import { formatRelativeTime } from '../../utils/dateTime.js';
import {
    UPDATE_CHANNELS,
    UPDATE_FEED_MAX_BYTES,
    cleanVersion,
    isNewerVersion,
    parseReleaseFeed,
} from '../../releaseFeed.js';
import '../../../i18n/locales/en/history.js';
import '../../../i18n/locales/en/settings.js';

export { parseReleaseFeed } from '../../releaseFeed.js';

const PROBLEM_REPORT_URL = 'https://github.com/XChain-Platform/xchain-wallet/issues/new';
const STORE_NAMES = Object.freeze({
    chrome: 'Chrome Web Store',
    firefox: 'Firefox Add-ons',
    edge: 'Microsoft Edge Add-ons',
    ios: 'App Store',
    'macos-appstore': 'Mac App Store',
    'android-play': 'Google Play',
    'windows-store': 'Microsoft Store',
    snap: 'Snap Store',
});
const LIST_SURFACE = { border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', background: 'var(--xc-surface)' };

/**
 * @param {object} [props]
 * @param {number | null} [props.balancesFetchedAt]  Unix ms of the last successful balance fetch;
 *   Home's balance box no longer shows it (U72), so About does.
 * @param {() => Promise<{ status: 'latest' | 'available' | 'pending', version?: string, storeName?: string, getUpdate?: () => void | Promise<void> }>} [props.checkForUpdates]
 *   Test seam and shell override. The normal path uses the wallet's existing
 *   desktop updater, published-version feed, or browser-store update lane.
 */
export function AboutSection({
    balancesFetchedAt = null,
    checkForUpdates,
} = {}) {
    const { shell, messaging } = useMessaging();
    const haptic = useHapticFeedback();
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState(/** @type {string | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // The prepared diagnostics, read once so Copy has them at hand.
    const [preview, setPreview] = useState(/** @type {string | null} */ (null));
    const [diagnosticMeta, setDiagnosticMeta] = useState(null);
    const copyResetRef = useRef(null);
    const updateBusyRef = useRef(false);
    const [updateBusy, setUpdateBusy] = useState(false);
    const [updateResult, setUpdateResult] = useState(null);
    // Read once at mount: the provider is installed at shell boot, before any
    // settings route can render, so this cannot go stale within a session.
    const [updateLane] = useState(() => hasDirectUpdateLane());
    const [updateCheck, setUpdateCheck] = useState(() => isUpdateNoticeEnabled());
    // A failed copy is retryable by re-running the same fetch, so the error
    // surface offers a one-click "Try again".
    const retryRef = useRef(/** @type {null | (() => void)} */ (null));

    useEffect(() => () => clearTimeout(copyResetRef.current), []);

    async function fetchDump() {
        if (typeof messaging?.getDiagnosticDump !== 'function') {
            throw new Error('Diagnostic dump is not available in this shell.');
        }
        const dump = await messaging.getDiagnosticDump();
        return JSON.stringify(prepareDiagnosticDump(dump, shell), null, 2);
    }

    useEffect(() => {
        let active = true;
        if (typeof messaging?.getDiagnosticDump !== 'function') return undefined;
        messaging.getDiagnosticDump().then((dump) => {
            if (!active) return;
            const prepared = prepareDiagnosticDump(dump, shell);
            const platform = prepared.wallet.platform;
            const buildHash = prepared.build?.gitCommit || prepared.build?.buildId;
            setDiagnosticMeta({
                platform,
                buildHash: typeof buildHash === 'string' ? buildHash : null,
            });
            setPreview(JSON.stringify(prepared, null, 2));
        }).catch(() => {});
        return () => { active = false; };
    }, [messaging, shell]);

    async function handleCopyDiagnostics() {
        if (busy) return;
        clearTimeout(copyResetRef.current);
        setBusy(true);
        setStatus(null);
        setError(null);
        retryRef.current = null;
        try {
            const text = preview ?? (await fetchDump());
            if (preview === null) setPreview(text);
            const { ok } = await copyText(text);
            if (!ok) {
                throw new Error('Copy is not available here. Use Report a Problem to describe what happened.');
            }
            setStatus(t('settings.about.copiedBytes', { size: formatByteSize(text.length) }));
            copyResetRef.current = setTimeout(() => setStatus(null), 1500);
            haptic.tap();
        } catch (err) {
            retryRef.current = handleCopyDiagnostics;
            setError(userFacingMessage(err, 'Could not copy diagnostics.'));
            haptic.error();
        } finally {
            setBusy(false);
        }
    }

    function handleReportProblem() {
        setError(null);
        retryRef.current = null;
        try {
            globalThis.open?.(PROBLEM_REPORT_URL, '_blank', 'noopener,noreferrer');
        } catch (err) {
            retryRef.current = handleReportProblem;
            setError(userFacingMessage(err, 'Could not open the problem report.'));
            haptic.error();
        }
    }

    async function handleUpdateCheck() {
        if (updateBusyRef.current) return;
        updateBusyRef.current = true;
        setUpdateBusy(true);
        setUpdateResult(null);
        try {
            const result = await (checkForUpdates || (() => checkShellForUpdates(shell)))();
            if (
                !result
                || !['latest', 'available', 'pending'].includes(result.status)
                || (result.status === 'available' && typeof result.getUpdate !== 'function')
                || (result.status === 'pending' && (
                    typeof result.getUpdate !== 'function' || typeof result.storeName !== 'string'
                ))
            ) {
                throw new Error('invalid update result');
            }
            setUpdateResult(result);
            haptic.tap();
        } catch (_err) {
            setUpdateResult({ status: 'error' });
            haptic.error();
        } finally {
            updateBusyRef.current = false;
            setUpdateBusy(false);
        }
    }

    return (
        <ListPage>
            <div className={styles.brandTop}>
                <img
                    src={logoUrl()}
                    alt={t('settings.about.logoAlt')}
                    width={170}
                    className={styles.logo}
                    data-testid="about-logo"
                />
                <p className={styles.intro} data-testid="about-intro">
                    {t('settings.about.aSelfCustodialWalletFor')}
                </p>
            </div>
            <Section title={t('settings.about.sectionVersionBuild')}>
                <Card label={t('settings.about.sectionVersionBuild')}>
                    <Fact label={t('settings.about.version')}>{WALLET_VERSION}</Fact>
                    <Fact label={t('settings.about.buildIdentifier')}>
                        {diagnosticMeta?.buildHash
                            ? <code className={styles.code}>{diagnosticMeta.buildHash}</code>
                            : <span className={styles.mutedValue}>{t('settings.about.notAvailable')}</span>}
                    </Fact>
                    <Fact label={t('settings.about.platform')}>
                        {diagnosticMeta?.platform || platformLabel(shell)}
                    </Fact>
                    <Fact label={t('settings.about.updateChannel')}>{UPDATE_CHANNEL}</Fact>
                    <Fact label={t('settings.about.balancesUpdated')}>
                        {balancesFetchedAt
                            ? formatRelativeTime(balancesFetchedAt)
                            : <span className={styles.mutedValue}>{t('settings.about.balancesNotUpdated')}</span>}
                    </Fact>
                    {/* §6 / D4: only a directly-installed build has to look
                        after its own updates, and only there is there a switch to
                        show. Every other shell is updated by a store, the browser or
                        electron-updater, and `hasDirectUpdateLane()` is false, so
                        this row does not exist rather than existing greyed out. */}
                    {updateLane ? (
                        <li className={styles.toggleItem}>
                            <ToggleRow
                                embedded
                                label={t('settings.about.checkForNewVersions')}
                                help={
                                    'Checks our download site once a day and alerts you to new versions.'
                                    + ' Downloading and installing stay up to you, and the check sends no wallet data.'
                                }
                                checked={updateCheck}
                                onChange={(next) => {
                                    setUpdateNoticeEnabled(next);
                                    setUpdateCheck(isUpdateNoticeEnabled());
                                }}
                            />
                        </li>
                    ) : null}
                    <ActionListItem
                        icon={updateResult?.status === 'error'
                            ? <Icon.AlertCircleIcon />
                            : (
                                <span className={updateBusy ? styles.updateIconSpinning : undefined}>
                                    <Icon.RefreshIcon />
                                </span>
                            )}
                        iconLabel={updateResult?.status === 'error' ? t('settings.about.updateCheckFailed') : undefined}
                        title={t('settings.page.checkForUpdates')}
                        description={t('settings.about.checkForUpdatesDescription')}
                        onClick={handleUpdateCheck}
                        aria-busy={updateBusy || undefined}
                    />
                </Card>
                <UpdateCheckNotice result={updateResult} />
            </Section>
            <Section title={t('settings.about.license')}>
                {/* Every tappable item is one action-list row (icon, title, description,
                    chevron), the same row Support uses (operator ruling 2026-11-15). */}
                <ActionList label={t('settings.about.license')} style={LIST_SURFACE}>
                    <ActionListItem
                        icon={<Icon.BookIcon />}
                        title={t('settings.about.license')}
                        description={t('settings.about.licenseRowHint')}
                        {...docLinkProps(LICENSE_FILE)}
                    />
                    <ActionListItem
                        icon={<Icon.DocumentIcon />}
                        title={t('settings.about.notice')}
                        description={withoutFileName(t('settings.about.noticeDesc', { file: NOTICE_FILE }))}
                        {...docLinkProps(NOTICE_FILE)}
                    />
                </ActionList>
            </Section>
            <Section title={t('settings.about.sectionVerification')}>
                <ActionList label={t('settings.about.sectionVerification')} style={LIST_SURFACE}>
                    <ActionListItem
                        icon={<Icon.VerifyIcon />}
                        title={t('settings.about.reproducibleBuild')}
                        description={t('settings.about.reproducibleBuildDesc')}
                        {...docLinkProps(REPRODUCIBLE_BUILD_DOC)}
                    />
                    {/* Cluster T FOLLOWUP 2: end-user verification recipe (key import ->
                        manifest download -> GPG verify -> artifact hash check). */}
                    <ActionListItem
                        icon={<Icon.CircleCheckIcon />}
                        title={t('settings.about.verifyARelease')}
                        description={t('settings.about.verifyARecipeDesc')}
                        {...docLinkProps(VERIFY_RELEASE_DOC)}
                    />
                    <ActionListItem
                        icon={<Icon.KeyIcon />}
                        title={t('settings.about.releaseSignatures')}
                        description={t('settings.about.gpgFingerprint')}
                        {...docLinkProps(RELEASE_SIGNATURES_DOC)}
                    />
                    <ActionListItem
                        icon={<Icon.LockIcon />}
                        title={t('settings.about.disclosurePolicy')}
                        description={withoutFileName(t('settings.about.disclosurePolicyDesc', { file: SECURITY_FILE }))}
                        {...docLinkProps(SECURITY_FILE)}
                    />
                </ActionList>
            </Section>
            <Section title={t('settings.about.sectionSupport')}>
                {/* The page's two actions, one action list (G101). Copy only: an
                    expanding preview is not shown on an info page. */}
                <ActionList label={t('settings.about.sectionSupport')} style={LIST_SURFACE}>
                    <ActionListItem
                        icon={status ? <Icon.CheckIcon /> : <Icon.CopyIcon />}
                        title={status ? t('history.copy.copied') : t('settings.about.copyDiagnosticsTitle')}
                        description={t('settings.about.copyDiagnosticsDesc')}
                        onClick={handleCopyDiagnostics}
                        chevron={false}
                    />
                    <ActionListItem
                        icon={<Icon.MessageIcon />}
                        title={t('settings.about.reportAProblemTitle')}
                        description={t('settings.about.reportAProblemDesc')}
                        onClick={handleReportProblem}
                    />
                </ActionList>
            </Section>
            {status ? <StatusMessage variant="success">{status}</StatusMessage> : null}
            {error ? (
                <StatusMessage
                    variant="error"
                    recovery={retryRef.current ? { label: t('common.tryAgain'), onAction: retryRef.current } : undefined}
                >
                    {error}
                </StatusMessage>
            ) : null}
        </ListPage>
    );
}

function UpdateCheckNotice({ result }) {
    if (!result) return null;
    if (result.status === 'latest') {
        return (
            <StatusMessage variant="success" title={t('settings.about.upToDate')}>
                {t('settings.about.latestVersion', { version: cleanVersion(result.version || WALLET_VERSION) })}
            </StatusMessage>
        );
    }
    if (result.status === 'available') {
        return (
            <StatusMessage
                variant="info"
                title={t('settings.about.updateAvailable')}
                action={{ label: t('settings.about.updateAction'), onAction: result.getUpdate }}
            >
                {t('settings.about.updateAvailableVersion', { version: cleanVersion(result.version) })}
            </StatusMessage>
        );
    }
    if (result.status === 'pending') {
        return (
            <StatusMessage
                variant="info"
                title={t('settings.about.waitingForStoreReview')}
                action={{ label: t('settings.about.openWebWallet'), onAction: result.getUpdate }}
            >
                {t('settings.about.pendingStoreReview', {
                    version: cleanVersion(result.version),
                    storeName: result.storeName,
                })}
            </StatusMessage>
        );
    }
    return null;
}

export async function checkShellForUpdates(shell, env = globalThis) {
    const [feed, channel] = await Promise.all([
        fetchReleaseFeed(env),
        detectRunningChannel(shell, env),
    ]);
    const current = cleanVersion(WALLET_VERSION);

    if (channel === 'web') {
        if (!isNewerVersion(feed.latest, current)) return { status: 'latest', version: current };
        return {
            status: 'available',
            version: feed.latest,
            getUpdate: () => env.location?.reload?.(),
        };
    }

    const release = feed.channels[channel];
    if (!release) {
        if (!isNewerVersion(feed.latest, current)) return { status: 'latest', version: current };
        return {
            status: 'available',
            version: feed.latest,
            getUpdate: () => openExternal(WEB_WALLET_URL, env),
        };
    }

    if (isNewerVersion(release.version, current)) {
        return {
            status: 'available',
            version: release.version,
            getUpdate: updateActionFor(channel, release.url, env),
        };
    }

    if (isNewerVersion(feed.latest, current) && STORE_NAMES[channel]) {
        return {
            status: 'pending',
            version: feed.latest,
            storeName: STORE_NAMES[channel],
            getUpdate: () => openExternal(WEB_WALLET_URL, env),
        };
    }
    return { status: 'latest', version: current };
}

export async function detectRunningChannel(shell, env = globalThis) {
    const nativePlatform = nativePlatformName(env);
    if (nativePlatform === 'ios') return 'ios';
    if (nativePlatform === 'android') {
        const plugin = env.Capacitor?.Plugins?.XChainVault;
        if (typeof plugin?.getInstallOrigin !== 'function') return 'unknown';
        try {
            const result = await plugin.getInstallOrigin({});
            if (result?.channel === 'store') return 'android-play';
            if (result?.channel === 'direct') return 'android-direct';
        } catch (_error) {
            return 'unknown';
        }
        return 'unknown';
    }
    if (shell === 'desktop') {
        const channel = await env.xchainWalletUpdater?.getChannel?.();
        return UPDATE_CHANNELS.includes(channel) ? channel : 'unknown';
    }
    if (shell === 'popup' || shell === 'extension') {
        const agent = String(env.navigator?.userAgent || '');
        if (/Firefox\//i.test(agent)) return 'firefox';
        if (/Edg\//i.test(agent)) return 'edge';
        if (/(?:Chrome|Chromium)\//i.test(agent)) return 'chrome';
        return 'unknown';
    }
    return 'web';
}

async function readReleaseFeedText(env) {
    const hostedSource = getReleaseFeedSource();
    if (hostedSource) return hostedSource();
    if (typeof env.fetch !== 'function') throw new Error('update feed unavailable');
    const response = await env.fetch(WALLET_RELEASE_FEED_URL, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
    });
    if (!response?.ok) throw new Error('update feed unavailable');
    return response.text();
}

async function fetchReleaseFeed(env) {
    const text = await readReleaseFeedText(env);
    if (typeof text !== 'string' || text.length > UPDATE_FEED_MAX_BYTES) {
        throw new Error('invalid update feed');
    }
    return parseReleaseFeed(JSON.parse(text));
}

function updateActionFor(channel, url, env) {
    if (channel === 'desktop-direct') {
        return async () => {
            if (typeof env.xchainWalletUpdater?.install !== 'function') {
                throw new Error('desktop updater unavailable');
            }
            // Main's download step runs its own update check first, so one call
            // is the whole update; a refusal comes back as ok false, not a throw.
            const outcome = await env.xchainWalletUpdater.install('download');
            if (outcome?.ok === false) throw new Error('desktop update failed');
        };
    }
    return () => openExternal(url, env);
}

function openExternal(url, env) {
    return env.open?.(url, '_blank', 'noopener,noreferrer');
}

/** One titled group of facts: a small section title over its card or list (G08). */
function Section({ title, children }) {
    return (
        <section className={styles.section}>
            <SectionHeader title={title} as="h3" />
            {children}
        </section>
    );
}

function Card({ label, children }) {
    return <ul className={styles.card} style={LIST_SURFACE} aria-label={label}>{children}</ul>;
}

/** One label-left, value-right fact, the Details card's row (G14). */
function Fact({ label, children }) {
    return (
        <li>
            <ListRow title={label} trailing={<span className={styles.value}>{children}</span>} />
        </li>
    );
}

/** Props that make an action row an external link to a repo doc or an absolute URL. */
function docLinkProps(path) {
    const isUrl = typeof path === 'string' && /^https?:\/\//.test(path);
    return {
        href: isUrl ? path : `${REPO_FILE_BASE}${path}`,
        target: '_blank',
        rel: 'noreferrer noopener',
    };
}

/** Removes a parenthesized file name from a translated document subtitle. */
function withoutFileName(description) {
    return description.replace(/\s*\([^)]*\.[^)]+\)\s*$/, '');
}

/** Shell name for display; a Capacitor build reports its OS, not the "web" shell it wraps. */
function platformLabel(shell) {
    return nativePlatformName() || (shell === 'popup' ? 'extension' : shell);
}

function prepareDiagnosticDump(dump, shell) {
    const sanitized = sanitizeDiagnosticValue(dump);
    const report = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
        ? sanitized
        : {};
    const platform = platformLabel(shell);
    const wallet = report.wallet && typeof report.wallet === 'object' ? report.wallet : {};
    const build = report.build && typeof report.build === 'object' ? report.build : {};
    const buildId = build.buildId || runtimeBuildHash();
    return {
        ...report,
        wallet: {
            ...wallet,
            version: wallet.version || WALLET_VERSION,
            // The web host reports "web" for a Capacitor build too, so the
            // native OS name takes precedence over the host's own label.
            platform: nativePlatformName() || wallet.platform || platform,
        },
        build: Object.keys(build).length > 0 || buildId
            ? { ...build, ...(buildId ? { buildId } : {}) }
            : null,
    };
}

function runtimeBuildHash() {
    if (typeof document === 'undefined') return null;
    for (const script of document.querySelectorAll('script[src]')) {
        const match = /-([A-Za-z0-9_-]{8,})\.js(?:$|[?#])/.exec(script.src);
        if (match) return match[1];
    }
    return null;
}
