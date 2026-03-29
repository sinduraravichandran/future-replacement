-- Programs table
create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  prompt_used text,
  raw_response text,
  is_active boolean default true
);

-- Workouts table
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references programs(id) on delete cascade,
  scheduled_date date not null,
  name text not null,
  type text not null check (type in ('strength', 'cardio')),
  status text not null default 'upcoming' check (status in ('upcoming', 'completed', 'missed')),
  week_number integer not null,
  day_label text not null,
  estimated_duration_minutes integer
);

-- Exercises table
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid references workouts(id) on delete cascade,
  name text not null,
  "order" integer not null,
  sets integer,
  reps text,
  weight_lbs numeric,
  rest_seconds integer,
  notes text,
  category text not null check (category in ('warmup', 'main', 'cooldown', 'cardio'))
);

-- Workout logs (completed sessions)
create table if not exists workout_logs (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid references workouts(id) on delete cascade,
  completed_at timestamptz default now(),
  duration_seconds integer
);

-- Per-set exercise logs
create table if not exists exercise_logs (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid references workout_logs(id) on delete cascade,
  exercise_id uuid references exercises(id) on delete cascade,
  set_number integer not null,
  actual_reps integer,
  actual_weight_lbs numeric,
  logged_at timestamptz default now()
);

-- Cardio logs
create table if not exists cardio_logs (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid references workout_logs(id) on delete cascade,
  duration_seconds integer,
  type text
);

-- AI trainer memory (single row)
create table if not exists trainer_memory (
  id uuid primary key default gen_random_uuid(),
  memory_text text,
  updated_at timestamptz default now()
);

-- Chat history
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

-- User profile / nutrition
create table if not exists user_profile (
  id uuid primary key default gen_random_uuid(),
  daily_calories integer,
  daily_protein_g integer,
  daily_fiber_g integer,
  notes text
);

-- Indexes for common queries
create index if not exists workouts_scheduled_date_idx on workouts(scheduled_date);
create index if not exists workouts_program_id_idx on workouts(program_id);
create index if not exists exercises_workout_id_idx on exercises(workout_id);
create index if not exists exercise_logs_workout_log_id_idx on exercise_logs(workout_log_id);
create index if not exists chat_messages_created_at_idx on chat_messages(created_at desc);
