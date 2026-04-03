/**
 * The Quiet Edge Academy — Resource Selector
 * app.js: assessment engine, scoring, email gate, Formspree, Stripe wiring
 *
 * CONFIG: Update FORMSPREE_ID and STRIPE_PAYMENT_LINK before launch.
 */

// ── Config ─────────────────────────────────────────────────────────────────
const CONFIG = {
  FORMSPREE_ID:       'YOUR_FORMSPREE_ID',        // replace with your Formspree form ID
  STRIPE_PAYMENT_LINK:'https://buy.stripe.com/YOUR_LINK', // replace with your Stripe Payment Link
  FREE_PREVIEW_COUNT: 3,   // number of resource cards shown in free preview
  PROMO_CODES: {
    // code → { discount: '20%', multiplier: 0.80, label: '20% off' }
    'COACH20':  { discount: '20%', multiplier: 0.80, label: '20% off — Coach discount applied' },
    'PARENT15': { discount: '15%', multiplier: 0.85, label: '15% off — Parent Edition discount applied' },
    'TEAM10':   { discount: '10%', multiplier: 0.90, label: '10% off — Team discount applied' },
    'LAUNCH':   { discount: '30%', multiplier: 0.70, label: '30% off — Launch special applied' },
  },
  BASE_PRICE: 29,
};

// ── State ───────────────────────────────────────────────────────────────────
let questions   = [];
let resources   = [];
let currentStep = 0;
let answers     = {};   // { audience, pillar, coreValue, stage, urgency }
let matchedResources = [];
let activePromo = null;

// ── Boot ────────────────────────────────────────────────────────────────────
(async function init() {
  try {
    const [qRes, rRes] = await Promise.all([
      fetch('/data/questions.json'),
      fetch('/data/resources.json'),
    ]);
    const qData = await qRes.json();
    const rData = await rRes.json();
    questions = qData.questions;
    resources = rData.resources;
    bindHeroButton();
  } catch (err) {
    console.error('Failed to load data:', err);
  }
})();

// ── Hero ────────────────────────────────────────────────────────────────────
function bindHeroButton() {
  document.getElementById('btn-start').addEventListener('click', () => {
    showScreen('screen-assessment');
    renderStep(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ── Screen management ───────────────────────────────────────────────────────
function showScreen(id) {
  ['screen-hero','screen-assessment','screen-gate','screen-preview'].forEach(s => {
    document.getElementById(s).classList.add('hidden');
  });
  document.getElementById(id).classList.remove('hidden');
}

// ── Progress bar ────────────────────────────────────────────────────────────
function renderProgress(activeIndex) {
  const container = document.getElementById('progress-steps');
  const labels = ['Who', 'Challenge', 'Goal', 'Stage', 'Urgency'];
  container.innerHTML = labels.map((label, i) => {
    let cls = 'progress-step';
    if (i < activeIndex)  cls += ' done';
    if (i === activeIndex) cls += ' active';
    const content = i < activeIndex ? '✓' : (i + 1);
    return `<div class="${cls}">
      <div class="step-dot">${content}</div>
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

  document.getElementById('step-indicator').textContent = `Step ${stepIndex + 1} of ${questions.length}`;
  document.getElementById('question-text').textContent  = q.question;
  document.getElementById('question-subtext').textContent = q.subtext;

  const grid   = document.getElementById('options-grid');
  const isTwoCol = q.options.length === 2;
  grid.className = 'card-grid' + (isTwoCol ? ' card-grid-2' : '');

  grid.innerHTML = q.options.map(opt => {
    const badge = opt.badge ? `<span class="badge-stage">${opt.badge}</span>` : '';
    return `<div class="option-card" data-value="${opt.value}" data-qid="${q.id}" onclick="selectOption(this)">
      <span class="card-icon">${opt.icon}</span>
      <div class="card-body">
        <h3>${opt.label}</h3>
        <p>${opt.description}</p>
        ${badge}
      </div>
    </div>`;
  }).join('');

  // Restore selection if already answered
  if (answers[q.id]) {
    const card = grid.querySelector(`[data-value="${answers[q.id]}"]`);
    if (card) card.classList.add('selected');
  }

  const btnNext = document.getElementById('btn-next');
  const btnBack = document.getElementById('btn-back');

  btnNext.disabled = !answers[q.id];
  btnNext.textContent = stepIndex === questions.length - 1 ? 'See My Results →' : 'Continue →';
  btnBack.style.display = stepIndex === 0 ? 'none' : '';

  // Re-bind nav buttons (replace to avoid duplicate listeners)
  const newNext = btnNext.cloneNode(true);
  const newBack = btnBack.cloneNode(true);
  btnNext.parentNode.replaceChild(newNext, btnNext);
  btnBack.parentNode.replaceChild(newBack, btnBack);

  newNext.disabled = !answers[q.id];
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
    // All questions answered → compute matches → show gate
    matchedResources = scoreResources(answers, resources);
    document.getElementById('gate-match-count').textContent = matchedResources.length;
    populateHiddenFields();
    showScreen('screen-gate');
    bindGateForm();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function onBack() {
  if (currentStep > 0) {
    renderStep(currentStep - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    showScreen('screen-hero');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ── Scoring algorithm ───────────────────────────────────────────────────────
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
      // Bonus for having a live interactive tool
      if (r.liveUrl) score += 0.5;
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Populate hidden fields for Formspree ────────────────────────────────────
function populateHiddenFields() {
  const topIds = matchedResources.slice(0, 8).map(r => r.id).join(', ');
  document.getElementById('hidden-audience').value  = answers.audience  || '';
  document.getElementById('hidden-pillar').value    = answers.pillar    || '';
  document.getElementById('hidden-coreValue').value = answers.coreValue || '';
  document.getElementById('hidden-stage').value     = answers.stage     || '';
  document.getElementById('hidden-urgency').value   = answers.urgency   || '';
  document.getElementById('hidden-matched').value   = topIds;
}

// ── Save assessment to localStorage (for results page) ──────────────────────
function saveToStorage() {
  const payload = {
    answers,
    matched: matchedResources.map(r => r.id),
    savedAt: Date.now(),
  };
  localStorage.setItem('qe_assessment', JSON.stringify(payload));
}

// ── Email gate ───────────────────────────────────────────────────────────────
function bindGateForm() {
  const form = document.getElementById('gate-form');
  form.action = `https://formspree.io/f/${CONFIG.FORMSPREE_ID}`;
  form.method = 'POST';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('gate-email').value.trim();
    if (!email || !email.includes('@')) {
      document.getElementById('gate-email').focus();
      return;
    }
    const btn = document.getElementById('btn-gate-submit');
    btn.disabled = true;
    btn.textContent = 'Processing…';

    // Fire-and-forget to Formspree (non-blocking for UX)
    submitToFormspree(form).catch(console.warn);

    // Save to localStorage so results page can load data
    saveToStorage();

    // Show preview immediately
    showScreen('screen-preview');
    renderPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

async function submitToFormspree(form) {
  const data = new FormData(form);
  await fetch(form.action, {
    method: 'POST',
    body: data,
    headers: { 'Accept': 'application/json' },
  });
}

// ── Free preview ─────────────────────────────────────────────────────────────
function renderPreview() {
  const previewList = document.getElementById('preview-list');
  const total = matchedResources.length;

  document.getElementById('preview-match-label').textContent =
    `${total} resource${total !== 1 ? 's' : ''} matched to your profile`;

  const audienceBadgeClass = answers.audience === 'Athlete' ? 'audience-athlete' : 'audience-parent';

  previewList.innerHTML = matchedResources.slice(0, CONFIG.FREE_PREVIEW_COUNT + 1).map((r, i) => {
    const isUnlocked = i === 0; // only first card fully visible in free preview
    const isLocked   = !isUnlocked;
    return `<div class="resource-preview-card ${isUnlocked ? 'unlocked' : ''}">
      <div class="resource-card-rank">${i + 1}</div>
      <div class="resource-card-body ${isLocked ? 'locked-blur' : ''}">
        <h3>${r.title}</h3>
        <div class="resource-card-meta">
          <span class="meta-tag ${audienceBadgeClass}">${r.audience}</span>
          <span class="meta-tag pillar">${r.pillar}</span>
          <span class="meta-tag stage">Stage ${r.stage}</span>
          <span class="meta-tag format">${r.format}</span>
        </div>
        ${isUnlocked && r.framework ? `<p style="font-size:0.8rem;color:var(--teal);margin-top:8px;font-weight:600;">${r.framework}</p>` : ''}
      </div>
      <span class="lock-icon">${isUnlocked ? '✓' : '🔒'}</span>
    </div>`;
  }).join('');

  // Wire up Stripe CTA
  document.getElementById('btn-stripe-checkout').href = CONFIG.STRIPE_PAYMENT_LINK;

  // Promo code
  document.getElementById('btn-apply-promo').addEventListener('click', applyPromo);
}

// ── Promo code handler ───────────────────────────────────────────────────────
function applyPromo() {
  const code = document.getElementById('promo-input').value.trim().toUpperCase();
  const msgEl = document.getElementById('promo-msg');
  const stripeBtn = document.getElementById('btn-stripe-checkout');

  if (!code) return;

  const promo = CONFIG.PROMO_CODES[code];
  msgEl.classList.remove('hidden', 'valid', 'invalid');

  if (promo) {
    activePromo = promo;
    const discountedPrice = Math.round(CONFIG.BASE_PRICE * promo.multiplier);
    msgEl.textContent = `✓ ${promo.label} — You pay $${discountedPrice}`;
    msgEl.classList.add('valid');
    // Append promo code to Stripe Payment Link
    const base = CONFIG.STRIPE_PAYMENT_LINK.split('?')[0];
    stripeBtn.href = `${base}?prefilled_promo_code=${code}`;
    stripeBtn.textContent = `Unlock Full Guide — $${discountedPrice} →`;
  } else {
    activePromo = null;
    msgEl.textContent = '✗ Code not recognised. Check for typos.';
    msgEl.classList.add('invalid');
    stripeBtn.href = CONFIG.STRIPE_PAYMENT_LINK;
    stripeBtn.textContent = `Unlock Full Guide — $${CONFIG.BASE_PRICE} →`;
  }
}
