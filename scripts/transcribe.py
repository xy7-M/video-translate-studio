# -*- coding: utf-8 -*-
"""
视频快译 · 英文转写脚本
用法: python transcribe.py <audio.wav> <out.json> [model_size]
输出: [{"start":0.5,"end":3.2,"text":"..."}, ...]
"""
import json
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: transcribe.py <audio.wav> <out.json> [model_size]", file=sys.stderr)
        return 2

    audio_path, out_path = sys.argv[1], sys.argv[2]
    model_size = sys.argv[3] if len(sys.argv) > 3 else "small"

    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
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

    print(json.dumps({"segments": len(result), "model": model_size}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
