// G123: amounts group their thousands, identifiers do not. A block number, an
// action index and a wake or callback block are read digit for digit, so no
// grouping helper may touch one on a display line.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addressLockStateError } from '../../../packages/core/src/shared/utils/addressLockState.js';
import { validateAdvancedIssueFields } from '../../../packages/core/src/shared/utils/issueAdvancedFields.js';

const GROUPING = /toLocaleString|Intl\.NumberFormat|formatWithThousands|formatDecimalAmount|formatDisplayAmount/;
const IDENTIFIER = /\b(?:block|Block|cbBlock|freshBlock|wakeBlock|resumeBlock|displayedResumeBlock|currentHeight|stateHeight|cooldown_end_block|block_index|blockIndex|confirmedBlockIndex|action_index|actionIndex|rawActionIndex)\b/;

const ROUTES = [
    'shared/routes/CallbackForm.jsx',
    'shared/routes/SleepForm.jsx',
    'shared/routes/StakingList.jsx',
    'shared/routes/LinkForm.jsx',
    'shared/routes/ActionDetail.jsx',
    'shared/routes/HistoryDetailCard.jsx',
    'shared/routes/HistoryEntryRow.jsx',
    'shared/routes/ContractHero.jsx',
    'shared/routes/IssueTokenForm.jsx',
    'shared/routes/TokenAdminForm.jsx',
    'shared/components/HomeTabs.jsx',
    'shared/components/MarketLifecycleTimeline.jsx',
    'shared/components/PreflightPanel.jsx',
    'shared/utils/addressLockState.js',
    'shared/utils/issueAdvancedFields.js',
];

// Lines that group something that is not an identifier although a block word
// sits nearby: the recipient count, a duration in blocks, and amounts.
// The timeline's i18n placeholder is named formatDecimalAmountValue but now
// receives String(block_index); the name is not a call.
const ALLOWED = [/recipientCount/, /durationBlock/, /Duration/, /presetBlocks/, /formatDecimalAmountValue: String\(/];

describe('identifiers are never grouped (G123)', () => {
    it.each(ROUTES)('%s groups no block number, action index or height', (rel) => {
        const offenders = readFileSync(join(process.cwd(), 'packages/core/src', rel), 'utf8').split('\n')
            .map((text, i) => ({ text, line: i + 1 }))
            .filter(({ text }) => !/^\s*(?:\/\/|\*|\/\*)/.test(text))
            .filter(({ text }) => GROUPING.test(text) && IDENTIFIER.test(text))
            .filter(({ text }) => !ALLOWED.some((re) => re.test(text)))
            .map(({ text, line }) => `${rel}:${line}: ${text.trim()}`);
        expect(offenders).toEqual([]);
    });

    it('names the locked-until block with raw digits', () => {
        const message = addressLockStateError('ready', { resumeBlock: 1234567 }, 1000000);
        expect(message).toContain('1234567');
        expect(message).not.toContain('1,234,567');
    });

    it('names the chain height with raw digits in the callback block refusal', () => {
        const message = validateAdvancedIssueFields(
            { callbackTick: 'XCHAIN', callbackAmount: '1', callbackBlock: '1000' },
            { currentHeight: 1234567 },
        );
        const text = typeof message === 'string' ? message : JSON.stringify(message);
        expect(text).toContain('1234567');
        expect(text).not.toContain('1,234,567');
    });
});
