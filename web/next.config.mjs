/** @type {import('next').NextConfig} */
const nextConfig = {
  // 桌面版（Electron）需要独立可运行的服务端产物
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: [],
  },
};

export default nextConfig;
