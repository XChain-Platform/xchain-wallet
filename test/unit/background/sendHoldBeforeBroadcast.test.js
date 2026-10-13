// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  createHoldBeforeBroadcast,
  createSendHoldRegistry,
  SendHoldCancelledError,
  SEND_HOLD_SECONDS_MAX,
} from '../../../packages/extension/src/background/sendHold.js'

function fakeTimers() {
  const timers = new Map()
  let next = 1
  return {
    timers,
    setTimer: (fn, ms) => {
      const handle = next++
      timers.set(handle, { fn, ms })
      return handle
    },
    clearTimer: (handle) => {
      timers.delete(handle)
    },
    fireAll() {
      for (const [handle, t] of [...timers]) {
        timers.delete(handle)
        t.fn()
      }
    },
  }
}

function setup() {
  const t = fakeTimers()
  const sendHold = createSendHoldRegistry({ setTimer: t.setTimer, clearTimer: t.clearTimer })
  return { t, sendHold }
}

describe('createHoldBeforeBroadcast', () => {
  // Tests without an injected clock read Date.now(); freeze it so the hold
  // length does not lose a millisecond on a loaded runner.
  let frozenNow
  beforeEach(() => {
    frozenNow = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
  })

  afterEach(() => {
    frozenNow.mockRestore()
  })

  it('exports a 30 second ceiling', () => {
    expect(SEND_HOLD_SECONDS_MAX).toBe(30)
  })

  it('returns undefined for a null or undefined holdId whatever undoSeconds holds', () => {
    const { sendHold } = setup()
    for (const holdId of [undefined, null]) {
      for (const undoSeconds of [undefined, 5, -1, 'x', NaN]) {
        expect(createHoldBeforeBroadcast({ sendHold, holdId, undoSeconds })).toBeUndefined()
      }
    }
  })

  it('throws TypeError for a holdId that is not a non-empty string', () => {
    const { sendHold } = setup()
    for (const holdId of ['', 5, {}, [], true, 0]) {
      expect(() => createHoldBeforeBroadcast({ sendHold, holdId, undoSeconds: 5 })).toThrow(
        TypeError,
      )
    }
  })

  it('throws TypeError for an undoSeconds that is not a non-negative integer', () => {
    const { sendHold } = setup()
    for (const undoSeconds of [1.5, -1, NaN, '5', undefined, null, Infinity]) {
      expect(() => createHoldBeforeBroadcast({ sendHold, holdId: 'a', undoSeconds })).toThrow(
        TypeError,
      )
    }
  })

  it('returns undefined when undoSeconds is 0', () => {
    const { sendHold } = setup()
    expect(createHoldBeforeBroadcast({ sendHold, holdId: 'a', undoSeconds: 0 })).toBeUndefined()
  })

  it('arms no timer at build time', () => {
    const { t, sendHold } = setup()
    const fn = createHoldBeforeBroadcast({ sendHold, holdId: 'a', undoSeconds: 5 })
    expect(typeof fn).toBe('function')
    expect(t.timers.size).toBe(0)
    expect(sendHold.isHeld('a')).toBe(false)
  })

  it('counts signing time against the displayed undo window', async () => {
    const { t, sendHold } = setup()
    let now = 10_000
    const fn = createHoldBeforeBroadcast({
      sendHold,
      holdId: 'a',
      undoSeconds: 5,
      now: () => now,
    })
    now += 2_000

    const p = fn()
    expect([...t.timers.values()][0].ms).toBe(3000)
    t.fireAll()
    await expect(p).resolves.toBeUndefined()
  })

  it('still consumes a cancellation when signing outlasts the window', async () => {
    const { t, sendHold } = setup()
    let now = 10_000
    const fn = createHoldBeforeBroadcast({
      sendHold,
      holdId: 'a',
      undoSeconds: 5,
      now: () => now,
    })
    expect(sendHold.cancel('a')).toBe(false)
    now += 6_000

    await expect(fn()).rejects.toBeInstanceOf(SendHoldCancelledError)
    expect(t.timers.size).toBe(0)
  })

  it('resolves once the window ends, ignoring the signed bytes argument', async () => {
    const { t, sendHold } = setup()
    const fn = createHoldBeforeBroadcast({ sendHold, holdId: 'a', undoSeconds: 5 })
    const p = fn(new Uint8Array([1, 2, 3]))
    expect(t.timers.size).toBe(1)
    expect([...t.timers.values()][0].ms).toBe(5000)
    expect(sendHold.isHeld('a')).toBe(true)
    t.fireAll()
    await expect(p).resolves.toBeUndefined()
    expect(sendHold.isHeld('a')).toBe(false)
  })

  it('clamps a request of 600 seconds to 30', async () => {
    const { t, sendHold } = setup()
    const fn = createHoldBeforeBroadcast({ sendHold, holdId: 'a', undoSeconds: 600 })
    const p = fn()
    expect([...t.timers.values()][0].ms).toBe(30000)
    t.fireAll()
    await expect(p).resolves.toBeUndefined()
  })

  it('honours a custom maxSeconds', () => {
    const { t, sendHold } = setup()
    const fn = createHoldBeforeBroadcast({ sendHold, holdId: 'a', undoSeconds: 20, maxSeconds: 7 })
    fn()
    expect([...t.timers.values()][0].ms).toBe(7000)
  })

  it('rejects SendHoldCancelledError on a cancel during the window', async () => {
    const { t, sendHold } = setup()
    const fn = createHoldBeforeBroadcast({ sendHold, holdId: 'a', undoSeconds: 5 })
    const p = fn()
    expect(sendHold.cancel('a')).toBe(true)
    await expect(p).rejects.toBeInstanceOf(SendHoldCancelledError)
    expect(t.timers.size).toBe(0)
  })

  it('rejects at once on a cancel remembered from before the call', async () => {
    const { t, sendHold } = setup()
    const fn = createHoldBeforeBroadcast({ sendHold, holdId: 'a', undoSeconds: 5 })
    expect(sendHold.cancel('a')).toBe(false)
    await expect(fn()).rejects.toBeInstanceOf(SendHoldCancelledError)
    expect(t.timers.size).toBe(0)
  })
})
