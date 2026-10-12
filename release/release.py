#!/usr/bin/env python3
"""MediaFire uploads and the songs.html patch, one stage per call.

  --stage mediafire   upload --zip to MediaFire, print the share link to stdout
  --stage html        patch the SDVX7 card in --html from --zip-name/--md5/--mega-link/--mediafire-link

MEGA is not here: the shell stage drives rclone.

Only the SDVX VII NABLA card is touched: B2 filename, MEGA link, MediaFire link,
MD5 comment. Everything else in the file is left byte-for-byte alone. No git here.
Logging goes to stderr; stdout carries only the value the caller captures.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# Card markers in help/songs.html — SDVX7 card spans [START, END).
CARD_START = "<!-- SDVX VII NABLA -->"
CARD_END = "<!-- SDVX 1-5 Pack -->"


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def upload_mediafire(zip_path: Path) -> str:
    from mediafire import MediaFireApi, MediaFireUploader

    email = os.environ.get("MEDIAFIRE_EMAIL")
    password = os.environ.get("MEDIAFIRE_PASSWORD")
    # 42511 = public SDK app id; override with MEDIAFIRE_APP_ID.
    app_id = os.environ.get("MEDIAFIRE_APP_ID") or "42511"
    api_key = os.environ.get("MEDIAFIRE_API_KEY") or None
    if not email or not password:
        die("MEDIAFIRE_EMAIL / MEDIAFIRE_PASSWORD not set")
    log("[mediafire] logging in as ***")
    api = MediaFireApi()
    api.session = api.user_get_session_token(
        email=email, password=password, app_id=app_id, api_key=api_key
    )
    log(f"[mediafire] uploading {zip_path.name} ...")
    uploader = MediaFireUploader(api)
    with zip_path.open("rb") as fd:
        result = uploader.upload(fd, zip_path.name)
    quickkey = getattr(result, "quickkey", None)
    if not quickkey:
        die(f"mediafire upload returned no quickkey: {result!r}")
    return f"https://www.mediafire.com/file/{quickkey}/{zip_path.name}/file"


def b2_filename_re(pack: str) -> re.Pattern[str]:
    # Pack zips are always ${PACK}-${STAMP}.zip (sdvx-release.sh:119); the hyphen
    # proves we matched the dated link, not a bare Pack.zip.
    return re.compile(r"https://b2\.oniichan\.wtf/song/" + re.escape(pack) + r"-[^\"]*\.zip")


def patch_card(html: str, pack: str, zip_name: str, md5: str,
               mega_link: str | None, mediafire_link: str | None) -> str:
    start = html.index(CARD_START)
    end = html.index(CARD_END, start)
    card = html[start:end]

    edits = [
        ("b2 filename",
         b2_filename_re(pack),
         f"https://b2.oniichan.wtf/song/{zip_name}"),
        (f"{pack} md5",
         re.compile(r"<!--\s*" + re.escape(pack) + r"\s*MD5sum:\s*[0-9A-Fa-f]+\s*-->"),
         f"<!-- {pack} MD5sum: {md5} -->"),
    ]
    if mega_link:
        edits.append(("mega link", re.compile(r"https://mega\.nz/[^\"]*"), mega_link))
    if mediafire_link:
        edits.append(("mediafire link",
                      re.compile(r"https://www\.mediafire\.com/[^\"]*"), mediafire_link))

    for label, pattern, new in edits:
        card, n = pattern.subn(lambda _m, new=new: new, card)
        if n != 1:
            die(f"{label}: expected 1 match in SDVX7 card, got {n}")
        log(f"[html] {label}: {new}")

    return html[:start] + card + html[end:]


def stage_preflight(args: argparse.Namespace) -> None:
    if not args.html:
        die("--html required for --stage preflight")
    html = Path(args.html).read_text(encoding="utf-8")
    n = len(b2_filename_re(args.pack).findall(html))
    if n != 1:
        die(f"b2 filename: expected 1 match in {args.html}, got {n}")
    log(f"[preflight] b2 filename: 1 match")


def stage_html(args: argparse.Namespace) -> None:
    for name in ("html", "zip_name", "md5"):
        if not getattr(args, name):
            die(f"--{name.replace('_', '-')} required for --stage html")

    html = Path(args.html).read_text(encoding="utf-8")
    Path(args.html).write_text(
        patch_card(html, args.pack, args.zip_name, args.md5,
                   args.mega_link or None, args.mediafire_link or None),
        encoding="utf-8", newline="\n",
    )
    log(f"[html] wrote {args.html}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, choices=["preflight", "mediafire", "html"])
    ap.add_argument("--zip", help="zip path (mediafire stage)")
    ap.add_argument("--pack", default="SDVX7")
    ap.add_argument("--html", help="songs.html path (html/preflight stage)")
    ap.add_argument("--zip-name", help="zip filename to write into songs.html (html stage)")
    ap.add_argument("--md5", help="MD5 to write into songs.html (html stage)")
    ap.add_argument("--mega-link", default="", help="MEGA url to write (html stage)")
    ap.add_argument("--mediafire-link", default="", help="MediaFire url to write (html stage)")
    args = ap.parse_args()

    if args.stage == "html":
        stage_html(args)
    elif args.stage == "preflight":
        stage_preflight(args)
    else:
        print(upload_mediafire(Path(args.zip).resolve()))


if __name__ == "__main__":
    main()
