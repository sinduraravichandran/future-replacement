# PRD: Personal Training App

## Overview
A mobile-first web app that acts as a personal AI trainer. It manages a 16-week recomposition program, guides the user through workouts in real time, and provides a persistent AI chat interface that remembers context across sessions.

Single user, no auth for v1. Deployed as a web app, opened in **Chrome on mobile**. Add to home screen for native feel.

---

## Tech Stack
- **Frontend:** React (Vite), mobile-first CSS
- **Database:** Supabase (Postgres)
- **AI:** Claude API (claude-sonnet-4-20250514)
- **Hosting:** Vercel (free tier)

---

## Navigation
Two tabs, persistent bottom nav:

1. **Schedule** (default)
2. **Trainer** (chat)

---

## Tab 1: Schedule

### Calendar View
- Google Calendar "Schedule" style — a continuous scrollable list grouped by date
- Past workouts scroll up, upcoming scroll down
- Today is anchored on loadls
- Each day shows: workout name (e.g. "Day A — Upper Body"), status badge (Completed / Upcoming / Missed)
- Days with no workout show as rest days
- Default workout days: **Tuesday, Wednesday, Friday, Saturday**

### Rescheduling Workouts
- Any upcoming workout can be moved to a different date
- Tapping a workout → detail sheet has a "Move to..." option (date picker)
- If the target date already has a workout, the two workouts swap scheduled dates (same modal flow as the "start future workout" swap)
- If the target date is empty, the workout simply moves there
- Completed and in-progress workouts cannot be moved
- The schedule view updates immediately after a move

### Workout Detail View
Tapping a workout opens a detail sheet:
- Workout name, estimated duration
- Full exercise list: exercise name, sets × reps, rest time (warmup exercises listed first, cooldown last — all inline, no separate sections)
- **Move to...** button to reschedule the workout to a different date
- **Start Workout** button at the bottom, active for any workout (past or future)

**Starting a future workout:**
- If the user taps Start on a future workout and a workout is already scheduled for today, a modal appears: "You have [workout name] scheduled for today. Swap dates and start this one instead?"
- Confirming swaps the two workouts' scheduled dates in the DB and begins the selected workout
- If nothing is scheduled for today, it starts immediately with no prompt

---

## Active Workout View
Triggered by tapping Start. Full screen takeover.

### Strength Exercises
- Current exercise displayed prominently: name, sets × reps, prescribed weight
- User logs **actual reps and actual weight** per set (both fields editable, pre-filled with prescribed values)
- **Complete Set** button — logs each set individually with actual reps + actual weight
- After each set: countdown rest timer (auto-advances when done, skippable)
- After all sets: **Next Exercise** button
- Short video clip of the exercise (v2 — placeholder UI now)
- "Form cue" button → plays voiceover of form instructions (v2)

### Workout Overview Drawer
- Persistent button in the bottom left: "View Workout" (or list icon)
- Tapping it slides up a drawer showing the full exercise list for the session
- Completed exercises are checked/greyed, current exercise is highlighted, upcoming exercises are listed below
- Dismissible, returns to active exercise view

### Cardio
- Timer only
- If interval training: auto-cycles through intervals with label ("Work — 30s", "Rest — 60s"), plays a beep on transition (Web Audio API)

### Warmup / Cooldown
- Warmup exercises are the first items in the exercise sequence; cooldown are the last
- No special treatment — they flow through with the same Next pattern as all other exercises
- Timed holds or rep-based stretches use the same set/rep/rest UI as strength exercises

### Completion
- After last exercise: "Workout Complete" screen with summary (total time, exercises done)
- Auto-saves to history as completed

---

## Tab 2: Trainer (Chat)

Standard chat UI — user messages right, AI messages left.

### How Memory Works
- Supabase has a `trainer_memory` table with a single row: a text blob written in plain language (e.g. "User is 115lb, 5'3", training age 3.5 years. Reported left knee discomfort on 3/15. Responded well to RDLs. Wants to prioritize glute development...")
- On every message send: app fetches the memory blob, passes it as system prompt context alongside the conversation history
- After every AI response: a second Claude call rewrites/updates the memory blob with any new facts or preferences surfaced in the conversation (runs async, non-blocking)
- Conversation history: last 20 messages stored in Supabase, passed with every call for in-session continuity

### What the Trainer Can Do
- Answer questions about the program
- Swap an exercise (updates the program in DB)
- Adjust weight, volume, rest times
- Advise on nutrition (calories, protein, fiber targets are stored in profile)
- Review recent workout history when asked

---

## Data Schema

```sql
-- The program (16 weeks of workouts, AI-generated on first load)
programs (
  id, created_at, prompt_used, raw_response, is_active
)

-- Individual scheduled workout days
workouts (
  id, program_id, scheduled_date, name, type (strength/cardio), 
  status (upcoming/completed/missed), week_number, day_label
)

-- Exercises within a workout (prescribed)
exercises (
  id, workout_id, name, order, sets, reps, weight_lbs, 
  rest_seconds, notes, category (warmup/main/cooldown/cardio)
)

-- What the user actually did
workout_logs (
  id, workout_id, completed_at, duration_seconds
)

exercise_logs (
  id, workout_log_id, exercise_id, set_number, 
  actual_reps, actual_weight_lbs, logged_at
)

-- Cardio logs
cardio_logs (
  id, workout_log_id, duration_seconds, type
)

-- AI trainer memory
trainer_memory (
  id, memory_text, updated_at
)

-- Chat history
chat_messages (
  id, role (user/assistant), content, created_at
)

-- User profile / nutrition targets
user_profile (
  id, daily_calories, daily_protein_g, daily_fiber_g, notes
)
```

---

## Program Generation

On first app load, if no active program exists, the app calls Claude to generate the program. Week 1 starts on the date of first load. Workouts are scheduled on **Tuesday, Wednesday, Friday, and Saturday** by default (fitting 4 sessions per week into the 16-week plan). The response is parsed into the DB schema (workouts + exercises for all 16 weeks).

```
You are an elite strength coach and sports nutritionist specialising in body recomposition for intermediate 
natural lifters. I want to achieve genuine body recomposition — building muscle while
simultaneously losing body fat — over the next 16 weeks. My stats are: 5'3', 31 year old woman, 115lb. 
I have been training consistently for 3.5 years. My current lifts are: 45lb bench press, 200lb leg press, 
40lb in each hand dumbbell hamstrings. I can train 3 days per week for strength and 1 for cardio, 
30-45min workouts.

Build me a complete recomposition blueprint. Return the full 16-week training programme as structured 
JSON in this exact format:

{
  "nutrition": {
    "daily_calories": number,
    "daily_protein_g": number,
    "daily_fiber_g": number,
    "notes": string
  },
  "weeks": [
    {
      "week_number": 1,
      "days": [
        {
          "day_label": "Day A - Upper Body",
          "type": "strength",
          "exercises": [
            {
              "category": "warmup|main|cooldown",
              "name": string,
              "sets": number,
              "reps": string,
              "weight_lbs": number,
              "rest_seconds": number,
              "notes": string
            }
          ]
        }
      ]
    }
  ]
}

Every workout must begin with warmup exercises (category: "warmup") and end with cooldown exercises
(category: "cooldown"). These are plain exercises in the same array as the main lifts — do NOT
separate them. They flow through in order: warmup → main → cooldown. For cardio days, use
category "cardio" and include interval breakdowns in the notes field if applicable. Do not use
any category other than "warmup", "main", "cooldown", or "cardio".
```

The nutrition values get stored in `user_profile`. The program gets stored in `programs` + `workouts` + `exercises`.

---

## V1 Scope
- Schedule view + workout detail
- Active workout flow (strength + cardio)
- Set/rep/weight logging (actual reps + actual weight per set)
- Workout swap logic for future workouts (start future workout / swap with today)
- Workout rescheduling (move any upcoming workout to a different date)
- Workout overview drawer during active session
- Workout completion + history storage
- AI chat with persistent memory
- Program generation on first load (Week 1 starts on date of first app load)

## V2 (Defer)
- Exercise video clips
- Form cue voiceover
- Auth / multi-device
- Progress charts
- Weight progression suggestions
- Push notifications for scheduled workouts

---

## Build Order for Claude Code
1. Supabase schema + seed the program (get real data first)
2. Schedule view
3. Active workout flow
4. Chat + memory