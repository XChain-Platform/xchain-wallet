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
import {
  createSendHoldRegistry,
  SendHoldCancelledError,
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
    fire: (handle) => {
      const t = timers.get(handle)
      timers.delete(handle)
      t.fn()
    },
  }
}

describe('createSendHoldRegistry', () => {
  it('resolves undefined once the window elapses', async () => {
    const ft = fakeTimers()
    const r = createSendHoldRegistry(ft)
    const p = r.hold('a', 5)
    expect(r.isHeld('a')).toBe(true)
    expect(ft.timers.get(1).ms).toBe(5000)
    ft.fire(1)
    await expect(p).resolves.toBeUndefined()
    expect(r.isHeld('a')).toBe(false)
  })

  it('resolves at once for 0 seconds without a timer', async () => {
    const ft = fakeTimers()
    const r = createSendHoldRegistry(ft)
    await expect(r.hold('a', 0)).resolves.toBeUndefined()
    expect(ft.timers.size).toBe(0)
  })

  it('rejects SendHoldCancelledError when cancelled during the window', async () => {
    const ft = fakeTimers()
    const r = createSendHoldRegistry(ft)
    const p = r.hold('a', 5)
    expect(r.cancel('a')).toBe(true)
    await expect(p).rejects.toBeInstanceOf(SendHoldCancelledError)
    await p.catch((e) => {
      expect(e.name).toBe('SendHoldCancelledError')
      expect(e.holdId).toBe('a')
      expect(e).toBeInstanceOf(Error)
    })
    expect(ft.timers.size).toBe(0)
    expect(r.isHeld('a')).toBe(false)
  })

  it('cancel on an unheld id returns false and the next hold rejects at once', async () => {
    const ft = fakeTimers()
    const r = createSendHoldRegistry(ft)
    expect(r.cancel('a')).toBe(false)
    await expect(r.hold('a', 5)).rejects.toBeInstanceOf(SendHoldCancelledError)
    expect(ft.timers.size).toBe(0)
    expect(r.isHeld('a')).toBe(false)
  })

  it('early cancel also rejects a 0 second hold, then consumes the memory', async () => {
    const ft = fakeTimers()
    const r = createSendHoldRegistry(ft)
    r.cancel('a')
    await expect(r.hold('a', 0)).rejects.toBeInstanceOf(SendHoldCancelledError)
    await expect(r.hold('a', 0)).resolves.toBeUndefined()
  })

  it('a remembered cancel does not affect other ids', async () => {
    const ft = fakeTimers()
    const r = createSendHoldRegistry(ft)
    r.cancel('a')
    await expect(r.hold('b', 0)).resolves.toBeUndefined()
  })

  it('keeps at most rememberLimit ids, dropping the oldest first', async () => {
    const ft = fakeTimers()
    const r = createSendHoldRegistry({ ...ft, rememberLimit: 2 })
    r.cancel('a')
    r.cancel('b')
    r.cancel('c')
    await expect(r.hold('a', 0)).resolves.toBeUndefined()
    await expect(r.hold('b', 0)).rejects.toBeInstanceOf(SendHoldCancelledError)
    await expect(r.hold('c', 0)).rejects.toBeInstanceOf(SendHoldCancelledError)
  })

  it('rememberLimit 0 remembers nothing', async () => {
    const ft = fakeTimers()
    const r = createSendHoldRegistry({ ...ft, rememberLimit: 0 })
    expect(r.cancel('a')).toBe(false)
    await expect(r.hold('a', 0)).resolves.toBeUndefined()
  })

  it('a second hold on a held id rejects and leaves the first intact', async () => {
    const ft = fakeTimers()
    const r = createSendHoldRegistry(ft)
    const p = r.hold('a', 5)
    await expect(r.hold('a', 5)).rejects.toThrow(/already active/)
    expect(r.isHeld('a')).toBe(true)
    ft.fire(1)
    await expect(p).resolves.toBeUndefined()
  })

  it('cancel returns false after the window elapsed and is remembered', async () => {
    const ft = fakeTimers()
    const r = createSendHoldRegistry(ft)
    const p = r.hold('a', 5)
    ft.fire(1)
    await p
    expect(r.cancel('a')).toBe(false)
    await expect(r.hold('a', 5)).rejects.toBeInstanceOf(SendHoldCancelledError)
  })
})
