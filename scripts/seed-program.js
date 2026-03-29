/**
 * Generates a 16-week training program via Claude and seeds it into Supabase.
 * Run once: node scripts/seed-program.js
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { jsonrepair } from 'jsonrepair'

// Load env manually for Node (Vite doesn't apply here)
const envFile = readFileSync('.env', 'utf-8')
const env = Object.fromEntries(
  envFile.split('\n')
    .filter(l => l.includes('='))
    .map(l => {
      const [k, ...v] = l.split('=')
      return [k.trim(), v.join('=').trim()]
    })
)

const SUPABASE_URL = env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY
const CLAUDE_API_KEY = env.VITE_CLAUDE_API_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const anthropic = new Anthropic({ apiKey: CLAUDE_API_KEY })

const BASE_CONTEXT = `You are an elite strength coach specialising in body recomposition for intermediate natural lifters.
Client: 5'3", 31 year old woman, 115lb, 3.5 years training experience.
Current lifts: 45lb bench press, 200lb leg press, 40lb dumbbell Romanian deadlifts.
Schedule: Tuesday/Wednesday/Friday strength, Saturday cardio. 30-45 min workouts.
Goal: body recomposition over 16 weeks.`

const WEEKS_PROMPT = (startWeek, endWeek, isFirst) => `${BASE_CONTEXT}

${isFirst
  ? `First provide the nutrition plan. Then generate weeks ${startWeek}-${endWeek} of the 16-week program.`
  : `Generate weeks ${startWeek}-${endWeek} of the 16-week program (continuing from week ${startWeek - 1}).`}

Return ONLY raw JSON, no markdown, no explanation. Format:

${isFirst ? `{
  "nutrition": {
    "daily_calories": number,
    "daily_protein_g": number,
    "daily_fiber_g": number,
    "notes": string
  },
  "weeks": [...]
}` : `{
  "weeks": [...]
}`}

Each week: { "week_number": number, "days": [...] }
Each day: { "day_label": string, "type": "strength"|"cardio", "estimated_duration_minutes": number, "exercises": [...] }
Each exercise: { "category": "warmup"|"main"|"cooldown"|"cardio", "name": string, "sets": number, "reps": string, "weight_lbs": number, "rest_seconds": number, "notes": string, "order": number }

Rules:
- Every workout must start with warmup exercises and end with cooldown exercises
- Cardio day exercises all use category "cardio", put interval details in notes
- order is sequential starting at 1 within each workout
- Include ONLY weeks ${startWeek} through ${endWeek}`

async function callClaude(prompt, label) {
  console.log(`\n${label}...`)
  let text = ''
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  })
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      text += chunk.delta.text
      process.stdout.write('.')
    }
  }
  process.stdout.write('\n')
  return text.trim()
}

function parseJSON(raw) {
  const jsonStr = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '')
  try {
    return JSON.parse(jsonStr)
  } catch (_) {
    console.log('Attempting JSON repair...')
    return JSON.parse(jsonrepair(jsonStr))
  }
}

function getNextWeekday(baseDate, targetDow) {
  const d = new Date(baseDate)
  const diff = (targetDow - d.getDay() + 7) % 7
  d.setDate(d.getDate() + diff)
  return d
}

function getScheduledDate(programStart, weekNumber, dayOfWeek) {
  const base = new Date(programStart)
  base.setDate(base.getDate() + (weekNumber - 1) * 7)
  return getNextWeekday(base, dayOfWeek)
}

function dateToISO(d) {
  return d.toISOString().split('T')[0]
}

async function insertWeeks(weeks, programId, programStart) {
  const DOWS = [2, 3, 5, 6] // Tue, Wed, Fri, Sat
  for (const week of weeks) {
    for (let i = 0; i < week.days.length; i++) {
      const day = week.days[i]
      const scheduledDate = getScheduledDate(programStart, week.week_number, DOWS[i % DOWS.length])

      const { data: workout, error: workoutError } = await supabase
        .from('workouts')
        .insert({
          program_id: programId,
          scheduled_date: dateToISO(scheduledDate),
          name: day.day_label,
          type: day.type,
          status: 'upcoming',
          week_number: week.week_number,
          day_label: day.day_label,
          estimated_duration_minutes: day.estimated_duration_minutes || 40,
        })
        .select()
        .single()

      if (workoutError) throw workoutError

      const exercises = day.exercises.map((ex, idx) => ({
        workout_id: workout.id,
        name: ex.name,
        order: ex.order ?? idx + 1,
        sets: ex.sets,
        reps: ex.reps,
        weight_lbs: ex.weight_lbs,
        rest_seconds: ex.rest_seconds,
        notes: ex.notes,
        category: ex.category,
      }))

      const { error: exError } = await supabase.from('exercises').insert(exercises)
      if (exError) throw exError
    }
    console.log(`  Week ${week.week_number} seeded`)
  }
}

async function main() {
  // Clear any existing data
  console.log('Clearing existing program data...')
  await supabase.from('programs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('user_profile').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('trainer_memory').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  console.log('Cleared.')

  // Call 1: weeks 1-8 + nutrition
  const raw1 = await callClaude(WEEKS_PROMPT(1, 8, true), 'Generating weeks 1-8 + nutrition')
  const part1 = parseJSON(raw1)
  console.log(`Part 1: ${part1.weeks?.length ?? 0} weeks received`)

  // Call 2: weeks 9-16
  const raw2 = await callClaude(WEEKS_PROMPT(9, 16, false), 'Generating weeks 9-16')
  const part2 = parseJSON(raw2)
  console.log(`Part 2: ${part2.weeks?.length ?? 0} weeks received`)

  const allWeeks = [...(part1.weeks || []), ...(part2.weeks || [])]
  const nutrition = part1.nutrition
  console.log(`\nTotal weeks: ${allWeeks.length}. Inserting into Supabase...`)

  // Insert program record
  const { data: program, error: programError } = await supabase
    .from('programs')
    .insert({ prompt_used: BASE_CONTEXT, raw_response: raw1 + '\n---\n' + raw2, is_active: true })
    .select()
    .single()
  if (programError) throw programError

  // Insert nutrition
  const { error: profileError } = await supabase.from('user_profile').insert({
    daily_calories: nutrition.daily_calories,
    daily_protein_g: nutrition.daily_protein_g,
    daily_fiber_g: nutrition.daily_fiber_g,
    notes: nutrition.notes,
  })
  if (profileError) throw profileError

  // Program starts next Tuesday
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const programStart = getNextWeekday(today, 2)
  console.log(`Program starts: ${dateToISO(programStart)}\n`)

  await insertWeeks(allWeeks, program.id, programStart)

  // Seed trainer memory
  await supabase.from('trainer_memory').insert({
    memory_text: `User is a 31-year-old woman, 5'3", 115lb, training age 3.5 years. Goal: body recomposition over 16 weeks. Current lifts: 45lb bench press, 200lb leg press, 40lb dumbbell Romanian deadlifts. Trains Tue/Wed/Fri (strength) + Sat (cardio). Nutrition targets: ${nutrition.daily_calories} cal, ${nutrition.daily_protein_g}g protein, ${nutrition.daily_fiber_g}g fiber daily.`,
  })

  console.log('\nDone! 16-week program seeded successfully.')
  console.log(`Nutrition: ${nutrition.daily_calories} cal | ${nutrition.daily_protein_g}g protein | ${nutrition.daily_fiber_g}g fiber`)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
