# 视频快译 · 一键发布脚本
# 用法：
#   powershell -File desktop\scripts\release.ps1 -Version 0.1.4 [-VercelToken vcp_xxx] [-SkipBuild]
#
# 链路：改版本号 → 打包 → 传 COS（exe + latest.yml，同对象同时服务宣传站下载与应用内自动更新）
#       → 更新 promo/config.js → git commit+tag+push → 重新部署 Vercel 宣传站
#
# 说明：
#   - 安装包只传一份到 COS feed/ 前缀：宣传站直链与 electron-updater 共用，少传 1.3GB
#   - 不传 -VercelToken 时跳过宣传站部署，并在结尾打印手动部署命令（token 不落盘原则）
#   - -SkipBuild：跳过打包，直接复用 D:\vts-build 里已有产物（仅用于重传/补发）
#   - -Force：package.json 已是该版本时仍继续（用于上次发布中途失败后的续跑，如上传断网）
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$VercelToken = "",
  [switch]$SkipBuild,
  [switch]$Force
)
$ErrorActionPreference = "Stop"

$desktop = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $desktop
$buildOut = "D:\vts-build"
$bucket = "mengxiaoyao-vts-1455284621"
$region = "ap-beijing"
$cosBase = "https://$bucket.cos.$region.myqcloud.com"

function Step($m) { Write-Host "`n==== $m ====" -ForegroundColor Yellow }

# ── 0. 前置检查 ──
Step "0/7 前置检查"
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "版本号格式应为 x.y.z，收到：$Version" }
$pkgPath = Join-Path $desktop "package.json"
$pkgRaw = Get-Content $pkgPath -Raw
$oldVer = ([regex]::Match($pkgRaw, '"version":\s*"([^"]+)"')).Groups[1].Value
if ($oldVer -eq $Version -and -not $Force) {
  throw "package.json 已是 $Version。若上次发布中途失败要续跑，请加 -Force -SkipBuild"
}
if (git -C $root rev-parse -q --verify "refs/tags/v$Version" 2>$null) {
  if (-not $Force) { throw "tag v$Version 已存在（如需覆盖续跑请加 -Force，并手工处理旧 tag）" }
  Write-Host "tag v$Version 已存在（-Force 续跑，跳过打 tag）" -ForegroundColor DarkYellow
}
Write-Host "版本：$oldVer → $Version"

# Python：优先仓库 pyenv（已装 qcloud_cos），退回系统 python
$py = Join-Path $root "pyenv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }

# ── 1. 改版本号 ──
if ($oldVer -eq $Version) {
  Step "1/7 版本号已是 $Version（-Force 续跑，跳过）"
} else {
  Step "1/7 更新 desktop/package.json 版本号"
  $pkgRaw = $pkgRaw -replace [regex]::Escape("`"version`": `"$oldVer`""), "`"version`": `"$Version`""
  # 无 BOM 写回：PS5.1 的 -Encoding utf8 会带 BOM，npm/electron-builder 读 package.json 可能报错
  [IO.File]::WriteAllText($pkgPath, $pkgRaw, (New-Object Text.UTF8Encoding $false))
}

# ── 2. 打包（约 10-20 分钟）──
if (-not $SkipBuild) {
  Step "2/7 打包（electron-builder，压缩最耗时）"
  & (Join-Path $PSScriptRoot "build.ps1")
  if ($LASTEXITCODE -ne 0) { throw "打包失败" }
} else {
  Step "2/7 跳过打包（-SkipBuild）"
}

# ── 3. 校验产物 ──
Step "3/7 校验产物"
$setup = Get-Item (Join-Path $buildOut "VideoTranslate-Setup-$Version.exe") -ErrorAction SilentlyContinue
$blockmap = Join-Path $buildOut "VideoTranslate-Setup-$Version.exe.blockmap"
$latestYml = Join-Path $buildOut "latest.yml"
if (-not $setup) { throw "未找到 VideoTranslate-Setup-$Version.exe（版本号与产物不符？）" }
if (-not (Test-Path $blockmap)) { throw "未找到 blockmap：$blockmap" }
if (-not (Test-Path $latestYml)) { throw "未找到 latest.yml：$latestYml" }
$sizeMb = [math]::Round($setup.Length / 1MB)
if ($sizeMb -lt 50) { throw "安装包仅 ${sizeMb}MB，疑似损坏，中止" }
Write-Host "产物 OK：$($setup.Name)  ${sizeMb} MB"

# ── 4. 上传 COS（exe + blockmap + latest.yml 全部放 feed/ 前缀）──
Step "4/7 上传 COS（1.3GB，视带宽可能较久）"
$uploader = Join-Path $root "scripts\upload-to-cos.py"
& $py $uploader $setup.FullName --bucket $bucket --region $region --key "feed/$($setup.Name)"
if ($LASTEXITCODE -ne 0) { throw "上传安装包失败" }
& $py $uploader $blockmap --bucket $bucket --region $region --key "feed/$($setup.Name).blockmap"
if ($LASTEXITCODE -ne 0) { throw "上传 blockmap 失败" }
& $py $uploader $latestYml --bucket $bucket --region $region --key "feed/latest.yml"
if ($LASTEXITCODE -ne 0) { throw "上传 latest.yml 失败" }

$exeUrl = "$cosBase/feed/$($setup.Name)"
$feedUrl = "$cosBase/feed/latest.yml"

# ── 5. 匿名访问验证（模拟用户/更新器）──
Step "5/7 验证公有读"
$h1 = (Invoke-WebRequest $exeUrl -Method Head -UseBasicParsing -TimeoutSec 30).StatusCode
$h2 = (Invoke-WebRequest $feedUrl -Method Head -UseBasicParsing -TimeoutSec 30).StatusCode
if ($h1 -ne 200 -or $h2 -ne 200) { throw "公有读验证失败：exe=$h1 latest.yml=$h2" }
Write-Host "exe 直链 200 ✓   latest.yml 200 ✓"

# ── 6. 更新宣传站配置 + git ──
Step "6/7 更新 promo/config.js 并提交"
$configJs = @"
// 宣传站运行时配置：下载直链指向腾讯云 COS 公有读对象，改链接无需重新构建页面。
window.PROMO_CONFIG = {
  version: "$Version",
  // Windows（NSIS 安装包，约 1.3 GB，内置 Python/ffmpeg/Node 运行环境；Windows 10/11 64 位）
  fileName: "$($setup.Name)",
  downloadUrl: "$exeUrl"
};
"@
[IO.File]::WriteAllText((Join-Path $root "promo\config.js"), $configJs, (New-Object Text.UTF8Encoding $false))

git -C $root add desktop/package.json promo/config.js
git -C $root commit -m "release: v$Version 安装包与更新源已发布到 COS feed/"
$tagExists = git -C $root rev-parse -q --verify "refs/tags/v$Version" 2>$null
if (-not $tagExists) { git -C $root tag "v$Version" }
git -C $root push origin master --tags
if ($LASTEXITCODE -ne 0) {
  Write-Host "警告：git push 失败（cmcc 常见）。请让 agent 用 gh api（push-to-github-via-api skill）补推。" -ForegroundColor Red
}

# ── 7. 部署宣传站 ──
if ($VercelToken) {
  Step "7/7 部署宣传站到 Vercel"
  if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) { throw "未全局安装 vercel：npm i -g vercel" }
  $dst = Join-Path $env:TEMP "promo-deploy"
  Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $dst | Out-Null
  Copy-Item (Join-Path $root "promo\index.html"), (Join-Path $root "promo\config.js") -Destination $dst
  vercel link --yes --project shipin-kuaiyi-promo --token $VercelToken --cwd $dst
  vercel deploy --prod --yes --token $VercelToken --cwd $dst
  # vercel link 会自动连 GitHub，立即断开（runbook 4.6）
  vercel git disconnect --yes --token $VercelToken --cwd $dst 2>$null
  Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "宣传站已更新：https://shipin-kuaiyi-promo.vercel.app" -ForegroundColor Green
  Write-Host "记得去 https://vercel.com/account/tokens 撤销本次 token" -ForegroundColor Yellow
} else {
  Step "7/7 跳过 Vercel 部署（未传 -VercelToken）"
  Write-Host @"
手动部署宣传站（30 秒）：
  1) https://vercel.com/account/tokens 建 1 天有效期 token
  2) `$dst = "`$env:TEMP\promo-deploy"
     Remove-Item `$dst -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Path `$dst | Out-Null
     Copy-Item "promo\index.html","promo\config.js" -Destination `$dst
     vercel link --yes --project shipin-kuaiyi-promo --token <TOKEN> --cwd `$dst
     vercel deploy --prod --yes --token <TOKEN> --cwd `$dst
  3) 用完 revoke token
"@
}

Write-Host "`n✅ v$Version 发布完成" -ForegroundColor Green
Write-Host "下载直链：$exeUrl"
Write-Host "应用内更新源：$feedUrl （v$Version 起，旧版 0.1.3 的 GitHub 404 报错随重装消失）"
