// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';
import { approveSettle } from '../../packages/core/src/shared/utils/approveSettle.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// Suites click Approve the instant a review renders; the settle window has its
// own regression test (confirmApproveSettle) that restores the real value.
approveSettle.ms = 0;
