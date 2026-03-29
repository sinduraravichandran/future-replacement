import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase.js'
import './StatsTab.css'

function toLocalISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

function calcAge(birthday) {
  if (!birthday) return null
  const today = new Date()
  const dob = new Date(birthday)
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
  return age
}

function formatChartDate(dateStr) {
  const [, m, d] = dateStr.split('-')
  return `${parseInt(m)}/${parseInt(d)}`
}

const CustomTooltip = ({ active, payload, label, unit }) => {
  if (active && payload && payload.length) {
    return (
      <div className="chart-tooltip">
        <p className="tooltip-label">{label}</p>
        <p className="tooltip-value">{payload[0].value}{unit}</p>
      </div>
    )
  }
  return null
}

export default function StatsTab() {
  const [profile, setProfile] = useState(null)
  const [editProfile, setEditProfile] = useState(null)
  const [savingProfile, setSavingProfile] = useState(false)

  const [measurements, setMeasurements] = useState([])
  const [todayLog, setTodayLog] = useState({ weight_lbs: '', waist_in: '', hip_in: '' })
  const [savingMeasurement, setSavingMeasurement] = useState(false)
  const [todayAlreadyLogged, setTodayAlreadyLogged] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [{ data: prof }, { data: meas }] = await Promise.all([
      supabase.from('user_profile').select('*').limit(1).single(),
      supabase.from('measurements').select('*').order('measured_date', { ascending: true }),
    ])
    if (prof) {
      setProfile(prof)
      setEditProfile({
        name: prof.name || '',
        birthday: prof.birthday || '',
        height: prof.height || '',
      })
    }
    if (meas) {
      setMeasurements(meas)
      const today = toLocalISO(new Date())
      const todayEntry = meas.find(m => m.measured_date === today)
      if (todayEntry) {
        setTodayAlreadyLogged(true)
        setTodayLog({
          weight_lbs: todayEntry.weight_lbs ?? '',
          waist_in: todayEntry.waist_in ?? '',
          hip_in: todayEntry.hip_in ?? '',
        })
      } else {
        // Pre-fill with last known values
        const last = meas[meas.length - 1]
        if (last) {
          setTodayLog({
            weight_lbs: last.weight_lbs ?? '',
            waist_in: last.waist_in ?? '',
            hip_in: last.hip_in ?? '',
          })
        }
      }
    }
  }

  async function saveProfile() {
    setSavingProfile(true)
    const updates = {
      name: editProfile.name || null,
      birthday: editProfile.birthday || null,
      height: editProfile.height || null,
    }

    let error
    if (profile?.id) {
      ;({ error } = await supabase.from('user_profile').update(updates).eq('id', profile.id))
    } else {
      ;({ error } = await supabase.from('user_profile').insert(updates))
    }

    if (!error) {
      await updateTrainerMemory({ ...profile, ...updates })
      await loadData()
    }
    setSavingProfile(false)
  }

  async function updateTrainerMemory(prof) {
    const age = calcAge(prof.birthday)
    const memParts = [
      prof.name ? `User's name: ${prof.name}.` : null,
      age ? `Age: ${age}.` : null,
      prof.height ? `Height: ${prof.height}.` : null,
      prof.daily_calories ? `Nutrition targets: ${prof.daily_calories} cal, ${prof.daily_protein_g}g protein, ${prof.daily_fiber_g}g fiber daily.` : null,
    ].filter(Boolean)

    const lastMeasurement = measurements[measurements.length - 1]
    if (lastMeasurement) {
      const parts = []
      if (lastMeasurement.weight_lbs) parts.push(`${lastMeasurement.weight_lbs}lb`)
      if (lastMeasurement.waist_in) parts.push(`waist ${lastMeasurement.waist_in}"`)
      if (lastMeasurement.hip_in) parts.push(`hips ${lastMeasurement.hip_in}"`)
      if (parts.length) memParts.push(`Last recorded measurements: ${parts.join(', ')} on ${lastMeasurement.measured_date}.`)
    }

    memParts.push(`Goal: body recomposition over 16 weeks. Current lifts: 45lb bench press, 200lb leg press, 40lb dumbbell Romanian deadlifts. Trains Tue/Wed/Fri (strength) + Sat (cardio).`)

    const memoryText = memParts.join(' ')
    const { data: existing } = await supabase.from('trainer_memory').select('id').limit(1).single()
    if (existing) {
      await supabase.from('trainer_memory').update({ memory_text: memoryText, updated_at: new Date().toISOString() }).eq('id', existing.id)
    } else {
      await supabase.from('trainer_memory').insert({ memory_text: memoryText })
    }
  }

  async function saveMeasurement() {
    setSavingMeasurement(true)
    const today = toLocalISO(new Date())
    const entry = {
      measured_date: today,
      weight_lbs: todayLog.weight_lbs !== '' ? Number(todayLog.weight_lbs) : null,
      waist_in: todayLog.waist_in !== '' ? Number(todayLog.waist_in) : null,
      hip_in: todayLog.hip_in !== '' ? Number(todayLog.hip_in) : null,
    }

    await supabase.from('measurements').upsert(entry, { onConflict: 'measured_date' })
    await loadData()
    setSavingMeasurement(false)
  }

  const age = calcAge(editProfile?.birthday)
  const chartData = measurements.map(m => ({
    date: formatChartDate(m.measured_date),
    weight: m.weight_lbs,
    waist: m.waist_in,
    hip: m.hip_in,
  }))

  return (
    <div className="stats-tab">
      <div className="stats-header">
        <h1>Stats</h1>
      </div>

      <div className="stats-body">
        {/* Profile */}
        <section className="stats-section">
          <h2 className="section-title">Profile</h2>
          <div className="profile-fields">
            <div className="field-row">
              <label>Name</label>
              <input
                type="text"
                value={editProfile?.name || ''}
                onChange={e => setEditProfile(p => ({ ...p, name: e.target.value }))}
                placeholder="Your name"
                className="field-input"
              />
            </div>
            <div className="field-row">
              <label>Birthday</label>
              <input
                type="date"
                value={editProfile?.birthday || ''}
                onChange={e => setEditProfile(p => ({ ...p, birthday: e.target.value }))}
                className="field-input"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            {age !== null && (
              <div className="field-row derived">
                <label>Age</label>
                <span className="field-derived">{age} years old</span>
              </div>
            )}
            <div className="field-row">
              <label>Height</label>
              <input
                type="text"
                value={editProfile?.height || ''}
                onChange={e => setEditProfile(p => ({ ...p, height: e.target.value }))}
                placeholder={`e.g. 5'3"`}
                className="field-input"
              />
            </div>
          </div>
          <button className="btn-primary btn-full" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? 'Saving...' : 'Save Profile'}
          </button>
        </section>

        {/* Log today */}
        <section className="stats-section">
          <div className="section-title-row">
            <h2 className="section-title">Today's Measurements</h2>
            {todayAlreadyLogged && <span className="logged-badge">Logged</span>}
          </div>
          <div className="measurement-inputs">
            <div className="meas-field">
              <label>Weight</label>
              <div className="meas-input-wrap">
                <input
                  type="number"
                  inputMode="decimal"
                  value={todayLog.weight_lbs}
                  onChange={e => setTodayLog(p => ({ ...p, weight_lbs: e.target.value }))}
                  className="meas-input"
                  placeholder="—"
                />
                <span className="meas-unit">lb</span>
              </div>
            </div>
            <div className="meas-field">
              <label>Waist</label>
              <div className="meas-input-wrap">
                <input
                  type="number"
                  inputMode="decimal"
                  value={todayLog.waist_in}
                  onChange={e => setTodayLog(p => ({ ...p, waist_in: e.target.value }))}
                  className="meas-input"
                  placeholder="—"
                />
                <span className="meas-unit">in</span>
              </div>
            </div>
            <div className="meas-field">
              <label>Hip</label>
              <div className="meas-input-wrap">
                <input
                  type="number"
                  inputMode="decimal"
                  value={todayLog.hip_in}
                  onChange={e => setTodayLog(p => ({ ...p, hip_in: e.target.value }))}
                  className="meas-input"
                  placeholder="—"
                />
                <span className="meas-unit">in</span>
              </div>
            </div>
          </div>
          <button className="btn-primary btn-full" onClick={saveMeasurement} disabled={savingMeasurement}>
            {savingMeasurement ? 'Saving...' : todayAlreadyLogged ? 'Update Today' : 'Log Measurements'}
          </button>
        </section>

        {/* Charts */}
        {chartData.length > 1 && (
          <section className="stats-section">
            <h2 className="section-title">Progress</h2>

            <div className="chart-block">
              <p className="chart-label">Weight (lb)</p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#2e2e2e" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#666', fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                  <Tooltip content={<CustomTooltip unit="lb" />} />
                  <Line type="monotone" dataKey="weight" stroke="#6ee7b7" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#6ee7b7' }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-block">
              <p className="chart-label">Waist (in)</p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#2e2e2e" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#666', fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                  <Tooltip content={<CustomTooltip unit='"' />} />
                  <Line type="monotone" dataKey="waist" stroke="#60a5fa" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#60a5fa' }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-block">
              <p className="chart-label">Hip (in)</p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#2e2e2e" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#666', fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                  <Tooltip content={<CustomTooltip unit='"' />} />
                  <Line type="monotone" dataKey="hip" stroke="#fbbf24" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#fbbf24' }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {chartData.length <= 1 && (
          <section className="stats-section charts-empty">
            <p>Log measurements on at least 2 different days to see your progress charts.</p>
          </section>
        )}
      </div>
    </div>
  )
}
