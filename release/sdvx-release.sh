#!/usr/bin/env bash
set -euo pipefail

STAGE="${1:-}"
PACK="${PACK:-SDVX7}"
SOURCE_SETTLE_SECONDS="${SOURCE_SETTLE_SECONDS:-1800}"
TOP_DIR="SDVX Nabla"
WORKDIR="${WORKDIR:-/tmp/sdvx-release}"

# Mask the value of any secret we are handed before it reaches the CI log.
redact() {
  local out name
  out="$(cat)"
  for name in GDRIVE_TOKEN GDRIVE_CLIENT_ID GDRIVE_CLIENT_SECRET \
              B2_BUCKET B2_ACCOUNT_ID B2_APP_KEY \
              MEGA_EMAIL MEGA_PASSWORD MEDIAFIRE_EMAIL MEDIAFIRE_PASSWORD; do
    [[ -n "${!name:-}" ]] && out="${out//"${!name}"/***}"
  done
  printf '%s\n' "$out"
}
log()  { printf '\n=== %s ===' "$*" | redact; }
info() { printf '  %s' "$*" | redact; }
die()  { printf 'ERROR: %s' "$*" | redact >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SONGS_HTML="$REPO_ROOT/help/songs.html"
RELEASE_PY="$REPO_ROOT/release/release.py"
STATE="$WORKDIR/state.env"
state_get() { grep -m1 "^$1=" "$STATE" 2>/dev/null | cut -d= -f2- || true; }
state_set() { printf '%s=%s\n' "$1" "$2" >> "$STATE"; }
load_state() {
  [[ -f "$STATE" ]] || die "state file missing ($STATE) — run the earlier stages first"
  ZIP="$(state_get ZIP)"
  MD5="$(state_get MD5)"
  MEGA="$(state_get MEGA)"
  MEDIAFIRE="$(state_get MEDIAFIRE)"
  [[ -n "$ZIP" ]] || die "state file $STATE has no ZIP"
}
drive_folder_id() { printf '%s' "$DRIVE_URL" | sed -n 's#.*/folders/\([^/?]*\).*#\1#p'; }
drive_env() {
  [[ -n "${DRIVE_URL:-}" ]] || die "DRIVE_URL required"
  [[ -n "${GDRIVE_TOKEN:-}" ]] || die "GDRIVE_TOKEN required"
  command -v rclone >/dev/null || die "rclone not installed"
  FOLDER_ID="$(drive_folder_id)"
  [[ -n "$FOLDER_ID" ]] || die "could not parse folder id from DRIVE_URL"
  export RCLONE_CONFIG_GDRIVE_TYPE=drive
  export RCLONE_CONFIG_GDRIVE_TOKEN="$GDRIVE_TOKEN"
  # Bring our own OAuth client: rclone's shared client_id is retired in 2026.
  [[ -n "${GDRIVE_CLIENT_ID:-}" ]] && export RCLONE_CONFIG_GDRIVE_CLIENT_ID="$GDRIVE_CLIENT_ID"
  [[ -n "${GDRIVE_CLIENT_SECRET:-}" ]] && export RCLONE_CONFIG_GDRIVE_CLIENT_SECRET="$GDRIVE_CLIENT_SECRET"
}
count_files() { find "$1" -type f | wc -l | tr -d ' '; }
human_size()  { du -sh "$1" | cut -f1; }

case "$STAGE" in
  check)
    log "Stage: check Drive folder for a newer release"
    drive_env
    LATEST="$(rclone lsl gdrive: --drive-root-folder-id "$FOLDER_ID" --drive-skip-gdocs \
              | awk 'NF>=4 {print $2"T"$3}' | sort | tail -n1)"
    [[ -n "$LATEST" ]] || die "Drive folder listed no files"
    # ISO-8601 with the fraction trimmed: what rclone prints and what source-date.txt
    # stores. A format change would otherwise be silent — `date` failing inside `(( ))`
    # does not stop the script, it just makes the settle gate below decide nothing.
    STAMP="${LATEST%%.*}"
    date -u -d "$STAMP" +%s >/dev/null 2>&1 || die "Drive listed an unparsable timestamp: '$LATEST'"
    RECORDED="$(cat "$REPO_ROOT/release/source-date.txt" 2>/dev/null || true)"

    # A poll can land mid-upload: Drive moves the newest mtime as soon as the first file
    # lands, and releasing then ships a half-copied pack. A manual run never waits.
    TOUCHED_AGO=""
    if [[ "${GITHUB_EVENT_NAME:-}" == schedule ]]; then
      TOUCHED_AGO=$(( $(date +%s) - $(date -u -d "$STAMP" +%s) ))
    fi

    SKIP=""
    if [[ -n "$RECORDED" ]] && [[ ! "$LATEST" > "$RECORDED" ]]; then
      SKIP="up to date (folder $LATEST <= recorded $RECORDED)"
    elif [[ -n "$TOUCHED_AGO" ]] && (( TOUCHED_AGO < SOURCE_SETTLE_SECONDS )); then
      SKIP="the folder was touched ${TOUCHED_AGO}s ago (< ${SOURCE_SETTLE_SECONDS}s)"
    fi

    if [[ -n "$SKIP" ]]; then
      CHANGED=false
      log "Skipping release: $SKIP"
    else
      CHANGED=true
      info "folder latest : $LATEST"
      info "recorded      : ${RECORDED:-<none>}"
      log "New or never-released content — release will run"
    fi

    [[ -n "${GITHUB_ENV:-}" ]] || die "GITHUB_ENV is not set, so the release date could not be recorded"
    printf 'SOURCE_LATEST=%s\n' "$LATEST" >> "$GITHUB_ENV"
    [[ -n "${GITHUB_OUTPUT:-}" ]] || die "GITHUB_OUTPUT is not set, so the workflow cannot read 'changed'"
    printf 'changed=%s\n' "$CHANGED" >> "$GITHUB_OUTPUT"
    ;;

  preflight)
    # Refuse before any upload: the card must already hold exactly one dated B2
    # link for this pack, or patch-html would only notice after B2/Mega/MediaFire.
    log "Stage: preflight songs.html card"
    python3 "$RELEASE_PY" --stage preflight --pack "$PACK" --html "$SONGS_HTML"
    ;;

  download)
    log "Stage: download Google Drive folder"
    drive_env
    info "source folder : $TOP_DIR"
    info "source URL    : $DRIVE_URL"
    info "folder id     : $FOLDER_ID"
    rm -rf "$WORKDIR"
    mkdir -p "$WORKDIR"
    cd "$WORKDIR"
    rclone copy gdrive: "$TOP_DIR" \
      --drive-root-folder-id "$FOLDER_ID" --drive-skip-gdocs \
      --transfers 8 --checkers 16 --retries 5 --low-level-retries 10 \
      -v --stats 15s --stats-one-line
    [[ -d "$TOP_DIR" ]] || die "missing folder '$TOP_DIR'"
    [[ -n "$(find "$TOP_DIR" -mindepth 1 -print -quit)" ]] || die "'$TOP_DIR' is empty"
    info "downloaded    : $(count_files "$TOP_DIR") files, $(human_size "$TOP_DIR")"
    ;;

  pack)
    log "Stage: rename folder + create zip + compute MD5"
    cd "$WORKDIR"
    [[ -d "$TOP_DIR" ]] || die "no '$TOP_DIR' in $WORKDIR — run 'download' first"
    # SDVX7-OCT5-2026.zip  (%-d = no leading zero, so day 5 -> "5")
    STAMP="$(date +%b%-d-%Y | tr '[:lower:]' '[:upper:]')"
    ZIP="${PACK}-${STAMP}.zip"
    info "input folder  : $TOP_DIR ($(count_files "$TOP_DIR") files, $(human_size "$TOP_DIR"))"
    info "output zip    : $ZIP"
    rm -f "$ZIP"
    zip -r -q "$ZIP" "$TOP_DIR"
    MD5="$(md5sum "$ZIP" | awk '{print toupper($1)}')"
    printf 'ZIP=%s\nMD5=%s\n' "$ZIP" "$MD5" > "$STATE"
    info "zip size      : $(human_size "$ZIP")"
    info "MD5           : $MD5"
    ;;

  upload-b2)
    load_state
    [[ -n "${B2_BUCKET:-}" ]] || die "B2_BUCKET not set"
    B2_DEST="b2:${B2_BUCKET}/song"
    command -v rclone >/dev/null || die "rclone not installed"
    log "Stage: upload to Backblaze B2"
    info "file          : $ZIP ($(human_size "$WORKDIR/$ZIP"))"
    info "destination   : $B2_DEST"
    info "public URL    : https://b2.oniichan.wtf/song/$ZIP"
    cd "$WORKDIR"
    rclone copy "$ZIP" "$B2_DEST" --checksum -v --stats 15s --stats-one-line
    ;;

  upload-mega)
    load_state
    [[ -n "${MEGA_EMAIL:-}" ]] || die "MEGA_EMAIL not set"
    [[ -n "${MEGA_PASSWORD:-}" ]] || die "MEGA_PASSWORD not set"
    command -v rclone >/dev/null || die "rclone not installed"
    # rclone wants the password obscured, not the plain value.
    export RCLONE_CONFIG_MEGA_TYPE=mega
    export RCLONE_CONFIG_MEGA_USER="$MEGA_EMAIL"
    export RCLONE_CONFIG_MEGA_PASS="$(rclone obscure "$MEGA_PASSWORD")"
    log "Stage: upload to MEGA"
    info "file          : $ZIP ($(human_size "$WORKDIR/$ZIP"))"
    cd "$WORKDIR"
    rclone copy "$ZIP" mega: -v --stats 15s --stats-one-line
    # Rewrite the legacy mega.co.nz/#!HANDLE!KEY form go-mega can return. `|` is the
    # delimiter because the pattern itself contains `#`.
    MEGA="$(rclone link "mega:$ZIP" | sed -E 's|^https?://mega\.co\.nz/#!([^!]+)!(.+)$|https://mega.nz/file/\1#\2|')"
    [[ -n "$MEGA" ]] || die "rclone link returned no link for $ZIP"
    state_set MEGA "$MEGA"
    info "mega link     : $MEGA"
    ;;

  all)
    # The pipeline's sequencing, so the workflow needs one condition. `bash "$0"`
    # because git checks this script out 100644, and a bare "$0" is exit 126.
    for stage in preflight download pack upload-b2 upload-mega upload-mediafire patch-html; do
      bash "$0" "$stage"
    done
    ;;

  upload-mediafire)
    load_state
    log "Stage: upload to MediaFire"
    info "file          : $ZIP ($(human_size "$WORKDIR/$ZIP"))"
    cd "$WORKDIR"
    MEDIAFIRE="$(python3 "$RELEASE_PY" --stage mediafire --zip "$ZIP")"
    state_set MEDIAFIRE "$MEDIAFIRE"
    info "mediafire link: $MEDIAFIRE"
    ;;

  patch-html)
    load_state
    # Recording the date is what stops the next poll from releasing the same pack again,
    # so refuse before the card is touched rather than patching without it.
    [[ -n "${SOURCE_LATEST:-}" ]] || die "SOURCE_LATEST is empty — refusing to patch the card"
    log "Stage: update help/songs.html"
    info "zip           : $ZIP"
    info "md5           : $MD5"
    info "mega link     : ${MEGA:-(none)}"
    info "mediafire link: ${MEDIAFIRE:-(none)}"
    python3 "$RELEASE_PY" \
      --stage html --pack "$PACK" --html "$SONGS_HTML" \
      --zip-name "$ZIP" --md5 "$MD5" \
      --mega-link "$MEGA" --mediafire-link "$MEDIAFIRE"
    printf '%s\n' "$SOURCE_LATEST" > "$REPO_ROOT/release/source-date.txt"
    info "recorded source-latest: $SOURCE_LATEST"
    ;;

  *)
    die "usage: $0 {check|download|pack|upload-b2|upload-mega|upload-mediafire|patch-html|all}"
    ;;
esac
