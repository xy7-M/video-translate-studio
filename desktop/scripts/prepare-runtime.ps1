# 构建便携运行时 runtime/
# 1) 从本机已安装的 Python 3.11 复制可迁移解释器（python.org 完整版可整目录搬迁）
# 2) 叠加 pyenv 中已验证的 faster-whisper + CUDA 依赖（本机复制，无需联网下载 2GB）
# 3) 复制 winget 安装的 ffmpeg/ffprobe
$ErrorActionPreference = "Stop"
$desktop = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $desktop
$runtime = Join-Path $desktop "runtime"
$pyDst = Join-Path $runtime "python"
$ffDst = Join-Path $runtime "ffmpeg"

function Copy-RC($Src, $Dst, [string[]]$Extra) {
  & robocopy $Src $Dst @Extra /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败（$Src → $Dst）退出码 $LASTEXITCODE" }
}

# ─────────────── Python 解释器 + 依赖 ───────────────
if (-not (Test-Path (Join-Path $pyDst "python.exe"))) {
  $base = "C:\Users\12653\AppData\Local\Programs\Python\Python311"
  if (-not (Test-Path (Join-Path $base "python.exe"))) { throw "找不到基础解释器 $base" }
  if (Test-Path $pyDst) { Remove-Item $pyDst -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $pyDst | Out-Null

  Write-Host "[1/3] 复制便携 Python 3.11 解释器…" -ForegroundColor Cyan
  # 剔除测试/文档/Tk 等运行时用不到的部分
  Copy-RC $base $pyDst @(
    "/E",
    "/XD", "__pycache__", "test", "tests", "tcl", "tkinter", "Tools", "lib2to3",
    "/XF", "*.pyc", "*.pdb", "*.chm"
  )

  # 用 pyenv 中实测通过的依赖覆盖基础 site-packages
  $spDst = Join-Path $pyDst "Lib\site-packages"
  if (Test-Path $spDst) { Remove-Item $spDst -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $spDst | Out-Null
  $spSrc = Join-Path $root "pyenv\Lib\site-packages"
  Write-Host "[2/3] 叠加 faster-whisper / ctranslate2 / cuDNN / cuBLAS…" -ForegroundColor Cyan
  # cuda_nvrtc（~180MB）CTranslate2 运行时不需要；hf_xet 已被环境变量禁用
  Copy-RC $spSrc $spDst @(
    "/E",
    "/XD", "__pycache__", "hf_xet", "cuda_nvrtc",
    "/XF", "*.pyc"
  )
} else {
  Write-Host "[1-2/3] runtime\python 已存在，跳过" -ForegroundColor DarkGray
}

# ─────────────── ffmpeg ───────────────
if (-not (Test-Path (Join-Path $ffDst "ffmpeg.exe"))) {
  Write-Host "[3/3] 复制 ffmpeg / ffprobe…" -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $ffDst | Out-Null
  $ff = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg*\*\bin\ffmpeg.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $ff) {
    $cmd = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if ($cmd) { $ff = Get-Item $cmd.Source }
  }
  if (-not $ff) { throw "找不到 ffmpeg.exe（winget 安装的 Gyan.FFmpeg 不存在？）" }
  Copy-Item $ff.FullName $ffDst
  $probe = Join-Path (Split-Path $ff.FullName) "ffprobe.exe"
  if (Test-Path $probe) { Copy-Item $probe $ffDst }
}

# ─────────────── 冒烟：导入测试 ───────────────
Write-Host "依赖导入冒烟测试…" -ForegroundColor Cyan
& (Join-Path $pyDst "python.exe") -c "import sys; print(sys.version); import faster_whisper, ctranslate2, onnxruntime, av, tokenizers, numpy; print('imports ok')"
if ($LASTEXITCODE -ne 0) { throw "Python 依赖导入失败" }

$mb = [math]::Round(((Get-ChildItem $runtime -Recurse -File | Measure-Object Length -Sum).Sum / 1MB))
Write-Host "runtime 就绪，共 $mb MB" -ForegroundColor Green
