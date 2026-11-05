import { useEffect, useState } from "react";
import { rands, supabase } from "./supabase";

type Item = { id: string; name: string; price_cents: number; active: boolean; category_id: string; sort: number };
type Cat = { id: string; name: string; sort: number };
type PassProduct = { id: string; name: string; price_cents: number; active: boolean; kind: string; credits: number | null; valid_days: number };

export default function MenuTab({ notify }: { notify: (m: string) => void }) {
  const [cats, setCats] = useState<Cat[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [passes, setPasses] = useState<PassProduct[]>([]);

  const load = async () => {
    const [c, i, p] = await Promise.all([
      supabase.from("menu_categories").select("id,name,sort").order("sort"),
      supabase.from("menu_items").select("id,name,price_cents,active,category_id,sort").order("sort"),
      supabase.from("pass_products").select("*").order("sort"),
    ]);
    setCats((c.data ?? []) as Cat[]);
    setItems((i.data ?? []) as Item[]);
    setPasses((p.data ?? []) as PassProduct[]);
  };
  useEffect(() => { load(); }, []);

  const update = async (table: string, id: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    if (error) notify(error.message); else load();
  };

  const PriceCell = ({ table, row }: { table: string; row: { id: string; price_cents: number } }) => {
    const [v, setV] = useState((row.price_cents / 100).toString());
    return (
      <input
        inputMode="decimal"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const cents = Math.round(parseFloat(v.replace(",", ".")) * 100);
          if (Number.isFinite(cents) && cents !== row.price_cents) update(table, row.id, { price_cents: cents });
        }}
      />
    );
  };

  return (
    <div>
      <p className="hint">
        Tap a price to change it · switch an item off when you run out · new items and milk options are added in Supabase (see the handover guide)
      </p>
      {cats.map((c) => (
        <div key={c.id}>
          <h3 className="section">{c.name}</h3>
          <table className="table">
            <thead><tr><th>Item</th><th>Price</th><th>On menu</th></tr></thead>
            <tbody>
              {items.filter((i) => i.category_id === c.id).map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td><PriceCell table="menu_items" row={i} /></td>
                  <td><button className={`toggle ${i.active ? "on" : ""}`} onClick={() => update("menu_items", i.id, { active: !i.active })}>{i.active ? "On" : "Off"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <h3 className="section">Coffee passes</h3>
      <table className="table">
        <thead><tr><th>Pass</th><th>What</th><th>Price</th><th>For sale</th></tr></thead>
        <tbody>
          {passes.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className="dim">{p.kind === "credits" ? `${p.credits} coffees` : "1 a day"} · {p.valid_days} days · {rands(p.price_cents)}</td>
              <td><PriceCell table="pass_products" row={p} /></td>
              <td><button className={`toggle ${p.active ? "on" : ""}`} onClick={() => update("pass_products", p.id, { active: !p.active })}>{p.active ? "On" : "Off"}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
