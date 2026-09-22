// 宣传站运行时配置：下载直链指向腾讯云 COS 公有读对象，改链接无需重新构建页面。
window.PROMO_CONFIG = {
  version: "0.1.3",
  // Windows（NSIS 安装包，约 1.3 GB，内置 Python/ffmpeg 运行环境）
  fileName: "VideoTranslate-Setup-0.1.3.exe",
  downloadUrl: "https://mengxiaoyao-vts-1455284621.cos.ap-beijing.myqcloud.com/VideoTranslate-Setup-0.1.3.exe",
  // macOS（dmg 由 GitHub Actions 产出，x64 通用，Apple 芯片经 Rosetta 2 运行，约 200 MB）
  macFileName: "VideoTranslate-0.1.3-macOS.dmg",
  macUrl: "https://mengxiaoyao-vts-1455284621.cos.ap-beijing.myqcloud.com/VideoTranslate-0.1.3-macOS.dmg"
};
