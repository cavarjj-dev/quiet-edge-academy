/**
 * QE Academy Intake Worker
 * POST /submit  — writes lead to Notion + sends email notification via Resend
 * POST /paid    — called after Stripe payment, upgrades access level to Paid
 */

const CORS_HEADERS = (origin) => ({
  'Access-Control-Allow-Origin':  origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

export default {
  async fetch(request, env) {
    const origin    = request.headers.get('Origin') || '';
    const isAllowed = origin === env.ALLOWED_ORIGIN
                   || origin.startsWith('http://localhost')
                   || origin.startsWith('http://127.0.0.1');
    const corsOrigin = isAllowed ? origin : env.ALLOWED_ORIGIN;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS(corsOrigin) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, corsOrigin);
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === '/submit') return await handleSubmit(request, env, corsOrigin);
      if (url.pathname === '/paid')   return await handlePaid(request, env, corsOrigin);
      return json({ error: 'Not found' }, 404, corsOrigin);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: 'Internal error' }, 500, corsOrigin);
    }
  },
};

// ── /submit ───────────────────────────────────────────────────────────────────
async function handleSubmit(request, env, corsOrigin) {
  const body = await request.json().catch(() => null);
  if (!body?.email) return json({ error: 'Email required' }, 400, corsOrigin);

  const notionRes = await createNotionRow(env, body);
  if (!notionRes.ok) console.error('Notion error:', await notionRes.text());
  const pageId = notionRes.ok ? (await notionRes.json()).id : null;

  await sendEmail(env, {
    to:      env.NOTIFY_EMAIL,
    subject: `New QE Lead: ${body.audience || '?'} — ${body.email}`,
    html:    emailHtml(body),
  });

  return json({ ok: true, pageId }, 200, corsOrigin);
}

// ── /paid ─────────────────────────────────────────────────────────────────────
async function handlePaid(request, env, corsOrigin) {
  const body = await request.json().catch(() => null);
  if (!body?.email) return json({ error: 'Email required' }, 400, corsOrigin);

  const searchRes = await fetch(
    `https://api.notion.com/v1/databases/${env.NOTION_DATABASE_ID}/query`,
    {
      method:  'POST',
      headers: notionHeaders(env),
      body:    JSON.stringify({
        filter: { property: 'Email', title: { equals: body.email } },
        page_size: 1,
      }),
    }
  );

  if (searchRes.ok) {
    const data = await searchRes.json();
    const page = data.results?.[0];
    if (page) {
      await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
        method:  'PATCH',
        headers: notionHeaders(env),
        body:    JSON.stringify({
          properties: { 'Access Level': { select: { name: 'Paid' } } },
        }),
      });
      await sendEmail(env, {
        to:      env.NOTIFY_EMAIL,
        subject: `💰 Paid conversion: ${body.email}`,
        html:    `<p><strong>${body.email}</strong> just purchased the full guide ($29).</p>
                  <p><a href="https://www.notion.so/${page.id.replace(/-/g,'')}">View in Notion →</a></p>`,
      });
    }
  }

  return json({ ok: true }, 200, corsOrigin);
}

// ── Notion helpers ────────────────────────────────────────────────────────────
function notionHeaders(env) {
  return {
    'Authorization':  `Bearer ${env.NOTION_API_KEY}`,
    'Content-Type':   'application/json',
    'Notion-Version': '2022-06-28',
  };
}

function createNotionRow(env, f) {
  const props = {
    'Email':             { title:     [{ text: { content: f.email || '' } }] },
    'Name':              { rich_text: [{ text: { content: f.name  || '' } }] },
    'Matched Resources': { rich_text: [{ text: { content: f.matched_resources || '' } }] },
    'Stage Theme':       { rich_text: [{ text: { content: f.stage_theme || '' } }] },
    'Submission Date':   { date: { start: f.submission_date || today() } },
    'Follow-up Status':  { select: { name: 'Not Contacted' } },
    'Access Level':      { select: { name: 'Free' } },
  };

  if (f.audience)  props['Audience']  = { select: { name: f.audience } };
  if (f.challenge) props['Challenge'] = { select: { name: f.challenge } };
  if (f.stage)     props['Stage']     = { select: { name: f.stage } };

  return fetch('https://api.notion.com/v1/pages', {
    method:  'POST',
    headers: notionHeaders(env),
    body:    JSON.stringify({
      parent:     { database_id: env.NOTION_DATABASE_ID },
      properties: props,
    }),
  });
}

// ── Resend ────────────────────────────────────────────────────────────────────
async function sendEmail(env, { to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
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
      ${row('Name',        f.name || '—')}
      ${row('Email',       `<a href="mailto:${f.email}">${f.email}</a>`)}
      ${row('Audience',    f.audience)}
      ${row('Stage',       f.stage)}
      ${row('Theme',       f.stage_theme)}
      ${row('Challenge',   f.challenge)}
      ${row('Urgency',     f.urgency)}
      ${row('Matched',     f.matched_resources)}
      ${row('Access',      f.access_level)}
      ${row('Date',        f.submission_date)}
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

// ── Utils ─────────────────────────────────────────────────────────────────────
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS(origin) },
  });
}

function today() {
  return new Date().toISOString().split('T')[0];
}
