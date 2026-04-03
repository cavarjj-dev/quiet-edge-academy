/**
 * The Quiet Edge Academy — Resource Selector
 * app.js: assessment engine, scoring, email gate, Cloudflare Worker, Stripe
 */

// ── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  WORKER_URL:         'https://qe-academy-intake.quietedge.workers.dev',
  STRIPE_PAYMENT_LINK:'https://buy.stripe.com/9B68wIfuBbz8f6c11jbsc00',
  FREE_PREVIEW_COUNT: 3,
  PROMO_CODES: {
    'COACH20':  { discount: '20%', multiplier: 0.80, label: '20% off — Coach discount applied' },
    'PARENT15': { discount: '15%', multiplier: 0.85, label: '15% off — Parent Edition discount applied' },
    'TEAM10':   { discount: '10%', multiplier: 0.90, label: '10% off — Team discount applied' },
    'LAUNCH':   { discount: '30%', multiplier: 0.70, label: '30% off — Launch special applied' },
  },
  BASE_PRICE: 29,
};

// ── Challenge → taxonomy mapping ─────────────────────────────────────────────
// Maps user-facing challenge selections to inventory taxonomy dimensions
const CHALLENGE_MAP = {
  confidence:    { pillars: ['Psychological'],                  coreValues: ['Competence'] },
  pressure:      { pillars: ['Psychological'],                  coreValues: ['Competence', 'Mastery-Focus'] },
  motivation:    { pillars: ['Psychological'],                  coreValues: ['Mastery-Focus', 'Autonomy'] },
  mistakes:      { pillars: ['Psychological'],                  coreValues: ['Mastery-Focus'] },
  identity:      { pillars: ['Psychological'],                  coreValues: ['Autonomy'] },
  overthinking:  { pillars: ['Psychological'],                  coreValues: ['Competence'] },
  injury:        { pillars: ['Psychological', 'Physical'],      coreValues: ['Autonomy', 'Competence'] },
  transition:    { pillars: ['Psychological', 'Socio-Emotional'], coreValues: ['Autonomy', 'Relatedness'] },
  communication: { pillars: ['Socio-Emotional'],                coreValues: ['Relatedness', 'Autonomy'] },
};

// ── Stage metadata (from Quick Reference) ───────────────────────────────────
const STAGE_META = {
  '1': { label: 'Stage 1 — Foundation',            theme: 'Love the Game & Build Identity' },
  '2': { label: 'Stage 2 — Self-Awareness',         theme: 'Learning How You Learn' },
  '3': { label: 'Stage 3 — Skill Acquisition',      theme: 'Training the Mind Like the Body' },
  '4': { label: 'Stage 4 — Competition',            theme: 'Handling Pressure & Chaos' },
  '5': { label: 'Stage 5 — Peak Performance',       theme: 'Competing at the Highest Level' },
  '6': { label: 'Stage 6 — Adversity & Resilience', theme: 'Navigating Setbacks & Transitions' },
  '7': { label: 'Stage 7 — Leadership & Legacy',    theme: 'Becoming More Than a Competitor' },
  '8': { label: 'Stage 8 — Life After Sport',       theme: 'Longevity & Transition' },
};

// YouTube playlists by stage + audience (from Quick Reference)
const STAGE_PLAYLISTS = {
  '1': { Athlete: 'https://www.youtube.com/playlist?list=PLhj0UiZpacExGZHNtWx5bsAvRXyi1TNHJ', Parent: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEwedHxPI4NoZt5BdT0F1lxl' },
  '2': { Athlete: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEwBkurYE58B5g4s_QIifwOh', Parent: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEzvI2PC9z5EVHO3rfvzKC7K' },
  '3': { Athlete: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEwOOT_FhXaH0tuyPjIkmHKV', Parent: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEzekP16cOX5yK2RH31ZEITz' },
  '4': { Athlete: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEwqXfzYVHc5ZvtC7NFCi5ER', Parent: 'https://www.youtube.com/playlist?list=PLhj0UiZpacExo_ktsZHG_Po_YgJkQ4d7b' },
  '5': { Athlete: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEwm1sBkWvtSQtfOSMrnQHDS', Parent: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEyRQz9G-KwvMz3DySArGS34' },
  '6': { Athlete: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEztsKhNzMFIAO8043wC5pJ2', Parent: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEz8hv2ifT9_01CFV-M-lwJ4' },
  '7': { Athlete: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEyl69tO_svnVJZFS5cVvP-4', Parent: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEzMV56SQ2guiPzB17JkL7eo' },
  '8': { Athlete: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEwoj3Iv6aY7QHak0y1lWTXQ', Parent: 'https://www.youtube.com/playlist?list=PLhj0UiZpacEyOPNJilMTOJSI2o5sauw4L' },
};

// ── State ───────────────────────────────────────────────────────────────────
let questions        = [];
let resources        = [];
let currentStep      = 0;
let answers          = {};  // { audience, stage, challenge, urgency }
let matchedResources = [];
let activePromo      = null;

// ── Boot ────────────────────────────────────────────────────────────────────
(async function init() {
  try {
    const [qRes, rRes] = await Promise.all([
      fetch('/data/questions.json'),
      fetch('/data/resources.json'),
    ]);
    questions = (await qRes.json()).questions;
    resources = (await rRes.json()).resources;
    bindHeroButton();
  } catch (err) {
    console.error('Failed to load data:', err);
  }
})();

function bindHeroButton() {
  document.getElementById('btn-start').addEventListener('click', () => {
    showScreen('screen-assessment');
    renderStep(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ── Screen management ───────────────────────────────────────────────────────
function showScreen(id) {
  ['screen-hero','screen-assessment','screen-gate','screen-preview'].forEach(s =>
    document.getElementById(s).classList.add('hidden')
  );
  document.getElementById(id).classList.remove('hidden');
}

// ── Progress bar ────────────────────────────────────────────────────────────
function renderProgress(activeIndex) {
  const labels = ['Who', 'Stage', 'Challenge', 'Urgency'];
  document.getElementById('progress-steps').innerHTML = labels.map((label, i) => {
    let cls = 'progress-step' + (i < activeIndex ? ' done' : '') + (i === activeIndex ? ' active' : '');
    return `<div class="${cls}">
      <div class="step-dot">${i < activeIndex ? '✓' : i + 1}</div>
      <span class="step-label">${label}</span>
    </div>`;
  }).join('');
}

// ── Render a question step ───────────────────────────────────────────────────
function renderStep(stepIndex) {
  currentStep = stepIndex;
  const q = questions[stepIndex];
  if (!q) return;

  renderProgress(stepIndex);
  document.getElementById('step-indicator').textContent  = `Step ${stepIndex + 1} of ${questions.length}`;
  document.getElementById('question-text').textContent   = q.question;
  document.getElementById('question-subtext').textContent = q.subtext;

  const grid = document.getElementById('options-grid');
  const isTwoCol = q.options.length === 2;
  grid.className = 'card-grid' + (isTwoCol ? ' card-grid-2' : '');

  // Build options — challenge step uses audience-aware descriptions
  grid.innerHTML = q.options.map(opt => {
    const desc = q.id === 'challenge'
      ? (answers.audience === 'Parent' ? opt.descriptionParent : opt.descriptionAthlete)
      : (opt.description || '');
    const badge  = opt.badge  ? `<span class="badge-stage">${opt.badge}</span>` : '';
    const theme  = opt.theme  ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${opt.theme}</div>` : '';
    return `<div class="option-card" data-value="${opt.value}" data-qid="${q.id}" onclick="selectOption(this)">
      <span class="card-icon">${opt.icon}</span>
      <div class="card-body">
        <h3>${opt.label}</h3>
        ${theme}
        <p>${desc}</p>
        ${badge}
      </div>
    </div>`;
  }).join('');

  // Restore prior selection
  if (answers[q.id]) {
    const card = grid.querySelector(`[data-value="${answers[q.id]}"]`);
    if (card) card.classList.add('selected');
  }

  // Re-bind nav buttons (clone to remove old listeners)
  const btnNext = document.getElementById('btn-next');
  const btnBack = document.getElementById('btn-back');
  const newNext = btnNext.cloneNode(true);
  const newBack = btnBack.cloneNode(true);
  btnNext.parentNode.replaceChild(newNext, btnNext);
  btnBack.parentNode.replaceChild(newBack, btnBack);

  newNext.disabled    = !answers[q.id];
  newNext.textContent = stepIndex === questions.length - 1 ? 'See My Results →' : 'Continue →';
  newBack.style.display = stepIndex === 0 ? 'none' : '';
  newNext.addEventListener('click', onNext);
  newBack.addEventListener('click', onBack);
}

function selectOption(card) {
  const qid = card.dataset.qid;
  document.querySelectorAll(`[data-qid="${qid}"]`).forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  answers[qid] = card.dataset.value;
  document.getElementById('btn-next').disabled = false;
}

function onNext() {
  if (currentStep < questions.length - 1) {
    renderStep(currentStep + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    matchedResources = scoreResources(answers, resources);
    const count = matchedResources.length;
    document.getElementById('gate-match-count').textContent =
      count > 0 ? count : 'relevant';
    showScreen('screen-gate');
    bindGateForm();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function onBack() {
  if (currentStep > 0) {
    renderStep(currentStep - 1);
  } else {
    showScreen('screen-hero');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Scoring algorithm ────────────────────────────────────────────────────────
// Primary: audience match (hard filter)
// Secondary: stage proximity (exact = 3pts, adjacent = 1pt)
// Tertiary: challenge → pillar/coreValue match (2pts each)
// Bonus: live tool (+0.5), foundational evidence (+0.5)
function scoreResources(ans, res) {
  const selectedStage = parseInt(ans.stage) || 2;
  const challengeMap  = CHALLENGE_MAP[ans.challenge] || {};
  const matchPillars  = challengeMap.pillars    || [];
  const matchValues   = challengeMap.coreValues || [];

  const filtered = res.filter(r => r.audience === ans.audience);

  // If no resources for this stage/audience, widen to all stages
  const hasExact = filtered.some(r => r.stage === selectedStage);

  return filtered
    .map(r => {
      let score = 0;

      // Stage match
      if (r.stage === selectedStage)              score += 3;
      else if (Math.abs(r.stage - selectedStage) === 1) score += 1;

      // Challenge taxonomy match
      if (matchPillars.includes(r.pillar))        score += 2;
      if (matchValues.includes(r.coreValue))      score += 2;

      // Bonuses
      if (r.liveUrl)                              score += 0.5;
      if (r.evidenceLevel === 'Foundational Research') score += 0.5;

      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Payload builder ──────────────────────────────────────────────────────────
function buildPayload(name, email) {
  const stageNum  = answers.stage || '';
  const stageMeta = STAGE_META[stageNum] || {};
  return {
    name,
    email,
    audience:          answers.audience  || '',
    stage:             stageMeta.label   || `Stage ${stageNum}`,
    stage_theme:       stageMeta.theme   || '',
    challenge:         answers.challenge || '',
    urgency:           answers.urgency   || '',
    matched_resources: matchedResources.slice(0, 8).map(r => r.id).join(', '),
    access_level:      'Free',
    submission_date:   new Date().toISOString().split('T')[0],
  };
}

// ── Save to localStorage ─────────────────────────────────────────────────────
function saveToStorage() {
  localStorage.setItem('qe_assessment', JSON.stringify({
    answers,
    matched: matchedResources.map(r => r.id),
    savedAt: Date.now(),
  }));
}

// ── Email gate ───────────────────────────────────────────────────────────────
function bindGateForm() {
  const form = document.getElementById('gate-form');
  // Remove any prior listener by replacing
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);

  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = newForm.querySelector('#gate-email').value.trim();
    const name  = newForm.querySelector('#gate-name').value.trim();
    if (!email || !email.includes('@')) {
      newForm.querySelector('#gate-email').focus();
      return;
    }
    const btn = newForm.querySelector('#btn-gate-submit');
    btn.disabled = true;
    btn.textContent = 'Processing…';

    submitToWorker(buildPayload(name, email)).catch(console.warn);
    saveToStorage();
    showScreen('screen-preview');
    renderPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

async function submitToWorker(payload) {
  await fetch(`${CONFIG.WORKER_URL}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ── Free preview ─────────────────────────────────────────────────────────────
function renderPreview() {
  const previewList = document.getElementById('preview-list');
  const total       = matchedResources.length;
  const stageNum    = answers.stage || '';
  const playlist    = (STAGE_PLAYLISTS[stageNum] || {})[answers.audience];
  const audienceClass = answers.audience === 'Athlete' ? 'audience-athlete' : 'audience-parent';

  document.getElementById('preview-match-label').textContent =
    `${total} resource${total !== 1 ? 's' : ''} matched to your profile`;

  if (total === 0) {
    // Stage has no resources yet — show coming soon message + playlist link
    previewList.innerHTML = `<div class="resource-preview-card" style="flex-direction:column;align-items:flex-start;gap:12px;">
      <div style="font-size:1.5rem">🎬</div>
      <div>
        <h3 style="margin-bottom:6px;">Resources for ${STAGE_META[stageNum]?.label || 'this stage'} are coming soon</h3>
        <p style="font-size:0.9rem;margin-bottom:12px;">
          We're building tools to match this stage as new episodes publish.
          In the meantime, start with the YouTube playlist — it covers the full curriculum for your situation.
        </p>
        ${playlist ? `<a href="${playlist}" target="_blank" class="btn btn-primary" style="font-size:0.85rem;padding:10px 20px;">
          Watch the ${STAGE_META[stageNum]?.label} Playlist →
        </a>` : ''}
      </div>
    </div>`;
  } else {
    previewList.innerHTML = matchedResources.slice(0, CONFIG.FREE_PREVIEW_COUNT + 1).map((r, i) => {
      const isUnlocked = i === 0;
      return `<div class="resource-preview-card ${isUnlocked ? 'unlocked' : ''}">
        <div class="resource-card-rank">${i + 1}</div>
        <div class="resource-card-body ${!isUnlocked ? 'locked-blur' : ''}">
          <h3>${r.title}</h3>
          <div class="resource-card-meta">
            <span class="meta-tag ${audienceClass}">${r.audience}</span>
            <span class="meta-tag pillar">${r.pillar}</span>
            <span class="meta-tag stage">Stage ${r.stage}</span>
            <span class="meta-tag format">${r.format}</span>
          </div>
          ${isUnlocked && r.framework ? `<p style="font-size:0.8rem;color:var(--teal);margin-top:8px;font-weight:600;">${r.framework}</p>` : ''}
        </div>
        <span class="lock-icon">${isUnlocked ? '✓' : '🔒'}</span>
      </div>`;
    }).join('');
  }

  document.getElementById('btn-stripe-checkout').href = CONFIG.STRIPE_PAYMENT_LINK;
  document.getElementById('btn-apply-promo').addEventListener('click', applyPromo);
}

// ── Promo code ───────────────────────────────────────────────────────────────
function applyPromo() {
  const code     = document.getElementById('promo-input').value.trim().toUpperCase();
  const msgEl    = document.getElementById('promo-msg');
  const stripeBtn = document.getElementById('btn-stripe-checkout');
  if (!code) return;

  const promo = CONFIG.PROMO_CODES[code];
  msgEl.classList.remove('hidden', 'valid', 'invalid');

  if (promo) {
    activePromo = promo;
    const price = Math.round(CONFIG.BASE_PRICE * promo.multiplier);
    msgEl.textContent = `✓ ${promo.label} — You pay $${price}`;
    msgEl.classList.add('valid');
    stripeBtn.href = `${CONFIG.STRIPE_PAYMENT_LINK.split('?')[0]}?prefilled_promo_code=${code}`;
    stripeBtn.textContent = `Unlock Full Guide — $${price} →`;
  } else {
    activePromo = null;
    msgEl.textContent = '✗ Code not recognised. Check for typos.';
    msgEl.classList.add('invalid');
    stripeBtn.href = CONFIG.STRIPE_PAYMENT_LINK;
    stripeBtn.textContent = `Unlock Full Guide — $${CONFIG.BASE_PRICE} →`;
  }
}
