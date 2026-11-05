"""Pack the Aurora source (for GitHub cloud-build / moving the project) into a single ZIP."""
import os
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # aurora/
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "Aurora-source.zip")

EXCLUDE_TOP_DIRS = {"node_modules", ".npm-cache", "bin", "pylibs", "library", ".tmp", ".cache"}
EXCLUDE_FILES = {"library.json"}

count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(HERE):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_TOP_DIRS]
        for fn in filenames:
            if fn in EXCLUDE_FILES or fn.endswith(".log"):
                continue
            full = os.path.join(dirpath, fn)
            arc = os.path.relpath(full, ROOT)  # "aurora/..."
            z.write(full, arc)
            count += 1

print("packed files:", count)
print("zip:", OUT)
print("size:", os.path.getsize(OUT), "bytes")
