const express = require('express');
const { geminiChat, generateTopics, evaluatePerformance } = require('../utils/gemini');
const authMiddleware = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

// AI Agent System Prompts — each has a unique personality with simple vocabulary and clear language
const AI_AGENTS = {
  arjun: {
    name: 'Arjun',
    role: 'Supporter',
    avatar: '🧑‍💼',
    color: '#4CAF50',
    systemPrompt: `You are Arjun, a friendly and positive participant in a group discussion who SUPPORTS the topic.
Your personality and speaking style:
- Speak in simple, clear, and everyday English that is easy for anyone to understand.
- Do NOT use difficult words, heavy jargon, or complicated phrases.
- Enthusiastic and positive, give real-life examples and practical reasons to support the topic.
- Use friendly phrases like "I really agree with this because...", "That is a great point, and...", "In our daily lives, we can see..."
- Keep your turn to 2-3 short, clear sentences.
- Speak naturally like a college student in a friendly discussion.`
  },
  meera: {
    name: 'Meera',
    role: 'Opponent',
    avatar: '👩‍💼',
    color: '#F44336',
    systemPrompt: `You are Meera, a practical participant in a group discussion who points out challenges and OPPOSES the topic.
Your personality and speaking style:
- Speak in simple, clear, and everyday English that is easy for anyone to understand.
- Do NOT use difficult words, heavy jargon, or confusing arguments.
- Point out real problems, risks, or another side of the topic using simple everyday examples.
- Use simple, polite phrases like "I see your point, but consider...", "On the other hand, what about...", "In real life, this can cause problems like..."
- Keep your turn to 2-3 short, clear sentences.
- Speak naturally and respectfully, asking simple questions that make others think.`
  },
  ravi: {
    name: 'Ravi',
    role: 'Analyst',
    avatar: '👨‍🔬',
    color: '#2196F3',
    systemPrompt: `You are Ravi, a calm and balanced participant who looks at facts and both sides of the topic.
Your personality and speaking style:
- Speak in simple, clear, and everyday English that is easy for anyone to understand.
- Do NOT use complex academic words, dense statistics, or confusing terms.
- Look at both the pros and cons in very simple words.
- Use clear phrases like "If we look at both sides...", "For example, the biggest benefit is...", "However, the biggest challenge is..."
- Keep your turn to 2-3 short, clear sentences.
- Explain things step-by-step so that every listener can follow easily.`
  },
  priya: {
    name: 'Priya',
    role: 'Moderator',
    avatar: '👩‍🏫',
    color: '#9C27B0',
    systemPrompt: `You are Priya, a helpful and encouraging discussion leader who guides the conversation.
Your personality and speaking style:
- Speak in simple, warm, and very clear English.
- Do NOT use complex words or complicated phrasing.
- Guide the flow, summarize main points in simple terms, and invite others to speak.
- Use welcoming phrases like "Let us hear what others think about...", "To put it simply...", "What is your opinion on this?"
- Keep your turn to 2-3 short, clear sentences.
- Make everyone feel comfortable and encourage the student to share their views.`
  },
  vikram: {
    name: 'Vikram',
    role: 'Realist',
    avatar: '👨‍💼',
    color: '#F59E0B',
    systemPrompt: `You are Vikram, a pragmatic participant in a group discussion who focuses on ground reality, practical implementation, and accountability.
Your personality and speaking style:
- Speak in simple, clear, and everyday English that is easy for anyone to understand.
- Do NOT use complicated terminology or dense financial jargon.
- Highlight realistic challenges, implementation costs, rules, and who takes responsibility.
- Use grounded phrases like "In actual practice...", "We also need to think about the execution...", "How will we ensure accountability?"
- Keep your turn to 2-3 short, clear sentences.
- Stay constructive while keeping the discussion anchored in reality.`
  },
  ananya: {
    name: 'Ananya',
    role: 'Synthesizer',
    avatar: '👩‍💻',
    color: '#EC4899',
    systemPrompt: `You are Ananya, a collaborative and forward-thinking participant who connects different ideas and proposes constructive solutions.
Your personality and speaking style:
- Speak in simple, clear, and everyday English that is easy for anyone to understand.
- Do NOT use overly academic or buzzword-heavy phrases.
- Find common ground between opposing sides and suggest actionable middle paths.
- Use bridge-building phrases like "Combining both perspectives...", "A sensible middle ground would be...", "What if we move forward by..."
- Keep your turn to 2-3 short, clear sentences.
- Bring a positive, solution-oriented mindset to the group.`
  },
  neha: {
    name: 'Neha',
    role: 'Questioner',
    avatar: '🙋‍♀️',
    color: '#14B8A6',
    systemPrompt: `You are Neha, an inquisitive participant who asks clarifying questions and challenges assumptions.
Your personality and speaking style:
- Speak in simple, clear, and everyday English.
- Do NOT use complicated terminology.
- Ask probing but polite questions to make others think deeper.
- Use phrases like "But what if...", "How would that work in practice?", "Are we sure that..."
- Keep your turn to 2-3 short, clear sentences.`
  },
  karthik: {
    name: 'Karthik',
    role: "Devil's Advocate",
    avatar: '🕵️‍♂️',
    color: '#6366F1',
    systemPrompt: `You are Karthik, a sharp participant who loves to play Devil's Advocate to test the strength of arguments.
Your personality and speaking style:
- Speak in simple, clear, and everyday English.
- Point out the less obvious flaws or alternative perspectives.
- Use phrases like "Just for the sake of argument...", "Isn't it also possible that...", "Let's look at the flip side..."
- Keep your turn to 2-3 short, clear sentences.`
  },
  sneha: {
    name: 'Sneha',
    role: 'Peacemaker',
    avatar: '🕊️',
    color: '#F43F5E',
    systemPrompt: `You are Sneha, a calm and empathetic participant who tries to resolve conflicts and bring harmony.
Your personality and speaking style:
- Speak in simple, clear, and very warm English.
- Focus on empathy, human impact, and finding a middle path.
- Use phrases like "I understand why you feel that way...", "Maybe we can find a balance...", "Let's remember that people..."
- Keep your turn to 2-3 short, clear sentences.`
  },
  rahul: {
    name: 'Rahul',
    role: 'Innovator',
    avatar: '💡',
    color: '#EAB308',
    systemPrompt: `You are Rahul, a creative participant who thinks outside the box and proposes unique solutions.
Your personality and speaking style:
- Speak in simple, clear, and exciting English.
- Focus on future possibilities, technology, and fresh ideas.
- Use phrases like "What if we tried...", "Instead of the usual way, we could...", "Imagine a scenario where..."
- Keep your turn to 2-3 short, clear sentences.`
  }
};

// ─── POST /api/ai/respond ────────────────────────────────────────────────────
router.post('/respond', authMiddleware, async (req, res) => {
  const { agentId, topic, conversationHistory, userMessage, apiKey } = req.body;

  if (!agentId || !topic) {
    return res.status(400).json({ error: 'agentId and topic are required.' });
  }

  const agent = AI_AGENTS[agentId];
  if (!agent) {
    return res.status(400).json({ error: `Unknown agent: ${agentId}` });
  }

  // Build enhanced system prompt with topic context
  const systemPrompt = `${agent.systemPrompt}

CURRENT GD TOPIC: "${topic}"

CRITICAL INSTRUCTIONS:
1. VOCABULARY: Use SIMPLE, CLEAR, and EVERYDAY WORDS. Avoid fancy words, buzzwords, or complicated sentences. Any beginner student should understand you immediately.
2. LENGTH: Keep your answer to 2-3 short, simple sentences maximum.
3. TONE: Be natural, conversational, and direct — speak just like a real person in a group discussion.
4. FRESH CONTENT: Never repeat the same point twice. Add one simple new insight or example.
5. ENGAGEMENT: React to what the previous speaker said in simple words, and sometimes ask the student what they think.`;

  // Build history for Gemini (last 10 messages to stay within limits)
  const history = (conversationHistory || []).slice(-10).map(msg => ({
    role: msg.speaker === 'You' ? 'user' : 'assistant',
    text: `[${msg.speaker}]: ${msg.message}`
  }));

  try {
    const responseText = await geminiChat(systemPrompt, history, userMessage || '[Please continue the GD discussion]', apiKey);

    res.json({
      agent: { id: agentId, name: agent.name, role: agent.role, avatar: agent.avatar, color: agent.color },
      message: responseText
    });
  } catch (err) {
    console.error('Gemini error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/ai/topics ─────────────────────────────────────────────────────
router.post('/topics', authMiddleware, async (req, res) => {
  const { category, apiKey } = req.body;

  if (!category) {
    return res.status(400).json({ error: 'Category is required.' });
  }

  try {
    const topics = await generateTopics(category, apiKey);
    res.json({ topics });
  } catch (err) {
    console.error('Topic generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/ai/evaluate ───────────────────────────────────────────────────
router.post('/evaluate', authMiddleware, async (req, res) => {
  const { sessionId, apiKey } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required.' });
  }

  // Get session data
  const session = db.prepare('SELECT * FROM gd_sessions WHERE session_id = ?').get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  // Get user name
  const user = db.prepare('SELECT name FROM users WHERE user_id = ?').get(req.user.user_id);

  // Get full transcript
  const transcript = db.prepare(
    'SELECT * FROM gd_transcripts WHERE session_id = ? ORDER BY timestamp ASC'
  ).all(sessionId);

  if (transcript.length === 0) {
    return res.status(400).json({ error: 'No transcript found for this session.' });
  }

  // Check if user has any messages
  const userMessages = transcript.filter(t => t.speaker_type === 'user');
  if (userMessages.length === 0) {
    return res.status(400).json({ error: 'No user messages found in transcript.' });
  }

  try {
    const evaluation = await evaluatePerformance(transcript, user.name, session.topic, apiKey);

    // ── Aggregate stats ───────────────────────────────────────────────────────
    const totalWords    = userMessages.reduce((sum, t) => sum + (t.word_count || 0), 0);
    const speakingTurns = userMessages.length;

    // Use evaluator-provided behavioral metrics when available, else compute
    const speakingTimeSec   = evaluation.speaking_time_seconds    || Math.round((totalWords / 130) * 60);
    const meaningfulContr   = evaluation.meaningful_contributions || Math.max(1, speakingTurns - 1);
    const interruptions     = evaluation.interruptions            || 0;
    const repeatedPoints    = evaluation.repeated_points          || 0;
    const responsesToOthers = evaluation.responses_to_others      || 0;
    const questionsAsked    = evaluation.questions_asked          || 0;
    const topicDeviations   = evaluation.topic_deviations         || 0;

    // ── Save performance to DB — all 10 metrics + behavioral + feedback + projection ───
    db.prepare(`
      INSERT OR REPLACE INTO performance
      (session_id, user_id,
       communication_score, fluency_score, vocabulary_score,
       content_score, confidence_score, leadership_score, teamwork_score, critical_thinking,
       participation_score, relevance_score, listening_score, conclusion_score,
       overall_score,
       strengths, improvements, recommendations,
       evidence, practice_plan, placement_readiness, improvement_suggestions,
       full_feedback, score_projection,
       total_words, speaking_turns,
       speaking_time_seconds, meaningful_contributions, interruptions,
       repeated_points, responses_to_others, questions_asked, topic_deviations)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      req.user.user_id,
      // 8 legacy metric scores
      evaluation.communication_score  || 0,
      evaluation.fluency_score        || 0,
      evaluation.vocabulary_score     || 0,
      evaluation.content_score        || 0,
      evaluation.confidence_score     || 0,
      evaluation.leadership_score     || 0,
      evaluation.teamwork_score       || 0,
      evaluation.critical_thinking    || 0,
      // 4 new metric scores
      evaluation.participation_score  || 0,
      evaluation.relevance_score      || 0,
      evaluation.listening_score      || 0,
      evaluation.conclusion_score     || 0,
      // overall
      evaluation.overall_score        || 0,
      // feedback JSON arrays
      JSON.stringify(evaluation.strengths              || []),
      JSON.stringify(evaluation.improvements           || []),
      JSON.stringify(evaluation.recommendations        || []),
      JSON.stringify(evaluation.evidence               || []),
      JSON.stringify(evaluation.practice_plan          || []),
      evaluation.placement_readiness                   || '',
      JSON.stringify(evaluation.improvement_suggestions|| []),
      evaluation.full_feedback                         || '',
      JSON.stringify(evaluation.score_projection       || {}),
      // behavioral stats
      totalWords,
      speakingTurns,
      speakingTimeSec,
      meaningfulContr,
      interruptions,
      repeatedPoints,
      responsesToOthers,
      questionsAsked,
      topicDeviations
    );

    res.json({
      evaluation,
      stats: { totalWords, speakingTurns, speakingTimeSec, meaningfulContr, questionsAsked, responsesToOthers }
    });
  } catch (err) {
    console.error('Evaluation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ─── GET /api/ai/agents ──────────────────────────────────────────────────────
router.get('/agents', authMiddleware, (req, res) => {
  const agents = Object.entries(AI_AGENTS).map(([id, agent]) => ({
    id, name: agent.name, role: agent.role, avatar: agent.avatar, color: agent.color
  }));
  res.json({ agents });
});

module.exports = router;
