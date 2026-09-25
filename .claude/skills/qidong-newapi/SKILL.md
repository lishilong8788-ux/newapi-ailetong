---
name: qidong-newapi
description: 启动、检查、停止或重启 newapi-ailetong 本地开发环境（Go 后端 3020 + Rsbuild 前端 5220）。用户说“启动 newapi”“启动新 api”“检查 newapi 状态”“停止 newapi”“重启后端/前端”“端口冲突”时使用。固定 3020/5220，绝不占用乐童的 3000/3006/5173/9001，绝不误杀常驻 node 进程。
---

# newapi-ailetong 本地开发环境

项目根：`E:\newapi-ailetong`。本文是操作规程，每条约束后面都附了原因 —— 那是实测踩出来的，别删。

完整背景与历史见 `docs/dev-startup.md`。本 skill 是可执行版；两者端口必须一致，改一处就改另一处。

## 固定端口

| 服务 | 地址 | 配置位置 |
|---|---|---|
| 后端 Go | `localhost:3020` | `PORT` 环境变量；`makefile` 的 `DEV_API_PORT` |
| 前端 Rsbuild | `localhost:5220` | `web/rsbuild.config.ts` 的 `server.port` |

编译进二进制的后端默认口仍是 3000（`common/init.go:19`），Docker 容器内也仍听 3000 —— 都没动，只有宿主侧映射改成了 `3020:3000`。**所以后端必须显式传 `PORT=3020`**，直接跑 `./new-api.exe` 会听 3000。

## 硬边界（先读这段）

- **乐童（`E:\ailetong`）的 3000 / 3006 / 5173 / 9001 不得占用。** 那边的启动清场脚本一旦检测到 5173 上有外部进程就 `exit 1`，整条任务链中止。2026-08-11 在旧目录 `E:\01ai\01newapi` 调过一次端口但只改在启动命令里，换目录后没跟着改，2026-09-25 又撞了一次 —— 所以现在写在配置文件里。
- **端口冲突时直接失败并报告，不自动递增换口。** `web/rsbuild.config.ts` 里 `strictPort: false`，换口是静默的、不报错，排查极费劲。
- **两个常驻 node 进程不要杀**：`openclaw gateway --port 18789` 和 `cc-connect run.js`，与本项目无关。`tasklist | grep node` 只给 `node.exe <pid>`，**看不到命令行**，没法直接对上名字。用端口反查确认：`netstat -ano | grep -i LISTENING | grep -E ":18789\s"`，这行的 pid 就是 openclaw，剩下那个是 cc-connect。
- **杀进程前必须先读命令行**，只有明确包含 `E:\newapi-ailetong` 才可在用户确认后按 PID 停止：

  ```bash
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'ProcessId=<pid>' | Select-Object ProcessId,Name,CommandLine | Format-List"
  ```

- **旧目录 `E:\01ai\01newapi` 已废弃**，不要在那里启动或改代码。
- 端口已被本项目自己占着 → **先问用户复用还是杀掉重起**，别直接 taskkill。

## 0. 先查是否已在跑

```bash
bash .claude/skills/qidong-newapi/scripts/check-services.sh
```

脚本输出三态：`RUNNING`（两端都通）/ `PARTIAL`（只起了一端）/ `DOWN`（都没起）。它还会单独报「乐童端口是否被本项目占用」—— 这一项为 `CONFLICT` 时立刻停下报告，别继续启动。

手工版：

```bash
netstat -ano | grep -i LISTENING | grep -E ":(3020|5220)\s"
```

- **必须 `grep LISTENING`**。`ESTABLISHED` 的出站连接（例如 `->103.212.12.45:3000`）是本机去连别人，不是本地端口被占。
- **正则里的 `\s` 必须留**。否则 `:30201`、`:52200` 之类会误匹配。

## 1. 前置检查（缺任何一项，后面全废）

```bash
export PATH="/c/Program Files/Go/bin:$PATH"          # Go 1.26.5 不在 PATH
[ -d web/node_modules ] || (cd web && bun install)    # 约 3 分钟 / 1191 包
[ -f web/dist/index.html ] || (mkdir -p web/dist && printf '<!doctype html>' > web/dist/index.html)
```

`web/dist` 那行是关键：`main.go:42` 有 `//go:embed web/dist`，目录不存在时 `go build` 第一秒就失败。dev 模式前端跑在 5220，这个 embed 产物根本不会被访问，占位文件足够。**只有要让后端单独提供 UI 时**，才需要真跑 `bun run build` 覆盖它。

但 `-f` 判断只保证 `go build` 不炸，**不保证 dist 是占位还是真构建**，也不保证二进制里 embed 的是哪一版。想知道当前二进制 embed 了什么，直接问后端根路径（不经 5220 代理）：

```bash
curl -s http://localhost:3020/ | head -c 120
# 占位 → <!doctype html><title>dev placeholder</title>（45 bytes）
# 真构建 → 完整 HTML，带 /static/ 里的 hash 资源引用
```

dev 下拿到占位符是正常的、不用修。

## 2. 编译后端

```bash
go build -o bin/new-api.exe .
```

约 2 分钟，占位 dist 下产物约 84MB（真实 dist 会到 141MB 左右）。

已经有 `bin/new-api.exe` 时，才需要比源码时间戳决定是否重编：

```bash
find . -name '*.go' -newer bin/new-api.exe -not -path './web/*' | head
```

`.gitignore` 排除了 `*.exe` 和 `*.db`，**刚克隆的 `bin/` 里没有任何二进制**。`find -newer` 返回空是**参照物不存在**，不是命令没生效 —— 别换个文件当参照再跑一遍。

## 3. 启动后端

```bash
cd bin
mkdir -p logs
SQLITE_PATH="E:/newapi-ailetong/bin/one-api.db?_busy_timeout=30000" PORT=3020 \
  nohup ./new-api.exe > logs/dev-backend.log 2>&1 &
```

**为什么显式传 `SQLITE_PATH`**：`common/database.go:44` 里默认是相对路径 `one-api.db`，从项目根启动就会在根目录另建一个空库、弹初始化向导。真实数据在 `bin/one-api.db`。`common/init.go:70` 支持这个环境变量，用绝对路径比依赖 cwd 稳，日志里也能直接看到连的哪个库。

就绪判定 —— **轮询，不要 sleep 固定秒数**：

```bash
for i in $(seq 1 40); do
  netstat -ano | grep -i LISTENING | grep -E ":3020\s" && break
  sleep 2
done
```

空库约 1 秒即 ready。（网上常说的「AutoMigrate 建索引慢 15s+」在空库上不成立，真正需要耐心的是前端。）

## 4. 启动前端

```bash
cd web
VITE_REACT_APP_SERVER_URL=http://localhost:3020 \
  nohup bun run dev > ../bin/logs/dev-frontend.log 2>&1 &
```

**端口不用传** —— `web/rsbuild.config.ts` 里写死了 `server.port = 5220`。要临时换口才加 `--port <n>`（CLI 优先于配置）。**反过来说：如果发现前端起在 5173，先查启动命令里有没有残留的 `--port 5173`**，CLI 会盖掉配置。

变量名确实是这个 Vite 风格的名字（`web/rsbuild.config.ts:14` 读它），项目用 Rsbuild 并不矛盾，照传。不传会兜底到 `http://localhost:3020`（同文件 `:16`）—— 兜底值与真实后端口一致，所以漏传也能跑通，**别把「跑通了」当成变量传对了**。

**就绪判定不能用 netstat** —— 端口 10 秒就进 LISTENING 了，但首次构建还要几十秒（实测 `built in 25.6s`，冷缓存更久），这中间打 `/` 拿不到 200。必须轮询 HTTP：

```bash
for i in $(seq 1 40); do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:5220/)
  [ "$C" = "200" ] && echo "frontend ready" && break
  sleep 3
done
```

或等日志里出现 `built in`。

## 5. 验证（全部走 5220，顺带验代理）

```bash
bash .claude/skills/qidong-newapi/scripts/check-services.sh
```

脚本已覆盖下表全部三项。手工核对时：

| 检查 | 期望 |
|---|---|
| `GET /` | 200 |
| `GET /api/status` | 200，含 `setup` 字段（`controller/misc.go:122`，**没有** `initialized` 字段） |
| `GET /api/pricing` | 200 |

**`setup` 字段怎么判断** —— `bin/one-api.db` 已在 2026-08-25 前走完初始化向导，所以：

- **正常应为 `true`**。
- **如果是 `false`，说明连错库了**（大概率漏传 `SQLITE_PATH`，在别处新建了空库）。这时停下来报用户，**别继续，更别去点向导页** —— 那会在错误的库里建管理员。
- 仅当刻意换新库时 `false` 才是预期值。

`system_name` 和 `/api/pricing` 的模型数**按实际值报，不要预设**。模型数随渠道增减而变，别拿某次快照当断言。真正有意义的信号是「pricing 接近空（约 238 bytes / 0 模型）」与 `setup: true` 同时出现 —— 那是矛盾的，按连错库处理。

最后给出两个 PID —— **从 `netstat -ano` 的 LISTENING 行末尾读**：

```bash
netstat -ano | grep -i LISTENING | grep -E ":(3020|5220)\s"
```

**不要用 `$!`**。Git Bash 里 `nohup` 启动 Windows 原生 exe，`$!` 返回的是 bash 的 job id（例如 1382），不是 Windows 进程 pid（例如 16372）。拿 job id 去 `taskkill` 会杀错进程或根本杀不掉。

## 6. 停止与重启

```bash
# 先从 netstat 拿真实 pid
netstat -ano | grep -i LISTENING | grep -E ":(3020|5220)\s"
# 再读命令行确认是本项目的（见「硬边界」），确认后才杀
taskkill //PID <pid> //F      # Git Bash 里选项要用双斜杠
```

前端是 `bun -> rsbuild.exe -> node` 三级链，**杀父进程要带 `//T`** 才能带走监听端口的那个 node：

```bash
taskkill //PID <bun-pid> //T //F
```

重启时等 3020/5220 的 LISTENING 全部消失，再按第 3、4 节重来。

## 诊断规则

- **前端 502 / `/api` 全挂**：查 `web/rsbuild.config.ts:16` 的兜底值和启动时传的 `VITE_REACT_APP_SERVER_URL` 是否都指向 3020。后端改口必须同时改这两处。
- **前端起在 3000**：`server.port` 被删了，退回 Rsbuild 默认口。撞乐童 mobile，立刻改回 5220。
- **前端起在 5173**：启动命令里有残留 `--port 5173`。撞乐童 website，会让那边的清场脚本 `exit 1`。
- **前端起在 5221 之类**：5220 被占且 `strictPort: false` 静默换口了。查是谁占着 5220，不要将就。
- **后端起在 3000**：漏传 `PORT=3020`。
- **`setup: false`**：连错库，见第 5 节。
- **字段存不进去 / 新列没生效**：先查 `bin/new-api.exe` 的编译时间。旧二进制会静默丢弃未知 JSON key，症状像前端 bug，其实是没重编。
- **passkey 登录失败**：`server_address` 和 `passkey_rp_id` 停留在 `localhost:3000`（`setting/system_setting/system_setting_old.go:3`），是后端默认值，不随 `PORT` 变。不影响其他 dev 功能，要用 passkey 得去系统设置里改这两项。**不是 bug，不用查。**

## 本机环境速查

| 项 | 值 / 位置 |
|---|---|
| Go | `C:\Program Files\Go`（1.26.5），**不在 PATH** |
| Bun | 1.3.13；Node v26.1.0 |
| make / docker / sqlite3 / jq | **都没装**（所以 `makefile` 里的目标在本机跑不了，按第 3、4 节手动起） |
| 查 SQLite 库 | 用 `py -c "import sqlite3..."`；`python` 直接调用会 exit 49 且无输出，要用 `py` 启动器 |
| `py` 的路径 | **必须传 Windows 路径**。`py` 是原生解释器，看不见 Git Bash 的 `/tmp`（那是 `AppData\Local\Temp`）。落盘到 `E:/tmp/` 再读 |
| 后端日志 | `bin/logs/dev-backend.log` |
| 前端日志 | `bin/logs/dev-frontend.log` |

后端日志里的 `Warning: Refresh cookie is not secure` 是 dev 环境正常提示，生产才需要设 `SESSION_COOKIE_SECURE=true`。
