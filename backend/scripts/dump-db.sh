#!/usr/bin/env bash
# Dump database tele_sso untuk dipindahkan antar mesin.
#
# Data tabel `users` SENGAJA tidak ikut karena berisi access_token dan refresh_token
# Google. Struktur tabelnya tetap ikut, jadi restore tetap utuh — tiap orang cukup
# /login sekali di mesin baru, dan absensi lama tetap nyambung lewat telegram_id.
#
# Pakai: backend/scripts/dump-db.sh [folder-tujuan]
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3309}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-password}"
DB_NAME="${DB_NAME:-tele_sso}"
CONTAINER="${CONTAINER:-tele-sso-mysql}"

OUT_DIR="${1:-${OUT_DIR:-$HOME/backups/wknd-tele-bot}}"
OUT="$OUT_DIR/${DB_NAME}-$(date +%Y%m%d-%H%M).sql"

# Jalankan mysqldump dari host bila tersedia, kalau tidak lewat container MySQL.
dump() {
  if command -v mysqldump >/dev/null 2>&1; then
    MYSQL_PWD="$DB_PASS" mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" --single-transaction "$@"
  else
    docker exec -e MYSQL_PWD="$DB_PASS" "$CONTAINER" mysqldump -u "$DB_USER" --single-transaction "$@"
  fi
}

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

{
  dump --no-data "$DB_NAME" users              # struktur users saja, tanpa baris token
  dump --ignore-table="$DB_NAME.users" "$DB_NAME"  # tabel lain lengkap dengan datanya
} > "$OUT"

# Jaring pengaman: kalau ada pola token yang lolos, buang hasilnya.
if grep -qE "ya29\.|1//0" "$OUT"; then
  rm -f "$OUT"
  echo "GAGAL: pola token terdeteksi di hasil dump — dump dibatalkan dan file dihapus." >&2
  exit 1
fi

chmod 600 "$OUT"
echo "Dump selesai: $OUT"
echo "Tabel users hanya berisi struktur — tiap user perlu /login ulang sekali di mesin baru."
