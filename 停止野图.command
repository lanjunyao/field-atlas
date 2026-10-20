#!/bin/bash
DATA_DIR="$HOME/Library/Application Support/FieldAtlas"
if [ -f "$DATA_DIR/supervisor.pid" ]; then
 SUPERVISOR_PID="$(cat "$DATA_DIR/supervisor.pid")"
 if [[ "$SUPERVISOR_PID" =~ ^[0-9]+$ ]]; then
  COMMAND="$(ps -p "$SUPERVISOR_PID" -o command= 2>/dev/null)"
  if [[ "$COMMAND" == *node*supervisor.mjs* ]]; then
   kill -TERM "$SUPERVISOR_PID"
   echo '正在停止野图后台服务与自动恢复进程。'
   exit 0
  fi
 fi
fi
if [ -f "$DATA_DIR/server.pid" ]; then
 PID="$(cat "$DATA_DIR/server.pid")"
 if [[ "$PID" =~ ^[0-9]+$ ]]; then
  CMD="$(ps -p "$PID" -o command= 2>/dev/null)"
  LISTENER="$(/usr/sbin/lsof -tiTCP:9847 -sTCP:LISTEN 2>/dev/null)"
  if [[ "$CMD" == *node*server.mjs* && "$LISTENER" == "$PID" ]]; then
   kill -TERM "$PID" && rm -f "$DATA_DIR/server.pid"
   echo '野图本地服务已停止。'
  else echo '启动器对应的本地服务已不在运行。'; fi
 fi
else echo '未找到启动器创建的服务进程。'; fi
