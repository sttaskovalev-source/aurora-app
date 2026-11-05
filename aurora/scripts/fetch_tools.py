"""Download yt-dlp.exe and ffmpeg.exe (Windows) into aurora/bin using Python's OpenSSL stack."""
import os, sys, ssl, shutil, urllib.request, zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(HERE, "bin")
os.makedirs(BIN, exist_ok=True)

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def download(url, dest, timeout=300):
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f, length=1024 * 1024)
    return os.path.getsize(dest)


def main():
    ytdlp = os.path.join(BIN, "yt-dlp.exe")
    print("[1/2] downloading yt-dlp.exe ...", flush=True)
    n = download("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", ytdlp)
    print("      yt-dlp.exe:", n, "bytes", flush=True)

    ffzip = os.path.join(BIN, "ffmpeg.zip")
    print("[2/2] downloading ffmpeg (this is ~100 MB) ...", flush=True)
    n = download("https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip", ffzip)
    print("      ffmpeg.zip:", n, "bytes", flush=True)

    with zipfile.ZipFile(ffzip) as z:
        names = z.namelist()
        fm = [x for x in names if x.endswith("bin/ffmpeg.exe")]
        fp = [x for x in names if x.endswith("bin/ffprobe.exe")]
        assert fm and fp, "ffmpeg.exe/ffprobe.exe not found in zip"
        with open(os.path.join(BIN, "ffmpeg.exe"), "wb") as f:
            f.write(z.read(fm[0]))
        with open(os.path.join(BIN, "ffprobe.exe"), "wb") as f:
            f.write(z.read(fp[0]))
    os.remove(ffzip)
    print("      ffmpeg.exe:", os.path.getsize(os.path.join(BIN, "ffmpeg.exe")), "bytes", flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr, flush=True)
        sys.exit(1)
