import io.xchain.wallet.android.wear.ui.InscribedSquare;

public final class InscribedSquareCheck {
    private static final double TOLERANCE = 1e-9;

    private InscribedSquareCheck() {
    }

    public static void main(String[] args) {
        checkClose("side(100)", InscribedSquare.side(100.0), 70.71067811865476);
        checkClose("inset(100)", InscribedSquare.inset(100.0), 14.64466094067262);

        checkClose("side(0)", InscribedSquare.side(0.0), 0.0);
        checkClose("side(-5)", InscribedSquare.side(-5.0), 0.0);
        checkClose("side(NaN)", InscribedSquare.side(Double.NaN), 0.0);
        checkClose("side(infinity)", InscribedSquare.side(Double.POSITIVE_INFINITY), 0.0);

        checkClose("inset(0)", InscribedSquare.inset(0.0), 0.0);
        checkClose("inset(-5)", InscribedSquare.inset(-5.0), 0.0);
        checkClose("inset(NaN)", InscribedSquare.inset(Double.NaN), 0.0);
        checkClose("inset(infinity)", InscribedSquare.inset(Double.POSITIVE_INFINITY), 0.0);

        checkFit(
                "fit(100, 0)",
                InscribedSquare.fit(100.0, 0.0),
                14.64466094067262,
                14.64466094067262,
                70.71067811865476);
        checkFit(
                "fit(100, 10)",
                InscribedSquare.fit(100.0, 10.0),
                21.715728752538098,
                21.715728752538098,
                56.568542494923804);

        checkNull("fit(100, 50)", InscribedSquare.fit(100.0, 50.0));
        checkNull("fit(100, -1)", InscribedSquare.fit(100.0, -1.0));
        checkNull("fit(NaN, 0)", InscribedSquare.fit(Double.NaN, 0.0));
    }

    private static void checkFit(
            String name, double[] actual, double expectedLeft, double expectedTop, double expectedSide) {
        if (actual == null) {
            fail(name + " returned null");
        }
        if (actual.length != 3) {
            fail(name + " returned an array of length " + actual.length);
        }
        checkClose(name + " left", actual[0], expectedLeft);
        checkClose(name + " top", actual[1], expectedTop);
        checkClose(name + " side", actual[2], expectedSide);
    }

    private static void checkNull(String name, double[] actual) {
        if (actual != null) {
            fail(name + " did not return null");
        }
    }

    private static void checkClose(String name, double actual, double expected) {
        if (!Double.isFinite(actual) || Math.abs(actual - expected) > TOLERANCE) {
            fail(name + " expected " + expected + " but was " + actual);
        }
    }

    private static void fail(String message) {
        System.err.println(message);
        System.exit(1);
    }
}
