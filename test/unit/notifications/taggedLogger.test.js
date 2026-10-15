// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { taggedLogger } from '../../../packages/core/src/notifications/taggedLogger.js';

describe('taggedLogger', () => {
    it('tags messages and reduces built-in errors to their safe type', () => {
        const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const log = taggedLogger(logger, 'deadline');
        const error = new TypeError('secret response payload');

        log.error('poll failed', error);

        expect(logger.error).toHaveBeenCalledWith('[deadline] poll failed', '<TypeError>');
        expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret response payload');
        expect(JSON.stringify(logger.error.mock.calls)).not.toContain(error.stack);
    });

    it('normalizes untrusted messages and error names', () => {
        const logger = { warn: vi.fn() };
        const log = taggedLogger(logger, 'notify');

        log.warn({ response: 'private' }, { name: 'PrivateNetworkError', body: 'private' });

        expect(logger.warn).toHaveBeenCalledWith('[notify] diagnostic event', '<Error>');
    });

    it('ignores absent sinks and unsupported levels without throwing', () => {
        expect(() => taggedLogger(null, 'quiet').debug('ignored')).not.toThrow();
        expect(() => taggedLogger({ debug: true }, 'quiet').debug('ignored')).not.toThrow();
    });
});
