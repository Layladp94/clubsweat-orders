import { useEffect, useRef, useState } from "react";
import { barAction, supabase } from "./supabase";

type Thread = { id: string; name: string | null; wa_id: string; last_inbound_at: string | null; preview?: string };
type Msg = { id: string; direction: "in" | "out"; body: string | null; created_at: string; sent_by: string | null };

export default function Inbox({ notify }: { notify: (m: string) => void }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const loadThreads = async () => {
    const { data } = await supabase
      .from("customers")
      .select("id,name,wa_id,last_inbound_at")
      .not("last_inbound_at", "is", null)
      .order("last_inbound_at", { ascending: false })
      .limit(60);
    setThreads((data ?? []) as Thread[]);
  };

  const loadMsgs = async (t: Thread) => {
    const { data } = await supabase
      .from("messages")
      .select("id,direction,body,created_at,sent_by")
      .eq("customer_id", t.id)
      .order("created_at", { ascending: true })
      .limit(200);
    setMsgs((data ?? []) as Msg[]);
    setTimeout(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  useEffect(() => {
    loadThreads();
    const ch = supabase
      .channel("inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
        loadThreads();
        if (active && (p.new as { customer_id: string }).customer_id === active.id) loadMsgs(active);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const send = async () => {
    if (!active || !text.trim()) return;
    const r = await barAction({ action: "reply", customer_id: active.id, text });
    if (!r.ok) { notify(r.error ?? "Failed"); return; }
    setText("");
    loadMsgs(active);
  };

  return (
    <div className="inbox">
      <div className={`list ${active ? "hidden" : ""}`}>
        {threads.length === 0 && <div className="empty">No conversations yet</div>}
        {threads.map((t) => (
          <button key={t.id} className={active?.id === t.id ? "active" : ""} onClick={() => { setActive(t); loadMsgs(t); }}>
            <div className="name">{t.name ?? "+" + t.wa_id}</div>
            <div className="preview">+{t.wa_id} · {t.last_inbound_at ? new Date(t.last_inbound_at).toLocaleString("en-ZA", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : ""}</div>
          </button>
        ))}
      </div>
      <div className={`thread ${active ? "" : "hidden"}`}>
        {!active && <div className="empty">Pick a conversation</div>}
        {active && (
          <>
            <div className="thread-head">
              <button className="back" onClick={() => setActive(null)}>‹</button>
              <strong>{active.name ?? "+" + active.wa_id}</strong>
              <span className="mono" style={{ color: "var(--text-3)" }}>+{active.wa_id}</span>
            </div>
            <div className="msgs">
              {msgs.map((m) => (
                <div key={m.id} className={`msg ${m.direction}`}>
                  {m.body}
                  <span className="t">{new Date(m.created_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}{m.direction === "out" ? ` · ${m.sent_by ?? "bot"}` : ""}</span>
                </div>
              ))}
              <div ref={bottom} />
            </div>
            <div className="compose">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply as the bar…" onKeyDown={(e) => e.key === "Enter" && send()} />
              <button className="btn-primary" onClick={send}>Send</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
