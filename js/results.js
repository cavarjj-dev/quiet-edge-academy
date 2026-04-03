/**
 * The Quiet Edge Academy — Full Results Page (results/index.html)
 * Reads assessment from localStorage, renders full resource cards + PDF.
 *
 * Access: landed here via Stripe payment redirect (?unlocked=true)
 * or direct link after payment email.
 */

// ── Listening Guide URLs ─────────────────────────────────────────────────────
const GUIDES = {
  Athlete: 'https://tinyurl.com/54tzjeku',
  Parent:  'https://tinyurl.com/5dcm9b9d',
};

// ── Audience → pillar label map ──────────────────────────────────────────────
const PILLAR_LABELS = {
  Psychological: '🧠 Mindset & Emotions',
  'Socio-Emotional': '💬 Relationships & Communication',
  Technical: '🎯 Mental Skills Building',
  Physical: '⚡ Mental-Physical Connection',
};
const CORE_LABELS = {
  Competence:    '💪 Confidence & Capability',
  'Mastery-Focus': '📈 Process Over Results',
  Autonomy:      '🔑 Ownership & Independence',
  Relatedness:   '🤲 Connection & Support',
};
const STAGE_LABELS = {
  '2':    'Stage 2 — Self Awareness',
  '3':    'Stage 3 — Skill Acquisition',
  'both': 'All Stages',
};
const URGENCY_LABELS = {
  high:   '🔥 Very Soon (competition approaching)',
  medium: '📅 Over the Next Few Months',
  low:    '👀 Just Exploring',
};

// ── Boot ─────────────────────────────────────────────────────────────────────
(async function init() {
  // Gate: require ?unlocked=true OR localStorage data + recent payment
  const params = new URLSearchParams(window.location.search);
  const isUnlocked = params.get('unlocked') === 'true' ||
                     params.get('session')  !== null;  // Stripe session redirect

  if (!isUnlocked) {
    showState('error');
    return;
  }

  const stored = localStorage.getItem('qe_assessment');
  if (!stored) {
    showState('error');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(stored);
  } catch {
    showState('error');
    return;
  }

  // Check freshness (24h)
  if (Date.now() - payload.savedAt > 86400000) {
    showState('error');
    return;
  }

  try {
    const [qRes, rRes] = await Promise.all([
      fetch('../data/questions.json'),
      fetch('../data/resources.json'),
    ]);
    const rData = await rRes.json();
    const allResources = rData.resources;

    // Reconstruct ordered matches from stored IDs
    const idOrder = payload.matched || [];
    const matched = idOrder
      .map(id => allResources.find(r => r.id === id))
      .filter(Boolean);

    // Fallback: re-score if IDs don't match (data update scenario)
    const finalMatched = matched.length > 0 ? matched : scoreResources(payload.answers, allResources);

    renderResults(payload.answers, finalMatched);
    showState('results');
  } catch (err) {
    console.error(err);
    showState('error');
  }
})();

function showState(state) {
  document.getElementById('screen-loading').classList.add('hidden');
  document.getElementById('screen-error').classList.add('hidden');
  document.getElementById('screen-results').classList.add('hidden');
  document.getElementById(`screen-${state}`).classList.remove('hidden');
}

// ── Scoring (mirrors app.js for fallback) ────────────────────────────────────
function scoreResources(ans, res) {
  const stageFilter = ans.stage === 'both' ? null : parseInt(ans.stage);
  return res
    .filter(r => r.audience === ans.audience)
    .filter(r => stageFilter === null || r.stage === stageFilter)
    .map(r => {
      let score = 0;
      if (r.pillar    === ans.pillar)     score += 3;
      if (r.coreValue === ans.coreValue)  score += 2;
      if (r.evidenceLevel === 'Foundational Research') score += 0.5;
      if (r.liveUrl) score += 0.5;
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Render full results ───────────────────────────────────────────────────────
function renderResults(answers, matched) {
  const guideUrl = GUIDES[answers.audience] || GUIDES.Athlete;

  // Subtitle
  document.getElementById('results-subtitle').textContent =
    `${matched.length} resource${matched.length !== 1 ? 's' : ''} matched for you — ranked by best-fit.`;

  document.getElementById('results-count').textContent = matched.length;

  // Summary box
  const summaryGrid = document.getElementById('summary-grid');
  summaryGrid.innerHTML = [
    { label: 'Who I am',         value: answers.audience || '—' },
    { label: 'Challenge area',   value: PILLAR_LABELS[answers.pillar] || answers.pillar || '—' },
    { label: 'Core goal',        value: CORE_LABELS[answers.coreValue] || answers.coreValue || '—' },
    { label: 'Stage focus',      value: STAGE_LABELS[answers.stage] || '—' },
    { label: 'Timeframe',        value: URGENCY_LABELS[answers.urgency] || '—' },
  ].map(item => `
    <div class="summary-item">
      <span class="label">${item.label}</span>
      <span class="value">${item.value}</span>
    </div>
  `).join('');

  // Resource cards
  const list = document.getElementById('full-resource-list');
  const audienceBadgeClass = answers.audience === 'Athlete' ? 'audience-athlete' : 'audience-parent';

  list.innerHTML = matched.map((r, i) => {
    const isTopMatch = i < 3;
    const scoreLabel = r.score >= 5 ? 'Top Match' : r.score >= 3 ? 'Strong Match' : 'Good Match';

    const toolLink = r.liveUrl
      ? `<a href="${r.liveUrl}" target="_blank" class="btn-tool">🎯 Open Interactive Tool</a>`
      : r.shortUrl
        ? `<a href="${r.shortUrl}" target="_blank" class="btn-tool">📄 Access Resource</a>`
        : `<span class="resource-available-note">Tool coming soon with upcoming episode</span>`;

    const objectives = r.learningObjectives && r.learningObjectives.length
      ? `<div class="objectives">
           <h4>What You'll Be Able to Do</h4>
           <ul>${r.learningObjectives.map(o => `<li>${o}</li>`).join('')}</ul>
         </div>`
      : '';

    return `<div class="full-resource-card${isTopMatch ? ' top-match' : ''}">
      <div class="resource-card-header">
        <div class="resource-card-number">${i + 1}</div>
        <div class="resource-card-title-block">
          <h3>${r.title}</h3>
          ${r.framework ? `<div class="framework">Framework: ${r.framework}</div>` : ''}
          <div class="resource-card-meta" style="margin-top:8px;">
            <span class="meta-tag ${audienceBadgeClass}">${r.audience}</span>
            <span class="meta-tag pillar">${r.pillar}</span>
            <span class="meta-tag stage">Stage ${r.stage}</span>
            <span class="meta-tag format">${r.format}</span>
          </div>
        </div>
        <div class="resource-card-score">${scoreLabel}</div>
      </div>
      <div class="resource-card-body">
        ${r.evidenceBase ? `<div class="evidence"><strong>Research:</strong> ${r.evidenceBase}</div>` : ''}
        ${objectives}
      </div>
      <div class="resource-card-actions">
        ${toolLink}
        <a href="${guideUrl}" target="_blank" class="btn-guide">📚 Listening Guide</a>
      </div>
    </div>`;
  }).join('');
}
