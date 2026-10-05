require('dotenv').config();
const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ─── CURATED OFFLINE TOPICS BY CATEGORY ──────────────────────────────────────
const FALLBACK_TOPICS = {
  Technology: [
    'Is Artificial Intelligence helping human creativity or replacing jobs?',
    'Should Social Media platforms be held responsible for fake news and misinformation?',
    'Data Privacy in the Digital Age: Is personal privacy still possible online?',
    'Self-Driving Cars: Are automated vehicles safe and ready for Indian roads?',
    'Work From Home vs Office: Which is better for productivity and career growth?',
    'Digital Currency and Crypto: The future of money or a risky gamble?'
  ],
  Economy: [
    'Universal Basic Income: A helpful safety net or a discouragement to work?',
    'Online Shopping vs Local Stores: Does online shopping hurt small shopkeepers?',
    'Startups in India: Are company valuations realistic or overhyped?',
    'Gig Economy and Delivery Apps: Freedom of work or lack of job security?',
    'Local Manufacturing vs Global Trade: Should countries prioritize making everything locally?',
    'Solar and Green Energy: Can countries grow fast while cutting pollution?'
  ],
  'Social Issues': [
    'Impact of Short Videos (Reels and Shorts) on student focus and mental health',
    'Work-Life Balance: Are long working hours necessary to succeed?',
    'Exams and Marks: Do test scores reflect real intelligence or block creativity?',
    'Climate Change: What is more effective — individual habits or government rules?',
    'Gender Equality: Are modern workplaces truly giving equal opportunities?',
    'Mental Health: How can schools and colleges talk more openly about stress?'
  ],
  General: [
    'Has social media made people more connected or more lonely?',
    'Is a college degree still necessary to build a successful career?',
    'Leadership vs Management: Which is more important during difficult times?',
    'Voting: Should voting in national elections be made compulsory?',
    'Hard Skills vs Communication Skills: What matters more for getting hired?',
    'Ethics vs Profit: Can modern businesses be honest and still make high profits?'
  ]
};

// ─── CURATED AGENT FALLBACK STATEMENTS (SIMPLE VOCABULARY) ──────────────────
const FALLBACK_PERSONA_RESPONSES = {
  Arjun: [
    "I agree with this topic. In our everyday lives, we can see real benefits and new opportunities opening up for students and young people.",
    "That is a really good point. If we use this properly and follow good habits, it helps everyone do their work faster and better.",
    "I want to add that when people try new things with an open mind, it brings positive changes for our society."
  ],
  Meera: [
    "I understand your point, but we also need to think about the problems. Not everyone has equal access, and it can create unfair situations.",
    "I see it a bit differently. If we are not careful, there are real risks like misuse, privacy issues, and lack of proper rules.",
    "That sounds nice in theory, but in real life, many people struggle to adapt. We must address these practical difficulties first."
  ],
  Ravi: [
    "Let us look at both sides simply. There is a clear advantage on one hand, but also a cost and challenge on the other hand.",
    "To understand this easily, think about the practical impact: who gains the most, and what problems do we need to fix first?",
    "A good solution is to take the best parts of both ideas. We can move forward step-by-step instead of rushing into it."
  ],
  Priya: [
    "That is an interesting view! Let us hear what others think about this. What has been your personal experience?",
    "To put it simply, we are seeing good points on both sides. Let us now talk about what action we should take next.",
    "Thank you for sharing that point. Would anyone like to add another example from daily life?"
  ],
  Vikram: [
    "We need to be realistic here. Without clear rules and honest checks, good intentions alone are not enough to solve the problem.",
    "Let us keep it simple: who is responsible if things go wrong? We need clear accountability before moving forward.",
    "That might work in ideal conditions, but in everyday reality, people often face very different practical issues."
  ],
  Rohan: [
    "To summarize where we stand so far: we all agree that change is happening, but we need to manage it step-by-step.",
    "Both sides have raised valid everyday points. Finding a middle ground will give us the most practical solution.",
    "As we wrap up this point, our main takeaway is that balance and clear guidelines are key."
  ],
  Ananya: [
    "To bring these points together simply, we can combine the best ideas from both sides to find a realistic solution.",
    "I think we can take a balanced step forward: use the positive benefits while setting clear safety boundaries.",
    "Looking at what everyone has said, the best way is to start with a pilot approach and learn as we grow."
  ],
  Neha: [
    "But what if we consider how this actually plays out in a real-world scenario?",
    "That is interesting, but are we sure that assumption holds true for everyone?",
    "Could you explain how that would work practically if things do not go as planned?"
  ],
  Karthik: [
    "Just to play devil's advocate, what happens if this backfires completely?",
    "Isn't it possible that the opposite is true and we're missing the real issue?",
    "Let's look at the flip side for a moment. This might actually cause more problems than it solves."
  ],
  Sneha: [
    "I understand where everyone is coming from. Maybe we can find a balance that helps everyone.",
    "Let's remember the human impact here. We need a solution that considers people's feelings.",
    "There might be a middle ground where both sides can actually agree on a few core principles."
  ],
  Rahul: [
    "What if we thought completely outside the box and tried something brand new?",
    "Instead of the usual approaches, we could leverage technology to solve this creatively.",
    "Imagine a future where this isn't even a problem anymore because of a totally fresh idea."
  ]
};

/**
 * Send a prompt to the Gemini API and return the text response.
 */
async function geminiChat(systemPrompt, history = [], userMessage, apiKey) {
  const key = apiKey || GEMINI_API_KEY;

  if (!key) {
    // Return intelligent simulated response based on persona if detected in systemPrompt
    for (const [name, responses] of Object.entries(FALLBACK_PERSONA_RESPONSES)) {
      if (systemPrompt.includes(name)) {
        const idx = Math.floor(Math.random() * responses.length);
        return responses[idx];
      }
    }
    return "That brings up an essential dimension of the topic. Considering both practical constraints and long-term impact will help us form a balanced perspective.";
  }

  try {
    const contents = [];
    for (const msg of history) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.text }]
      });
    }

    contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });

    const requestBody = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents,
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 512,
        topP: 0.9,
        topK: 40
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    };

    const response = await fetch(`${GEMINI_API_URL}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const err = await response.text();
      console.warn(`Gemini API returned ${response.status}: ${err}. Falling back to dynamic offline response.`);
      for (const [name, responses] of Object.entries(FALLBACK_PERSONA_RESPONSES)) {
        if (systemPrompt.includes(name)) {
          return responses[Math.floor(Math.random() * responses.length)];
        }
      }
      return "That brings up an essential dimension. Considering both practical constraints and long-term impact helps us form a balanced view.";
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? text.trim() : "I agree with that point and would like to build further on it.";
  } catch (networkErr) {
    console.warn('Network error reaching Gemini, using offline fallback:', networkErr.message);
    for (const [name, responses] of Object.entries(FALLBACK_PERSONA_RESPONSES)) {
      if (systemPrompt.includes(name)) {
        return responses[Math.floor(Math.random() * responses.length)];
      }
    }
    return "Valid point. Moving forward, how should we structure the implementation?";
  }
}

/**
 * Generate a list of GD topics for a given category.
 */
async function generateTopics(category, apiKey) {
  const key = apiKey || GEMINI_API_KEY;

  if (!key) {
    const list = FALLBACK_TOPICS[category] || FALLBACK_TOPICS.General;
    // Shuffle and return 6
    return [...list].sort(() => 0.5 - Math.random()).slice(0, 6);
  }

  try {
    const prompt = `Generate exactly 6 thought-provoking Group Discussion topics for the category: "${category}".
Return ONLY a valid JSON array of strings, like:
["Topic 1", "Topic 2", "Topic 3", "Topic 4", "Topic 5", "Topic 6"]`;

    const result = await geminiChat('You are a GD topic expert.', [], prompt, key);
    const match = result.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (err) {
    console.warn('Gemini topic generation fallback:', err.message);
  }

  return FALLBACK_TOPICS[category] || FALLBACK_TOPICS.General;
}

/**
 * Evaluate a full GD transcript and return a 10-metric performance evaluation.
 * Uses the expert evaluator prompt with exact weighted scoring.
 */
async function evaluatePerformance(transcript, userName, topic, apiKey) {
  const key = apiKey || GEMINI_API_KEY;

  // ── Derive basic stats from transcript ──────────────────────────────────────
  const userTurns = transcript.filter(t =>
    t.speaker_type === 'user' ||
    (t.speaker && (t.speaker.includes('You') || t.speaker.toLowerCase().includes(userName.toLowerCase())))
  );
  const totalUserWords = userTurns.reduce(
    (acc, t) => acc + (t.word_count || (t.message ? t.message.split(/\s+/).length : 0)), 0
  );
  const turnsCount = userTurns.length;

  if (!key) {
    return generateSmartOfflineEvaluation(userTurns, totalUserWords, turnsCount, userName, topic);
  }

  try {
    const transcriptText = transcript
      .map(t => `[${t.speaker}]: ${t.message}`)
      .join('\n');

    const evaluatorSystemPrompt = `You are an expert AI Group Discussion evaluator for a placement-preparation platform.
Evaluate each participant's performance using objective, measurable, and explainable metrics.
You MUST respond ONLY with valid JSON matching the exact schema provided. No markdown, no prose outside JSON.`;

    const evaluatorPrompt = `Evaluate the performance of participant "${userName}" in the following Group Discussion.

TOPIC: "${topic}"

TRANSCRIPT:
${transcriptText}

EVALUATION RUBRIC — Score each category 0–10 (stored as 0–100 in output):

1. content_quality (weight 15%): Relevance of ideas, accuracy, depth, examples
2. communication (weight 15%): Clarity, fluency, vocabulary, sentence formation
3. participation (weight 10%): Number of meaningful contributions, speaking balance, avoids silence/over-speaking
4. relevance (weight 10%): Stays on topic, avoids repetition and tangents
5. listening_response (weight 10%): Responds to others, builds on ideas, shows understanding before disagreeing
6. teamwork (weight 10%): Encourages others, cooperates, maintains positive environment
7. leadership (weight 10%): Initiates discussion, guides conversation, connects viewpoints, helps reach conclusion
8. critical_thinking (weight 10%): Logical arguments, identifies problems/solutions, compares viewpoints, gives reasoning
9. confidence_professionalism (weight 5%): Confident communication, respectful language, handles disagreement calmly
10. conclusion (weight 5%): Summarizes key points, connects opinions, provides clear conclusion

Overall Score = (content_quality*15 + communication*15 + participation*10 + relevance*10 + listening_response*10 + teamwork*10 + leadership*10 + critical_thinking*10 + confidence_professionalism*5 + conclusion*5) / 100

FAIRNESS RULES:
- Evaluate ONLY "${userName}", not others
- Never reward speaking quantity over quality
- Do not penalize for accent, gender, or background
- Base all feedback on actual transcript content

Return ONLY this JSON (all scores 0–100, no markdown):
{
  "participant": "${userName}",
  "overall_score": <weighted 0-100>,
  "metrics": {
    "content_quality": <0-100>,
    "communication": <0-100>,
    "participation": <0-100>,
    "relevance": <0-100>,
    "listening_response": <0-100>,
    "teamwork": <0-100>,
    "leadership": <0-100>,
    "critical_thinking": <0-100>,
    "confidence_professionalism": <0-100>,
    "conclusion": <0-100>
  },
  "behavioral_metrics": {
    "speaking_time_seconds": <estimated from word count at 130 WPM>,
    "speaking_turns": <count of their turns>,
    "meaningful_contributions": <turns with substantive new points>,
    "interruptions": <count of interruptions>,
    "repeated_points": <count of repeated ideas>,
    "responses_to_others": <count of direct responses to other speakers>,
    "questions_asked": <count of questions>,
    "topic_deviations": <count of off-topic remarks>
  },
  "strengths": ["<specific strength 1 with example>", "<specific strength 2>", "<specific strength 3>"],
  "weaknesses": ["<specific weakness 1 with example>", "<specific weakness 2>", "<specific weakness 3>"],
  "evidence": [
    "<direct quote or paraphrase from their speech with score rationale>",
    "<another evidence point>",
    "<another evidence point>"
  ],
  "improvement_suggestions": {
    "communication": "<actionable, specific suggestion>",
    "content": "<actionable, specific suggestion>",
    "teamwork": "<actionable, specific suggestion>"
  },
  "practice_plan": [
    "<step 1 — specific practice activity>",
    "<step 2>",
    "<step 3>",
    "<step 4>",
    "<step 5>"
  ],
  "full_feedback": "<2–3 paragraph evidence-based narrative feedback>",
  "placement_readiness": "<one-sentence placement readiness verdict with score interpretation: Excellent/Very Good/Good/Needs Improvement/Requires Significant Practice>"
}`;

    const result = await geminiChat(evaluatorSystemPrompt, [], evaluatorPrompt, key);

    // Strip any markdown fences if the model added them
    const cleaned = result.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return normalizeEvaluation(parsed, turnsCount, totalUserWords, userTurns);
    }
  } catch (err) {
    console.warn('Gemini evaluation API error, applying algorithmic evaluation:', err.message);
  }

  return generateSmartOfflineEvaluation(userTurns, totalUserWords, turnsCount, userName, topic);
}

/**
 * Helper to build the 10-metric score projection details object
 */
function buildScoreProjection(metrics, turnsCount, totalWords, userTurns = []) {
  const contentQ   = Number(metrics.content_score || metrics.content_quality || 70);
  const comm       = Number(metrics.communication_score || metrics.communication || 70);
  const partic     = Number(metrics.participation_score || metrics.participation || 70);
  const relev      = Number(metrics.relevance_score || metrics.relevance || 70);
  const listening  = Number(metrics.listening_score || metrics.listening_response || 70);
  const teamwork   = Number(metrics.teamwork_score || metrics.teamwork || 70);
  const leadership = Number(metrics.leadership_score || metrics.leadership || 70);
  const critThink  = Number(metrics.critical_thinking || 70);
  const confProf   = Number(metrics.confidence_score || metrics.confidence_professionalism || 70);
  const conclusion = Number(metrics.conclusion_score || metrics.conclusion || 70);

  const responsesToOthers = userTurns.filter(t => t.message && /\b(agree|disagree|build|add|point|said|think)\b/i.test(t.message)).length;
  const questionsAsked = userTurns.filter(t => t.message && t.message.includes('?')).length;
  const hasSummary = userTurns.some(t => t.message && /\b(conclude|summary|summarize|overall|final)\b/i.test(t.message));

  const items = [
    {
      metric: 'Content Quality', icon: '💡', weight: '15%', weight_num: 0.15,
      score: contentQ, weighted_points: Number((contentQ * 0.15).toFixed(2)),
      rationale: totalWords < 25 ? 'Very low word count limits arguments and topic depth.' : totalWords >= 150 ? 'Strong volume of meaningful arguments provided.' : 'Moderate topic depth provided.'
    },
    {
      metric: 'Communication', icon: '🗣️', weight: '15%', weight_num: 0.15,
      score: comm, weighted_points: Number((comm * 0.15).toFixed(2)),
      rationale: comm >= 75 ? 'Fluent vocabulary and clear sentence structure.' : 'Work on more structured sentence formation.'
    },
    {
      metric: 'Participation', icon: '🙋', weight: '10%', weight_num: 0.10,
      score: partic, weighted_points: Number((partic * 0.10).toFixed(2)),
      rationale: `Projected directly from your ${turnsCount} active speaking turn(s) in discussion.`
    },
    {
      metric: 'Relevance', icon: '🎯', weight: '10%', weight_num: 0.10,
      score: relev, weighted_points: Number((relev * 0.10).toFixed(2)),
      rationale: relev >= 75 ? 'Remained focused on topic without off-topic tangents.' : 'Minor topic drift detected in turns.'
    },
    {
      metric: 'Listening & Response', icon: '👂', weight: '10%', weight_num: 0.10,
      score: listening, weighted_points: Number((listening * 0.10).toFixed(2)),
      rationale: responsesToOthers > 0 ? `Responded directly to peer points in ${responsesToOthers} turn(s).` : 'No direct references or responses to peer points detected.'
    },
    {
      metric: 'Teamwork', icon: '🤝', weight: '10%', weight_num: 0.10,
      score: teamwork, weighted_points: Number((teamwork * 0.10).toFixed(2)),
      rationale: teamwork >= 75 ? 'Collaborative tone, encouraging group discussion flow.' : 'Acknowledge peer ideas more explicitly before adding yours.'
    },
    {
      metric: 'Leadership', icon: '👑', weight: '10%', weight_num: 0.10,
      score: leadership, weighted_points: Number((leadership * 0.10).toFixed(2)),
      rationale: turnsCount <= 1 ? 'Single turn limits leadership opportunities.' : leadership >= 75 ? 'Initiated or guided conversation direction effectively.' : 'Helped maintain discussion flow.'
    },
    {
      metric: 'Critical Thinking', icon: '🧠', weight: '10%', weight_num: 0.10,
      score: critThink, weighted_points: Number((critThink * 0.10).toFixed(2)),
      rationale: critThink >= 75 ? 'Logical reasoning and analytical points provided.' : 'Support claims with more real-world examples or data.'
    },
    {
      metric: 'Confidence', icon: '💪', weight: '5%', weight_num: 0.05,
      score: confProf, weighted_points: Number((confProf * 0.05).toFixed(2)),
      rationale: 'Maintained professional tone and confident delivery.'
    },
    {
      metric: 'Conclusion', icon: '📌', weight: '5%', weight_num: 0.05,
      score: conclusion, weighted_points: Number((conclusion * 0.05).toFixed(2)),
      rationale: hasSummary ? 'Included concluding summary in discussion.' : 'No explicit concluding summary contributed at end of GD.'
    }
  ];

  const totalWeighted = Number(items.reduce((sum, item) => sum + item.weighted_points, 0).toFixed(1));

  const activityLevel =
    turnsCount >= 4 && totalWords >= 120 ? '🔥 High Active Engagement' :
    turnsCount >= 2 && totalWords >= 35 ? '⚡ Moderate Active Engagement' :
    '⚠️ Low Active Engagement';

  return {
    formula: 'Overall Score = (Content × 0.15) + (Communication × 0.15) + (Participation × 0.10) + (Relevance × 0.10) + (Listening × 0.10) + (Teamwork × 0.10) + (Leadership × 0.10) + (Critical Thinking × 0.10) + (Confidence × 0.05) + (Conclusion × 0.05)',
    activity_level: activityLevel,
    activity_metrics_summary: `${turnsCount} speaking turn(s), ${totalWords} total word(s) (${Math.round(totalWords / Math.max(1, turnsCount))} words/turn), ${responsesToOthers} peer response(s), ${questionsAsked} question(s) asked.`,
    items,
    total_projected_score: Math.round(totalWeighted)
  };
}

/**
 * Normalize API response to ensure all required fields are present
 * and map nested metrics back to flat DB fields.
 */
function normalizeEvaluation(parsed, turnsCount, totalWords, userTurns = []) {
  const m = parsed.metrics || {};
  const bm = parsed.behavioral_metrics || {};
  const impSug = parsed.improvement_suggestions || {};

  const metricsObj = {
    content_score:          Number(m.content_quality          || m.content_score || 70),
    communication_score:    Number(m.communication            || 70),
    participation_score:    Number(m.participation            || 70),
    relevance_score:        Number(m.relevance                || 70),
    listening_score:        Number(m.listening_response       || 70),
    teamwork_score:         Number(m.teamwork                 || 70),
    leadership_score:       Number(m.leadership               || 70),
    critical_thinking:      Number(m.critical_thinking        || 70),
    confidence_score:       Number(m.confidence_professionalism || m.confidence_score || 70),
    conclusion_score:       Number(m.conclusion               || 70)
  };

  const scoreProj = parsed.score_projection && parsed.score_projection.items
    ? parsed.score_projection
    : buildScoreProjection(metricsObj, turnsCount, totalWords, userTurns);

  return {
    ...metricsObj,
    fluency_score:          metricsObj.communication_score,
    vocabulary_score:       metricsObj.content_score,
    overall_score: Number(parsed.overall_score || computeWeightedScore(m)),
    speaking_time_seconds:    Number(bm.speaking_time_seconds    || Math.round((totalWords / 130) * 60)),
    speaking_turns:           Number(bm.speaking_turns           || turnsCount),
    meaningful_contributions: Number(bm.meaningful_contributions || Math.max(1, turnsCount - 1)),
    interruptions:            Number(bm.interruptions            || 0),
    repeated_points:          Number(bm.repeated_points         || 0),
    responses_to_others:      Number(bm.responses_to_others     || 0),
    questions_asked:          Number(bm.questions_asked         || 0),
    topic_deviations:         Number(bm.topic_deviations        || 0),
    total_words:              totalWords,
    strengths:    Array.isArray(parsed.strengths)  ? parsed.strengths  : [],
    improvements: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
    recommendations: Array.isArray(parsed.practice_plan) ? parsed.practice_plan : [],
    evidence:    Array.isArray(parsed.evidence)    ? parsed.evidence   : [],
    practice_plan: Array.isArray(parsed.practice_plan) ? parsed.practice_plan : [],
    improvement_suggestions: [
      impSug.communication || '',
      impSug.content       || '',
      impSug.teamwork      || ''
    ].filter(Boolean),
    full_feedback:       parsed.full_feedback       || '',
    placement_readiness: parsed.placement_readiness || '',
    score_projection:    scoreProj
  };
}

/**
 * Compute weighted overall score from 10 metrics.
 */
function computeWeightedScore(m) {
  return Math.round(
    (Number(m.content_quality          || 0) * 0.15) +
    (Number(m.communication            || 0) * 0.15) +
    (Number(m.participation            || 0) * 0.10) +
    (Number(m.relevance                || 0) * 0.10) +
    (Number(m.listening_response       || 0) * 0.10) +
    (Number(m.teamwork                 || 0) * 0.10) +
    (Number(m.leadership               || 0) * 0.10) +
    (Number(m.critical_thinking        || 0) * 0.10) +
    (Number(m.confidence_professionalism || 0) * 0.05) +
    (Number(m.conclusion               || 0) * 0.05)
  );
}

/**
 * Algorithmic 10-metric evaluation engine (offline fallback).
 * Evaluates performance strictly based on active user turns & quotes.
 */
function generateSmartOfflineEvaluation(userTurns, totalWords, turnsCount, userName, topic) {
  // Extract user text samples for evidence & quotes
  const userMessages = userTurns.map(t => t.message || '').filter(Boolean);
  const sample1 = userMessages[0] ? `"${userMessages[0].substring(0, 90)}${userMessages[0].length > 90 ? '...' : ''}"` : '';
  const sample2 = userMessages[1] ? `"${userMessages[1].substring(0, 90)}${userMessages[1].length > 90 ? '...' : ''}"` : '';

  // Calculate peer interaction & questions
  const responseKeywords = /\b(agree|disagree|build|add|point|mentioned|said|think|respond|reply)\b/i;
  const responsesToOthers = userTurns.filter(t => t.message && responseKeywords.test(t.message)).length;
  const questionsAsked = userTurns.filter(t => t.message && t.message.includes('?')).length;
  const summaryKeywords = /\b(conclude|summary|summarize|overall|final|wrap|end)\b/i;
  const hasSummary = userTurns.some(t => t.message && summaryKeywords.test(t.message));

  let contentQ, comm, partic, relev, listening, teamwork, leadership, critThink, confProf, conclusion;

  if (turnsCount <= 1 || totalWords < 25) {
    // Low participation branch
    partic     = Math.max(25, Math.min(45, turnsCount * 25 + totalWords));
    leadership = Math.max(25, Math.min(40, 20 + turnsCount * 10));
    contentQ   = Math.max(30, Math.min(50, 20 + totalWords * 1.2));
    comm       = Math.max(40, Math.min(60, 35 + totalWords * 0.8));
    relev      = 55;
    listening  = 35;
    teamwork   = 40;
    critThink  = 35;
    confProf   = 50;
    conclusion = hasSummary ? 65 : 25;
  } else if (turnsCount <= 3 || totalWords < 90) {
    // Moderate participation branch
    partic     = 65 + (turnsCount - 2) * 5;
    leadership = 60 + (turnsCount - 2) * 5;
    contentQ   = 65 + Math.min(15, Math.round(totalWords / 10));
    comm       = 70;
    relev      = 75;
    listening  = 65 + responsesToOthers * 5;
    teamwork   = 68 + responsesToOthers * 4;
    critThink  = 68;
    confProf   = 72;
    conclusion = hasSummary ? 80 : 55;
  } else {
    // High active participation branch
    partic     = Math.min(95, 80 + (turnsCount - 4) * 3);
    leadership = Math.min(92, 78 + (turnsCount - 4) * 3);
    contentQ   = Math.min(92, 75 + Math.round(totalWords / 20));
    comm       = Math.min(90, 78 + Math.round(totalWords / 30));
    relev      = 85;
    listening  = Math.min(90, 75 + responsesToOthers * 5);
    teamwork   = Math.min(90, 76 + responsesToOthers * 4);
    critThink  = Math.min(90, 75 + questionsAsked * 4);
    confProf   = 85;
    conclusion = hasSummary ? 90 : 65;
  }

  const clamp = v => Math.max(25, Math.min(98, Math.round(v)));
  contentQ   = clamp(contentQ);
  comm       = clamp(comm);
  partic     = clamp(partic);
  relev      = clamp(relev);
  listening  = clamp(listening);
  teamwork   = clamp(teamwork);
  leadership = clamp(leadership);
  critThink  = clamp(critThink);
  confProf   = clamp(confProf);
  conclusion = clamp(conclusion);

  const overall = Math.round(
    contentQ * 0.15 + comm * 0.15 + partic * 0.10 + relev * 0.10 +
    listening * 0.10 + teamwork * 0.10 + leadership * 0.10 + critThink * 0.10 +
    confProf * 0.05 + conclusion * 0.05
  );

  const metricsObj = {
    content_score: contentQ, communication_score: comm, participation_score: partic,
    relevance_score: relev, listening_score: listening, teamwork_score: teamwork,
    leadership_score: leadership, critical_thinking: critThink, confidence_score: confProf,
    conclusion_score: conclusion
  };

  const scoreProjection = buildScoreProjection(metricsObj, turnsCount, totalWords, userTurns);

  // Evidence array with exact user quotes
  const evidence = [];
  if (sample1) {
    evidence.push(`Turn 1 Quote: ${sample1} — ${totalWords < 25 ? 'Brief response with limited supporting detail.' : 'Good opening contribution establishing active participation.'}`);
  } else {
    evidence.push(`No active turns recorded for ${userName}. Zero verbal contribution detected.`);
  }

  if (sample2) {
    evidence.push(`Turn 2 Quote: ${sample2} — ${responsesToOthers > 0 ? 'Direct interaction with other speakers.' : 'Continued individual viewpoint.'}`);
  } else if (turnsCount === 1) {
    evidence.push(`Only 1 speaking turn contributed (${totalWords} words total). Aim for 3–5 turns in competitive GDs.`);
  } else {
    evidence.push(`Contributed ${turnsCount} turn(s) with ${totalWords} total words.`);
  }

  if (hasSummary) {
    evidence.push('Contributed concluding remarks near discussion wrap-up, boosting Leadership and Conclusion scores.');
  } else {
    evidence.push('Did not contribute a concluding summary — adding a 2-sentence summary at discussion end adds up to +15 pts.');
  }

  // Strengths & Weaknesses based strictly on activity
  const strengths = [];
  const weaknesses = [];

  if (partic >= 75) strengths.push(`Active participation across ${turnsCount} turns (${totalWords} words total) showing consistent presence.`);
  else weaknesses.push(`Low participation (${turnsCount} turn${turnsCount !== 1 ? 's' : ''}, ${totalWords} words) — target at least 4 turns and 100+ words per session.`);

  if (contentQ >= 75) strengths.push('Strong content depth with relevant topic points and arguments.');
  else weaknesses.push('Strengthen content quality by backing up each point with a real-world example or statistic.');

  if (listening >= 75) strengths.push('High active listening — acknowledged and built upon other participants\' points.');
  else weaknesses.push('Improve active listening — explicitly reference peer contributions ("I agree with Meera\'s point...").');

  if (conclusion >= 75) strengths.push('Effectively summarized key points during the discussion wrap-up.');
  else weaknesses.push('Practice concluding skills — summarize 2 key points in 2 clear sentences at the end.');

  while (strengths.length < 3) strengths.push('Maintained a polite, constructive, and professional communication tone throughout.');
  while (weaknesses.length < 3) weaknesses.push('Structure contributions as: Claim → Evidence → Impact for maximum clarity.');

  const placementScore =
    overall >= 88 ? 'Excellent — ready for top-tier company placement GDs' :
    overall >= 78 ? 'Very Good — strong active candidate with minor refinements needed' :
    overall >= 65 ? 'Good — solid foundation, requires more consistent active turns' :
    overall >= 50 ? 'Needs Improvement — low speaking volume; practice active contribution' :
                    'Requires Significant Practice — very low participation detected; active speaking is essential';

  const fullFeedback = `Evaluation for ${userName} on GD Topic: "${topic}"

Activity Summary: You contributed ${turnsCount} turn(s) with a total of ${totalWords} word(s) (${Math.round((totalWords/130)*60)} seconds estimated speaking time).

${turnsCount <= 1 || totalWords < 30 ? 
  '⚠️ CRITICAL PARTICIPATION FEEDBACK: Your active participation in this discussion was very low. In competitive Group Discussions, silence or minimal participation (1 brief turn) heavily penalizes your score across Participation (10%), Leadership (10%), and Content Quality (15%). To improve your score projection, you must speak at least 3-4 times per session.' :
  '✅ ACTIVE PARTICIPATION FEEDBACK: You demonstrated active engagement in the discussion. Your contributions showed clear alignment with the topic and maintained discussion momentum.'
}

Score Projection Analysis: Your projected overall score of ${overall}/100 is calculated using a 10-metric weighted formula. Your active turn count (${turnsCount}) and content volume directly influenced your Participation (${partic}/100) and Content Quality (${contentQ}/100) scores. ${responsesToOthers > 0 ? 'Your peer responses positively impacted your Listening score.' : 'Adding direct responses to peer points will boost your Listening score.'}`;

  return {
    content_score: contentQ, communication_score: comm, participation_score: partic,
    relevance_score: relev, listening_score: listening, teamwork_score: teamwork,
    leadership_score: leadership, critical_thinking: critThink, confidence_score: confProf,
    conclusion_score: conclusion, fluency_score: comm, vocabulary_score: contentQ,
    overall_score: overall,
    speaking_time_seconds: Math.round((totalWords / 130) * 60),
    speaking_turns: turnsCount, meaningful_contributions: Math.max(1, turnsCount - 1),
    interruptions: 0, repeated_points: 0, responses_to_others: responsesToOthers,
    questions_asked: questionsAsked, topic_deviations: 0, total_words: totalWords,
    strengths, improvements: weaknesses, recommendations: [
      'Aim for 4–5 active speaking turns in every 10-minute GD session.',
      'Use transition phrases like "Building on that point..." to demonstrate active listening.',
      'Structure every turn: Claim → Real-world Example → Impact on topic.',
      'Always offer a 2-sentence summary at the end of the discussion to claim Leadership points.'
    ],
    evidence, practice_plan: [
      'Week 1: Focus on active initiation — speak within the first 90 seconds of the GD.',
      'Week 2: Practice peer acknowledgment — reference what another speaker said before adding your point.',
      'Week 3: Structure arguments — practice speaking for 45 seconds using Claim-Evidence-Impact format.',
      'Week 4: Master conclusions — summarize the main viewpoints of the group in 2 concise sentences.'
    ],
    improvement_suggestions: [
      `Communication: Your current volume is ${totalWords} words across ${turnsCount} turn(s). Increase turn frequency for better communication flow.`,
      'Content: Provide specific data points or real-life examples rather than general statements.',
      'Teamwork: Actively encourage quieter participants or respond to points made by peers.'
    ],
    full_feedback: fullFeedback,
    placement_readiness: placementScore,
    score_projection: scoreProjection
  };
}

/**
 * Generate comprehensive topic background content, arguments, pros/cons, and facts
 * for the discussion participants and AI context.
 */
async function generateTopicContext(topic, apiKey) {
  const key = apiKey || GEMINI_API_KEY;

  if (key) {
    try {
      const prompt = `You are an expert GD debate and discussion analyst.
Generate structured discussion material for the GD topic: "${topic}".
Return ONLY a valid JSON object matching this schema:
{
  "overview": "<2-3 sentence clear, balanced summary of what the topic means and why it is being discussed>",
  "pros": [
    "<strong argument in favor 1 with practical example>",
    "<strong argument in favor 2 with practical example>",
    "<strong argument in favor 3 with practical example>"
  ],
  "cons": [
    "<strong counter-argument / challenge 1 with practical example>",
    "<strong counter-argument / challenge 2 with practical example>",
    "<strong counter-argument / challenge 3 with practical example>"
  ],
  "facts": [
    "<relevant statistic, real-world case study or fact 1>",
    "<relevant statistic, real-world case study or fact 2>",
    "<relevant statistic, real-world case study or fact 3>"
  ],
  "discussion_angles": [
    "Economic Impact",
    "Social & Ethical Implications",
    "Technology & Innovation",
    "Policy & Governance"
  ]
}`;
      const result = await geminiChat('You are a GD research analyst.', [], prompt, key);
      const cleaned = result.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
    } catch (err) {
      console.warn('Gemini topic context generation error, using fallback:', err.message);
    }
  }

  // Smart Offline Fallback Topic Context
  return {
    overview: `The topic "${topic}" explores key shifts in technology, economy, and society. A constructive group discussion balances practical real-world benefits against implementation risks, accessibility, and long-term societal impact.`,
    pros: [
      `Enables significant efficiency, higher productivity, and opens up new career opportunities.`,
      `Democratizes access to tools, knowledge, and services across diverse demographic groups.`,
      `Drives innovation and accelerates problem-solving in education, business, and daily life.`
    ],
    cons: [
      `Can widen the digital and economic divide if access and infrastructure are unequal.`,
      `Raises genuine concerns regarding data privacy, job transitions, and over-dependence.`,
      `Requires strong regulatory frameworks and ethical guidelines that often lag behind adoption.`
    ],
    facts: [
      `Global adoption studies highlight over 60% acceleration in digital and automated workflows in recent years.`,
      `Workforce readiness surveys suggest that continuous reskilling is now required for more than 40% of core job skills.`,
      `Successful implementations universally depend on human-in-the-loop oversight and clear accountability.`
    ],
    discussion_angles: [
      'Individual & Student Perspective',
      'Economic & Employment Outlook',
      'Ethical & Privacy Considerations',
      'Realistic Implementation Solutions'
    ]
  };
}

module.exports = { geminiChat, generateTopics, evaluatePerformance, generateTopicContext };

