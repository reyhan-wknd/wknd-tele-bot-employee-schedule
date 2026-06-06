#!/bin/bash

BOT_SERVICE=wknd-tele-bot.service
TUNNEL_SERVICE=cloudflared-wknd.service

stop_all() {
  systemctl --user stop "$BOT_SERVICE"
  echo "[backend] stopped"

  systemctl --user stop "$TUNNEL_SERVICE"
  echo "[tunnel]  stopped"
}

start_all() {
  systemctl --user start "$BOT_SERVICE"
  echo "[backend] started (systemd)"

  systemctl --user start "$TUNNEL_SERVICE"
  echo "[tunnel]  started (systemd)"
}

status() {
  systemctl --user is-active "$BOT_SERVICE" | grep -q "^active" \
    && echo "[backend] running (systemd)" \
    || echo "[backend] stopped"

  systemctl --user is-active "$TUNNEL_SERVICE" | grep -q "^active" \
    && echo "[tunnel]  running (systemd)" \
    || echo "[tunnel]  stopped"
}

case "$1" in
  start)  start_all ;;
  stop)   stop_all ;;
  status) status ;;
  *)
    start_all
    ;;
esac
