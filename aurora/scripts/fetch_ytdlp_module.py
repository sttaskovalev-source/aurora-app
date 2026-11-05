"""Download the yt-dlp pure-Python wheel from PyPI and unpack it into aurora/pylibs (no pip needed)."""
import json, os, ssl, shutil, sys, urllib.request, zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYLIB = os.path.join(HERE, "pylibs")
TMP = os.path.join(HERE, ".tmp")
os.makedirs(PYLIB, exist_ok=True)
os.makedirs(TMP, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=120)


def main():
    data = json.load(get("https://pypi.org/pypi/yt-dlp/json"))
    wheel = None
    for u in data["urls"]:
        if u["filename"].endswith(".whl") and "py3-none-any" in u["filename"]:
            wheel = u
            break
    if not wheel:
        print("ERROR: wheel not found", file=sys.stderr)
        sys.exit(1)
    print("wheel:", wheel["filename"], flush=True)

    whl_path = os.path.join(TMP, "yt_dlp.whl")
    with get(wheel["url"]) as r, open(whl_path, "wb") as f:
        shutil.copyfileobj(r, f, length=1024 * 1024)
    print("downloaded:", os.path.getsize(whl_path), "bytes", flush=True)

    with zipfile.ZipFile(whl_path) as z:
        # inspect dependencies
        meta = [n for n in z.namelist() if n.endswith(".dist-info/METADATA")]
        if meta:
            txt = z.read(meta[0]).decode("utf-8", "replace")
            reqs = [l for l in txt.splitlines() if l.startswith("Requires-Dist:")]
            print("Requires-Dist:", reqs if reqs else "(none)", flush=True)
        z.extractall(PYLIB)
    os.remove(whl_path)
    print("extracted ->", PYLIB, flush=True)
    print("yt_dlp dir exists:", os.path.isdir(os.path.join(PYLIB, "yt_dlp")), flush=True)

    # smoke test
    sys.path.insert(0, PYLIB)
    import yt_dlp
    print("import OK, version:", yt_dlp.version.__version__, flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr, flush=True)
        sys.exit(1)
