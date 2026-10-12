// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest'
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js'
import { createSendHold } from '../../../packages/extension/src/background/sendHold.js'

function makeHost(sendHold) {
  return createBackgroundHost({
    broadcastQueueStorage: null,
    signThrottleStorage: null,
    logConsoleStorage: null,
    approvals: { request: async () => ({ approved: true }) },
    bridgeEvents: { emit() {} },
    getDiagnosticContext: () => ({}),
    vault: { settings: { get: async () => ({}) }, wallets: { list: async () => [] } },
    chainRegistry: { get: () => null, list: () => [] },
    sdkRegistry: { for: () => ({}) },
    sendHold,
  })
}

describe('send.holdCancel route', () => {
  it('is listed by host.types()', () => {
    const host = makeHost(createSendHold())
    expect(host.types()).toContain('send.holdCancel')
  })

  it('cancels a held id and resolves its hold as cancelled', async () => {
    const sendHold = createSendHold()
    const host = makeHost(sendHold)
    const held = sendHold.hold('h1', 60)
    const res = await host.handle({ type: 'send.holdCancel', request: { holdId: 'h1' } })
    expect(res).toEqual({ ok: true, result: { cancelled: true } })
    await expect(held).resolves.toBe('cancelled')
  })

  it('answers cancelled false for an unknown id', async () => {
    const host = makeHost(createSendHold())
    const res = await host.handle({ type: 'send.holdCancel', request: { holdId: 'nope' } })
    expect(res).toEqual({ ok: true, result: { cancelled: false } })
  })

  it('answers ok false for a missing or empty holdId', async () => {
    const host = makeHost(createSendHold())
    for (const request of [undefined, {}, { holdId: '' }, { holdId: 7 }]) {
      const res = await host.handle({ type: 'send.holdCancel', request })
      expect(res.ok).toBe(false)
    }
  })
})
