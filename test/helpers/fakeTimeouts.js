import { vi } from 'vitest';

const TIMER_APIS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];

// Keep React's scheduler clocks real so passive effects continue to flush.
export function useFakeTimeouts(options = {}) {
    vi.useFakeTimers({ ...options, toFake: TIMER_APIS });
}

export function useFakeTimeoutsAndDate(options = {}) {
    vi.useFakeTimers({ ...options, toFake: ['Date', ...TIMER_APIS] });
}
