import Anthropic from '@anthropic-ai/sdk'

// NOTE: In production, API calls to Claude should go through a backend/edge function.
// For this single-user app, we call directly from the client.
export const anthropic = new Anthropic({
  apiKey: import.meta.env.VITE_CLAUDE_API_KEY,
  dangerouslyAllowBrowser: true,
})
