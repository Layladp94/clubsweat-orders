import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { barAction, DEMO, supabase } from "./supabase";
import Board from "./Board";
import Inbox from "./Inbox";
import MenuTab from "./MenuTab";
import Settings from "./Settings";

type Tab = "orders" | "inbox" | "menu" | "settings";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("orders");
  const [isOpen, setIsOpen] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (DEMO) { setSession({} as Session); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || DEMO) return;
    supabase.from("bar_settings").select("is_open").eq("id", 1).single().then(({ data }) => {
      if (data) setIsOpen(data.is_open);
    });
  }, [session]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (session === undefined) return null;
  if (!session) return <Login />;

  const toggleOpen = async () => {
    const next = !isOpen;
    if (DEMO) { setIsOpen(next); return; }
    const r = await barAction({ action: "set_open", is_open: next });
    if (r.ok) setIsOpen(next); else setToast(r.error ?? "Failed");
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">club sweat. bar</span>
        <nav className="tabs">
          {(["orders", "inbox", "menu", "settings"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <button className={`pill ${isOpen ? "open" : "closed"}`} onClick={toggleOpen}>
          <span className="dot" />{isOpen ? "Taking orders" : "Closed"}
        </button>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <main className="main">
        {tab === "orders" && <Board notify={setToast} />}
        {tab === "inbox" && <Inbox notify={setToast} />}
        {tab === "menu" && <MenuTab notify={setToast} />}
        {tab === "settings" && <Settings notify={setToast} onOpenChange={setIsOpen} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  };

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>club sweat.</h1>
        <p className="sub">Bar screen · sign in</p>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {error && <div className="error">{error}</div>}
        <button className="btn-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
