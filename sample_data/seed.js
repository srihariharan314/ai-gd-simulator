/**
 * Seed Script for AI Group Discussion Simulator
 * Populates sample user, completed GD sessions, realistic transcripts, and performance scores.
 * Run with: node sample_data/seed.js
 */

const bcrypt = require('../backend/node_modules/bcryptjs');
const db = require('../backend/db');

console.log('🌱 Seeding database...');

const seed = db.transaction(() => {
  // 1. Create or get demo user
  const demoEmail = 'demo@gd.com';
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(demoEmail);

  if (!user) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('demo123', salt);
    const res = db.prepare(`
      INSERT INTO users (name, email, password, bio)
      VALUES (?, ?, ?, ?)
    `).run('Alex Morgan', demoEmail, hash, 'Aspirant preparing for placement & MBA group discussions.');
    user = { user_id: res.lastInsertRowid, name: 'Alex Morgan', email: demoEmail };
    console.log('👤 Created demo user: demo@gd.com / demo123');
  } else {
    console.log('👤 Using existing demo user:', user.email);
  }

  // Clear existing sessions for this demo user to avoid duplicates on re-seed
  db.prepare('DELETE FROM gd_sessions WHERE user_id = ?').run(user.user_id);

  // 2. Insert Completed Sessions with rich transcripts & performance
  const sampleSessions = [
    {
      topic: 'Is Artificial Intelligence replacing human creativity or augmenting it?',
      category: 'Technology',
      mode: 'ai',
      duration: 720,
      scores: {
        comm: 84, fluency: 82, vocab: 86, content: 88, conf: 85, lead: 80, team: 88, crit: 90, overall: 85,
        filler_words: 3, total_words: 290, turns: 4,
        strengths: [
          'Excellent framing with the distinction between procedural automation vs conceptual creativity',
          'Polite yet firm interjections when disagreeing with opposing views',
          'Effective reference to graphic design and AI coding tools as co-pilots'
        ],
        improvements: [
          'Could have concluded the round by synthesizing common points made by peers',
          'Noticeable pause at minute 6 before entering the ethical IP discussion'
        ],
        recommendations: [
          'Practice leading the final consensus in the last 60 seconds of a GD',
          'Expand on legal & copyright frameworks surrounding generative AI models'
        ],
        full_feedback: 'Alex displayed remarkable clarity and structured reasoning throughout this discussion. You entered the conversation early with high confidence, set an open and objective tone, and supported arguments with contemporary industry examples. Your critical thinking score was particularly distinguished.'
      },
      transcripts: [
        { speaker: 'Moderator', type: 'system', message: 'Welcome to this Group Discussion on AI and Human Creativity. The floor is now open.' },
        { speaker: 'Alex Morgan (You)', type: 'user', message: 'Good afternoon everyone. I believe AI should not be viewed as an adversary to human creativity, but rather as an amplifier. Throughout history, tools like the camera did not destroy painters; they birthed photography and modernism.' },
        { speaker: 'Vikram', type: 'ai', message: 'While I appreciate your optimistic comparison, Alex, generative models today generate poetry, music, and art that challenge the livelihood of creators without ethical consent.' },
        { speaker: 'Alex Morgan (You)', type: 'user', message: 'Vikram makes an important ethical point about attribution and intellectual property. However, raw generative output still requires human curation, emotional resonance, and contextual judgment to achieve authentic artistic depth.' },
        { speaker: 'Priya', type: 'ai', message: 'I agree with Alex on the curation aspect. In our design agency experiments, AI acts like a high-speed intern sketching 100 concepts in seconds, while the creative director remains human.' },
        { speaker: 'Rohan', type: 'ai', message: 'Can we also consider economic barriers? Not every artist has access to enterprise compute or licensing.' },
        { speaker: 'Alex Morgan (You)', type: 'user', message: 'Precisely, Rohan. Democratizing access while establishing transparent watermarking standards will ensure creativity remains an inclusive human pursuit assisted by technology.' }
      ]
    },
    {
      topic: 'Work From Home vs Return to Office: Finding the Sustainable Balance',
      category: 'Economy',
      mode: 'ai',
      duration: 600,
      scores: {
        comm: 80, fluency: 78, vocab: 82, content: 84, conf: 79, lead: 75, team: 85, crit: 82, overall: 81,
        filler_words: 5, total_words: 240, turns: 3,
        strengths: [
          'Balanced perspectives addressing both employee wellbeing and corporate culture',
          'Respected speaking turns and acknowledged prior speakers effectively'
        ],
        improvements: [
          'Slight hesitation during opening thoughts; work on immediate hook lines',
          'Avoid repetitive transition phrases like "as mentioned before"'
        ],
        recommendations: [
          'Cite specific statistical surveys (e.g. Gallup or Stanford remote work studies)',
          'Practice structured 3-part argumentation: Point, Evidence, Impact'
        ],
        full_feedback: 'A very solid performance with mature conversational dynamics. You showed high emotional intelligence and consensus building, prioritizing sustainable corporate policies.'
      },
      transcripts: [
        { speaker: 'Moderator', type: 'system', message: 'Topic initiated: Work From Home vs Return to Office.' },
        { speaker: 'Alex Morgan (You)', type: 'user', message: 'Remote work proved during the pandemic that productivity does not require geographic confinement, but total isolation can erode mentorship and spontaneous innovation.' },
        { speaker: 'Priya', type: 'ai', message: 'Companies with 100% remote models report higher burnout due to blurred boundaries between work and rest.' },
        { speaker: 'Alex Morgan (You)', type: 'user', message: 'That is why a hybrid cadence with intentional on-site collaboration days often yields the highest retention and team cohesion.' }
      ]
    },
    {
      topic: 'Electric Vehicles: Green Revolution or Environmental Illusion?',
      category: 'Environment',
      mode: 'human',
      duration: 900,
      scores: {
        comm: 76, fluency: 74, vocab: 79, content: 80, conf: 75, lead: 72, team: 82, crit: 80, overall: 77,
        filler_words: 6, total_words: 215, turns: 3,
        strengths: [
          'Addressed the entire lifecycle including lithium battery mining and recycling',
          'Maintained composure during heated peer debates'
        ],
        improvements: [
          'Interrupted once during another candidate\'s point; wait for natural cadence',
          'Could elevate vocabulary around renewable energy grids'
        ],
        recommendations: [
          'Use non-verbal active listening cues and smoother counter-argument transitions',
          'Brush up on battery recycling technology and solid-state innovations'
        ],
        full_feedback: 'Good team engagement in this peer discussion session. You brought attention back to the core topic when participants strayed into individual car brands.'
      },
      transcripts: [
        { speaker: 'Host', type: 'system', message: 'Peer discussion started in room EV-GREEN-24.' },
        { speaker: 'Alex Morgan (You)', type: 'user', message: 'Zero tailpipe emissions are transformative for urban air quality, but we must account for coal-heavy electricity grids and raw mineral extraction.' },
        { speaker: 'Sarah', type: 'user', message: 'Modern sodium-ion and LFP batteries are significantly reducing reliance on rare earth minerals.' },
        { speaker: 'Alex Morgan (You)', type: 'user', message: 'Agreed, Sarah. The transition requires a synchronized greening of both our generation grids and battery supply chains.' }
      ]
    },
    {
      topic: 'Universal Basic Income: Economic Necessity or Disincentive to Work?',
      category: 'Social Issues',
      mode: 'ai',
      duration: 650,
      scores: {
        comm: 86, fluency: 85, vocab: 88, content: 89, conf: 87, lead: 84, team: 90, crit: 92, overall: 88,
        filler_words: 2, total_words: 320, turns: 5,
        strengths: [
          'Outstanding critical analysis referencing Finnish and Stockton pilot studies',
          'Took proactive initiative to summarize diverse viewpoints towards the end',
          'Very crisp diction, flawless sentence structuring'
        ],
        improvements: [
          'Minor point: could have addressed inflation concerns more thoroughly'
        ],
        recommendations: [
          'Ready for advanced competitive MBA / placement GD rounds'
        ],
        full_feedback: 'Exceptional performance! You demonstrated leadership by bridging welfare economics with fiscal realism. Your tone was persuasive, articulate, and highly collegial.'
      },
      transcripts: [
        { speaker: 'Moderator', type: 'system', message: 'Discussion started: Universal Basic Income.' },
        { speaker: 'Alex Morgan (You)', type: 'user', message: 'UBI provides an economic floor against technological disruption, ensuring dignity without replacing the incentive for upward mobility.' },
        { speaker: 'Kavya', type: 'ai', message: 'How will national budgets fund trillions annually without triggering runaway inflation or deficit spirals?' },
        { speaker: 'Alex Morgan (You)', type: 'user', message: 'By streamlining overlapping bureaucratic welfare subsidies and implementing digital transaction levies, funding can be restructured sustainably.' }
      ]
    }
  ];

  for (const s of sampleSessions) {
    const sessRes = db.prepare(`
      INSERT INTO gd_sessions (user_id, mode, topic, category, duration, status)
      VALUES (?, ?, ?, ?, ?, 'completed')
    `).run(user.user_id, s.mode, s.topic, s.category, s.duration);

    const sessionId = sessRes.lastInsertRowid;

    // Insert transcripts
    const insertT = db.prepare(`
      INSERT INTO gd_transcripts (session_id, speaker, speaker_type, message, word_count)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const t of s.transcripts) {
      const words = t.message.split(/\s+/).length;
      insertT.run(sessionId, t.speaker, t.type, t.message, words);
    }

    // Insert performance
    const sc = s.scores;
    db.prepare(`
      INSERT INTO performance (
        session_id, user_id,
        communication_score, fluency_score, vocabulary_score, content_score,
        confidence_score, leadership_score, teamwork_score, critical_thinking,
        overall_score, strengths, improvements, recommendations, full_feedback,
        filler_word_count, total_words, speaking_turns
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId, user.user_id,
      sc.comm, sc.fluency, sc.vocab, sc.content,
      sc.conf, sc.lead, sc.team, sc.crit,
      sc.overall,
      JSON.stringify(sc.strengths),
      JSON.stringify(sc.improvements),
      JSON.stringify(sc.recommendations),
      sc.full_feedback,
      sc.filler_words, sc.total_words, sc.turns
    );
  }

  console.log(`✅ Seeded ${sampleSessions.length} realistic GD sessions with full transcripts and evaluations!`);
});

seed();
db.close();
console.log('🎉 Database seeding complete! You can now log in with demo@gd.com / demo123');
