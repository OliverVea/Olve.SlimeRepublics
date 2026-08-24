#!/usr/bin/env bash
# Fetch YouTube metadata, descriptions, transcripts and comments for ingestion into docs/sources/.
#
#   ./yt-ingest.sh <outdir> <videoId|url> [more...]
#   ./yt-ingest.sh out https://www.youtube.com/playlist?list=PL...   # playlists expand
#
# Needs only `uv` on PATH — uvx runs yt-dlp without installing it.
# Writes <id>.info.json, <id>.en*.vtt and tx_<id>.txt (clean transcript) into <outdir>.
set -euo pipefail

out="${1:?usage: yt-ingest.sh <outdir> <video-or-playlist>...}"; shift
mkdir -p "$out"

# --write-comments is slow and rate-limited; drop max_comments or raise it as needed.
uvx --from yt-dlp yt-dlp \
    --no-warnings --sleep-requests 1 --ignore-errors \
    --skip-download --write-info-json \
    --write-auto-subs --sub-langs "en.*" --sub-format vtt \
    --write-comments --extractor-args "youtube:max_comments=30,all,all,30;comment_sort=top" \
    -P "$out" -o "%(id)s" "$@"

# Auto-caption VTT is rolling: each line repeats across cues. Without dedup every
# sentence appears two or three times and the transcript triples in size.
python3 - "$out" <<'PY'
import sys, re, glob, os, html, json
out = sys.argv[1]

def vtt_text(path):
    lines = []
    for ln in open(path, encoding="utf-8").read().splitlines():
        if "-->" in ln or ln.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")) or not ln.strip():
            continue
        t = html.unescape(re.sub(r"<[^>]+>", "", ln)).strip()
        if t and (not lines or lines[-1] != t):
            lines.append(t)
    kept = []
    for t in lines:
        if kept and t in kept[-1]:
            continue
        if kept and kept[-1] in t:
            kept[-1] = t
        else:
            kept.append(t)
    return " ".join(kept)

for info in sorted(glob.glob(os.path.join(out, "*.info.json"))):
    d = json.load(open(info))
    vid = d["id"]
    sub = next((p for p in (f"{out}/{vid}.en-orig.vtt", f"{out}/{vid}.en.vtt") if os.path.exists(p)), None)
    text = vtt_text(sub) if sub else ""
    with open(f"{out}/tx_{vid}.txt", "w") as fh:
        fh.write(f"# {d['title']}\n({d.get('upload_date')}, {d.get('duration', 0) // 60}m)\n\n{text}\n")
    print(f"{vid}  {len(text.split()):5d}w  {len(d.get('comments') or []):3d} comments  {d['title']}")
PY
