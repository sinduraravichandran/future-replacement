-- Add profile fields to user_profile
alter table user_profile add column if not exists name text;
alter table user_profile add column if not exists birthday date;
alter table user_profile add column if not exists height text;

-- Measurements history (at most one entry per day)
create table if not exists measurements (
  id uuid primary key default gen_random_uuid(),
  measured_date date not null unique,
  weight_lbs numeric,
  waist_in numeric,
  hip_in numeric,
  created_at timestamptz default now()
);

create index if not exists measurements_date_idx on measurements(measured_date desc);
