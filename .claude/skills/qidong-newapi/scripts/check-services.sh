#!/usr/bin/env bash
# newapi-ailetong 本地开发环境状态检查
#
# 用法：bash .claude/skills/qidong-newapi/scripts/check-services.sh [--wait <秒>]
#
# 退出码：0 = 两端就绪；1 = 未就绪/部分就绪；2 = 端口冲突（占了乐童的口）
#
# 设计约束（别改坏）：
# - 只读，不杀任何进程。清理进程必须由人确认，见 SKILL.md「硬边界」。
# - 端口判定必须 grep LISTENING：ESTABLISHED 是本机去连别人，不是本地端口被占。
# - 端口正则必须带 \s 收尾：否则 :30201、:52200 之类会误匹配。
# - 前端就绪只认 HTTP 200：端口 10 秒就 LISTENING，但首次构建要几十秒。
# - JSON 用 py 解析（本机没有 jq），落盘必须在 E:/tmp：py 是原生解释器，看不见
#   Git Bash 的 /tmp。

set -uo pipefail

BACKEND_PORT=3020
FRONTEND_PORT=5220
# 乐童（E:\ailetong）固定占用，本项目绝不能碰
AILETONG_PORTS="3000 3006 5173 9001"
TMP_WIN_DIR="E:/tmp"

WAIT_SECONDS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --wait) WAIT_SECONDS="${2:-0}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

listening_pid() {
  # $1 = port。输出监听该端口的 pid（可能多行，IPv4/IPv6 各一条），没有则空。
  # 只匹配「冒号+端口+空白」：netstat 的本地地址形如 0.0.0.0:3020 或 [::]:3020。
  # 收尾的 [[:space:]] 必须留，否则 :30201、:52200 之类会误匹配。
  netstat -ano \
    | grep -i 'LISTENING' \
    | grep -E ":$1[[:space:]]" \
    | awk '{print $NF}' \
    | sort -u
}

http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$1" 2>/dev/null || echo 000
}

process_cmdline() {
  # $1 = pid。拿命令行用于确认是不是本项目的进程；PowerShell 不可用时返回空。
  powershell -NoProfile -Command \
    "(Get-CimInstance Win32_Process -Filter 'ProcessId=$1').CommandLine" 2>/dev/null \
    | tr -d '\r' | head -1
}

echo "=== newapi-ailetong 开发环境检查 ==="
echo

# ---- 1. 乐童端口占用检查（最先做：冲突就没必要继续）----
conflict=0
for p in $AILETONG_PORTS; do
  for pid in $(listening_pid "$p"); do
    cmd="$(process_cmdline "$pid")"
    case "$cmd" in
      *newapi-ailetong*|*01newapi*)
        echo "  CONFLICT  :$p  pid=$pid  <- 本项目占了乐童的口"
        echo "            $cmd"
        conflict=1
        ;;
      *)
        # 别的项目占着是正常的（乐童自己就该占），只记录不报错
        echo "  (乐童口)  :$p  pid=$pid  非本项目，正常"
        ;;
    esac
  done
done
[ "$conflict" = "0" ] && echo "  OK        乐童端口 3000/3006/5173/9001 未被本项目占用"
echo

# ---- 2. 两端就绪判定（可选轮询）----
backend_ok=0
frontend_ok=0
deadline=$(( $(date +%s) + WAIT_SECONDS ))

probe() {
  # $1=端口 $2=路径。没进程监听就别打 HTTP —— curl 会干等满 8 秒超时，
  # DOWN 的场景下那是纯浪费。
  if [ -z "$(listening_pid "$1")" ]; then
    echo 000
  else
    http_code "http://localhost:$1$2"
  fi
}

while :; do
  backend_code=$(probe "$BACKEND_PORT" "/api/status")
  [ "$backend_code" = "200" ] && backend_ok=1 || backend_ok=0

  # 前端走 / 而不是 /api/*：/api 会被代理到后端，验不出前端自己是否构建完
  frontend_code=$(probe "$FRONTEND_PORT" "/")
  [ "$frontend_code" = "200" ] && frontend_ok=1 || frontend_ok=0

  [ "$backend_ok" = "1" ] && [ "$frontend_ok" = "1" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && break
  sleep 3
done

fmt_port() {
  # $1=名字 $2=端口 $3=ok标志 $4=HTTP码
  local pids
  pids=$(listening_pid "$2" | tr '\n' ',' | sed 's/,$//')
  if [ "$3" = "1" ]; then
    echo "  READY     $1  :$2  HTTP $4  pid=${pids:-?}"
  elif [ -n "$pids" ]; then
    echo "  LISTEN    $1  :$2  HTTP $4  pid=$pids  <- 端口在听但没返回 200（前端可能还在首次构建）"
  else
    echo "  DOWN      $1  :$2  没有进程监听"
  fi
}

fmt_port "后端" "$BACKEND_PORT" "$backend_ok" "$backend_code"
fmt_port "前端" "$FRONTEND_PORT" "$frontend_ok" "$frontend_code"
echo

# ---- 3. 走前端代理读 /api/status，顺带验代理链路 ----
if [ "$frontend_ok" = "1" ]; then
  mkdir -p "$TMP_WIN_DIR" 2>/dev/null
  status_file="$TMP_WIN_DIR/newapi-status.json"
  proxy_code=$(curl -s -o "$status_file" -w '%{http_code}' --max-time 8 \
    "http://localhost:$FRONTEND_PORT/api/status")
  if [ "$proxy_code" = "200" ]; then
    echo "  OK        代理 :$FRONTEND_PORT/api -> :$BACKEND_PORT 通"
    py -c "
import json, sys
try:
    d = json.load(open(r'$status_file', encoding='utf-8'))['data']
except Exception as e:
    print('  WARN      /api/status 解析失败:', e); sys.exit(0)
setup = d.get('setup')
print('  setup        =', repr(setup), '' if setup is True else '  <- 不是 True：可能连错库，见 SKILL.md 第 5 节')
for k in ('system_name', 'version', 'server_address'):
    print('  %-12s =' % k, repr(d.get(k)))
" 2>/dev/null || echo "  WARN      py 不可用，跳过 /api/status 字段解析"
  else
    echo "  FAIL      代理 :$FRONTEND_PORT/api -> :$BACKEND_PORT 返回 $proxy_code"
    echo "            查 web/rsbuild.config.ts:16 的兜底值与启动时的 VITE_REACT_APP_SERVER_URL"
  fi

  pricing_code=$(http_code "http://localhost:$FRONTEND_PORT/api/pricing")
  echo "  /api/pricing = HTTP $pricing_code"
  echo
fi

# ---- 4. 汇总 ----
if [ "$conflict" = "1" ]; then
  echo "结论：CONFLICT —— 本项目占了乐童的端口，会让那边的清场脚本 exit 1。先停下报告。"
  exit 2
elif [ "$backend_ok" = "1" ] && [ "$frontend_ok" = "1" ]; then
  echo "结论：RUNNING —— 后端 :$BACKEND_PORT / 前端 :$FRONTEND_PORT 均就绪。"
  exit 0
elif [ "$backend_ok" = "1" ] || [ "$frontend_ok" = "1" ]; then
  echo "结论：PARTIAL —— 只有一端就绪。前端刚起的话加 --wait 60 再看（首次构建几十秒）。"
  exit 1
else
  echo "结论：DOWN —— 两端都没起。按 SKILL.md 第 1~4 节启动。"
  exit 1
fi
