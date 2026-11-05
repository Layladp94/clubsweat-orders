import { useEffect, useState } from "react";
import { barAction, supabase } from "./supabase";

export default function Settings({ notify, onOpenChange }: { notify: (m: string) => void; onOpenChange: (v: boolean) => void }) {
  const [isOpen, setIsOpen] = useState(true);
  const [prep, setPrep] = useState(6);
  const [closedMsg, setClosedMsg] = useState("");
  const [stats, setStats] = useState<{ today: number; todayCents: number; passes: number } | null>(null);

  useEffect(() => {
    supabase.from("bar_settings").select("*").eq("id", 1).single().then(({ data }) => {
      if (!data) return;
      setIsOpen(data.is_open); setPrep(data.prep_minutes); setClosedMsg(data.closed_message);
    });
    const start = new Date(); start.setHours(0, 0, 0, 0);
    Promise.all([
      supabase.from("orders").select("total_cents,paid_with").in("status", ["paid", "making", "ready", "collected"]).gte("paid_at", start.toISOString()),
      supabase.from("passes").select("id", { count: "exact", head: true }).eq("status", "active"),
    ]).then(([o, p]) => {
      const rows = o.data ?? [];
      setStats({
        today: rows.length,
        todayCents: rows.filter((r) => r.paid_with === "yoco").reduce((a, r) => a + r.total_cents, 0),
        passes: p.count ?? 0,
      });
    });
  }, []);

  const save = async () => {
    const r = await barAction({ action: "set_open", is_open: isOpen, prep_minutes: prep, closed_message: closedMsg });
    if (r.ok) { notify("Saved"); onOpenChange(isOpen); } else notify(r.error ?? "Failed");
  };

  return (
    <div className="form">
      {stats && (
        <div className="stat">
          <div><span className="n">{stats.today}</span><span className="l">Orders today</span></div>
          <div><span className="n">R{(stats.todayCents / 100).toFixed(0)}</span><span className="l">Yoco today</span></div>
          <div><span className="n">{stats.passes}</span><span className="l">Active passes</span></div>
        </div>
      )}
      <label>
        Taking orders
        <button className={`toggle ${isOpen ? "on" : ""}`} onClick={() => setIsOpen(!isOpen)} style={{ justifySelf: "start" }}>{isOpen ? "Open" : "Closed"}</button>
      </label>
      <label>
        Typical prep time (minutes, shown to customers)
        <input type="number" min={1} max={60} value={prep} onChange={(e) => setPrep(parseInt(e.target.value || "6"))} />
      </label>
      <label>
        Message when closed
        <textarea rows={3} value={closedMsg} onChange={(e) => setClosedMsg(e.target.value)} />
      </label>
      <button className="btn-primary" onClick={save}>Save</button>
    </div>
  );
}
