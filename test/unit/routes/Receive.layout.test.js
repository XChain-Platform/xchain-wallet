// Copyright © 2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withEnglishCopy } from '../../helpers/englishSource.js';

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Receive.module.css'),
    'utf8',
);
const receive = withEnglishCopy(readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Receive.jsx'),
    'utf8',
));

describe('Receive action layout', () => {
    it.each([360, 1280])('shares one left-aligned content width at %ipx', (viewportWidth) => {
        expect(viewportWidth).toBeGreaterThanOrEqual(360);
        expect(css).toMatch(
            /\.receiveQrDisplay > \*\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/,
        );
        // The form already supplies the card, so only the unframed code is capped.
        expect(css).not.toMatch(/\.qrBox\s*\{/);
        expect(css).toMatch(
            /\.qrSurface\s*\{[^}]*max-width:\s*min\(var\(--xc-qr-frame-size\), var\(--xc-qr-fit-size, var\(--xc-qr-frame-size\)\)\);[^}]*margin-inline:\s*auto;/,
        );
        expect(receive).toMatch(
            /styles\.qrSurface[\s\S]*?<AddressField[\s\S]*?\{qrActionsContent\}/,
        );
    });

    it('keeps only the QR, address, asset, amount and four actions in the receive stack', () => {
        const stack = receive.match(/className=\{`\$\{qrStyles\.stack\} \$\{styles\.receiveQrDisplay\}`\}>[\s\S]*?\{qrActionsContent\}/)?.[0] || '';
        expect(stack).not.toBe('');
        // QR first, then the three fields the user changes, then the actions.
        const order = ['styles.qrSurface', '<AddressField', '<TokenField', '<AmountField', '{qrActionsContent}']
            .map((marker) => stack.indexOf(marker));
        expect(order.every((index) => index >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        const addressField = stack.match(/<AddressField[\s\S]*?\/>/)?.[0] || '';
        // The plain Address label: no address name and no tap-to-copy tooltip,
        // with its '?' help tip like every labelled field (ruling 2026-11-13).
        expect(addressField).toMatch(/label=\{t\('verifySignature\.address'\)\}|label="Address"/);
        expect(addressField).not.toContain('address.label');
        expect(addressField).not.toMatch(/\btitle=/);
        expect(addressField).toMatch(/\bhelp=/);
        expect(receive).not.toContain('tapToCopyAddress');
        expect(receive).not.toContain('tapTheAddressToCopy');
    });

    it.each([360, 1280])('draws the QR actions as one full-width ActionList at %ipx', (viewportWidth) => {
        const actionSource = receive.match(
            /const qrActionsContent[\s\S]*?\) : null;\n/,
        )?.[0] || '';
        expect(viewportWidth).toBeGreaterThanOrEqual(360);
        // G101: Copy, Share, the explorer and New address are rows of the
        // shared ActionList, each with a description, not a row of short buttons.
        expect(actionSource).toMatch(/<ActionList\b/);
        expect(actionSource.match(/<ActionListItem\b/g)).toHaveLength(4);
        expect(actionSource.match(/description=/g)).toHaveLength(4);
        expect(actionSource).not.toMatch(/<Button\b/);
        expect(actionSource).not.toContain('buttonStyles');
        // The explorer row is an external link that opens a new tab.
        expect(actionSource).toMatch(/href=\{addressExplorerUrl\}[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/);
        // The old four-across grid is gone; the list fills the form's width.
        expect(css).not.toMatch(/grid-template-columns:\s*repeat\(4/);
        expect(css).not.toMatch(/\.explorerLink\s*\{/);
        expect(css).toMatch(/\.qrActions\s*\{[^}]*min-width:\s*0;/);
        // With no address yet, New address is still the one standalone button.
        expect(receive).toMatch(/aria-label="Generate new address"[\s\S]*?>\s*New\s*</);
    });

    it('leaves the amount field controls at the shared AmountField sizes', () => {
        // The redesign retired the label editor row. The amount editor no longer
        // overrides its buttons: the fiat swap toggle keeps the AmountField's own
        // small size, the same as on Send.
        expect(css).not.toContain('.labelEditor');
        expect(css).not.toMatch(/\.amountEditor\s+button/);
        expect(receive).toMatch(/<AmountField[\s\S]*?\/>/);
    });

    it('caps the complete QR column to the visible height on landscape phones', () => {
        expect(css).toMatch(
            /@media \(orientation: landscape\) and \(max-height: 480px\) and \(min-aspect-ratio: 7\/5\) \{[\s\S]*?\.qrSurface\s*\{[\s\S]*?max-width: min\(var\(--xc-qr-frame-size\), var\(--xc-qr-fit-size, var\(--xc-qr-frame-size\)\), calc\(var\(--xc-viewport-h, 100vh\) - 11rem\)\);/,
        );
        expect(receive).not.toContain('qrStyles.frame');
        expect(css).toMatch(
            /\.qr\s*\{[\s\S]*?width: 100%;[\s\S]*?height: auto;[\s\S]*?aspect-ratio: 1;/,
        );
    });
});
