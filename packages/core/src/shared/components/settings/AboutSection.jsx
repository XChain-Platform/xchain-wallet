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

import { useState } from 'react';
import { Button } from '@xchain-wallet/core/ui';
import { useMessaging } from '../../useMessaging.js';
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

export function AboutSection() {
    const { messaging } = useMessaging();
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState(/** @type {string | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [preview, setPreview] = useState(/** @type {string | null} */ (null));
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewBusy, setPreviewBusy] = useState(false);
    const [licenseOpen, setLicenseOpen] = useState(false);

    async function fetchDump() {
        if (typeof messaging?.getDiagnosticDump !== 'function') {
            throw new Error('Diagnostic dump is not available in this shell.');
        }
        const dump = await messaging.getDiagnosticDump();
        return JSON.stringify(dump, null, 2);
    }

    async function handleCopyDiagnostics() {
        if (busy) return;
        setBusy(true);
        setStatus(null);
        setError(null);
        try {
            const text = preview ?? (await fetchDump());
            if (preview === null) setPreview(text);
            await navigator.clipboard?.writeText?.(text);
            setStatus(`Copied (${text.length.toLocaleString()} bytes). Paste into your bug report.`);
        } catch (err) {
            setError(err?.message || 'Could not copy diagnostics.');
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
            setError(err?.message || 'Could not load diagnostics preview.');
        } finally {
            setPreviewBusy(false);
        }
    }

    return (
        <div style={STACK}>
            <Row label="Version">
                <span style={ROW_VALUE}>{WALLET_VERSION}</span>
            </Row>
            <Row label="Update channel">
                <span style={ROW_VALUE}>{UPDATE_CHANNEL}</span>
            </Row>
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
            <p
                style={{
                    margin: 'var(--xc-space-1) 0 0',
                    fontSize: 'var(--xc-text-xs)',
                    color: 'var(--xc-text-muted, var(--xc-text))',
                    whiteSpace: 'pre-line',
                    lineHeight: 1.5,
                }}
            >
                {LICENSE_SUMMARY}
            </p>
            {licenseOpen ? (
                <pre
                    id="full-license-text"
                    style={{
                        margin: 0,
                        padding: 'var(--xc-space-3)',
                        background: 'var(--xc-surface-sunken, var(--xc-surface-raised))',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-md)',
                        fontSize: 'var(--xc-text-xs)',
                        fontFamily: 'var(--xc-font-mono, monospace)',
                        color: 'var(--xc-text)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: '32rem',
                        overflow: 'auto',
                    }}
                >
                    {LICENSE_TEXT}
                </pre>
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
                <div style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center' }}>
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
                        Copy diagnostics
                    </Button>
                </div>
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
                        maxHeight: '24rem',
                        overflow: 'auto',
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
                <div role="alert" style={{ color: 'var(--xc-danger, #B91C1C)', padding: 'var(--xc-space-2) var(--xc-space-3)' }}>
                    {error}
                </div>
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

function DocLink({ path, label }) {
    // Repo-relative path shown literally. These documents ship inside
    // the wallet bundle (LICENSE.md / NOTICE.md) or in-repo only. A
    // future pass replaces these with anchored links to a hosted docs
    // site once §55.6 governance + §51.5 release website land.
    return (
        <span style={{ color: 'var(--xc-text)', fontFamily: 'var(--xc-font-mono, monospace)', fontSize: 'var(--xc-text-xs)' }}>
            {label}
            <span style={{ color: 'var(--xc-text-muted)', marginLeft: 6 }}>({path})</span>
        </span>
    );
}
