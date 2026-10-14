// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as notifications from '../../../packages/core/src/notifications/index.js';

describe('notifications public surface', () => {
    it('exports the complete watcher, sound, and pending-transaction API', () => {
        expect(Object.keys(notifications).sort()).toEqual([
            'CoinpayAutopayWatcher',
            'DeadlineWatcher',
            'DispenserEscrowWatcher',
            'GovernancePollWatcher',
            'NotificationService',
            'PriceAlertWatcher',
            'SOUND_FAMILIES',
            'SOUND_NONE',
            'SOUND_PALETTE',
            'SOUND_PREVIEW_EVENT',
            'describeWindow',
            'familyForKind',
            'getActiveAddresses',
            'getBroadcastTxids',
            'markPendingTxIndexed',
            'markPendingTxMempoolSeen',
            'pendingTxReferencesMatch',
            'pickedSoundForFamily',
            'resolveNotificationSound',
            'soundById',
            'withNotificationSound',
        ].sort());
    });
});
