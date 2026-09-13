# 构建 Next standalone 并组装 .stage（electron-builder 的 extraResources 源）
$ErrorActionPreference = "Stop"
$desktop = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $desktop
$web = Join-Path $root "web"
$stage = Join-Path $desktop ".stage"
$server = Join-Path $stage "server"

function Copy-RC($Src, $Dst) {
  & robocopy $Src $Dst /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败（$Src）退出码 $LASTEXITCODE" }
}

Write-Host "next build（standalone）…" -ForegroundColor Cyan
Push-Location $web
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "next build 失败" }
} finally {
  Pop-Location
}

$standalone = Join-Path $web ".next\standalone"
if (-not (Test-Path (Join-Path $standalone "server.js"))) { throw "standalone 产物缺失：$standalone" }

Write-Host "组装 .stage…" -ForegroundColor Cyan
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $server | Out-Null

Copy-RC $standalone $server
Copy-RC (Join-Path $web ".next\static") (Join-Path $server ".next\static")
if (Test-Path (Join-Path $web "public")) {
  Copy-RC (Join-Path $web "public") (Join-Path $server "public")
}

$scriptsDst = Join-Path $stage "scripts"
New-Item -ItemType Directory -Force -Path $scriptsDst | Out-Null
Copy-Item (Join-Path $root "scripts\transcribe.py") $scriptsDst

Write-Host ".stage 就绪" -ForegroundColor Green
