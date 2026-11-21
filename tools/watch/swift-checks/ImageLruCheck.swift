import Foundation

@main
struct ImageLruCheck {
    static func main() {
        runDefaultCapacityCase()
        runRetouchedOldestCase()
        runPinnedLeastRecentCase()
        runAllPinnedCase()
        runRemoveThenTouchCase()
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }

    private static func runDefaultCapacityCase() {
        var lru = ImageLru()
        for index in 0...200 {
            lru.touch("hash-\(index)")
        }

        guard lru.evict(pinned: []) == ["hash-0"],
              lru.hashes == (1...200).map({ "hash-\($0)" }) else {
            fail("default capacity evicts exactly the first of 201 touches")
        }
    }

    private static func runRetouchedOldestCase() {
        var lru = ImageLru(capacity: 2)
        lru.touch("oldest")
        lru.touch("next")
        lru.touch("oldest")
        lru.touch("newest")

        guard lru.evict(pinned: []) == ["next"],
              lru.hashes == ["oldest", "newest"] else {
            fail("retouched oldest survives while next oldest is evicted")
        }
    }

    private static func runPinnedLeastRecentCase() {
        var lru = ImageLru(capacity: 2)
        lru.touch("pinned-oldest")
        lru.touch("next")
        lru.touch("newest")

        guard lru.evict(pinned: ["pinned-oldest"]) == ["next"],
              lru.hashes == ["pinned-oldest", "newest"] else {
            fail("pinned least-recent hash is skipped")
        }
    }

    private static func runAllPinnedCase() {
        var lru = ImageLru(capacity: 2)
        lru.touch("first")
        lru.touch("second")
        lru.touch("third")

        guard lru.evict(pinned: ["first", "second", "third"]).isEmpty,
              lru.hashes == ["first", "second", "third"] else {
            fail("three pinned hashes at capacity two evict nothing")
        }
    }

    private static func runRemoveThenTouchCase() {
        var lru = ImageLru(capacity: 3)
        lru.touch("first")
        lru.touch("second")
        lru.touch("third")
        lru.remove("second")
        lru.touch("second")

        guard lru.hashes == ["first", "third", "second"] else {
            fail("remove then touch puts the hash last")
        }
    }
}
