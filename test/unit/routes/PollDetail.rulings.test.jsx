// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(
    here,
    '../../../packages/core/src/shared/routes/PollDetail.jsx',
), 'utf8');

describe('PollDetail vote-form rulings', () => {
    it('starts the ballot form with a locked Network and picker-backed From', () => {
        const form = source.slice(source.indexOf('<FormPage\n                    demoGuard={ballotFormGuard}'));
        expect(form.indexOf('<NetworkField')).toBeGreaterThanOrEqual(0);
        expect(form.indexOf('<AddressField')).toBeGreaterThan(form.indexOf('<NetworkField'));
        expect(form).toMatch(/<NetworkField[\s\S]*?chainIds=\{\[chainId\]\}[\s\S]*?disabled/);
        expect(form).toMatch(/<AddressField[\s\S]*?label="From"[\s\S]*?help="The address casting this ballot\./);
        expect(source).toMatch(/<OwnAddressPickerScreen[\s\S]*?chainId=\{chainId\}[\s\S]*?lockNetwork/);
    });

    it('labels the ballot group with help and gives split shares and Memo specific help', () => {
        expect(source).toContain('<div role="group" aria-labelledby={ballotLabelId}>');
        expect(source).toContain('aria="About ballot choices"');
        expect(source).toContain('A direct vote overrides any standing');
        expect(source).not.toMatch(/<p[^>]*>A direct vote overrides/);
        expect(source).toContain('help="The positive share of this address\'s voting weight assigned to this option."');
        expect(source).toContain('help="An optional note recorded with this ballot. It does not affect the vote or its weight."');
    });

    it('pins vote icons, header-only review navigation, and the green Done action', () => {
        expect(source).toContain('icon={sourceBallot.length ? <Icon.CheckIcon /> : <Icon.ThumbsUpIcon />}');
        expect(source).not.toContain('>Back</Button>');
        expect(source).toContain("onBack={stage === 'review'");
        expect(source).toContain('<Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>');
    });
});
