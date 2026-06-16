// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the shared label → icon resolver. Drives the auto-icon
// behaviour on Button + the icon column on HeaderActionMenu's extra-
// actions list.

import { describe, it, expect } from 'vitest';
import {
    iconForLabel,
    SendIcon, ReceiveIcon, SignIcon, BroadcastIcon, LockIcon, UnlockIcon,
    CheckIcon, XIcon, TrashIcon, PencilIcon, PlusIcon, RefreshIcon,
    BackIcon, ForwardIcon, CopyIcon, ScanIcon, SearchIcon, FilterIcon,
    EyeIcon, UploadIcon, DownloadIcon, MigrateIcon, TokenIcon,
    MultisigIcon, AddressIcon, ContractIcon, MarketIcon, MessageIcon,
    HistoryIcon, HomeIcon, GearIcon, MoreIcon, PrinterIcon, HandshakeIcon,
    VerifyIcon,
} from '../../../packages/core/src/ui/icons/index.jsx';

describe('ui/icons/iconForLabel', () => {
    const cases = [
        ['Send', SendIcon],
        ['Send message', SendIcon],
        ['Receive', ReceiveIcon],
        ['Sign', SignIcon],
        ['Sign action', SignIcon],
        ['Broadcast', BroadcastIcon],
        ['Lock', LockIcon],
        ['Unlock', UnlockIcon],
        ['Save', CheckIcon],
        ['Confirm', CheckIcon],
        ['Validate code', CheckIcon],
        ['Cancel', XIcon],
        ['Skip', XIcon],
        ['Reject', XIcon],
        ['Delete', TrashIcon],
        ['Burn', TrashIcon],
        ['Edit', PencilIcon],
        ['Compose', PencilIcon],
        ['Create', PlusIcon],
        ['Create wallet', PlusIcon],
        ['Refresh', RefreshIcon],
        ['Retry', RefreshIcon],
        ['Back', BackIcon],
        ['Previous', BackIcon],
        ['Next', ForwardIcon],
        ['Continue', ForwardIcon],
        ['Use template', ForwardIcon],
        ['Copy recovery phrase', CopyIcon],
        ['Scan', ScanIcon],
        ['Search', SearchIcon],
        ['Filter', FilterIcon],
        ['View', EyeIcon],
        ['Reveal private key', EyeIcon],
        ['Preview', EyeIcon],
        ['Estimate size', EyeIcon],
        ['Import wallet', UploadIcon],
        ['Deposit', UploadIcon],
        ['Export', DownloadIcon],
        ['Withdraw', DownloadIcon],
        ['Migrate to BIP39', MigrateIcon],
        ['Issue token', PlusIcon], // matches "issue" in PlusIcon list
        ['Token', TokenIcon],
        ['Mint additional supply', PrinterIcon], // "mint" now routes to Printer
        ['Transfer ownership', HandshakeIcon],   // "transfer" → Handshake
        ['Verify signature', VerifyIcon],        // "verify" → shield-check
        ['Multisig signing', MultisigIcon],
        ['Addresses', AddressIcon],
        ['Contracts', ContractIcon],
        ['Call method', ContractIcon],
        ['Markets', MarketIcon],
        ['Messaging', MessageIcon],
        ['History', HistoryIcon],
        ['Home', HomeIcon],
        ['Settings', GearIcon],
        ['Advanced', GearIcon],
        ['More actions', MoreIcon],
    ];

    cases.forEach(([label, expected]) => {
        it(`maps "${label}" → ${expected.name}`, () => {
            expect(iconForLabel(label)).toBe(expected);
        });
    });

    describe('non-matching inputs', () => {
        it('returns null for an unrecognized label', () => {
            expect(iconForLabel('Quantum entanglement')).toBeNull();
        });

        it('returns null for empty / whitespace input', () => {
            expect(iconForLabel('')).toBeNull();
            expect(iconForLabel('   ')).toBeNull();
        });

        it('returns null for non-string input', () => {
            expect(iconForLabel(null)).toBeNull();
            expect(iconForLabel(undefined)).toBeNull();
            expect(iconForLabel(42)).toBeNull();
            expect(iconForLabel({})).toBeNull();
        });
    });

    describe('case + whitespace tolerance', () => {
        it('lowercases before matching', () => {
            expect(iconForLabel('SEND')).toBe(SendIcon);
            expect(iconForLabel('SeNd')).toBe(SendIcon);
        });

        it('trims surrounding whitespace before matching', () => {
            expect(iconForLabel('   Save   ')).toBe(CheckIcon);
        });
    });
});
