// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
    'packages/core/src/shared/routes/Receive.module.css',
    'utf8',
);
const qrCss = readFileSync(
    'packages/core/src/ui/QrDisplay.module.css',
    'utf8',
);
const receive = readFileSync(
    'packages/core/src/shared/routes/Receive.jsx',
    'utf8',
);
const keyQr = readFileSync(
    'packages/core/src/shared/components/KeyQR.jsx',
    'utf8',
);
const animatedQr = readFileSync(
    'packages/core/src/ui/AnimatedQrFrames.jsx',
    'utf8',
);
const cosignerShare = readFileSync(
    'packages/core/src/shared/routes/MultisigCosignerShare.jsx',
    'utf8',
);
const privateKey = readFileSync(
    'packages/core/src/shared/routes/ViewPrivateKey.jsx',
    'utf8',
);

function rule(cssText, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return cssText.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

describe('Receive form spacing', () => {
    it('separates the label editor from the following field group', () => {
        expect(rule(css, '.labelEditor'))
            .toMatch(/margin-bottom:\s*var\(--xc-space-3\)/);
    });

    it('uses one responsive frame rule across static, animated, and receive QRs', () => {
        expect(rule(qrCss, '.frame')).toMatch(/width:\s*100%/);
        expect(rule(qrCss, '.frame')).toMatch(/max-width:\s*var\(--xc-qr-frame-size\)/);
        expect(rule(qrCss, '.frame')).toMatch(/box-sizing:\s*border-box/);
        expect(rule(qrCss, '.frame')).toMatch(/padding:\s*var\(--xc-space-3\)/);
        expect(rule(qrCss, '.frame')).toMatch(/background:\s*#FFFFFF/);
        expect(rule(qrCss, '.frame')).toMatch(/border:\s*1px solid var\(--xc-border\)/);
        expect(rule(qrCss, '.frame')).toMatch(/border-radius:\s*var\(--xc-radius-md\)/);

        expect(keyQr).toMatch(/className=\{qrStyles\.frame\}/);
        expect(animatedQr).toMatch(/className=\{qrStyles\.frame\}/);
        expect(receive).toMatch(/className=\{`\$\{qrStyles\.frame\} \$\{styles\.qrBox\}`\}/);
        for (const source of [keyQr, animatedQr, receive]) {
            expect(source).toMatch(/margin:\s*4/);
        }
    });

    it('caps receive QRs inside a 360px phone gutter and keeps labels and actions below', () => {
        const receiveDisplay = rule(css, '.receiveQrDisplay');
        expect(receiveDisplay).toMatch(/--xc-qr-frame-size:\s*20rem/);
        expect(20 * 16).toBeLessThanOrEqual(360 - (2 * 12));
        expect(css.match(/\.receiveQrBox\s*\{/g)).toBeNull();

        expect(receive).toMatch(
            /qrStyles\.frame[\s\S]*?<AddressField[\s\S]*?\{qrActionsContent\}/,
        );
        expect(receive).toMatch(/className=\{`\$\{qrStyles\.actions\} \$\{styles\.qrActions\}`\}/);
        expect(animatedQr).toMatch(
            /qrStyles\.frame[\s\S]*?qrStyles\.caption[\s\S]*?qrStyles\.actions/,
        );
        expect(cosignerShare).toMatch(
            /<KeyQR[\s\S]*?<textarea[\s\S]*?<CopyButton/,
        );
        expect(privateKey).toMatch(
            /renderQR\(\{ value: currentWif \}\)[\s\S]*?styles\.copyRow/,
        );
    });
});
