import Foundation

@main
struct WatchAgeCheck {
    struct TestCase {
        let name: String
        let balancesAt: Int64
        let now: Int64
        let bucket: WatchAge.Bucket
        let n: Int
        let amber: Bool
    }

    static func main() {
        let base: Int64 = 1_800_000_000_000
        let cases = [
            TestCase(name: "elapsed 0", balancesAt: base, now: base, bucket: .justNow, n: 0, amber: false),
            TestCase(name: "elapsed 59999 ms", balancesAt: base, now: base + 59_999, bucket: .justNow, n: 0, amber: false),
            TestCase(name: "elapsed 60000 ms", balancesAt: base, now: base + 60_000, bucket: .minutes, n: 1, amber: false),
            TestCase(name: "exactly 15 minutes not amber", balancesAt: base, now: base + 15 * 60_000, bucket: .minutes, n: 15, amber: false),
            TestCase(name: "15 minutes plus 1 ms amber", balancesAt: base, now: base + 15 * 60_000 + 1, bucket: .minutes, n: 15, amber: true),
            TestCase(name: "59 minutes 59 seconds", balancesAt: base, now: base + 59 * 60_000 + 59_000, bucket: .minutes, n: 59, amber: true),
            TestCase(name: "60 minutes", balancesAt: base, now: base + 60 * 60_000, bucket: .hours, n: 1, amber: true),
            TestCase(name: "23 hours 59 minutes", balancesAt: base, now: base + (23 * 60 + 59) * 60_000, bucket: .hours, n: 23, amber: true),
            TestCase(name: "24 hours", balancesAt: base, now: base + 24 * 60 * 60_000, bucket: .day, n: 24, amber: true),
            TestCase(name: "50 hours", balancesAt: base, now: base + 50 * 60 * 60_000, bucket: .day, n: 50, amber: true),
            TestCase(name: "balancesAt one minute in the future", balancesAt: base + 60_000, now: base, bucket: .justNow, n: 0, amber: false),
        ]

        for testCase in cases {
            let result = WatchAge.of(balancesAt: testCase.balancesAt, now: testCase.now)
            guard result.bucket == testCase.bucket,
                  result.n == testCase.n,
                  result.amber == testCase.amber else {
                print("FAILED: \(testCase.name)")
                exit(1)
            }
        }

        print("WatchAgeCheck passed \(cases.count) cases")
    }
}
