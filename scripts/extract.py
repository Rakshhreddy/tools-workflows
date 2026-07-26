#!/usr/bin/env python3
"""Pull a cleaned, timestamped transcript and the chapter list for a source.

    python3 scripts/extract.py "https://www.youtube.com/watch?v=VIDEO_ID"

Writes transcripts/<id>.txt and prints the chapters.

YouTube returns empty caption tracks to plain fetches, so this shells out to
yt-dlp with the android player client, which is the combination that works.
Chapters are scraped from the watch page, where the creator's own timestamps
give you tool and purpose for free. They never give you the handoffs between
tools, so read the transcript before encoding anything.
"""

import html
import os
import re
import subprocess
import sys
import urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "transcripts")


def video_id(url):
    m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    if not m:
        sys.exit("Could not find a video id in that URL")
    return m.group(1)


def chapters(vid):
    req = urllib.request.Request(f"https://www.youtube.com/watch?v={vid}",
                                 headers={"User-Agent": UA})
    page = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")
    title = re.search(r'<meta name="title" content="([^"]*)"', page)
    desc = re.search(r'"shortDescription":"(.*?)","isCrawlable"', page, re.S)
    lines = []
    if desc:
        text = desc.group(1).encode().decode("unicode_escape")
        lines = [l.strip() for l in text.split("\n") if re.match(r"^\d{1,2}:\d{2}", l.strip())]
    return (title.group(1) if title else vid), lines


def subtitles(vid):
    os.makedirs(OUT, exist_ok=True)
    subprocess.run([
        sys.executable, "-m", "yt_dlp",
        "--extractor-args", "youtube:player_client=android",
        "--write-auto-sub", "--sub-lang", "en.*", "--skip-download",
        "--sub-format", "vtt/best",
        "-o", os.path.join(OUT, "%(id)s.%(ext)s"),
        f"https://www.youtube.com/watch?v={vid}",
    ], check=True, capture_output=True)
    for name in (f"{vid}.en-orig.vtt", f"{vid}.en.vtt"):
        path = os.path.join(OUT, name)
        if os.path.exists(path):
            return path
    sys.exit("yt-dlp did not produce a subtitle file")


def parse(path):
    """VTT cues to (seconds, text), stripping inline timing tags."""
    cues = []
    for block in open(path, encoding="utf-8", errors="ignore").read().split("\n\n"):
        m = re.search(r"(\d{2}):(\d{2}):(\d{2})\.\d+\s*-->", block)
        if not m:
            continue
        secs = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
        rows = []
        for line in block.split("\n"):
            if "-->" in line or line.startswith("WEBVTT") or not line.strip():
                continue
            row = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", line)).strip()
            if row:
                rows.append(row)
        if rows:
            cues.append((secs, rows[-1]))
    return cues


def dedupe(cues):
    """Auto captions roll: each cue repeats the last one. Keep only new tail."""
    out, prev = [], ""
    for secs, line in cues:
        if line == prev:
            continue
        if prev and line.startswith(prev):
            add = line[len(prev):].strip()
        elif prev and prev.endswith(line):
            continue
        else:
            add = line
        if add:
            out.append((secs, add))
        prev = line
    return out


def render(cues, every=30):
    chunks, buf, mark = [], [], None
    for secs, line in cues:
        if mark is None:
            mark = secs
        if secs - mark >= every and buf:
            chunks.append((mark, " ".join(buf)))
            buf, mark = [], secs
        buf.append(line)
    if buf:
        chunks.append((mark or 0, " ".join(buf)))

    out = []
    for secs, body in chunks:
        body = html.unescape(body).replace(">>", "\n  - ")
        body = re.sub(r"[ \t]+", " ", body).strip()
        h, rem = divmod(secs, 3600)
        m, s = divmod(rem, 60)
        ts = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
        out.append(f"[{ts}] {body}")
    return "\n\n".join(out)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    vid = video_id(sys.argv[1])
    title, marks = chapters(vid)

    print(f"\n{title}\n")
    if marks:
        print(f"{len(marks)} chapters:")
        for line in marks:
            print("  " + line)
    else:
        print("No chapters. The transcript is all you get for this one.")

    text = render(dedupe(parse(subtitles(vid))))
    dest = os.path.join(OUT, f"{vid}.txt")
    open(dest, "w", encoding="utf-8").write(text)
    print(f"\n{len(text.split())} words -> {dest}")


if __name__ == "__main__":
    main()
