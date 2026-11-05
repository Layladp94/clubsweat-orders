-- Placeholder menu. Replace names and prices with the real ClubSweat menu
-- (edit here before first run, or later in the barista app's Menu tab).
-- Prices are in cents, VAT inclusive.

insert into menu_categories (id, name, sort, credit_eligible) values
  ('11111111-1111-1111-1111-111111111111', 'Coffee',    1, true),
  ('22222222-2222-2222-2222-222222222222', 'Smoothies', 2, false),
  ('33333333-3333-3333-3333-333333333333', 'Extras',    3, false)
on conflict (id) do nothing;

insert into menu_items (category_id, name, description, price_cents, sort) values
  ('11111111-1111-1111-1111-111111111111', 'Flat white',   'Double shot, silky milk',        3800, 1),
  ('11111111-1111-1111-1111-111111111111', 'Cappuccino',   'Double shot, foamed milk',        3800, 2),
  ('11111111-1111-1111-1111-111111111111', 'Americano',    'Double shot, hot water',          3200, 3),
  ('11111111-1111-1111-1111-111111111111', 'Latte',        'Double shot, lots of milk',       4000, 4),
  ('11111111-1111-1111-1111-111111111111', 'Espresso',     'Double shot',                     2800, 5),
  ('11111111-1111-1111-1111-111111111111', 'Iced latte',   'Double shot over ice',            4500, 6),
  ('22222222-2222-2222-2222-222222222222', 'Green machine','Spinach, apple, banana, ginger',  6500, 1),
  ('22222222-2222-2222-2222-222222222222', 'Berry blast',  'Mixed berries, yoghurt, honey',   6500, 2),
  ('22222222-2222-2222-2222-222222222222', 'Peanut power', 'Peanut butter, banana, oats, whey', 7500, 3),
  ('33333333-3333-3333-3333-333333333333', 'Protein scoop','Add whey to any smoothie',        2000, 1),
  ('33333333-3333-3333-3333-333333333333', 'Rusks (2)',    'Buttermilk rusks',                2500, 2);

-- Modifier groups: Size and Milk apply to Coffee
insert into modifier_groups (id, category_id, name, prompt, required, sort) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Size', 'Which size?', true, 1),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Milk', 'Which milk?', true, 2)
on conflict (id) do nothing;

insert into modifiers (group_id, name, price_delta_cents, is_default, sort) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Regular',   0,    true,  1),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Large',     700,  false, 2),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Full cream',0,    true,  1),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Oat',       800,  false, 2),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Almond',    800,  false, 3);

-- Pass products
insert into pass_products (name, kind, credits, valid_days, price_cents, sort) values
  ('10 Coffee Pass',   'credits', 10, 60, 32000, 1),
  ('20 Coffee Pass',   'credits', 20, 90, 60000, 2),
  ('Daily Coffee Pass','daily',   null, 30, 65000, 3);
