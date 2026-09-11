# -*- coding: utf-8 -*-
"""
视频快译 · 英文转写脚本
用法: python transcribe.py <audio.wav> <out.json> [model_size]
输出: {"segments":[...], "device":"cuda|cpu"}
优先 CUDA（RTX 显卡，速度 10×+），失败自动回退 CPU。
"""
import json
import os
import sys


def register_cuda_dlls() -> None:
    """把 pip 装的 nvidia-cublas/cudnn DLL 目录注册进搜索路径（Windows 必需）"""
    import site

    roots = list(site.getsitepackages()) + [site.getusersitepackages()]
    for root in roots:
        for sub in ("cublas", "cudnn", "cublasLt", "cuda_runtime"):
            d = os.path.join(root, "nvidia", sub, "bin")
            if os.path.isdir(d):
                if hasattr(os, "add_dll_directory"):
                    try:
                        os.add_dll_directory(d)
                    except OSError:
                        pass
                os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


def build_model(model_size: str):
    from faster_whisper import WhisperModel

    # 优先 GPU：float16 在 RTX 5060 上最快；出错则回退 CPU int8
    try:
        register_cuda_dlls()
        return WhisperModel(model_size, device="cuda", compute_type="float16"), "cuda"
    except Exception as e:  # noqa: BLE001
        print(f"[warn] CUDA 不可用，回退 CPU：{e}", file=sys.stderr)
        return WhisperModel(model_size, device="cpu", compute_type="int8"), "cpu"


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: transcribe.py <audio.wav> <out.json> [model_size]", file=sys.stderr)
        return 2

    audio_path, out_path = sys.argv[1], sys.argv[2]
    model_size = sys.argv[3] if len(sys.argv) > 3 else "small"

    # 国内下载模型走镜像；禁用 Xet 避免 401
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

    model, device = build_model(model_size)
    segments, _info = model.transcribe(
        audio_path,
        language="en",
        vad_filter=True,
        beam_size=5,
        word_timestamps=False,
    )

    result = []
    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        result.append({"start": round(seg.start, 3), "end": round(seg.end, 3), "text": text})

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(json.dumps({"segments": len(result), "model": model_size, "device": device}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
