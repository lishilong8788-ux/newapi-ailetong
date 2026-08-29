# 本地开发环境启动手册

> 用法：对话里 `@docs/dev-startup.md` 然后说「启动」即可。
> 本文是给 AI 执行的操作规程，每条约束后面都附了原因，别删原因 —— 那是踩过的坑。

**端口约定**：后端 `3001`，前端 `5173`。
**为什么后端不用 3000**：New API 后端自己的默认口就是 3000，前端 proxy 的兜底值也是
`http://localhost:3000`（`web/rsbuild.config.ts:16`）。用 3001 能让「漏传
`VITE_REACT_APP_SERVER_URL`」立刻暴露成连接失败，而不是静默连上一个错的后端。

---

## 0. 先查是否已在跑

```bash
netstat -ano | grep -i LISTENING | grep -E ":(3001|5173)\s"
tasklist | grep -iE "new-api|bun|node"
```

三条硬性约束：

- **必须 `grep LISTENING`**。`ESTABLISHED` 的出站连接（例如 `->103.212.12.45:3000`）
  是本机去连别人，不是本地端口被占，别误判。
- **正则里的 `\s` 必须留**。否则 `:30010`、`:51730` 之类会误匹配。
- **两个常驻 node 进程不要杀**：`openclaw gateway --port 18789` 和 `cc-connect run.js`，
  与本项目无关。注意 `tasklist | grep node` 只给得出 `node.exe <pid>`，**看不到命令行**，
  没法直接对上这两个名字。要确认哪个是 gateway，用端口反查：

  ```bash
  netstat -ano | grep -i LISTENING | grep -E ":18789\s"   # 这行的 pid 就是 openclaw
  ```

  剩下那个 node 即 cc-connect。本项目的前端进程只会出现在 5173 上，不在这两个之列。

端口已被本项目自己占着 → **先问我复用还是杀掉重起**，别直接 taskkill。

---

## 1. 前置检查（缺任何一项，后面全废）

```bash
export PATH="/c/Program Files/Go/bin:$PATH"          # Go 1.26.5 不在 PATH
[ -d web/node_modules ] || (cd web && bun install)    # 约 3 分钟 / 1191 包
[ -f web/dist/index.html ] || (mkdir -p web/dist && printf '<!doctype html>' > web/dist/index.html)
```

`web/dist` 那行是关键：`main.go:42` 有 `//go:embed web/dist`，目录不存在时
`go build` 第一秒就失败。dev 模式前端跑在 5173，这个 embed 产物根本不会被访问，
所以占位文件足够。**只有要让后端单独提供 UI 时**，才需要真跑 `bun run build` 覆盖它。

但这个 `-f` 判断只保证 `go build` 不炸，**不保证 dist 是占位还是真构建**，也不保证
二进制里 embed 的是哪一版。2026-08-25 的实际状态就是：`web/dist/` 已有真实产物
（含 `static/`），而 `bin/new-api.exe` 是更早编的，里面 embed 的仍是 45 字节占位符。
想知道当前二进制 embed 了什么，直接问后端根路径（不经 5173 代理）：

```bash
curl -s http://localhost:3001/ | head -c 120
# 占位 → <!doctype html><title>dev placeholder</title>（45 bytes）
# 真构建 → 完整 HTML，带 /static/ 里的 hash 资源引用
```

dev 下拿到占位符是正常的、不用修。只有要让 3001 单独提供 UI 时，才需要
`cd web && bun run build` 后重编后端 —— 注意第 2 节的时间戳检查只看 `*.go`，
**dist 变新不会触发重编**，这一步得手动判断。

---

## 2. 编译后端

```bash
go build -o bin/new-api.exe .
```

约 2 分钟，占位 dist 下产物约 84MB（真实 dist 会到 141MB 左右）。

`.gitignore` 第 6、7 行排除了 `*.exe` 和 `*.db`，**所以刚克隆的 `bin/` 里没有任何二进制**。
由此：

- 不存在 `new-api.exe` / `new-api.new.exe` / `new-api` 之间的新旧比较，那是别的机器的情况。
- `find -newer` 返回空是**参照物不存在**，不是命令没生效 —— 别换个文件当参照再跑一遍。

已经有 `bin/new-api.exe` 时，才需要比源码时间戳决定是否重编：

```bash
find . -name '*.go' -newer bin/new-api.exe -not -path './web/*' | head
```

---

## 3. 启动后端

```bash
cd bin
mkdir -p logs
SQLITE_PATH="E:/newapi-ailetong/bin/one-api.db?_busy_timeout=30000" PORT=3001 \
  nohup ./new-api.exe > logs/dev-backend.log 2>&1 &
```

**为什么显式传 `SQLITE_PATH`**：`common/database.go:44` 里默认是相对路径 `one-api.db`，
从项目根启动就会在根目录另建一个空库、弹初始化向导。真实数据在 `bin/one-api.db`。
`common/init.go:70` 支持这个环境变量，用绝对路径比依赖 cwd 稳，日志里也能直接看到连的哪个库。

就绪判定 —— **轮询，不要 sleep 固定秒数**：

```bash
for i in $(seq 1 40); do
  netstat -ano | grep -i LISTENING | grep -E ":3001\s" && break
  sleep 2
done
```

空库约 1 秒即 ready。（网上常说的「AutoMigrate 建索引慢 15s+」在空库上不成立，
真正需要耐心的是下一步的前端。）

---

## 4. 启动前端

```bash
cd web
VITE_REACT_APP_SERVER_URL=http://localhost:3001 \
  nohup bun run dev --port 5173 > ../bin/logs/dev-frontend.log 2>&1 &
```

变量名确实是这个 Vite 风格的名字（`web/rsbuild.config.ts:14` 读它），项目用 Rsbuild
并不矛盾，照传。不传会兜底到 `http://localhost:3000`（同文件 `:16`），静默连错后端。

**就绪判定不能用 netstat** —— 端口 10 秒就进 LISTENING 了，但首次构建还要几十秒
（2026-08-25 实测 `built in 25.6s`，冷缓存会更久），这中间打 `/` 拿不到 200。
必须轮询 HTTP：

```bash
for i in $(seq 1 40); do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:5173/)
  [ "$C" = "200" ] && echo "frontend ready" && break
  sleep 3
done
```

或等日志里出现 `built in`。

---

## 5. 验证（全部走 5173，顺带验代理）

| 检查 | 期望 |
|---|---|
| `GET /` | 200 |
| `GET /api/status` | 200，含 `setup` 字段（`controller/misc.go:122`，**没有** `initialized` 字段） |
| `GET /api/pricing` | 200 |

`/api/status` 的 JSON 有几十个字段，`head -c` 截出来大概率看不到 `setup`。直接取：

```bash
curl -s --max-time 8 http://localhost:5173/api/status > E:/tmp/status.json
py -c "
import json
d=json.load(open('E:/tmp/status.json'))['data']
for k in ['setup','system_name','version','server_address']: print(k,'=',repr(d.get(k)))
"
```

落盘路径**必须是 `E:/tmp/`**，理由见文末速查表里 `py` 那两行。

`setup` 字段怎么判断 —— **`bin/one-api.db` 已在 2026-08-25 前走完初始化向导**，所以：

- **正常应为 `true`**。
- **如果是 `false`，说明连错库了**（大概率漏传 `SQLITE_PATH`，在别处新建了空库，
  于是看到的是没走过向导的新库）。这时停下来报我，别继续，更别去点向导页 —— 那会
  在错误的库里建管理员。
- 仅当刻意换新库时 `false` 才是预期值。

`system_name` 和 `/api/pricing` 的模型数**按实际值报，不要预设**。2026-08-25 实测
`system_name: "New API"`、version `v0.0.0`、pricing 200 / 200720 bytes / 640 个
`model_name` —— 这只是当时的快照，渠道增减就会变，别拿 640 当断言。真正有意义的信号
是「pricing 接近空（约 238 bytes / 0 模型）」与 `setup: true` 同时出现，那是矛盾的，
按上面连错库处理。

最后给出两个 PID —— **从 `netstat -ano` 的 LISTENING 行末尾读**：

```bash
netstat -ano | grep -i LISTENING | grep -E ":(3001|5173)\s"
```

**不要用 `$!`**。Git Bash 里 `nohup` 启动 Windows 原生 exe，`$!` 返回的是 bash 的
job id（例如 1382），不是 Windows 进程 pid（例如 16372）。拿 job id 去 `taskkill`
会杀错进程或根本杀不掉。

---

## 6. 停止

```bash
# 先从 netstat 拿真实 pid，再杀
netstat -ano | grep -i LISTENING | grep -E ":(3001|5173)\s"
taskkill //PID <pid> //F      # Git Bash 里选项要用双斜杠
```

---

## 已知项 —— 不用当 bug 查

- **`server_address` 和 `passkey_rp_id` 停留在 `localhost:3000`**。这是后端默认值，
  不随 `PORT` 变。不影响 dev 使用，但 passkey 登录在 5173 上会因 rp_id 不匹配而失败。
  要用 passkey 得去系统设置里改这两项。
- **Node 是 v26.1.0**，不会出现「Rspack 需要 Node 22.12+」的警告。
- 后端日志里的 `Warning: Refresh cookie is not secure` 是 dev 环境正常提示，
  生产才需要设 `SESSION_COOKIE_SECURE=true`。

## 本机环境速查

| 项 | 值 / 位置 |
|---|---|
| Go | `C:\Program Files\Go`（1.26.5），**不在 PATH** |
| Bun | 1.3.13 |
| Node | v26.1.0 |
| docker / sqlite3 | **都没装** |
| 查 SQLite 库 | 用 `py -c "import sqlite3..."`；`python` 直接调用会 exit 49 且无输出，要用 `py` 启动器 |
| `py` 的路径 | **必须传 Windows 路径**。`py` 是原生解释器，看不见 Git Bash 的 `/tmp`（那是 `AppData\Local\Temp`）。`curl > /tmp/x.json` 再 `py` 读会 FileNotFoundError —— 落盘到 `E:/tmp/` 再读 |
| GitHub 访问 | 直连被掐断（`schannel: server closed abruptly`）。本机 7897 有代理：`git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 <cmd>` |
| curl 打本地 | 环境里没有 proxy 变量，无需 `--noproxy`；哪天设了再加 |

## 与 ailetong 项目的关系

无端口冲突。`ailetong/server` 用 9001，`ailetong/admin` 用 3006，都与本项目无交集。
`ailetong/mobile` 曾用 3000（`vite.config.js:84`），但该端已停用；即便如此本项目后端
仍保持 3001，理由见开头。
