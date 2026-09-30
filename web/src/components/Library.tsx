"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, MessageCircle, Search, Trash2 } from "lucide-react";
import { authedFetch } from "@/lib/supabase";
import { ensureApiKey } from "@/lib/ensure-api-key";
import { useAuth } from "@/lib/auth-context";

const tabIc = { size: 14, strokeWidth: 1.75, className: "shrink-0" } as const;

type TaskMeta = {
  id: string;
  title?: string;
  course?: string;
  status: string;
  createdAt: number;
  segCount: number;
  hasBurned: boolean;
  points: number;
};

type SearchHit = {
  taskId: string;
  title?: string;
  course?: string;
  start: number;
  end: number;
  text: string;
  zh?: string;
  source?: string; // AI 笔记 / 专业词表命中时标注来源
};

type ChatMsg = { role: "user" | "ai"; text: string };

type SearchHistoryItem = { id: string; q: string; ts: number; hits: number };
type ChatHistoryItem = { id: string; question: string; answer: string; course?: string; ts: number };

const fmtClock = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};
const fmtDate = (ts: number) => (ts ? new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "—");

/** 课程库：Channels 归档 + 全文搜索 + AI 跨课程问答（借鉴 Otter / Notta） */
export default function Library({
  onOpen,
  onDeleted,
}: {
  onOpen: (taskId: string) => void;
  onDeleted?: (taskId: string) => void;
}) {
  const { session, openLogin } = useAuth();
  const [tab, setTab] = useState<"channels" | "search" | "chat">("channels");
  const [tasks, setTasks] = useState<TaskMeta[]>([]);
  const [activeCourse, setActiveCourse] = useState<string>("");
  const [confirmId, setConfirmId] = useState<string>("");
  const [sel, setSel] = useState<string[]>([]); // 多选删除：已勾选的任务 id
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [batching, setBatching] = useState(false);
  const [editingId, setEditingId] = useState<string>(""); // 正在重命名的任务
  const [editTitle, setEditTitle] = useState("");

  // search
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);

  // chat
  const [question, setQuestion] = useState("");
  const [chatCourse, setChatCourse] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [asking, setAsking] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [chatShown, setChatShown] = useState(20); // 对话区已恢复的历史问答条数

  // 课程归类报错提示（重名等）
  const [courseErr, setCourseErr] = useState("");
  const [courseFixKey, setCourseFixKey] = useState(0); // 归类失败时重挂载输入框，回滚显示值

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/history");
      const j = await r.json();
      setSearchHistory(j.searches || []);
      setChatHistory(j.chats || []);
      setHistoryLoaded(true);
    } catch {
      /* ignore */
    }
  }, []);

  const clearHistory = async (kind: "search" | "chat") => {
    await fetch(`/api/history?kind=${kind}`, { method: "DELETE" }).catch(() => {});
    if (kind === "search") setSearchHistory([]);
    else {
      setChatHistory([]);
      setMsgs([]);
    }
  };

  /** 从历史恢复一段问答到对话区（最近 20 条，按时间正序） */
  const restoreChat = (items: ChatHistoryItem[]) => {
    const out: ChatMsg[] = [];
    for (const it of [...items].reverse()) {
      out.push({ role: "user", text: it.question });
      out.push({ role: "ai", text: it.answer });
    }
    setMsgs(out);
  };

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/tasks");
      const j = await r.json();
      setTasks(j.tasks || []);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 切到搜索/问答 tab 时懒加载历史库；首次进入问答 tab 自动恢复上次对话
  useEffect(() => {
    if ((tab === "search" || tab === "chat") && !historyLoaded) loadHistory();
  }, [tab, historyLoaded, loadHistory]);

  useEffect(() => {
    if (tab === "chat" && historyLoaded && msgs.length === 0 && chatHistory.length > 0) {
      restoreChat(chatHistory.slice(0, chatShown));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, historyLoaded]);

  const courses = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) {
      const c = t.course || "未分类";
      map.set(c, (map.get(c) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  const shown = activeCourse
    ? tasks.filter((t) => (t.course || "未分类") === activeCourse)
    : tasks;

  const doSearch = async (term?: string) => {
    const query = (term ?? q).trim();
    if (!query) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const j = await r.json();
      setHits(j.hits || []);
      loadHistory(); // 服务端已记录本次搜索词，刷新历史条
    } finally {
      setSearching(false);
    }
  };

  const ask = async () => {
    const text = question.trim();
    if (!text || asking) return;
    if (!session) {
      openLogin();
      return;
    }
    if (!(await ensureApiKey())) return; // 未配置自有 Key：拦截并唤起配置弹窗
    setQuestion("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setAsking(true);
    try {
      const r = await authedFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, course: chatCourse }),
      });
      const j = await r.json();
      setMsgs((m) => [...m, { role: "ai", text: j.answer || j.error || "回答失败，请稍后重试" }]);
      if (j.answer) loadHistory(); // 成功回答后才入历史库
    } catch (e) {
      setMsgs((m) => [...m, { role: "ai", text: e instanceof Error ? e.message : "请求失败" }]);
    } finally {
      setAsking(false);
    }
  };

  const setCourse = async (id: string, course: string) => {
    setCourseErr("");
    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, course }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setCourseErr(j.error || "课程归类失败");
        setCourseFixKey((k) => k + 1); // 重挂载非受控输入框，回滚显示值
        return;
      }
    } catch {
      return;
    }
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, course: course.trim() } : t)));
  };

  const renameTask = async (id: string) => {
    if (editingId !== id) return;
    setEditingId("");
    const next = editTitle.trim();
    if (!next || next === (tasks.find((t) => t.id === id)?.title ?? `视频 ${id}`)) return;
    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title: next }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setCourseErr(j.error || "重命名失败"); // 顶部红条提示；输入框未更新，显示值自动回滚
        return;
      }
    } catch {
      return;
    }
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, title: next } : t)));
    setHits((hs) => hs.map((h) => (h.taskId === id ? { ...h, title: next } : h)));
  };

  const removeTask = async (id: string) => {
    setConfirmId("");
    try {
      const r = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!r.ok) return;
    } catch {
      return;
    }
    setTasks((ts) => ts.filter((t) => t.id !== id));
    setHits((hs) => hs.filter((h) => h.taskId !== id));
    setSel((s) => s.filter((x) => x !== id));
    onDeleted?.(id);
  };

  const toggleSel = (id: string) =>
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const allShownSelected = shown.length > 0 && shown.every((t) => sel.includes(t.id));
  const toggleSelectAll = () =>
    setSel((s) => (allShownSelected ? s.filter((id) => !shown.some((t) => t.id === id)) : Array.from(new Set([...s, ...shown.map((t) => t.id)]))));

  const removeBatch = async () => {
    setConfirmBatch(false);
    setBatching(true);
    const ids = [...sel];
    const done: string[] = [];
    for (const id of ids) {
      try {
        const r = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
        if (r.ok) done.push(id);
      } catch {
        /* 单个失败不影响其余 */
      }
    }
    const set = new Set(done);
    setTasks((ts) => ts.filter((t) => !set.has(t.id)));
    setHits((hs) => hs.filter((h) => !set.has(h.taskId)));
    setSel((s) => s.filter((id) => !set.has(id)));
    done.forEach((id) => onDeleted?.(id));
    setBatching(false);
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2">
        {(
          [
            ["channels", <BookOpen key="i" {...tabIc} />, "课程频道"],
            ["search", <Search key="i" {...tabIc} />, "全文搜索"],
            ["chat", <MessageCircle key="i" {...tabIc} />, "AI 问答"],
          ] as const
        ).map(([k, icon, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-5 py-2 rounded-full text-sm transition-all duration-200 inline-flex items-center gap-1.5 ${
              tab === k ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {tab === "channels" && (
        <div className="grid md:grid-cols-[240px_1fr] gap-6">
          {/* Course rail */}
          <div className="panel p-4 h-fit">
            <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest mb-3 px-2">Channels</p>
            <button
              onClick={() => setActiveCourse("")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm mb-1 transition-colors duration-150 ${
                !activeCourse ? "bg-[rgba(232,99,74,0.1)] text-[var(--accent)]" : "text-[var(--text)] hover:bg-[rgba(28,25,17,0.05)]"
              }`}
            >
              全部 <span className="text-[var(--muted)] text-xs">{tasks.length}</span>
            </button>
            {courses.map(([c, n]) => (
              <button
                key={c}
                onClick={() => setActiveCourse(c)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm mb-1 transition-colors duration-150 ${
                  activeCourse === c ? "bg-[rgba(232,99,74,0.1)] text-[var(--accent)]" : "text-[var(--text)] hover:bg-[rgba(28,25,17,0.05)]"
                }`}
              >
                {c} <span className="text-[var(--muted)] text-xs">{n}</span>
              </button>
            ))}
            {courses.length === 0 && <p className="text-xs text-[var(--muted)] px-3 py-2">还没有课程，先在「工作台」给视频归类</p>}
          </div>

          {/* Task list */}
          <div className="space-y-3">
            {courseErr && (
              <div
                className="panel p-3 text-sm flex items-center justify-between gap-3"
                style={{ borderColor: "var(--err)", color: "var(--err)" }}
              >
                <span>{courseErr}</span>
                <button className="text-xs underline underline-offset-2 shrink-0" onClick={() => setCourseErr("")}>
                  知道了
                </button>
              </div>
            )}
            {shown.length > 0 && (
              <div className="flex items-center gap-3 px-2 text-sm">
                <label className="flex items-center gap-2 cursor-pointer select-none text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 accent-[var(--accent)]"
                  />
                  全选{activeCourse ? `「${activeCourse}」` : ""}
                </label>
                {sel.length > 0 && (
                  <>
                    <span className="text-xs mono text-[var(--muted)]">已选 {sel.length} 项</span>
                    <button className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline underline-offset-2" onClick={() => setSel([])}>
                      清空选择
                    </button>
                    <span className="flex-1" />
                    {confirmBatch ? (
                      <span className="flex items-center gap-2">
                        <button
                          className="btn-ghost !px-3 !py-1.5 !text-xs"
                          style={{ color: "var(--err)", borderColor: "var(--err)" }}
                          onClick={removeBatch}
                          disabled={batching}
                        >
                          {batching ? "删除中…" : `确认删除 ${sel.length} 项`}
                        </button>
                        <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setConfirmBatch(false)}>
                          取消
                        </button>
                      </span>
                    ) : (
                      <button
                        className="btn-ghost !px-3 !py-1.5 !text-xs"
                        style={{ color: "var(--err)", borderColor: "var(--err)" }}
                        onClick={() => setConfirmBatch(true)}
                      >
                        <Trash2 size={13} strokeWidth={1.75} /> 批量删除
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {shown.length === 0 && (
              <div className="panel p-10 text-center text-sm text-[var(--muted)]">
                {tasks.length === 0 ? "课程库为空——去「工作台」导入第一个课堂视频吧" : "该频道下还没有视频"}
              </div>
            )}
            {shown.map((t) => (
              <div
                key={t.id}
                className="panel p-5 flex items-center gap-4 transition-colors duration-150"
                style={sel.includes(t.id) ? { borderColor: "var(--accent)" } : undefined}
              >
                <input
                  type="checkbox"
                  checked={sel.includes(t.id)}
                  onChange={() => toggleSel(t.id)}
                  aria-label={`选择 ${t.title || t.id}`}
                  className="w-4 h-4 shrink-0 accent-[var(--accent)] cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                  <input
                    value={editingId === t.id ? editTitle : t.title || `视频 ${t.id}`}
                    onFocus={() => {
                      setEditingId(t.id);
                      setEditTitle(t.title || `视频 ${t.id}`);
                    }}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => renameTask(t.id)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    aria-label="重命名视频"
                    className="w-full font-medium bg-transparent border-b border-dashed border-transparent hover:border-[var(--line-2)] focus:border-[var(--accent)] outline-none truncate transition-colors duration-150"
                  />
                  <p className="text-xs text-[var(--muted)] mono mt-1">
                    {fmtDate(t.createdAt)} · {t.segCount} 句 · {t.points > 0 ? `${t.points} 条要点` : "无笔记"}
                  </p>
                </div>
                <input
                  key={`${t.id}-${courseFixKey}`}
                  list="course-options"
                  placeholder="归类课程…"
                  defaultValue={t.course || ""}
                  onBlur={(e) => setCourse(t.id, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="w-32 bg-transparent border border-[var(--line)] rounded-full px-3 py-1.5 text-xs outline-none focus:border-[var(--accent)] transition-colors duration-150"
                />
                <button className="btn-ghost !px-4 !py-1.5 !text-sm" onClick={() => onOpen(t.id)}>
                  打开
                </button>
                {confirmId === t.id ? (
                  <span className="flex items-center gap-2">
                    <button
                      className="btn-ghost !px-3 !py-1.5 !text-xs"
                      style={{ color: "var(--err)", borderColor: "var(--err)" }}
                      onClick={() => removeTask(t.id)}
                    >
                      确认删除
                    </button>
                    <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setConfirmId("")}>
                      取消
                    </button>
                  </span>
                ) : (
                  <button
                    className="btn-ghost !px-3 !py-1.5"
                    title="删除该视频及其全部产物"
                    aria-label={`删除 ${t.title || t.id}`}
                    onClick={() => setConfirmId(t.id)}
                  >
                    <Trash2 size={14} strokeWidth={1.75} />
                  </button>
                )}
              </div>
            ))}
            <datalist id="course-options">
              {courses.filter(([c]) => c !== "未分类").map(([c]) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
      )}

      {tab === "search" && (
        <div className="space-y-4">
          <div className="panel p-4 flex gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="搜索所有课堂转录，如 gradient descent、作业、midterm…"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-[var(--muted)] px-2"
            />
            <button className="btn-primary !py-2" onClick={() => doSearch()} disabled={searching}>
              {searching ? "搜索中…" : "搜索"}
            </button>
          </div>
          {searchHistory.length > 0 && (
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest">最近搜索</p>
                <button
                  className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline underline-offset-2"
                  onClick={() => clearHistory("search")}
                >
                  清空历史
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {searchHistory.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setQ(s.q);
                      doSearch(s.q);
                    }}
                    className="px-3 py-1.5 rounded-full text-xs border border-[var(--line)] bg-[var(--bg-2)] hover:border-[var(--accent)] transition-colors duration-150"
                  >
                    {s.q}
                    <span className="text-[var(--muted)] ml-1.5">{s.hits}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {hits.length > 0 && (
            <div className="panel overflow-hidden">
              {hits.map((h, i) => (
                <button
                  key={i}
                  onClick={() => onOpen(h.taskId)}
                  className="w-full text-left px-5 py-4 border-b border-[var(--hair)] last:border-b-0 hover:bg-[rgba(232,99,74,0.05)] transition-colors duration-150"
                >
                  <p className="text-xs mono text-[var(--muted)] mb-1">
                    {h.course ? `${h.course} · ` : ""}
                    {h.title || h.taskId}
                    {h.source ? (
                      <span className="badge-note !text-[10px] px-2 py-0.5 ml-2 align-middle">{h.source}</span>
                    ) : (
                      <> · {fmtClock(h.start)}</>
                    )}
                  </p>
                  <p className="text-sm truncate">{h.text}</p>
                  {h.zh && <p className="text-sm text-[var(--muted)] truncate">{h.zh}</p>}
                </button>
              ))}
            </div>
          )}
          {q && !searching && hits.length === 0 && (
            <p className="text-sm text-[var(--muted)] text-center py-8">没有找到相关内容</p>
          )}
        </div>
      )}

      {tab === "chat" && (
        <div className="panel p-6 flex flex-col gap-4 min-h-[420px]">
          <div className="flex gap-3">
            <select
              value={chatCourse}
              onChange={(e) => setChatCourse(e.target.value)}
              className="bg-[var(--bg-2)] border border-[var(--line)] rounded-full px-4 py-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              <option value="">全部课程</option>
              {courses.filter(([c]) => c !== "未分类").map(([c]) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
              placeholder="就学过的课程内容提问，如「教授怎么解释供需曲线的？」"
              className="flex-1 bg-transparent border border-[var(--line)] rounded-full px-5 py-2 text-sm outline-none focus:border-[var(--accent)] transition-colors duration-150"
            />
            <button className="btn-primary !py-2" onClick={ask} disabled={asking || !question.trim()}>
              {asking ? "思考中…" : "提问"}
            </button>
          </div>
          {chatHistory.length > chatShown && (
            <button
              className="self-center text-xs text-[var(--muted)] hover:text-[var(--text)] underline underline-offset-2"
              onClick={() => {
                const n = chatShown + 20;
                setChatShown(n);
                restoreChat(chatHistory.slice(0, n));
              }}
            >
              加载更早的问答（还有 {chatHistory.length - chatShown} 条）
            </button>
          )}
          <div className="flex-1 space-y-4 overflow-y-auto max-h-[520px] pr-1">
            {msgs.length === 0 && (
              <p className="text-sm text-[var(--muted)] text-center mt-16">
                基于你已转写的全部课堂内容回答（本地检索 + DeepSeek），期末复习神器
              </p>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                    m.role === "user"
                      ? "bg-[var(--note)] border-[1.5px] border-[var(--line)] text-[var(--text)] shadow-[3px_3px_0_rgba(28,25,17,0.16)]"
                      : "bg-[var(--bg-2)] border border-[var(--line)] text-[var(--text)]"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>
          {chatHistory.length > 0 && (
            <div className="flex items-center justify-between text-xs text-[var(--muted)] border-t border-[var(--hair)] pt-3">
              <span>问答历史已保存 {chatHistory.length} 条，刷新页面不会丢失</span>
              <button
                className="hover:text-[var(--text)] underline underline-offset-2"
                onClick={() => clearHistory("chat")}
              >
                清空历史
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
