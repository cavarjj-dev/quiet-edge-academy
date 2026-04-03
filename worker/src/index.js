/**
 * QE Academy Intake Worker
 * POST /submit  — writes lead to Notion + sends email notification via Resend
 * POST /paid    — called after Stripe payment, updates access level to Paid
 */

const CORS_HEADERS = (origin) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN;

    // Allow exact origin match OR localhost for dev
    const isAllowed = origin === allowed || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
    const corsOrigin = isAllowed ? origin : allowed;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS(corsOrigin) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, corsOrigin);
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/submit') {
        return await handleSubmit(request, env, corsOrigin);
      }
      if (url.pathname === '/paid') {
        return await handlePaid(request, env, corsOrigin);
      }
      return json({ error: 'Not found' }, 404, corsOrigin);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: 'Internal error' }, 500, corsOrigin);
    }
  },
};

// ── /submit — free lead capture ──────────────────────────────────────────────
async function handleSubmit(request, env, corsOrigin) {
  const body = await request.json().catch(() => null);
  if (!body?.email) return json({ error: 'Email required' }, 400, corsOrigin);

  const stageLabel = stageToLabel(body.stage);

  // Write to Notion
  const notionRes = await createNotionRow(env, {
    email:             body.email,
    name:              body.name || '',
    audience:          body.audience || '',
    challengeArea:     body.challenge_area || '',
    coreNeed:          body.core_need || '',
    stage:             stageLabel,
    matchedResources:  body.matched_resources || '',
    accessLevel:       'Free',
    submissionDate:    today(),
    followUpStatus:    'Not Contacted',
  });

  if (!notionRes.ok) {
    const err = await notionRes.text();
    console.error('Notion error:', err);
    // Don't fail the user-facing response — still show them the preview
  }

  const pageId = notionRes.ok ? (await notionRes.json()).id : null;

  // Send notification email
  await sendEmail(env, {
    to:      env.NOTIFY_EMAIL,
    subject: `New QE Lead: ${body.audience || '?'} — ${body.email}`,
    html: emailHtml({
      name:      body.name,
      email:     body.email,
      audience:  body.audience,
      challenge: body.challenge_area,
      coreNeed:  body.core_need,
      stage:     stageLabel,
      matched:   body.matched_resources,
      access:    'Free',
      date:      today(),
    }),
  });

  return json({ ok: true, pageId }, 200, corsOrigin);
}

// ── /paid — upgrade access level after Stripe payment ────────────────────────
async function handlePaid(request, env, corsOrigin) {
  const body = await request.json().catch(() => null);
  if (!body?.email) return json({ error: 'Email required' }, 400, corsOrigin);

  // Find Notion page by email (title field)
  const searchRes = await fetch('https://api.notion.com/v1/databases/' + env.NOTION_DATABASE_ID + '/query', {
    method: 'POST',
    headers: notionHeaders(env),
    body: JSON.stringify({
      filter: { property: 'Email', title: { equals: body.email } },
      page_size: 1,
    }),
  });

  if (searchRes.ok) {
    const data = await searchRes.json();
    const page = data.results?.[0];
    if (page) {
      await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
        method: 'PATCH',
        headers: notionHeaders(env),
        body: JSON.stringify({
          properties: {
            'Access Level': { select: { name: 'Paid' } },
          },
        }),
      });

      // Send paid confirmation notification
      await sendEmail(env, {
        to:      env.NOTIFY_EMAIL,
        subject: `💰 Paid conversion: ${body.email}`,
        html: `<p><strong>${body.email}</strong> just purchased the full guide ($29).</p>
               <p><a href="https://www.notion.so/${page.id.replace(/-/g,'')}">View in Notion →</a></p>`,
      });
    }
  }

  return json({ ok: true }, 200, corsOrigin);
}

// ── Notion helpers ────────────────────────────────────────────────────────────
function notionHeaders(env) {
  return {
    'Authorization': `Bearer ${env.NOTION_API_KEY}`,
    'Content-Type':  'application/json',
    'Notion-Version': '2022-06-28',
  };
}

function createNotionRow(env, fields) {
  const props = {
    'Email':             { title: [{ text: { content: fields.email } }] },
    'Name':              { rich_text: [{ text: { content: fields.name } }] },
    'Matched Resources': { rich_text: [{ text: { content: fields.matchedResources } }] },
    'Submission Date':   { date: { start: fields.submissionDate } },
    'Follow-up Status':  { select: { name: fields.followUpStatus } },
    'Access Level':      { select: { name: fields.accessLevel } },
  };

  // Only set select fields if value is a valid option
  if (fields.audience)     props['Audience']       = { select: { name: fields.audience } };
  if (fields.challengeArea)props['Challenge Area'] = { select: { name: fields.challengeArea } };
  if (fields.coreNeed)     props['Core Need']      = { select: { name: fields.coreNeed } };
  if (fields.stage)        props['Stage']          = { select: { name: fields.stage } };

  return fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(env),
    body: JSON.stringify({
      parent: { database_id: env.NOTION_DATABASE_ID },
      properties: props,
    }),
  });
}

// ── Resend email helper ───────────────────────────────────────────────────────
async function sendEmail(env, { to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'QE Academy <onboarding@resend.dev>',
      to:      [to],
      subject,
      html,
    }),
  });
  if (!res.ok) console.error('Resend error:', await res.text());
  return res;
}

function emailHtml(f) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:520px;margin:40px auto;color:#222">
    <h2 style="color:#5fb3ac">New Resource Selector Lead</h2>
    <table style="width:100%;border-collapse:collapse">
      ${row('Name',      f.name || '—')}
      ${row('Email',     `<a href="mailto:${f.email}">${f.email}</a>`)}
      ${row('Audience',  f.audience)}
      ${row('Challenge', f.challenge)}
      ${row('Core Need', f.coreNeed)}
      ${row('Stage',     f.stage)}
      ${row('Matched',   f.matched)}
      ${row('Access',    f.access)}
      ${row('Date',      f.date)}
    </table>
    <p style="margin-top:24px">
      <a href="https://www.notion.so/ffc9aee0a1ea42eaacb5765f329ecad2"
         style="background:#5fb3ac;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
        View in Notion CRM →
      </a>
    </p>
  </body></html>`;
}

function row(label, value) {
  return `<tr>
    <td style="padding:8px 12px;background:#f5f5f5;font-weight:600;width:130px;border-bottom:1px solid #e0e0e0">${label}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0">${value || '—'}</td>
  </tr>`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS(origin) },
  });
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function stageToLabel(stage) {
  return { '2': 'Stage 2', '3': 'Stage 3', 'both': 'Both' }[stage] || stage || '';
}
