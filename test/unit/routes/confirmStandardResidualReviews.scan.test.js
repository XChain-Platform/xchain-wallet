import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTE_DIR = resolve(process.cwd(), 'packages/core/src/shared/routes');
const ROUTES = [
    'CreatePollForm.jsx',
    'PollDetail.jsx',
    'DelegateVoteForm.jsx',
    'ComposeMessage.jsx',
    'ListCreateForm.jsx',
];

const source = (name) => readFileSync(resolve(ROUTE_DIR, name), 'utf8');

describe('residual review stages use Confirm Standard', () => {
    it.each(ROUTES)('%s routes its residual review through ConfirmActionModal', (name) => {
        const text = source(name);
        expect(text).toContain("from '../components/ConfirmActionModal.jsx'");
        expect(text).toContain('<ConfirmActionModal');
        expect(text).toContain('networkFee={');
        expect(text).not.toMatch(/Estimate unavailable|estimateUnavailable/);
    });

    it('keeps list item details in the fact card instead of collapsed review details', () => {
        const text = source('ListCreateForm.jsx');
        expect(text).not.toContain('<details>');
        expect(text).toContain("{ label: 'Items', value: String(items.length) }");
        expect(text).toContain("{ label: 'Members after edit', value: String(resultingCount) }");
    });

    it('keeps watcher review actions on the standard Reject and Approve footer', () => {
        for (const name of ['CreatePollForm.jsx', 'PollDetail.jsx', 'DelegateVoteForm.jsx']) {
            const text = source(name);
            expect(text).toContain('acknowledged={NO_ACKNOWLEDGMENTS}');
            expect(text).toContain('onReject=');
            expect(text).toContain('onApprove=');
        }
    });
});
