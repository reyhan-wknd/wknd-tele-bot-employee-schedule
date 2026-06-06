#!/bin/bash

PROJECT=/home/wknd/github/wknd-tele-bot-employee-schedule/backend
CLOUDFLARED=/home/wknd/cloudflared
CLOUDFLARED_CONFIG=/home/wknd/.cloudflared/config-wknd.yml
CLOUDFLARED_LOG=/home/wknd/cloudflared-wknd.log

backend_pid() {
  pgrep -f "src/index.ts" | head -1
}

tunnel_pid() {
  pgrep -f "cloudflared tunnel --config $CLOUDFLARED_CONFIG" | head -1
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

  pid=$(tunnel_pid)
  if [ -n "$pid" ]; then
    kill "$pid"
    echo "[tunnel]  stopped (PID $pid)"
  else
    echo "[tunnel]  not running"
  fi
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

  pid=$(tunnel_pid)
  if [ -n "$pid" ]; then
    echo "[tunnel]  already running (PID $pid)"
  else
    nohup "$CLOUDFLARED" tunnel --config "$CLOUDFLARED_CONFIG" run >> "$CLOUDFLARED_LOG" 2>&1 &
    sleep 3
    pid=$(tunnel_pid)
    [ -n "$pid" ] && echo "[tunnel]  started (PID $pid)" || echo "[tunnel]  FAILED to start — check $CLOUDFLARED_LOG"
  fi
}

status() {
  local pid

  pid=$(backend_pid)
  [ -n "$pid" ] && echo "[backend] running (PID $pid)" || echo "[backend] stopped"

  pid=$(tunnel_pid)
  [ -n "$pid" ] && echo "[tunnel]  running (PID $pid)" || echo "[tunnel]  stopped"
}

case "$1" in
  start)  start_all ;;
  stop)   stop_all ;;
  status) status ;;
  *)
    start_all
    ;;
esac
