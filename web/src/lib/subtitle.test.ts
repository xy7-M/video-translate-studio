import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock 会被提升到文件顶部，spy 必须用 vi.hoisted 一并提前创建
const { deepseekJson } = vi.hoisted(() => ({ deepseekJson: vi.fn() }));
vi.mock("./deepseek", () => ({
  deepseekJson: (system: string, user: string, temp?: number) => deepseekJson(system, user, temp),
  deepseekText: vi.fn(),
}));

import { punctuate, resegmentSegments, type Segment } from "./pipeline";

/** 便捷构造：按给定词序列生成 whisper 词级时间戳（默认词长 0.4s、间隔 0.1s） */
function makeWords(
  words: string[],
  opts?: { gap?: number; start?: number; wordDur?: number }
): { w: string; s: number; e: number }[] {
  const gap = opts?.gap ?? 0.1;
  const wordDur = opts?.wordDur ?? 0.4;
  let t = opts?.start ?? 0;
  return words.map((w) => {
    const s = t;
    t += wordDur + gap;
    return { w, s: +s.toFixed(3), e: +(s + wordDur).toFixed(3) };
  });
}

const seg = (start: number, end: number, text: string, words?: Segment["words"]): Segment => ({
  start,
  end,
  text,
  ...(words ? { words } : {}),
});

describe("resegmentSegments 断句", () => {
  it("无词级时间戳的旧数据原样透传（仅 trim）", () => {
    const out = resegmentSegments([seg(0, 5, "  legacy line without words  ")]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("legacy line without words");
    expect(out[0].start).toBe(0);
    expect(out[0].end).toBe(5);
  });

  it("按句末标点（.!?）断句", () => {
    // 第二句 ≥18 字符，避免被「碎片并入」规则合回上一行
    const words = makeWords(["Hello", "world.", "Next", "line", "here", "is", "longer."]);
    const out = resegmentSegments([seg(0, 3, "Hello world. Next line here is longer.", words)]);
    expect(out.map((s) => s.text)).toEqual(["Hello world.", "Next line here is longer."]);
    // 时间轴取词级边界
    expect(out[0].start).toBe(words[0].s);
    expect(out[0].end).toBe(words[1].e);
    expect(out[1].end).toBe(words[6].e);
  });

  it("句末标点但长度不足 MIN_CHARS 时不立即断行（避免 'OK.' 孤行）", () => {
    // "Yes." 仅 5 字符 < 10，不触发标点断句；后续词继续累积
    const words = makeWords(["Yes.", "that", "is", "correct."]);
    const out = resegmentSegments([seg(0, 3, "", words)]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Yes. that is correct.");
  });

  it("停顿断句：非悬垂词后 ≥0.6s 停顿切开", () => {
    // "indeed" 后大停顿；后半句足够长（≥18 字符且 ≥0.6s），不会被碎片合并
    const w1 = makeWords(["very", "important", "indeed"], { gap: 0.1 });
    const w2 = makeWords(["the", "rest", "of", "the", "sentence", "here."], { start: 3, gap: 0.1 });
    const out = resegmentSegments([seg(0, 7, "", [...w1, ...w2])]);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("very important indeed");
    expect(out[1].text).toBe("the rest of the sentence here.");
    expect(out[0].end).toBe(w1[2].e);
    expect(out[1].start).toBe(w2[0].s);
  });

  it("悬垂词保护：the/of 等结尾时即使大停顿也不腰斩", () => {
    const words = makeWords(["learn", "the"], { gap: 0.1 });
    const tail = makeWords(["properties."], { start: 3 });
    const out = resegmentSegments([seg(0, 4, "", [...words, ...tail])]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("learn the properties.");
  });

  it("逗号断句：逗号结尾且累计 ≥26 字符时切开", () => {
    const w1 = makeWords(["so", "this", "physical", "property,"], { gap: 0.1 });
    const w2 = makeWords(["is", "very", "important", "indeed."], { start: 3, gap: 0.1 });
    const out = resegmentSegments([seg(0, 6, "", [...w1, ...w2])]);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("so this physical property,");
    expect(out[1].text).toBe("is very important indeed.");
  });

  it("无标点时也按 MAX_CHARS(46) 硬上限强制换气", () => {
    const words = makeWords(Array.from({ length: 10 }, () => "aaaaaaaaaa")); // 每词 10 字符
    const out = resegmentSegments([seg(0, 9, "", words)]);
    // 每满 ~46 字符（5 词 × 11）切一刀 → 两组各 5 词
    expect(out).toHaveLength(2);
    expect(out[0].text.split(" ")).toHaveLength(5);
    expect(out[1].text.split(" ")).toHaveLength(5);
  });

  it("标点归一：'foo .' → 'foo.'，标点后补空格", () => {
    const words = makeWords(["say", "foo", ".", "bar", "."]);
    const out = resegmentSegments([seg(0, 3, "", words)]);
    // "say foo ."（10 字符）触发句号断句，"bar."（4 字符）作为碎片并入 → 单行
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("say foo. bar.");
  });

  it("碎片并入上一行：短于 18 字符或短于 0.6s 的行不孤立存在", () => {
    // 第一段以句号断出（≥10 字符），第二段 "OK." 极短 → 应并入
    const w1 = makeWords(["that", "is", "fine."], { gap: 0.1 });
    const w2 = makeWords(["OK."], { start: 2.5, wordDur: 0.2 });
    const out = resegmentSegments([seg(0, 3, "", [...w1, ...w2])]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("that is fine. OK.");
    expect(out[0].end).toBe(w2[0].e);
  });

  it("合并有上限：拼接后超过 54 字符的碎片保持独立行", () => {
    const w1 = makeWords(["one", "two", "three."], { gap: 0.1 }); // 14 字符
    const w2 = makeWords(["a".repeat(45) + "."], { start: 3, wordDur: 1 }); // 46 字符，≥18 且 ≥0.6s
    const out = resegmentSegments([seg(0, 5, "", [...w1, ...w2])]);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("one two three.");
    expect(out[1].text.length).toBe(46);
  });

  it("输出不泄漏 words 字段（入库瘦身）", () => {
    const words = makeWords(["hello", "world."]);
    const out = resegmentSegments([seg(0, 2, "hello world.", words)]);
    expect(out[0]).not.toHaveProperty("words");
    expect(Object.keys(out[0]).sort()).toEqual(["end", "start", "text"]);
  });

  it("空文本与零词段被丢弃", () => {
    const out = resegmentSegments([
      seg(0, 1, "   "),
      seg(2, 3, "", []),
      seg(4, 5, "keep.", makeWords(["keep."])),
    ]);
    expect(out.map((s) => s.text)).toEqual(["keep."]);
  });

  it("多段输入按顺序展平，时间轴单调不减", () => {
    const a = seg(0, 2, "", makeWords(["this", "is", "the", "first."], { gap: 0.1 }));
    const b = seg(3, 5, "", makeWords(["and", "this", "is", "second."], { start: 3, gap: 0.1 }));
    const out = resegmentSegments([a, b]);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("this is the first.");
    expect(out[1].text).toBe("and this is second.");
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start);
  });
});

describe("punctuate 标点复原", () => {
  beforeEach(() => {
    deepseekJson.mockReset();
  });

  /** 让 mock 按「原句 + 末尾句号」返回（词数一致，应被接受） */
  function echoWithPeriod() {
    deepseekJson.mockImplementation(async (_s: string, user: string) => {
      const { items } = JSON.parse(user) as { items: { n: number; en: string }[] };
      return { items: items.map((it) => ({ n: it.n, en: it.en.replace(/\.?$/, ".") })) };
    });
  }

  it("词数一致时接受标点修正，并做首字母大写", () => {
    deepseekJson.mockImplementation(async (_s: string, user: string) => {
      const { items } = JSON.parse(user) as { items: { n: number; en: string }[] };
      return {
        items: items.map((it) => ({
          n: it.n,
          en: it.en.charAt(0).toUpperCase() + it.en.slice(1) + ".",
        })),
      };
    });
    const input = [seg(0, 1, "hello world"), seg(1, 2, "next line")];
    return punctuate(input).then((out) => {
      expect(out.map((s) => s.text)).toEqual(["Hello world.", "Next line."]);
      // 不修改入参（返回副本）
      expect(input[0].text).toBe("hello world");
    });
  });

  it("模型擅自增删词（词数不一致）时保留原句", () => {
    deepseekJson.mockImplementation(async (_s: string, user: string) => {
      const { items } = JSON.parse(user) as { items: { n: number; en: string }[] };
      return {
        items: items.map((it, i) => ({
          n: it.n,
          en: i === 0 ? it.en + " extra word" : it.en + ".", // 第 0 条被改写 → 拒绝
        })),
      };
    });
    return punctuate([seg(0, 1, "keep original"), seg(1, 2, "accept this")]).then((out) => {
      expect(out[0].text).toBe("keep original");
      expect(out[1].text).toBe("accept this.");
    });
  });

  it("越界/缺失序号被安全忽略", () => {
    deepseekJson.mockImplementation(async (_s: string, user: string) => {
      const { items } = JSON.parse(user) as { items: { n: number; en: string }[] };
      return {
        items: [
          ...items.map((it) => ({ n: it.n, en: it.en + "." })),
          { n: 999, en: "ghost line here." }, // 越界 n
          { n: -1, en: "negative index." },
        ],
      };
    });
    return punctuate([seg(0, 1, "real one"), seg(1, 2, "real two")]).then((out) => {
      expect(out.map((s) => s.text)).toEqual(["real one.", "real two."]);
    });
  });

  it("按 30 行一批调用，35 行触发两次请求", async () => {
    echoWithPeriod();
    const input = Array.from({ length: 35 }, (_, i) => seg(i, i + 1, `line number ${i}`));
    const out = await punctuate(input);
    expect(deepseekJson).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(35);
    expect(out[34].text).toBe("line number 34.");
  });

  it("单批失败（API 抛错）时保留原标点并继续后续批次", async () => {
    deepseekJson
      .mockRejectedValueOnce(new Error("DeepSeek API 429"))
      .mockImplementation(async (_s: string, user: string) => {
        const { items } = JSON.parse(user) as { items: { n: number; en: string }[] };
        return { items: items.map((it) => ({ n: it.n, en: it.en + "." })) };
      });
    const input = Array.from({ length: 35 }, (_, i) => seg(i, i + 1, `line number ${i}`));
    const out = await punctuate(input);
    expect(out[0].text).toBe("line number 0"); // 第一批失败 → 原文
    expect(out[30].text).toBe("line number 30."); // 第二批成功
  });

  it("onProgress 回调按批次累计推进", async () => {
    echoWithPeriod();
    const input = Array.from({ length: 65 }, (_, i) => seg(i, i + 1, `word ${i} here`));
    const done: number[] = [];
    await punctuate(input, (n) => done.push(n));
    expect(done).toEqual([30, 60, 65]);
  });
});
