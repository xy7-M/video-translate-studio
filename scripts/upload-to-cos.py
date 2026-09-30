#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
视频快译 · 安装包上传到腾讯云 COS
- 从 C:\\Users\\12653\\.secrets\\tencent-cloud\\credentials.env 读密钥
- 桶不存在则创建（公有读）
- 上传最新安装包，返回 CDN/直接下载地址

用法：
  python upload-to-cos.py <安装包本地路径> [--bucket <桶名>] [--region <地域>]
  不指定 bucket/region 时使用脚本内默认值。
"""
import os
import sys
import argparse
import configparser
from pathlib import Path

# 安全第一：密钥从不写进源码，从 .env 文件读取
CREDENTIALS_FILE = r"C:\Users\12653\.secrets\tencent-cloud\credentials.env"

# 默认值（用户可改）—— 桶名必须全局唯一，建议包含 com-mengxiaoyao 前缀
DEFAULT_BUCKET = "mengxiaoyao-vts-1455284621"  # 2026-09-21 控制台已建桶（公有读私有写）
DEFAULT_REGION = "ap-beijing"                  # 北京（cmcc 内地访问快）
DEFAULT_CDN_DOMAIN = ""  # 若已绑定 CDN 加速域名，填这里；空则返回 cos 直接 URL


def load_credentials():
    """从 credentials.env 读取 SecretId/SecretKey，不打印到 stdout"""
    if not os.path.exists(CREDENTIALS_FILE):
        print(f"错误：凭证文件不存在：{CREDENTIALS_FILE}", file=sys.stderr)
        print("请先在腾讯云访问管理 → API 密钥管理创建密钥，并保存到上述路径。", file=sys.stderr)
        sys.exit(1)
    parser = configparser.ConfigParser()
    # credentials.env 可能没有 section 头，加一个默认 section
    with open(CREDENTIALS_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    if not content.strip().startswith("["):
        content = "[default]\n" + content
    parser.read_string(content)
    sid = (
        parser.get("default", "TENCENT_SECRET_ID", fallback=None)
        or parser.get("default", "SecretId", fallback=None)
        or parser.get("default", "secret_id", fallback=None)
    )
    skey = (
        parser.get("default", "TENCENT_SECRET_KEY", fallback=None)
        or parser.get("default", "SecretKey", fallback=None)
        or parser.get("default", "secret_key", fallback=None)
    )
    if not sid or not skey:
        print("错误：凭证文件中未找到 SecretId/SecretKey", file=sys.stderr)
        sys.exit(1)
    return sid, skey


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("installer", help="安装包本地路径")
    ap.add_argument("--bucket", default=DEFAULT_BUCKET)
    ap.add_argument("--region", default=DEFAULT_REGION)
    ap.add_argument("--cdn", default=DEFAULT_CDN_DOMAIN, help="CDN 加速域名（含 https://），留空返回 COS 直接 URL")
    ap.add_argument("--key", default="", help="COS 对象 key，默认用文件名")
    args = ap.parse_args()

    installer = Path(args.installer)
    if not installer.exists():
        print(f"错误：安装包不存在：{installer}", file=sys.stderr)
        sys.exit(1)
    size_mb = installer.stat().st_size / (1024 * 1024)
    print(f"安装包：{installer.name}  ({size_mb:.1f} MB)")

    sid, skey = load_credentials()
    print("凭证已加载（不显示）")

    from qcloud_cos import CosConfig, CosS3Client

    config = CosConfig(Region=args.region, SecretId=sid, SecretKey=skey, Scheme="https")
    client = CosS3Client(config)

    # 1) 桶不存在则创建
    try:
        client.head_bucket(Bucket=args.bucket)
        print(f"桶已存在：{args.bucket}")
    except Exception:
        print(f"桶不存在，创建中：{args.bucket}  (region={args.region})")
        # 安全基线（2026-09-28 事故复盘）：桶保持私有，仅安装包对象单独设公有读；
        # 开版本控制防误删/覆盖，打防误删标签（cos-python-sdk 该版本一次最多 2 枚 Tag）
        client.create_bucket(Bucket=args.bucket)
        client.put_bucket_versioning(Bucket=args.bucket, Status="Enabled")
        try:
            client.put_bucket_tagging(
                Bucket=args.bucket,
                Tagging={"TagSet": {"Tag": [
                    {"Key": "keep", "Value": "donotdelete"},
                    {"Key": "purpose", "Value": "installer"},
                ]}},
            )
        except Exception as e:
            print(f"警告：打标签失败（不影响上传）：{e}", file=sys.stderr)
        print("桶已创建：私有 + 版本控制 + 防误删标签")

    # 2) 上传（大文件自动分片）
    key = args.key or installer.name
    print(f"上传中：{key} …")
    client.upload_file(
        Bucket=args.bucket,
        Key=key,
        LocalFilePath=str(installer),
        EnableMD5=True,
    )
    # 设对象公有读（覆盖桶级 ACL）
    client.put_object_acl(Bucket=args.bucket, Key=key, ACL="public-read")
    print("上传完成，对象已设为公有读")

    # 3) 返回下载 URL
    if args.cdn:
        url = f"{args.cdn.rstrip('/')}/{key}"
    else:
        url = f"https://{args.bucket}.cos.{args.region}.myqcloud.com/{key}"
    print(f"\n下载地址：{url}")
    print("\n下一步：")
    print("  1) 在腾讯云 CDN 控制台绑定 CDN 域名到该桶（下载加速 + 防 COS 流量超额）")
    print("  2) 把返回的 URL 填到宣传网站的「下载安装包」按钮 href")
    print("  3) API 密钥消费上限：登录腾讯云 → 访问管理 → API 密钥 → 设置消费额度上限 100 元")


if __name__ == "__main__":
    main()
