// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    findNotification,
    parseNotificationDump,
} from '../../../packages/mobile/scripts/dumpsys-notify.js';

const SCRIPT = resolve(process.cwd(), 'packages/mobile/scripts/dumpsys-notify.js');
const DUMP = `NotificationRecord(0x123: pkg=io.xchain.wallet user=UserHandle{0} id=42 tag=null: Notification(channel=wallet_activity shortcut=null contentView=null))
  opPkg=io.xchain.wallet
  extras={
    android.title=String (Approval requested)
    android.text=SpannableString (Approve transfer for 2 XCH)
    android.progress=Int (0)
  }
  actions={
    [0] "Reject" -> PendingIntent{123}
    [1] "Approve" -> PendingIntent{456}
  }
  stats=SingleNotificationStats{posttimeElapsedMs=10}
NotificationRecord(0x456: pkg=io.xchain.wallet.watch user=UserHandle{0} id=43 tag=null: Notification(channel=wallet_security shortcut=null contentView=null))
  android.title=String (Outside extras)
  extras={
    android.title=String [length=18]
    android.text=SpannableString [length=24]
  }
  [0] "Outside actions" -> PendingIntent{789}
  actions=null
`;
const records = parseNotificationDump(DUMP);

describe('dumpsys notification readers', () => {
    it('parses records, typed extras, and action titles in dump order', () => {
        expect(records).toEqual([
            {
                pkg: 'io.xchain.wallet',
                channel: 'wallet_activity',
                title: 'Approval requested',
                text: 'Approve transfer for 2 XCH',
                actions: ['Reject', 'Approve'],
            },
            {
                pkg: 'io.xchain.wallet.watch',
                channel: 'wallet_security',
                title: undefined,
                text: undefined,
                actions: [],
            },
        ]);
    });

    it('finds the first record matching every supplied field', () => {
        expect(findNotification(records, {
            pkg: 'io.xchain.wallet',
            title: 'Approval requested',
            textContains: '2 XCH',
            action: 'Approve',
        })).toBe(records[0]);
        expect(findNotification(records, { title: 'Approval requested', action: 'Open' }))
            .toBe(null);
        expect(findNotification(records, { textContains: 'redacted' })).toBe(null);
    });
});

describe('dumpsys notification CLI', () => {
    it('exits 0 when every requested field matches', () => {
        expect(execFileSync(process.execPath, [
            SCRIPT,
            'find',
            '--title',
            'Approval requested',
            '--text-contains',
            'transfer for 2',
            '--action',
            'Approve',
            '--pkg',
            'io.xchain.wallet',
        ], {
            encoding: 'utf8',
            input: DUMP,
        })).toBe('');
    });

    it('names the wanted title and exits 1 when no record matches', () => {
        let failure;
        try {
            execFileSync(process.execPath, [SCRIPT, 'find', '--title', 'Not posted'], {
                encoding: 'utf8',
                input: DUMP,
            });
        } catch (error) {
            failure = error;
        }

        expect(failure?.status).toBe(1);
        expect(failure?.stdout).toBe('Notification not found: Not posted\n');
    });
});
