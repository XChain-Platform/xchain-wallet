// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActionIntentSummary } from '../../../packages/core/src/shared/components/ActionIntentSummary.jsx';
import { PreflightPanel } from '../../../packages/core/src/shared/components/PreflightPanel.jsx';
import { PsbtIntentPanel } from '../../../packages/core/src/shared/components/PsbtIntentPanel.jsx';
import { RawPsbtViewer } from '../../../packages/core/src/shared/components/RawPsbtViewer.jsx';

afterEach(() => {
    cleanup();
    delete navigator.clipboard;
});

describe('PSBT confirmation presentation', () => {
    it('puts the one-sentence intent before transaction detail', () => {
        render(
            <PsbtIntentPanel
                decomposed={{
                    inputs: [{ address: 'bc1qsource', value: 2000 }],
                    outputs: [{ address: 'bc1qdestination', value: 1900 }],
                }}
                decodedAction={{ summary: 'Send 1 TOKEN to the named recipient.' }}
            />,
        );

        const panel = screen.getByTestId('psbt-intent-panel');
        expect(panel.firstElementChild).toBe(screen.getByTestId('psbt-action-intent'));
        expect(panel.firstElementChild).toHaveTextContent('Send 1 TOKEN to the named recipient.');
    });

    it('keeps action and pre-flight warnings ahead of supporting detail', () => {
        const action = render(
            <ActionIntentSummary
                decoded={{
                    summary: 'Send 1 TOKEN.',
                    warnings: ['Recipient is unverified.'],
                    details: [{ label: 'Recipient', value: 'bc1qdestination' }],
                }}
                simulation={{ deltas: [{ tick: 'TOKEN', before: '2', after: '1' }] }}
            />,
        );
        const actionRoot = action.getByTestId('action-intent');
        expect(actionRoot.children[0]).toHaveTextContent('Send 1 TOKEN.');
        expect(actionRoot.children[1]).toHaveTextContent('Recipient is unverified.');
        expect(actionRoot.children[2]).toHaveTextContent('Recipient');
        action.unmount();

        render(
            <PreflightPanel
                report={{
                    verdict: 'warn',
                    restricted: true,
                    findings: [{
                        code: 'RECIPIENT_UNVERIFIED',
                        severity: 'warning',
                        message: 'Recipient is unverified.',
                    }],
                    unverified: [],
                }}
                acknowledged={new Set()}
                onAcknowledge={() => {}}
            />,
        );
        const warning = screen.getByTestId('preflight-warning-RECIPIENT_UNVERIFIED');
        const restricted = screen.getByTestId('preflight-restricted');
        expect(warning.compareDocumentPosition(restricted) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('keeps raw payloads collapsed, independently copyable, and wrapping', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        const { container } = render(
            <RawPsbtViewer
                developerMode
                psbtHex="deadbeef"
                actionFields={{ action: 'SEND', memo: 'raw fields' }}
            />,
        );

        expect(container.querySelector('details').open).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Copy action fields', hidden: true }));
        expect(await screen.findByText('Copied')).toBeTruthy();
        expect(writeText).toHaveBeenCalledWith(JSON.stringify({ action: 'SEND', memo: 'raw fields' }, null, 2));

        const cssPath = join(
            process.cwd(),
            'packages/core/src/shared/components/RawPsbtViewer.module.css',
        );
        const css = readFileSync(cssPath, 'utf8');
        expect(css).toMatch(/\.hex\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*word-break:\s*break-all/s);
        expect(css).toMatch(/\.json\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*word-break:\s*break-all/s);
    });
});
