import io.xchain.wallet.android.wear.data.GlanceRefreshGate;

public final class GlanceRefreshGateCheck {
    private GlanceRefreshGateCheck() {}

    public static void main(String[] args) {
        GlanceRefreshGate gate = new GlanceRefreshGate();

        require(!gate.isPending() && gate.lastRefreshAtMs() == 0, "new gate state");

        GlanceRefreshGate.Decision immediate = gate.onSnapshot(1000, 0);
        require(
                immediate.equals(
                        new GlanceRefreshGate.Decision(
                                GlanceRefreshGate.Action.REFRESH_NOW, 0)),
                "zero delay refreshes now");
        require(gate.lastRefreshAtMs() == 1000, "immediate refresh records timestamp");

        GlanceRefreshGate.Decision scheduled = gate.onSnapshot(1001, 299999);
        require(
                scheduled.equals(
                        new GlanceRefreshGate.Decision(
                                GlanceRefreshGate.Action.SCHEDULE, 299999)),
                "positive delay schedules refresh");
        require(gate.isPending(), "scheduled refresh is pending");
        require(gate.lastRefreshAtMs() == 1000, "scheduling preserves refresh timestamp");

        GlanceRefreshGate.Decision coalesced = gate.onSnapshot(2000, 5);
        require(
                coalesced.equals(
                        new GlanceRefreshGate.Decision(
                                GlanceRefreshGate.Action.COALESCED, 0)),
                "pending refresh coalesces snapshot");
        require(gate.isPending(), "coalesced refresh remains pending");

        require(gate.onScheduledFire(301000), "pending scheduled refresh fires");
        require(!gate.isPending(), "scheduled fire clears pending state");
        require(gate.lastRefreshAtMs() == 301000, "scheduled fire records timestamp");

        require(!gate.onScheduledFire(302000), "fire without pending refresh is ignored");
        require(
                gate.lastRefreshAtMs() == 301000,
                "ignored fire preserves refresh timestamp");

        GlanceRefreshGate.Decision negative = gate.onSnapshot(4000, -1);
        require(
                negative.equals(
                        new GlanceRefreshGate.Decision(
                                GlanceRefreshGate.Action.REFRESH_NOW, 0))
                        && gate.lastRefreshAtMs() == 4000,
                "negative delay refreshes now");

        GlanceRefreshGate.Decision first =
                new GlanceRefreshGate.Decision(GlanceRefreshGate.Action.SCHEDULE, 42);
        GlanceRefreshGate.Decision second =
                new GlanceRefreshGate.Decision(GlanceRefreshGate.Action.SCHEDULE, 42);
        require(first.equals(second), "equal decisions compare equal");
        require(first.hashCode() == second.hashCode(), "equal decisions have equal hash codes");
    }

    private static void require(boolean condition, String name) {
        if (!condition) {
            System.err.println("FAIL: " + name);
            System.exit(1);
        }
    }
}
