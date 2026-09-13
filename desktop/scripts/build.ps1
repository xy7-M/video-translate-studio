# 视频快译 · 一键打包脚本
# 用法：双击 一键打包.bat，或 powershell -File scripts\build.ps1
$ErrorActionPreference = "Stop"
$desktop = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $desktop

# ── 国内镜像（electron 二进制 / nsis 工具链 / npm 包）──
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"

function Step($m) { Write-Host "`n==== $m ====" -ForegroundColor Yellow }

# 0. 端口 3000 上若有 dev server，先提醒（同时跑会损坏 .next）
$p3000 = (netstat -ano | Select-String ":3000\s.*LISTENING" | Select-Object -First 1)
if ($p3000) {
  throw "检测到 3000 端口有服务在跑（dev server）。请先关闭它再打包，避免 .next 缓存损坏。"
}

# 1. 便携 Python + ffmpeg 运行时
Step "1/5 准备便携运行时（Python + ffmpeg）"
& (Join-Path $PSScriptRoot "prepare-runtime.ps1")

# 2. 图标（pyenv 里装 Pillow）
Step "2/5 生成应用图标"
$icon = Join-Path $desktop "build\icon.ico"
if (-not (Test-Path $icon)) {
  $venvPy = Join-Path $root "pyenv\Scripts\python.exe"
  & $venvPy -c "import PIL" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "安装 Pillow（仅打包用）…"
    & $venvPy -m pip install pillow -i https://pypi.tuna.tsinghua.edu.cn/simple --quiet
  }
  & $venvPy (Join-Path $PSScriptRoot "make-icon.py") $icon
}

# 3. Next standalone 产物
Step "3/5 构建 Next.js standalone"
& (Join-Path $PSScriptRoot "stage-web.ps1")

# 4. Electron 依赖 + 打包
Step "4/5 electron-builder 打包（首次需下载 electron，约几分钟）"
Push-Location $desktop
try {
  if (-not (Test-Path (Join-Path $desktop "node_modules"))) {
    & npm.cmd install --registry=https://registry.npmmirror.com
    if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }
  }
  $ver = (Get-Content (Join-Path $desktop "package.json") -Raw | ConvertFrom-Json).version
  $outDir = Join-Path $desktop "dist\$ver"
  if (Test-Path $outDir) {
    Write-Host "清理旧产物 $outDir"
    Remove-Item $outDir -Recurse -Force
  }
  & (Join-Path $desktop "node_modules\.bin\electron-builder.cmd") --win nsis --x64 --publish never
  if ($LASTEXITCODE -ne 0) { throw "electron-builder 失败" }

  # 5. 交付：D 盘 + 更新源暂存
  Step "5/5 交付安装包"
  $deliver = "D:\Item AI\Claude Code\视频快译安装包"
  New-Item -ItemType Directory -Force -Path $deliver | Out-Null
  Get-ChildItem $outDir -File | Where-Object { $_.Extension -in ".exe", ".yml", ".blockmap" } |
    ForEach-Object { Copy-Item $_.FullName $deliver -Force }

  $feed = Join-Path $desktop "feed"
  if (Test-Path $feed) { Remove-Item $feed -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $feed | Out-Null
  Get-ChildItem $outDir -File | Where-Object { $_.Extension -in ".exe", ".yml", ".blockmap" } |
    ForEach-Object { Copy-Item $_.FullName $feed -Force }

  $setup = Get-ChildItem $outDir -Filter "*.exe" | Select-Object -First 1
  $sizeMb = [math]::Round($setup.Length / 1MB)
  Write-Host "`n✅ 打包成功" -ForegroundColor Green
  Write-Host "安装包：$($setup.FullName)  (${sizeMb} MB)"
  Write-Host "D 盘交付：$deliver"
  Write-Host "更新源暂存（上传到 GitHub Releases）：$feed"
} finally {
  Pop-Location
}
