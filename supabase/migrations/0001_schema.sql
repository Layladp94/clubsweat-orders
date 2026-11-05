-- ClubSweat Coffee Bar: WhatsApp ordering schema
-- Run with: supabase db push   (or paste into the SQL editor)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Customers (one row per WhatsApp number)
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id            uuid primary key default gen_random_uuid(),
  wa_id         text unique not null,          -- digits only, e.g. 27821234567
  name          text,
  opted_in      boolean not null default true,  -- messaged us = opted in; "STOP" clears it
  state         jsonb not null default '{}'::jsonb,  -- bot conversation state
  last_order_id uuid,
  last_inbound_at timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Menu
-- ---------------------------------------------------------------------------
create table if not exists menu_categories (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  sort     int  not null default 0,
  credit_eligible boolean not null default false  -- can a coffee pass pay for items in this category?
);

create table if not exists menu_items (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references menu_categories(id) on delete cascade,
  name         text not null,                 -- max 24 chars (WhatsApp list row title limit)
  description  text,                          -- max 72 chars
  price_cents  int  not null check (price_cents >= 0),
  active       boolean not null default true,
  sort         int not null default 0
);

-- Modifier groups (Size, Milk...) apply per category. Each group has up to 10 options.
create table if not exists modifier_groups (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references menu_categories(id) on delete cascade,
  name         text not null,       -- "Size", "Milk"
  prompt       text not null,       -- "Which size?"
  required     boolean not null default true,
  sort         int not null default 0
);

create table if not exists modifiers (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references modifier_groups(id) on delete cascade,
  name              text not null,     -- "Large", "Oat milk"
  price_delta_cents int  not null default 0,
  is_default        boolean not null default false,
  sort              int not null default 0
);

-- ---------------------------------------------------------------------------
-- Passes (prepaid coffee memberships)
-- ---------------------------------------------------------------------------
create table if not exists pass_products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,            -- "10 Coffee Pass"
  kind        text not null check (kind in ('credits','daily')),
  credits     int,                      -- for kind = credits
  valid_days  int not null default 30,
  price_cents int not null,
  active      boolean not null default true,
  sort        int not null default 0
);

create table if not exists passes (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references customers(id) on delete cascade,
  product_id        uuid not null references pass_products(id),
  kind              text not null,
  credits_remaining int,
  starts_at         timestamptz not null default now(),
  expires_at        timestamptz not null,
  last_daily_use    date,               -- for kind = daily: one coffee per calendar day
  status            text not null default 'active' check (status in ('active','expired','lapsed')),
  reminder_sent_at  timestamptz,
  renewal_payment_id uuid,
  created_at        timestamptz not null default now()
);
create index if not exists passes_customer_idx on passes(customer_id, status);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  short_code    text not null default upper(substr(encode(gen_random_bytes(3),'hex'),1,4)), -- shown to customer + barista
  customer_id   uuid not null references customers(id) on delete cascade,
  status        text not null default 'draft'
                check (status in ('draft','awaiting_payment','paid','making','ready','collected','cancelled')),
  total_cents   int not null default 0,
  paid_with     text check (paid_with in ('yoco','pass')),
  pass_id       uuid references passes(id),
  note          text,
  created_at    timestamptz not null default now(),
  paid_at       timestamptz,
  ready_at      timestamptz,
  collected_at  timestamptz
);
create index if not exists orders_status_idx on orders(status, created_at desc);
create index if not exists orders_customer_idx on orders(customer_id, created_at desc);

create table if not exists order_lines (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  item_id          uuid references menu_items(id),
  item_name        text not null,
  qty              int  not null default 1 check (qty > 0),
  unit_price_cents int  not null,
  modifiers        jsonb not null default '[]'::jsonb,   -- [{group:"Size", name:"Large", price_delta_cents:500}]
  line_total_cents int  not null,
  credit_eligible  boolean not null default false,
  paid_by_credit   boolean not null default false
);

-- ---------------------------------------------------------------------------
-- Payments (one row per Yoco checkout we create)
-- ---------------------------------------------------------------------------
create table if not exists payments (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null default 'yoco',
  checkout_id   text unique,
  redirect_url  text,
  purpose       text not null check (purpose in ('order','pass')),
  order_id      uuid references orders(id) on delete set null,
  pass_product_id uuid references pass_products(id),
  customer_id   uuid not null references customers(id) on delete cascade,
  amount_cents  int not null,
  status        text not null default 'created' check (status in ('created','succeeded','failed','cancelled')),
  created_at    timestamptz not null default now(),
  succeeded_at  timestamptz
);

-- Idempotency for inbound webhooks (WhatsApp message ids, Yoco event ids)
create table if not exists webhook_events (
  provider    text not null,
  event_id    text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Message log (both directions) – also feeds the chat inbox
-- ---------------------------------------------------------------------------
create table if not exists messages (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers(id) on delete cascade,
  direction     text not null check (direction in ('in','out')),
  wa_message_id text,
  kind          text not null default 'text',   -- text | interactive | template | system
  body          text,                           -- human-readable summary
  payload       jsonb,
  sent_by       text,                           -- 'bot' | 'staff' | null for inbound
  created_at    timestamptz not null default now()
);
create index if not exists messages_customer_idx on messages(customer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Bar settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists bar_settings (
  id            int primary key default 1 check (id = 1),
  is_open       boolean not null default true,
  prep_minutes  int not null default 6,
  closed_message text not null default 'The bar is closed right now. We are open weekdays 06:30 to 17:00 and Saturdays 07:00 to 13:00.',
  updated_at    timestamptz not null default now()
);
insert into bar_settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Row level security: the barista app signs in with Supabase Auth.
-- Any authenticated user (there will be one or two bar logins) can read/write
-- the operational tables. Edge functions use the service role and bypass RLS.
-- ---------------------------------------------------------------------------
alter table customers        enable row level security;
alter table menu_categories  enable row level security;
alter table menu_items       enable row level security;
alter table modifier_groups  enable row level security;
alter table modifiers        enable row level security;
alter table pass_products    enable row level security;
alter table passes           enable row level security;
alter table orders           enable row level security;
alter table order_lines      enable row level security;
alter table payments         enable row level security;
alter table webhook_events   enable row level security;
alter table messages         enable row level security;
alter table bar_settings     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['customers','menu_categories','menu_items','modifier_groups','modifiers',
                           'pass_products','passes','orders','order_lines','payments','messages','bar_settings']
  loop
    execute format('drop policy if exists staff_all on %I', t);
    execute format('create policy staff_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Realtime for the barista board
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table orders, messages;

-- ---------------------------------------------------------------------------
-- Helper view for the board
-- ---------------------------------------------------------------------------
create or replace view order_board as
select o.id, o.short_code, o.status, o.total_cents, o.paid_with, o.note,
       o.created_at, o.paid_at, o.ready_at,
       c.name as customer_name, c.wa_id,
       coalesce(json_agg(json_build_object(
         'item_name', l.item_name, 'qty', l.qty, 'modifiers', l.modifiers
       ) order by l.id) filter (where l.id is not null), '[]') as lines
from orders o
join customers c on c.id = o.customer_id
left join order_lines l on l.order_id = o.id
group by o.id, c.name, c.wa_id;
