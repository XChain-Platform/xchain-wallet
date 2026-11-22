package io.xchain.wallet.android.wear.data;

import java.util.Objects;

public final class GlanceRefreshGate {
    private boolean pending;
    private long lastRefreshAtMs;

    public GlanceRefreshGate() {}

    public enum Action {
        REFRESH_NOW,
        SCHEDULE,
        COALESCED
    }

    public static final class Decision {
        private final Action action;
        private final long delayMs;

        public Decision(Action action, long delayMs) {
            this.action = Objects.requireNonNull(action, "action");
            this.delayMs = delayMs;
        }

        public Action action() {
            return action;
        }

        public long delayMs() {
            return delayMs;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof Decision)) {
                return false;
            }
            Decision decision = (Decision) other;
            return action == decision.action && delayMs == decision.delayMs;
        }

        @Override
        public int hashCode() {
            return Objects.hash(action, delayMs);
        }

        @Override
        public String toString() {
            return "Decision{action=" + action + ", delayMs=" + delayMs + '}';
        }
    }

    public synchronized Decision onSnapshot(long nowMs, long delayMs) {
        if (pending) {
            return new Decision(Action.COALESCED, 0);
        }
        if (delayMs <= 0) {
            lastRefreshAtMs = nowMs;
            return new Decision(Action.REFRESH_NOW, 0);
        }
        pending = true;
        return new Decision(Action.SCHEDULE, delayMs);
    }

    public synchronized boolean onScheduledFire(long nowMs) {
        if (!pending) {
            return false;
        }
        pending = false;
        lastRefreshAtMs = nowMs;
        return true;
    }

    public synchronized boolean isPending() {
        return pending;
    }

    public synchronized long lastRefreshAtMs() {
        return lastRefreshAtMs;
    }
}
