// Free-text order parsing.
//  - With ANTHROPIC_API_KEY set: Claude turns "2 flat whites, one oat, and a green smoothie"
//    into structured lines.
//  - Without it: a simple keyword matcher does a best effort.

import Anthropic from "npm:@anthropic-ai/sdk@^0.80";
import { z } from "npm:zod@^3.23";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@^0.80/helpers/zod";
import { optionalEnv } from "./env.ts";
import type { Menu } from "./orders.ts";

export type ParsedLine = { item_id: string; qty: number; modifiers: { group: string; name: string; price_delta_cents: number }[] };
export type ParseResult = { lines: ParsedLine[]; note: string | null; unclear: boolean };

const Schema = z.object({
  lines: z.array(z.object({
    item: z.string().describe("Exact menu item name"),
    qty: z.number().int().min(1).max(20),
    modifiers: z.array(z.object({ group: z.string(), name: z.string() })),
  })),
  note: z.string().nullable().describe("Any special instruction, e.g. 'extra hot'"),
  unclear: z.boolean().describe("true if the message is not an order or cannot be mapped to the menu"),
});

export async function parseOrderText(text: string, menu: Menu): Promise<ParseResult> {
  const key = optionalEnv("ANTHROPIC_API_KEY");
  if (!key) return keywordMatch(text, menu);

  const menuDoc = menu.categories.map((c) => {
    const items = menu.items.filter((i) => i.category_id === c.id).map((i) => `  - ${i.name}`).join("\n");
    const groups = menu.groups.filter((g) => g.category_id === c.id).map((g) =>
      `  ${g.name} options: ${menu.modifiers.filter((m) => m.group_id === g.id).map((m) => m.name).join(", ")}`
    ).join("\n");
    return `${c.name}:\n${items}${groups ? "\n" + groups : ""}`;
  }).join("\n");

  try {
    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(Schema) },
      system:
        "You convert a customer's WhatsApp message into an order for a gym coffee bar. " +
        "Use only items from the menu and only listed modifier options. If a modifier group is not mentioned, omit it. " +
        "Map casual names (e.g. 'cappa' -> Cappuccino, 'oat flat white' -> Flat white with Milk: Oat). " +
        "If the message is a greeting or question rather than an order, set unclear=true with no lines.\n\nMENU\n" + menuDoc,
      messages: [{ role: "user", content: text }],
    });
    const out = res.parsed_output;
    if (!out || out.unclear) return { lines: [], note: null, unclear: true };
    return mapToMenu(out.lines, out.note, menu);
  } catch (e) {
    console.error("Claude parse failed, falling back to keyword match", e);
    return keywordMatch(text, menu);
  }
}

function mapToMenu(
  lines: { item: string; qty: number; modifiers: { group: string; name: string }[] }[],
  note: string | null,
  menu: Menu,
): ParseResult {
  const out: ParsedLine[] = [];
  for (const l of lines) {
    const item = menu.items.find((i) => i.name.toLowerCase() === l.item.toLowerCase());
    if (!item) continue;
    const groups = menu.groups.filter((g) => g.category_id === item.category_id);
    const mods = groups.flatMap((g) => {
      const wanted = l.modifiers.find((m) => m.group.toLowerCase() === g.name.toLowerCase());
      const opts = menu.modifiers.filter((m) => m.group_id === g.id);
      const chosen = (wanted && opts.find((o) => o.name.toLowerCase() === wanted.name.toLowerCase())) ??
        opts.find((o) => o.is_default) ?? opts[0];
      return chosen ? [{ group: g.name, name: chosen.name, price_delta_cents: chosen.price_delta_cents }] : [];
    });
    out.push({ item_id: item.id, qty: l.qty, modifiers: mods });
  }
  return { lines: out, note, unclear: out.length === 0 };
}

const NUM: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** Cheap fallback: find menu item names in the text, with a number word in front and modifier names anywhere. */
export function keywordMatch(text: string, menu: Menu): ParseResult {
  const t = " " + text.toLowerCase().replace(/[^a-z0-9 ]/g, " ") + " ";
  const lines: ParsedLine[] = [];
  for (const item of menu.items) {
    const name = item.name.toLowerCase();
    const idx = t.indexOf(" " + name);
    if (idx < 0) continue;
    const before = t.slice(0, idx).trim().split(" ").pop() ?? "";
    const qty = NUM[before] ?? (/^\d+$/.test(before) ? Math.min(20, parseInt(before)) : 1);
    const groups = menu.groups.filter((g) => g.category_id === item.category_id);
    const mods = groups.flatMap((g) => {
      const opts = menu.modifiers.filter((m) => m.group_id === g.id);
      const chosen = opts.find((o) => t.includes(" " + o.name.toLowerCase() + " ") || t.includes(" " + o.name.toLowerCase().split(" ")[0] + " ")) ??
        opts.find((o) => o.is_default) ?? opts[0];
      return chosen ? [{ group: g.name, name: chosen.name, price_delta_cents: chosen.price_delta_cents }] : [];
    });
    lines.push({ item_id: item.id, qty, modifiers: mods });
  }
  return { lines, note: null, unclear: lines.length === 0 };
}
