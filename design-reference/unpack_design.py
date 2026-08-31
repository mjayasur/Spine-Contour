import re, json, base64, gzip, zlib, os

OUT = "design_src"
os.makedirs(OUT, exist_ok=True)

src = open(r"C:\Users\codyj\Downloads\SpineContour Demo (offline).html", encoding="utf-8").read()
man = json.loads(re.search(r'<script type="__bundler/manifest"[^>]*>(.*?)</script>', src, re.S).group(1))

EXT = {
    "image/jpeg": "jpg", "image/png": "png", "image/svg+xml": "svg",
    "text/javascript": "js", "text/css": "css", "font/woff2": "woff2",
    "text/html": "html",
}


def decompress(raw, flag):
    if not flag:
        return raw
    for fn in (gzip.decompress, zlib.decompress, lambda b: zlib.decompress(b, -15)):
        try:
            return fn(raw)
        except Exception:
            pass
    raise RuntimeError("could not decompress")


for uid, entry in man.items():
    raw = base64.b64decode(entry["data"])
    try:
        blob = decompress(raw, entry.get("compressed"))
    except RuntimeError:
        print("SKIP (decompress failed)", uid)
        continue
    ext = EXT.get(entry.get("mime"), "bin")
    path = os.path.join(OUT, "%s.%s" % (uid, ext))
    with open(path, "wb") as fh:
        fh.write(blob)
    note = ""
    if ext == "js":
        head = blob[:200].decode("utf-8", "replace").replace("\n", " ")
        note = "  head: " + head[:120]
    print("%-45s %-6s %8d bytes%s" % (os.path.basename(path), ext, len(blob), note))

print()
print("wrote to", os.path.abspath(OUT))
