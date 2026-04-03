#!/usr/bin/env node
/**
 * sync-inventory.js
 * Regenerates data/resources.json from the master-inventory.json in sports-resource-library.
 * Run this whenever a new episode resource is added to the inventory.
 *
 * Usage:
 *   node scripts/sync-inventory.js
 *   node scripts/sync-inventory.js --verbose
 */

const fs   = require('fs');
const path = require('path');

const INVENTORY_PATH = path.resolve(
  'C:/Users/Julia/Documents/sports-resource-library/inventory/master-inventory.json'
);
const OUTPUT_PATH = path.resolve(__dirname, '../data/resources.json');

const verbose = process.argv.includes('--verbose');
const log = (...args) => verbose && console.log(...args);

// ── Load ─────────────────────────────────────────────────────────────────────
if (!fs.existsSync(INVENTORY_PATH)) {
  console.error(`ERROR: Inventory not found at ${INVENTORY_PATH}`);
  process.exit(1);
}

const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
const all = inventory.resources || [];

// ── Filter ────────────────────────────────────────────────────────────────────
const published = all.filter(r => {
  if (r.status !== 'published') { log(`SKIP (draft): ${r.id} ${r.title}`); return false; }
  if (!r.taxonomy?.audience)    { log(`SKIP (no audience): ${r.id} ${r.title}`); return false; }
  if (r.taxonomy.audience === 'Unknown') { log(`SKIP (Unknown audience): ${r.id}`); return false; }
  return true;
});

// ── Transform ─────────────────────────────────────────────────────────────────
const resources = published.map(r => ({
  id:              r.id,
  title:           r.title,
  audience:        r.taxonomy.audience,
  pillar:          r.taxonomy.pillar   || '',
  coreValue:       r.taxonomy.coreValue || '',
  evidenceLevel:   r.taxonomy.evidenceLevel || '',
  format:          r.taxonomy.format   || '',
  stage:           r.source?.stage     || 2,
  framework:       r.framework         || '',
  evidenceBase:    r.evidenceBase      || '',
  learningObjectives: (r.learningObjectives || []).slice(0, 2),
  liveUrl:         r.links?.liveUrl    || null,
  shortUrl:        r.links?.shortUrl   || null,
  videoTitle:      r.source?.videoTitle || '',
}));

// ── Stats ─────────────────────────────────────────────────────────────────────
const byAudience = resources.reduce((acc, r) => {
  acc[r.audience] = (acc[r.audience] || 0) + 1; return acc;
}, {});
const withLiveUrl = resources.filter(r => r.liveUrl).length;

// ── Write ─────────────────────────────────────────────────────────────────────
const output = {
  lastSynced: new Date().toISOString().split('T')[0],
  count:      resources.length,
  stats:      { byAudience, withLiveUrl, withShortUrl: resources.filter(r => r.shortUrl).length },
  resources,
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

console.log(`✅ Synced ${resources.length} resources → ${OUTPUT_PATH}`);
console.log(`   Athletes: ${byAudience.Athlete || 0} | Parents: ${byAudience.Parent || 0}`);
console.log(`   Live interactive tools: ${withLiveUrl}/${resources.length}`);
if (verbose) {
  resources.forEach(r =>
    console.log(`  ${r.id}  ${r.audience.padEnd(8)} Stage${r.stage}  ${r.title}`)
  );
}
