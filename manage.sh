#!/bin/bash

PROJECT=/home/wknd/github/wknd-tele-bot-employee-schedule/backend
TUNNEL_SERVICE=cloudflared-wknd.service

backend_pid() {
  pgrep -f "src/index.ts" | head -1
}

stop_all() {
  local pid

  pid=$(backend_pid)
  if [ -n "$pid" ]; then
    kill "$pid"
    echo "[backend] stopped (PID $pid)"
  else
    echo "[backend] not running"
  fi

  systemctl --user stop "$TUNNEL_SERVICE"
  echo "[tunnel]  stopped"
}

start_all() {
  local pid

  pid=$(backend_pid)
  if [ -n "$pid" ]; then
    echo "[backend] already running (PID $pid)"
  else
    cd "$PROJECT" && nohup npx tsx src/index.ts >> nohup.out 2>&1 &
    sleep 2
    pid=$(backend_pid)
    [ -n "$pid" ] && echo "[backend] started (PID $pid)" || echo "[backend] FAILED to start — check $PROJECT/nohup.out"
  fi

  systemctl --user start "$TUNNEL_SERVICE"
  echo "[tunnel]  started (managed by systemd)"
}

status() {
  local pid

  pid=$(backend_pid)
  [ -n "$pid" ] && echo "[backend] running (PID $pid)" || echo "[backend] stopped"

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
