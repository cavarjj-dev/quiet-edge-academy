# The Quiet Edge Academy — Resource Selector

Personalized mental performance resource guide for athletes and sports parents.

**Live site:** https://cavarjj-dev.github.io/quiet-edge-academy/

## How it works

1. User completes a 5-question assessment (audience, challenge area, goal, stage, urgency)
2. Scores all resources from the inventory against their profile
3. Captures email via Formspree → free preview of top matched resources
4. Full guide (all matches + evidence + tool links + PDF) unlocked via $29 Stripe payment
5. Lead data logged to Notion CRM for follow-up

## Setup (one-time)

### 1. Formspree
- Create a free form at [formspree.io](https://formspree.io)
- Copy the form ID (e.g. `xyzabc12`)
- Set `CONFIG.FORMSPREE_ID` in `js/app.js`

### 2. Stripe
- Create a **Payment Link** in Stripe Dashboard ($29 one-time)
- Enable "Redirect after payment" → `https://cavarjj-dev.github.io/quiet-edge-academy/results/?unlocked=true`
- Set `CONFIG.STRIPE_PAYMENT_LINK` in `js/app.js`
- Optionally add promo codes in the `CONFIG.PROMO_CODES` object

### 3. Notion CRM
- Database already created: **QE Resource Selector — Leads CRM**
- Formspree → Zapier → Notion (set up Zap: on new Formspree submission → create Notion row)
- Map fields: email, audience, challenge_area, core_need, matched_resources, access_level

## Adding new resources

When a new episode is published:

```bash
# 1. Add the resource to sports-resource-library/inventory/master-inventory.json
# 2. Sync to the academy data layer:
node scripts/sync-inventory.js

# 3. Commit and push
git add data/resources.json
git commit -m "Sync: add RES-XXX [resource name]"
git push
```

## Structure

```
quiet-edge-academy/
├── index.html          — Landing page + 5-step assessment + email gate + free preview
├── results/
│   └── index.html      — Full paid results page (requires ?unlocked=true)
├── css/
│   └── style.css       — Dark theme, teal accents
├── js/
│   ├── app.js          — Assessment engine, scoring, Formspree, Stripe
│   └── results.js      — Full results renderer, PDF
├── data/
│   ├── resources.json  — Auto-generated from master-inventory.json
│   └── questions.json  — Assessment questions
└── scripts/
    └── sync-inventory.js — Regenerates data/resources.json
```

## Promo codes (current)

| Code | Discount | Intended for |
|------|----------|--------------|
| `COACH20` | 20% | Coaches |
| `PARENT15` | 15% | Parent edition viewers |
| `TEAM10` | 10% | Team/club bulk |
| `LAUNCH` | 30% | Launch window |

Add new codes in `CONFIG.PROMO_CODES` in `js/app.js`.
