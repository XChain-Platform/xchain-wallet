// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AboutSection (§35.1 "About" + §51.3 release info). Read-only.
// Surfaces wallet version, update channel, license, reproducible-build
// link, release-signatures link, and the SECURITY.md disclosure link.
// Items whose underlying artifact isn't yet published render with a
// muted "not yet published" hint instead of an inert link.

import { useEffect, useRef, useState } from 'react';
import { Button, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging } from '../../useMessaging.js';
import { copyText } from '../../clipboard.js';
import {
    LICENSE_FILE,
    LICENSE_NAME,
    NOTICE_FILE,
    RELEASE_SIGNATURES_DOC,
    RELEASE_SIGNATURES_PUBLISHED,
    REPRODUCIBLE_BUILD_DOC,
    VERIFY_RELEASE_DOC,
    SECURITY_FILE,
    SECURITY_PUBLISHED,
    UPDATE_CHANNEL,
    WALLET_VERSION,
} from '../../../buildInfo.js';
import { LICENSE_TEXT, LICENSE_SUMMARY } from '../../../license.js';
import {
    hasDirectUpdateLane,
    isUpdateNoticeEnabled,
    setUpdateNoticeEnabled,
} from '../../../flows/directUpdate.js';
import { ToggleRow } from './_settingsPrimitives.jsx';
import { useHapticFeedback } from '../../hooks/useHaptic.js';
import {
    redactDiagnosticText,
    sanitizeDiagnosticValue,
} from '../../../flows/diagnosticDump.js';

const ROW = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    fontSize: 'var(--xc-text-sm)',
};
const ROW_LABEL = { color: 'var(--xc-text-muted)' };
const ROW_VALUE = { color: 'var(--xc-text)', fontWeight: 500 };
const ROW_VALUE_MUTED = { color: 'var(--xc-text-muted)', fontStyle: 'italic' };
const STACK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-1)',
};
const PARAGRAPHS = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-3)',
};
const PARAGRAPH = { margin: 0 };
const PROBLEM_REPORT_URL = 'https://github.com/XChain-Platform/xchain-wallet/issues/new';

function buildProblemReportUrl(diagnostics) {
    const url = new URL(PROBLEM_REPORT_URL);
    url.searchParams.set('body', `### Redacted diagnostics\n\n\`\`\`json\n${diagnostics}\n\`\`\``);
    return url.toString();
}

export function AboutSection() {
    const { shell, messaging } = useMessaging();
    const haptic = useHapticFeedback();
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState(/** @type {string | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [preview, setPreview] = useState(/** @type {string | null} */ (null));
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewBusy, setPreviewBusy] = useState(false);
    const [reportBusy, setReportBusy] = useState(false);
    const [licenseOpen, setLicenseOpen] = useState(false);
    const [diagnosticMeta, setDiagnosticMeta] = useState(null);
    const copyResetRef = useRef(null);
    // Read once at mount: the provider is installed at shell boot, before any
    // settings route can render, so this cannot go stale within a session.
    const [updateLane] = useState(() => hasDirectUpdateLane());
    const [updateCheck, setUpdateCheck] = useState(() => isUpdateNoticeEnabled());
    // Both diagnostic paths (copy + preview) are retryable by
    // re-running the same fetch, so the error surface offers a one-click
    // "Try again" against whichever action last failed.
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
                throw new Error('Copy is not available here. Select the diagnostics preview and copy it manually.');
            }
            setStatus(`Copied (${text.length.toLocaleString()} bytes). Paste into your bug report.`);
            copyResetRef.current = setTimeout(() => setStatus(null), 1500);
            haptic.tap();
        } catch (err) {
            retryRef.current = handleCopyDiagnostics;
            setError(err?.message || 'Could not copy diagnostics.');
            haptic.error();
        } finally {
            setBusy(false);
        }
    }

    async function handleTogglePreview() {
        if (previewOpen) {
            setPreviewOpen(false);
            return;
        }
        setError(null);
        retryRef.current = null;
        if (preview !== null) {
            setPreviewOpen(true);
            return;
        }
        setPreviewBusy(true);
        try {
            const text = await fetchDump();
            setPreview(text);
            setPreviewOpen(true);
        } catch (err) {
            retryRef.current = handleTogglePreview;
            setError(err?.message || 'Could not load diagnostics preview.');
        } finally {
            setPreviewBusy(false);
        }
    }

    async function handleReportProblem() {
        if (reportBusy) return;
        setReportBusy(true);
        setError(null);
        retryRef.current = null;
        const reportWindow = globalThis.open?.('about:blank', '_blank') ?? null;
        if (reportWindow) reportWindow.opener = null;
        try {
            const text = preview ?? (await fetchDump());
            if (preview === null) setPreview(text);
            const reportUrl = buildProblemReportUrl(text);
            if (reportWindow) reportWindow.location.replace(reportUrl);
            else globalThis.location.assign(reportUrl);
        } catch (err) {
            reportWindow?.close();
            retryRef.current = handleReportProblem;
            setError(err?.message || 'Could not open the problem report.');
            haptic.error();
        } finally {
            setReportBusy(false);
        }
    }

    return (
        <div style={STACK}>
            <p style={{ ...PARAGRAPH, color: 'var(--xc-text-muted)', lineHeight: 1.5 }}>
                A self-custodial wallet for the XChain Platform. Current chain support:
                {' '}Bitcoin, Litecoin, and Dogecoin.
            </p>
            <Row label="Version">
                <span style={ROW_VALUE}>{WALLET_VERSION}</span>
            </Row>
            <Row label="Build identifier">
                <span style={diagnosticMeta?.buildHash ? ROW_VALUE : ROW_VALUE_MUTED}>
                    {diagnosticMeta?.buildHash || 'not available'}
                </span>
            </Row>
            <Row label="Platform">
                <span style={ROW_VALUE}>
                    {diagnosticMeta?.platform || (shell === 'popup' ? 'extension' : shell)}
                </span>
            </Row>
            <Row label="Update channel">
                <span style={ROW_VALUE}>{UPDATE_CHANNEL}</span>
            </Row>
            {/* §6 / D4: only a directly-installed build has to look
                after its own updates, and only there is there a switch to
                show. Every other shell is updated by a store, the browser or
                electron-updater, and `hasDirectUpdateLane()` is false, so
                this row does not exist rather than existing greyed out. */}
            {updateLane ? (
                <ToggleRow
                    label="Check for new versions"
                    hint={
                        'Checks our download site once a day and alerts you to new versions.'
                        + ' It does not download or install them or send wallet data.'
                    }
                    checked={updateCheck}
                    onChange={(next) => {
                        setUpdateNoticeEnabled(next);
                        setUpdateCheck(isUpdateNoticeEnabled());
                    }}
                />
            ) : null}
            <Row label="License">
                <div style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <DocLink path={LICENSE_FILE} label={LICENSE_NAME} />
                    {/* Cluster J FOLLOWUP 5: surface the full LICENSE.md
                        text inline so users don't have to navigate to a
                        repo on GitHub to read what they're agreeing to. */}
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setLicenseOpen((open) => !open)}
                        aria-expanded={licenseOpen}
                        aria-controls="full-license-text"
                    >
                        {licenseOpen ? 'Hide full text' : 'Show full text'}
                    </Button>
                </div>
            </Row>
            {/* Plain-language summary shown by default for the wallet's
                non-technical audience; the full AGPL text is one tap away
                via the "Show full text" toggle above. */}
            <LicenseParagraphs
                text={LICENSE_SUMMARY}
                style={{
                    ...PARAGRAPHS,
                    margin: 'var(--xc-space-1) 0 0',
                    fontSize: 'var(--xc-text-xs)',
                    color: 'var(--xc-text-muted, var(--xc-text))',
                    lineHeight: 1.5,
                }}
            />
            {licenseOpen ? (
                <LicenseParagraphs
                    id="full-license-text"
                    text={LICENSE_TEXT}
                    style={{
                        ...PARAGRAPHS,
                        margin: 0,
                        padding: 'var(--xc-space-3)',
                        background: 'var(--xc-surface-sunken, var(--xc-surface-raised))',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-md)',
                        fontSize: 'var(--xc-text-xs)',
                        fontFamily: 'var(--xc-font-mono, monospace)',
                        color: 'var(--xc-text)',
                        wordBreak: 'break-word',
                    }}
                />
            ) : null}
            <Row label="Notice">
                <DocLink path={NOTICE_FILE} label={NOTICE_FILE} />
            </Row>
            <Row label="Reproducible build">
                <DocLink path={REPRODUCIBLE_BUILD_DOC} label="Verification procedure" />
            </Row>
            <Row label="Verify a release">
                {/* Cluster T FOLLOWUP 2: end-user verification recipe (key import ->
                    manifest download -> GPG verify -> artifact hash check). */}
                <DocLink path={VERIFY_RELEASE_DOC} label="Verification recipe" />
            </Row>
            <Row label="Release signatures">
                {RELEASE_SIGNATURES_PUBLISHED ? (
                    <DocLink path={RELEASE_SIGNATURES_DOC} label="GPG fingerprint" />
                ) : (
                    <span style={ROW_VALUE_MUTED}>not yet published</span>
                )}
            </Row>
            <Row label="Disclosure policy">
                {SECURITY_PUBLISHED ? (
                    <DocLink path={SECURITY_FILE} label={SECURITY_FILE} />
                ) : (
                    <span style={ROW_VALUE_MUTED}>not yet published</span>
                )}
            </Row>
            <Row label="Diagnostics">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--xc-space-2)', alignItems: 'center' }}>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleTogglePreview}
                        loading={previewBusy}
                        disabled={previewBusy}
                        aria-expanded={previewOpen}
                        aria-controls="diagnostic-dump-preview"
                    >
                        {previewOpen ? 'Hide preview' : 'Show preview'}
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleCopyDiagnostics}
                        loading={busy}
                        disabled={busy}
                    >
                        {status ? 'Copied' : 'Copy diagnostics'}
                    </Button>
                </div>
            </Row>
            <Row label="Feedback">
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleReportProblem}
                    loading={reportBusy}
                    disabled={reportBusy}
                >
                    Report a problem
                </Button>
            </Row>
            {previewOpen && preview !== null ? (
                <pre
                    id="diagnostic-dump-preview"
                    style={{
                        margin: 0,
                        padding: 'var(--xc-space-3)',
                        background: 'var(--xc-surface-sunken, var(--xc-surface-raised))',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-md)',
                        fontSize: 'var(--xc-text-xs)',
                        fontFamily: 'var(--xc-font-mono, monospace)',
                        color: 'var(--xc-text-muted)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                    }}
                >
                    {preview}
                </pre>
            ) : null}
            {status ? (
                <div role="status" aria-live="polite" style={{ ...ROW_VALUE_MUTED, padding: 'var(--xc-space-2) var(--xc-space-3)' }}>
                    {status}
                </div>
            ) : null}
            {error ? (
                <StatusMessage
                    variant="error"
                    recovery={retryRef.current ? { label: 'Try again', onAction: retryRef.current } : undefined}
                >
                    {error}
                </StatusMessage>
            ) : null}
        </div>
    );
}

function Row({ label, children }) {
    return (
        <div style={ROW}>
            <span style={ROW_LABEL}>{label}</span>
            {children}
        </div>
    );
}

function LicenseParagraphs({ text, ...props }) {
    return (
        <div {...props}>
            {text.trim().split('\n\n').map((paragraph, index) => (
                <p key={index} style={PARAGRAPH}>{paragraph}</p>
            ))}
        </div>
    );
}

function DocLink({ path, label }) {
    const isUrl = typeof path === 'string' && /^https?:\/\//.test(path);
    const href = isUrl
        ? path
        : `https://github.com/XChain-Platform/xchain-wallet/blob/main/${path}`;
    const style = {
        color: 'var(--xc-text)',
        fontFamily: 'var(--xc-font-mono, monospace)',
        fontSize: 'var(--xc-text-xs)',
    };
    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            style={{ ...style, color: 'var(--xc-accent, var(--xc-text))' }}
        >
            {label} <span aria-hidden="true">↗</span>
        </a>
    );
}

function prepareDiagnosticDump(dump, shell) {
    const sanitized = sanitizeDiagnosticValue(dump);
    const report = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
        ? sanitized
        : {};
    const platform = shell === 'popup' ? 'extension' : shell;
    const wallet = report.wallet && typeof report.wallet === 'object' ? report.wallet : {};
    const build = report.build && typeof report.build === 'object' ? report.build : {};
    const buildId = build.buildId || runtimeBuildHash();
    return {
        ...report,
        wallet: {
            ...wallet,
            version: wallet.version || WALLET_VERSION,
            platform: wallet.platform || platform,
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
