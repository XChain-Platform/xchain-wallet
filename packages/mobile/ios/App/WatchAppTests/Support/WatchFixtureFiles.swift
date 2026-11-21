import Foundation

enum WatchFixtureFiles {
    static func directory(from filePath: String = #filePath) -> URL? {
        let fileManager = FileManager.default
        var ancestor = URL(fileURLWithPath: filePath).deletingLastPathComponent()

        while true {
            let candidate = ancestor
                .appendingPathComponent("test", isDirectory: true)
                .appendingPathComponent("fixtures", isDirectory: true)
                .appendingPathComponent("watch", isDirectory: true)
            var isDirectory: ObjCBool = false

            if fileManager.fileExists(atPath: candidate.path, isDirectory: &isDirectory),
               isDirectory.boolValue {
                return candidate
            }

            let parent = ancestor.deletingLastPathComponent()
            if parent.path == ancestor.path {
                return nil
            }
            ancestor = parent
        }
    }

    static func names(prefix: String, in directory: URL) -> [String] {
        let keys: Set<URLResourceKey> = [.isRegularFileKey]
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: Array(keys),
            options: []
        ) else {
            return []
        }

        return contents.compactMap { file in
            guard file.pathExtension == "json",
                  file.lastPathComponent.hasPrefix(prefix),
                  let values = try? file.resourceValues(forKeys: keys),
                  values.isRegularFile == true else {
                return nil
            }
            return file.deletingPathExtension().lastPathComponent
        }.sorted()
    }

    static func data(_ name: String, in directory: URL) throws -> Data {
        try Data(contentsOf: directory.appendingPathComponent("\(name).json"))
    }
}
