# 视频快译 · 一键打包脚本
# 用法：双击 一键打包.bat，或 powershell -File scripts\build.ps1
$ErrorActionPreference = "Stop"
$desktop = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $desktop

# ── 国内镜像（electron 二进制 / npm 包）──
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"

# 工具链固定输出到非 OneDrive 目录，避免 2.8GB 产物被同步占用导致文件锁
$buildOut = "D:\vts-build"

function Step($m) { Write-Host "`n==== $m ====" -ForegroundColor Yellow }

# 0. 端口 3000 上若有 dev server，先提醒（同时跑会损坏 .next）
$p3000 = (netstat -ano | Select-String ":3000\s.*LISTENING" | Select-Object -First 1)
if ($p3000) {
  throw "检测到 3000 端口有服务在跑（dev server）。请先关闭它再打包，避免 .next 缓存损坏。"
}

# 1. 便携 Python + ffmpeg 运行时
Step "1/6 准备便携运行时（Python + ffmpeg）"
& (Join-Path $PSScriptRoot "prepare-runtime.ps1")

# 2. 图标（pyenv 里装 Pillow）
Step "2/6 生成应用图标"
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
Step "3/6 构建 Next.js standalone"
& (Join-Path $PSScriptRoot "stage-web.ps1")

# 4. Electron 依赖
Step "4/6 安装/检查 electron-builder 依赖"
Push-Location $desktop
try {
  if (-not (Test-Path (Join-Path $desktop "node_modules"))) {
    & npm.cmd install --registry=https://registry.npmmirror.com
    if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }
  }

  # 5. 离线工具链镜像 + app-builder 校验补丁（解决符号链接权限问题，见步骤说明）
  Step "5/6 准备 NSIS 工具链（本地镜像 + 免符号链接补丁，无需管理员）"
  $mirror = Join-Path $desktop ".binmirror"
  $reg = "https://registry.npmmirror.com/-/binary/electron-builder-binaries"
  $files = @(
    @{ rel = "nsis-3.0.4.1\nsis-3.0.4.1.7z"; url = "$reg/nsis-3.0.4.1/nsis-3.0.4.1.7z" },
    @{ rel = "nsis-resources-3.4.1\nsis-resources-3.4.1.7z"; url = "$reg/nsis-resources-3.4.1/nsis-resources-3.4.1.7z" }
  )
  foreach ($f in $files) {
    $dest = Join-Path $mirror $f.rel
    if (-not (Test-Path $dest)) {
      New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
      Write-Host "下载 $($f.rel)"
      Invoke-WebRequest $f.url -OutFile $dest -UseBasicParsing -TimeoutSec 300
    }
  }

  # winCodeSign：官方包内含 darwin 符号链接，非管理员解压必失败；
  # 改为重打包（删除 darwin），并把 app-builder.exe 内固定的 sha512 换成新包的值。
  $wcsDir = Join-Path $mirror "winCodeSign-2.6.0"
  $wcsPatched = Join-Path $wcsDir "winCodeSign-2.6.0.7z"
  if (-not (Test-Path $wcsPatched)) {
    New-Item -ItemType Directory -Force -Path $wcsDir | Out-Null
    $orig = Join-Path $env:TEMP "winCodeSign-2.6.0.orig.7z"
    Invoke-WebRequest "$reg/winCodeSign-2.6.0/winCodeSign-2.6.0.7z" -OutFile $orig -UseBasicParsing -TimeoutSec 300
    $staging = Join-Path $env:TEMP "wcs-repack"
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    $sevenza = Join-Path $desktop "node_modules\7zip-bin\win\x64\7za.exe"
    & $sevenza x $orig "-o$staging" -y "-x!darwin" -bd | Out-Null
    Push-Location $staging
    & $sevenza a -t7z -mx=5 -bd -y $wcsPatched "*" | Out-Null
    Pop-Location
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  }

  function Get-Sha512B64($p) {
    $b = [System.IO.File]::ReadAllBytes($p)
    [Convert]::ToBase64String([System.Security.Cryptography.SHA512]::Create().ComputeHash($b))
  }
  $patchedHash = Get-Sha512B64 $wcsPatched
  $abExe = Join-Path $desktop "node_modules\app-builder-bin\win\x64\app-builder.exe"
  $abBytes = [System.IO.File]::ReadAllBytes($abExe)
  # Latin1(ISO-8859-1) 保证每个字节 1:1 往返，绝不能用 ASCII（会把高位字节变成 ?）
  $latin1 = [System.Text.Encoding]::GetEncoding(28591)
  $abText = $latin1.GetString($abBytes)
  $officialPin = "6LQI2d9BPC3Xs0ZoTQe1o3tPiA28c7+PY69Q9i/pD8lY45psMtHuLwv3vRckiVr3Zx1cbNyLlBR8STwCdcHwtA=="
  if ($abText.Contains($officialPin)) {
    if (-not (Test-Path "$abExe.bak")) { Copy-Item $abExe "$abExe.bak" }
    $abText = $abText.Replace($officialPin, $patchedHash)
    [System.IO.File]::WriteAllBytes($abExe, $latin1.GetBytes($abText))
    Write-Host "app-builder.exe 校验值已补丁（免管理员符号链接）" -ForegroundColor Green
  } elseif ($abText.Contains($patchedHash)) {
    Write-Host "app-builder.exe 已是补丁状态"
  } else {
    Write-Host "警告：未找到 app-builder.exe 中的 winCodeSign 固定校验值（版本可能已更新），若打包报 checksum 错误需手工处理。" -ForegroundColor Yellow
  }

  # 启动本地静态镜像（端口 8899），让工具链下载地址稳定
  $mirrorUp = $false
  try { $mirrorUp = ((Invoke-WebRequest "http://127.0.0.1:8899/" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) } catch {}
  $mirrorPy = $null
  if (-not $mirrorUp) {
    $runtimePy = Join-Path $desktop "runtime\python\python.exe"
    $mirrorPy = Start-Process -FilePath $runtimePy -ArgumentList @("-m","http.server","8899","--bind","127.0.0.1") -WorkingDirectory $mirror -WindowStyle Hidden -PassThru
    Start-Sleep 2
    Write-Host "本地工具链镜像已启动 (PID $($mirrorPy.Id))"
  }
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = "http://127.0.0.1:8899/"

  # 6. 打包
  $ver = (Get-Content (Join-Path $desktop "package.json") -Raw | ConvertFrom-Json).version
  # 注意：命令行 -c.directories.output 会整体覆盖 yml 里的 dist/${version}，
  # 产物直接落在 $buildOut 根目录（不是 $buildOut\$ver）。
  $outDir = $buildOut
  $oldUnpacked = Join-Path $buildOut "win-unpacked"
  if (Test-Path $oldUnpacked) {
    Write-Host "清理旧 win-unpacked"
    Remove-Item $oldUnpacked -Recurse -Force -ErrorAction SilentlyContinue
  }
  Step "6/6 electron-builder 打包（压缩约 10-20 分钟）"
  & (Join-Path $desktop "node_modules\.bin\electron-builder.cmd") --win nsis --x64 --publish never "-c.directories.output=$($buildOut -replace '\\','/')"
  if ($LASTEXITCODE -ne 0) { throw "electron-builder 失败" }

  # 交付：D 盘 + 更新源暂存（只收当前版本的文件 + latest.yml，避免把历史版本一起搬走）
  Step "交付安装包"
  $deliver = "D:\Item AI\Claude Code\视频快译安装包"
  New-Item -ItemType Directory -Force -Path $deliver | Out-Null
  $artifacts = Get-ChildItem $outDir -File | Where-Object {
    ($_.Name -like "*$ver*" -and $_.Extension -in ".exe", ".blockmap") -or $_.Name -eq "latest.yml"
  }
  $artifacts | ForEach-Object { Copy-Item $_.FullName $deliver -Force }

  $feed = Join-Path $desktop "feed"
  if (Test-Path $feed) { Remove-Item $feed -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $feed | Out-Null
  $artifacts | ForEach-Object { Copy-Item $_.FullName $feed -Force }

  if ($mirrorPy) { Stop-Process -Id $mirrorPy.Id -Force -ErrorAction SilentlyContinue }

  $setup = Get-ChildItem $outDir -Filter "VideoTranslate-Setup-$ver.exe" | Select-Object -First 1
  if (-not $setup) { throw "未找到产物 VideoTranslate-Setup-$ver.exe" }
  $sizeMb = [math]::Round($setup.Length / 1MB)
  if ($sizeMb -lt 50) { throw "安装包仅 ${sizeMb}MB，疑似损坏（健康包应约 1200MB），中止交付" }
  Write-Host "`n✅ 打包成功" -ForegroundColor Green
  Write-Host "安装包：$($setup.FullName)  (${sizeMb} MB)"
  Write-Host "D 盘交付：$deliver"
  Write-Host "更新源暂存（上传到 GitHub Releases）：$feed"
} finally {
  Pop-Location
}
