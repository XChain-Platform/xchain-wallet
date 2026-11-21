import Foundation

struct ImageLru {
    let capacity: Int
    private(set) var hashes: [String] = []

    init(capacity: Int = 200) {
        self.capacity = max(0, capacity)
    }

    mutating func touch(_ hash: String) {
        remove(hash)
        hashes.append(hash)
    }

    mutating func remove(_ hash: String) {
        hashes.removeAll { $0 == hash }
    }

    mutating func evict(pinned: Set<String>) -> [String] {
        var evicted: [String] = []

        while hashes.count > capacity,
              let index = hashes.firstIndex(where: { !pinned.contains($0) }) {
            evicted.append(hashes.remove(at: index))
        }

        return evicted
    }
}
