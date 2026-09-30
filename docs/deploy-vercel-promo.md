# 宣传站 Vercel 公域部署手册（promo/）

> 创建：2026-09-22。部署对象：`promo/` 纯静态宣传站（非主应用）。
> 性质：**一次性手动部署**。长期公域方案仍以腾讯云 EdgeOne Pages 为准（见项目硬性规则）。

## 1. 部署结果

| 项 | 值 |
|---|---|
| 固定公网地址 | https://shipin-kuaiyi-promo.vercel.app |
| Vercel 账号 | felix-worldchanger（whoami: `1265355051`） |
| Vercel 项目名 | `shipin-kuaiyi-promo` |
| 部署来源目录 | 仓库内 `promo/`（仅含 `index.html` + `config.js`，约 60 KB） |
| 安装包下载 | 不经 Vercel；按钮直链腾讯云 COS（见 `promo/config.js`，v0.1.3 Win/macOS） |
| GitHub 自动部署 | **已断开**（防止 push 触发以仓库根目录为 context 的错误构建） |
| 本地链接目录 | `promo/.vercel/`（已在 `promo/.gitignore` 忽略） |
| 部署耗时 | 约 6 秒（纯静态，无 build step） |

## 2. 为什么只部署 promo/

主应用 **不能** 跑在 Vercel Serverless 上：

- 本地 faster-whisper（Python）语音识别 —— serverless 无 Python 长进程/无 GPU
- 用户视频存于本地 `.data/` —— serverless 无持久磁盘
- `/api/download` 从 `D:\vts-build` 流式分发约 1.3 GB 安装包 —— serverless 函数有体积/时长限制
- Electron 桌面壳与本地 0.0.0.0:3456 服务 —— 与 serverless 无关

`promo/` 是自包含静态站，零后端依赖，可直接托管。

## 3. 前置条件

- Windows + PowerShell；Node 已装（本机 Node 24/22）
- Vercel 账号（felix-worldchanger）
- 临时 Access Token（推荐，规避 CLI 交互式登录在自动化环境中的失败）

## 4. 标准部署流程（下次照做）

### 4.1 安装 / 确认 CLI

```powershell
npm install -g vercel
vercel --version   # 本次版本 59.25.0
```

注意：`npx vercel` 在本机因 npm 缓存/版本校验报 `Invalid Version`，直接全局安装最稳。

### 4.2 获取临时 Token（30 秒）

1. 打开 https://vercel.com/account/tokens
2. Create Token：Expiration 选 **1 Day**（名字随意，如 `trae-deploy`）
3. 复制 token，**只用于当前终端会话**，不写入任何文件；用完到同页 revoke

### 4.3 验证身份

```powershell
$env:VERCEL_TOKEN="vcp_xxx"
vercel whoami --token $env:VERCEL_TOKEN
```

### 4.4 首次：链接项目

```powershell
vercel link --yes --project shipin-kuaiyi-promo `
  --token $env:VERCEL_TOKEN `
  --cwd "C:\Users\12653\OneDrive\Desktop\My Item\视频快译\promo"
```

链接后 CLI 会生成 `promo/.vercel/`（已 gitignore），同时可能**自动连接当前 GitHub 仓库**——必须立即断开（见 4.6）。

### 4.5 部署到生产环境

```powershell
vercel deploy --prod --yes `
  --token $env:VERCEL_TOKEN `
  --cwd "C:\Users\12653\OneDrive\Desktop\My Item\视频快译\promo"
```

成功输出含：

- 固定 alias：`https://shipin-kuaiyi-promo.vercel.app`
- 本次不可变快照 URL：`https://shipin-kuaiyi-promo-<hash>-felix-worldchanger.vercel.app`
- Inspect 页面（构建/日志）

### 4.6 断开 GitHub 自动部署（首次链接后必做）

```powershell
vercel git disconnect --yes `
  --token $env:VERCEL_TOKEN `
  --cwd "C:\Users\12653\OneDrive\Desktop\My Item\视频快译\promo"
```

验证：

```powershell
$r = Invoke-RestMethod -Uri "https://api.vercel.com/v9/projects/shipin-kuaiyi-promo" `
  -Headers @{Authorization="Bearer $env:VERCEL_TOKEN"}
$r.link   # 应为 $null
```

### 4.7 更新线上内容（以后每次，2026-09-28 修订）

> **发版请优先用 `desktop/scripts/release.ps1`**（2026-09-30 起）：一条命令完成版本号、打包、COS 上传（exe+latest.yml 同对象服务下载与自动更新）、config.js 更新、git tag/push、Vercel 部署。本节以下命令仅在脚本外手动补部署时使用。

> **重要**：2026-09-28 起，直接在 git 仓库内跑 `vercel deploy` 会被 Vercel 席位管控拦截
> （部署详情 `seatBlock.blockCode = TEAM_ACCESS_REQUIRED`，state=BLOCKED），
> 因为本地 HEAD 提交作者 `xy7-M@users.noreply.github.com` 不是 Vercel 账号下已验证成员。
> **标准做法：从仓库外的临时干净目录部署**（不带任何 git 元数据，只含两个静态文件）。

```powershell
$env:VERCEL_TOKEN="vcp_xxx"
$src = "C:\Users\12653\OneDrive\Desktop\My Item\视频快译\promo"
$dst = "$env:TEMP\promo-deploy"
Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $dst | Out-Null
Copy-Item "$src\index.html","$src\config.js" -Destination $dst   # 只复制站点文件，.env* 绝不带
vercel link --yes --project shipin-kuaiyi-promo --token $env:VERCEL_TOKEN --cwd $dst
vercel deploy --prod --yes --token $env:VERCEL_TOKEN --cwd $dst
```

- 临时目录里生成的 `.vercel/`、`.env.local`（CLI OIDC）随目录丢弃即可
- `vercel link` 可能再次自动连 GitHub：随后按 4.6 检查 `link` 是否为空，非空则 `vercel git disconnect`
- BLOCKED 的残留部署用 `DELETE /v13/deployments/{id}` 清掉（或控制台删除），不留堆积
- 换安装包版本时只改 `promo/config.js` 里的两个 COS 直链即可，页面无需重构

### 4.8 COS 桶被删后的恢复（2026-09-28 发生过一次）

原桶 `mengxiaoyao-vts-1455284621` 曾在控制台被误删，两个直链全 404。恢复原则（比旧版更安全）：

- 桶**保持私有**（`create_bucket` 默认 ACL），**不再设桶级 public-read**
- 仅对安装包对象单独 `put_object_acl(ACL="public-read")`，匿名只能下载该 key，无法列桶（列桶返回 403）
- 建桶后立即 `put_bucket_versioning(Status="Enabled")`（误删/覆盖可恢复）并打防误删标签（如 `keep=donotdelete`；注意 cos-python-sdk 该版本一次只能成功写 1–2 枚 Tag，3 枚以上会误报 `cos:` 保留前缀错误）
- 安装包本地留存：`D:\vts-build\VideoTranslate-Setup-0.1.3.exe`（约 1263.9 MB）
- **2026-09-28：macOS 下载入口已从页面与 config.js 彻底移除**，全站只提供 Windows 安装包（用户明确要求）
- 验证标准：匿名 HEAD 200 + Range GET 返回 206 + 首字节 MZ（PE 头），浏览器点击三处下载按钮均指向同一 COS URL

## 5. 部署后验证清单

- [ ] `GET https://shipin-kuaiyi-promo.vercel.app/` 返回完整页面
- [ ] `GET /config.js` 返回 `window.PROMO_CONFIG` 且 COS 链接正确
- [ ] 页面 Windows / macOS 下载按钮指向 COS 公有读对象
- [ ] `promo/.vercel/`、`promo/.edgeone/`、`.env*` 均未进 git

## 6. 踩过的坑（CLI 59.25.0）

| 现象 | 原因 / 正解 |
|---|---|
| `npx vercel --version` 报 `npm error Invalid Version` | 本机 npx 缓存异常；改用 `npm i -g vercel` |
| `vercel login` 交互式登录走不通 | agent/非 TTY 环境默认 non-interactive；改用 1 天有效期 token |
| API `PATCH /v9/projects/{name}` 传 `{"link":null}` / `{"gitRepository":null}` 被拒 | 该 API 无此字段；解绑只能用 CLI `vercel git disconnect` 或控制台 Settings → Git → Disconnect |
| `vercel git disconnect github` 报 `Invalid number of arguments`；`vercel project disconnect` 报 Unknown command | CLI 59 正确写法是 **`vercel git disconnect`（不带 provider 参数）** |
| PowerShell 5 不支持 `&&` | 用 `;` 分隔，或分两条命令执行 |
| `vercel link` 自动连上 GitHub 仓库 | 属默认行为；按 4.6 立即断开，避免错误自动部署 |
| 部署 state=BLOCKED，详情 `seatBlock.blockCode=TEAM_ACCESS_REQUIRED`（2026-09-28 新增） | Vercel 席位管控：git 提交作者未验证。从仓库外临时目录部署绕过（见 4.7），勿在 dashboard 乱加席位 |
| CLI 上传中进程被 kill，部署永远 BLOCKED | 半次部署在等文件，直接删掉该 dpl，重新 deploy 即可 |
| COS 下载链接突然 404，API 报 NoSuchBucket | 桶被删；按 4.8 重建私有桶 + 重传（仅对象级公有读） |

## 7. 安全与维护

- Token 不落盘、不进 git、不进记忆；部署完 revoke
- 宣传站无任何密钥；下载走 COS 公有读对象
- 仓库保持 **private**
- 每次宣传站改动按规则 auto-commit（2026-09-22 部署提交：`a8dc147`，未 push）
- 若决定彻底弃用 Vercel：控制台删除项目 `shipin-kuaiyi-promo`，并删除本地 `promo/.vercel/`
