import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { anthropic } from '../lib/claude.js'
import './TrainerTab.css'

const MEMORY_UPDATE_PROMPT = `You are updating a persistent memory file for a personal trainer AI.
Given the conversation below, rewrite the memory blob to incorporate any new facts, preferences, or updates about the user.
Keep it concise plain text. Preserve all existing important facts. Do not mention the conversation itself — just the facts.
Return only the updated memory text, nothing else.`

export default function TrainerTab() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [memory, setMemory] = useState('')
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    loadHistory()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadHistory() {
    const { data: msgs } = await supabase
      .from('chat_messages')
      .select('*')
      .order('created_at', { ascending: true })

    const { data: mem } = await supabase
      .from('trainer_memory')
      .select('*')
      .limit(1)
      .single()

    setMessages(msgs || [])
    setMemory(mem?.memory_text || '')
  }

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setSending(true)

    // Optimistically add user message
    const userMsg = { role: 'user', content: text, created_at: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])

    // Persist user message
    const { data: savedUser } = await supabase
      .from('chat_messages')
      .insert({ role: 'user', content: text })
      .select()
      .single()

    // Build message history for Claude (last 20)
    const allMsgs = [...messages, savedUser]
    const history = allMsgs.slice(-20).map(m => ({ role: m.role, content: m.content }))

    // Get recent workout context
    const { data: recentLogs } = await supabase
      .from('workout_logs')
      .select('*, workouts(name, scheduled_date)')
      .order('completed_at', { ascending: false })
      .limit(5)

    const { data: profile } = await supabase
      .from('user_profile')
      .select('*')
      .limit(1)
      .single()

    const systemPrompt = buildSystemPrompt(memory, recentLogs, profile)

    // Call Claude
    let assistantContent = ''
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: history,
      })
      assistantContent = response.content[0].text
    } catch (err) {
      assistantContent = "Sorry, I'm having trouble connecting right now. Try again in a moment."
    }

    // Add assistant message to UI
    const assistantMsg = { role: 'assistant', content: assistantContent, created_at: new Date().toISOString() }
    setMessages(prev => [...prev, assistantMsg])
    setSending(false)

    // Persist assistant message
    await supabase.from('chat_messages').insert({ role: 'assistant', content: assistantContent })

    // Async memory update (non-blocking)
    updateMemory([...allMsgs, assistantMsg], memory)
  }

  async function updateMemory(msgs, currentMemory) {
    try {
      const recentConvo = msgs.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n')
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `${MEMORY_UPDATE_PROMPT}\n\nCurrent memory:\n${currentMemory}\n\nRecent conversation:\n${recentConvo}`
        }]
      })
      const newMemory = response.content[0].text

      const { data: existing } = await supabase.from('trainer_memory').select('id').limit(1).single()
      if (existing) {
        await supabase.from('trainer_memory').update({ memory_text: newMemory, updated_at: new Date().toISOString() }).eq('id', existing.id)
      } else {
        await supabase.from('trainer_memory').insert({ memory_text: newMemory })
      }
      setMemory(newMemory)
    } catch (_) {}
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="trainer-tab">
      <div className="trainer-header">
        <h1>Trainer</h1>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && !sending && (
          <div className="chat-empty">
            <p>Ask me anything about your program, nutrition, or how you're feeling today.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`msg msg-${msg.role}`}>
            <div className="msg-bubble">{msg.content}</div>
          </div>
        ))}
        {sending && (
          <div className="msg msg-assistant">
            <div className="msg-bubble typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message your trainer..."
          rows={1}
          className="chat-input"
          disabled={sending}
        />
        <button className="send-btn" onClick={send} disabled={!input.trim() || sending}>
          <SendIcon />
        </button>
      </div>
    </div>
  )
}

function buildSystemPrompt(memory, recentLogs, profile) {
  const parts = [
    `You are a personal trainer AI with persistent memory of your client. Be concise, practical, and encouraging.`,
  ]

  if (memory) {
    parts.push(`\nWhat you know about the client:\n${memory}`)
  }

  if (profile) {
    parts.push(`\nNutrition targets: ${profile.daily_calories} cal/day, ${profile.daily_protein_g}g protein, ${profile.daily_fiber_g}g fiber`)
  }

  if (recentLogs && recentLogs.length > 0) {
    const logStr = recentLogs
      .map(l => `- ${l.workouts?.name || 'Workout'} on ${l.workouts?.scheduled_date} (${Math.round((l.duration_seconds || 0) / 60)}min)`)
      .join('\n')
    parts.push(`\nRecent workout history:\n${logStr}`)
  }

  parts.push(`\nYou can: answer questions about the program, suggest exercise swaps, adjust nutrition advice, review history. Keep replies short and mobile-friendly.`)

  return parts.join('\n')
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  )
}
