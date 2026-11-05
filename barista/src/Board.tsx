import { useCallback, useEffect, useRef, useState } from "react";
import { barAction, type BoardOrder, DEMO, rands, supabase, timeAgo } from "./supabase";

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const DEMO_ORDERS: BoardOrder[] = [
  { id: "d1", short_code: "7F2A", status: "paid", total_cents: 0, paid_with: "pass", note: null, created_at: ago(1), paid_at: ago(1), ready_at: null, customer_name: "Jan Smit", wa_id: "27821234567",
    lines: [{ item_name: "Flat white", qty: 1, modifiers: [{ group: "Size", name: "Large" }, { group: "Milk", name: "Oat" }] }] },
  { id: "d2", short_code: "B31C", status: "paid", total_cents: 10300, paid_with: "yoco", note: "Extra hot please", created_at: ago(3), paid_at: ago(3), ready_at: null, customer_name: "Thandi M", wa_id: "27831112222",
    lines: [{ item_name: "Cappuccino", qty: 1, modifiers: [{ group: "Size", name: "Regular" }, { group: "Milk", name: "Full cream" }] }, { item_name: "Green machine", qty: 1, modifiers: [] }] },
  { id: "d3", short_code: "9E0D", status: "making", total_cents: 7600, paid_with: "yoco", note: null, created_at: ago(6), paid_at: ago(6), ready_at: null, customer_name: "Pieter", wa_id: "27829998888",
    lines: [{ item_name: "Americano", qty: 2, modifiers: [{ group: "Size", name: "Regular" }, { group: "Milk", name: "Full cream" }] }] },
  { id: "d4", short_code: "C4A1", status: "ready", total_cents: 0, paid_with: "pass", note: null, created_at: ago(12), paid_at: ago(12), ready_at: ago(2), customer_name: "Lerato K", wa_id: "27824445555",
    lines: [{ item_name: "Latte", qty: 1, modifiers: [{ group: "Size", name: "Large" }, { group: "Milk", name: "Almond" }] }] },
];

const ACTIVE = ["paid", "making", "ready"] as const;

export default function Board({ notify }: { notify: (m: string) => void }) {
  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [, tick] = useState(0);
  const known = useRef<Set<string>>(new Set());
  const first = useRef(true);

  const load = useCallback(async () => {
    if (DEMO) { setOrders((prev) => (prev.length ? prev : DEMO_ORDERS)); return; }
    const { data, error } = await supabase
      .from("order_board")
      .select("*")
      .in("status", ACTIVE as unknown as string[])
      .order("paid_at", { ascending: true });
    if (error) { notify(error.message); return; }
    const list = (data ?? []) as BoardOrder[];
    if (!first.current) {
      const fresh = list.filter((o) => o.status === "paid" && !known.current.has(o.id));
      if (fresh.length) chime();
    }
    first.current = false;
    for (const o of list) known.current.add(o.id);
    setOrders(list);
  }, [notify]);

  useEffect(() => {
    load();
    if (DEMO) return;
    const channel = supabase
      .channel("orders-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
      .subscribe();
    const poll = setInterval(load, 20000);       // belt and braces if realtime drops
    const clock = setInterval(() => tick((n) => n + 1), 30000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); clearInterval(clock); };
  }, [load]);

  const setStatus = async (o: BoardOrder, status: string) => {
    setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, status: status as BoardOrder["status"] } : x)));
    if (DEMO) return;
    const r = await barAction({ action: "set_status", order_id: o.id, status });
    if (!r.ok) { notify(r.error ?? "Failed"); load(); }
    else if (status === "ready") notify(`Customer told order ${o.short_code} is ready`);
  };

  const col = (status: BoardOrder["status"]) => orders.filter((o) => o.status === status);

  return (
    <div className="columns">
      <Column title="New" cls="new" items={col("paid")} render={(o) => (
        <Card o={o} highlight>
          <button className="btn-primary" onClick={() => setStatus(o, "making")}>Start making</button>
          <button className="btn-danger" onClick={() => confirm(`Cancel order ${o.short_code}? Refund it in the Yoco app if they paid.`) && setStatus(o, "cancelled")}>Cancel</button>
        </Card>
      )} />
      <Column title="Making" cls="making" items={col("making")} render={(o) => (
        <Card o={o}>
          <button className="btn-primary" onClick={() => setStatus(o, "ready")}>Ready, notify</button>
        </Card>
      )} />
      <Column title="Ready to collect" cls="ready" items={col("ready")} render={(o) => (
        <Card o={o}>
          <button className="btn-secondary" onClick={() => setStatus(o, "collected")}>Collected</button>
        </Card>
      )} />
    </div>
  );
}

function Column({ title, cls, items, render }: { title: string; cls: string; items: BoardOrder[]; render: (o: BoardOrder) => React.ReactNode }) {
  return (
    <section className={`col ${cls}`}>
      <h2><span className="sdot" />{title} <span className="count">{items.length}</span></h2>
      {items.length === 0 && <div className="empty">Nothing here</div>}
      {items.map((o) => <div key={o.id}>{render(o)}</div>)}
    </section>
  );
}

function Card({ o, highlight, children }: { o: BoardOrder; highlight?: boolean; children: React.ReactNode }) {
  const since = o.paid_at ?? o.created_at;
  const mins = (Date.now() - new Date(since).getTime()) / 60000;
  return (
    <article className={`card ${highlight ? "new" : ""}`}>
      <div className="head">
        <span className="code">{o.short_code}</span>
        <span className="who">{o.customer_name ?? o.wa_id}</span>
        <span className={`age ${mins > 10 && o.status !== "ready" ? "late" : ""}`}>{timeAgo(since)}</span>
      </div>
      <ul>
        {o.lines.map((l, i) => (
          <li key={i}>
            {l.qty > 1 ? `${l.qty} × ` : ""}{l.item_name}
            {l.modifiers?.length ? <span className="mods">{l.modifiers.map((m) => m.name).join(" · ")}</span> : null}
          </li>
        ))}
      </ul>
      {o.note && <div className="note">Note: {o.note}</div>}
      <div className="meta">
        <span>{o.paid_with === "pass" ? "Coffee pass" : `Paid ${rands(o.total_cents)} (Yoco)`}</span>
        <span>+{o.wa_id}</span>
      </div>
      <div className="actions">{children}</div>
    </article>
  );
}

let audioCtx: AudioContext | null = null;
function chime() {
  try {
    audioCtx ??= new AudioContext();
    const now = audioCtx.currentTime;
    [880, 1175].forEach((f, i) => {
      const o = audioCtx!.createOscillator();
      const g = audioCtx!.createGain();
      o.frequency.value = f;
      o.connect(g); g.connect(audioCtx!.destination);
      g.gain.setValueAtTime(0.0001, now + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.4, now + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.4);
      o.start(now + i * 0.18); o.stop(now + i * 0.18 + 0.45);
    });
  } catch { /* audio blocked until first tap; fine */ }
}
