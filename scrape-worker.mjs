/**
 * Worker GitHub Actions pour scraping WOS distribué
 *
 * Utilisation : node scrape-worker.mjs <worker-id>
 */

import https from 'https';
import http from 'http';
import crypto from 'crypto';
import { writeFileSync } from 'fs';

const OVH_SERVER = process.env.OVH_SERVER || '57.129.123.224:4242';
const WORKER_ID = process.argv[2] || 'gh-unknown';
const BATCH_SIZE = 10; // 10 IDs par run

const WOS_HASH = "tB87#kPtkxqOS2";
const WOS_HOST = "wos-giftcode-api.centurygame.com";
const WOS_PATH = "/api/player";

// ─── Helper ───────────────────────────────────────────────────────────────────

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function buildBody(playerId) {
  const time = Date.now();
  const sign = md5(`fid=${playerId}&time=${time}${WOS_HASH}`);
  return new URLSearchParams({ sign, fid: String(playerId), time: String(time) }).toString();
}

// ─── Fetch player depuis WOS API ──────────────────────────────────────────────

async function fetchPlayer(playerId) {
  return new Promise((resolve) => {
    const body = buildBody(playerId);

    const options = {
      hostname: WOS_HOST,
      path: WOS_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://wos-giftcode.centurygame.com',
        'Referer': 'https://wos-giftcode.centurygame.com/',
      },
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.msg === 'success' && json.data && json.data.nickname) {
            resolve({
              id: playerId,
              found: true,
              data: {
                nickname: json.data.nickname,
                kid: json.data.kid || 0,
                avatarFrame: json.data.avatarFrame || json.data.avatar_frame || "",
                stateLevel: json.data.stove_lv || json.data.stateLevel || json.data.state_level || 0,
                allianceTag: json.data.allianceTag || json.data.alliance_tag || ""
              }
            });
          } else {
            resolve({ id: playerId, found: false });
          }
        } catch (e) {
          resolve({ id: playerId, found: false, error: 'parse_error' });
        }
      });
    });

    req.on('error', () => resolve({ id: playerId, found: false, error: 'network_error' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ id: playerId, found: false, error: 'timeout' });
    });

    req.write(body);
    req.end();
  });
}

// ─── Demander batch d'IDs au serveur OVH ──────────────────────────────────────

async function getBatch() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: OVH_SERVER.split(':')[0],
      port: OVH_SERVER.split(':')[1] || 80,
      path: `/api/get-batch?size=${BATCH_SIZE}&worker=${WORKER_ID}`,
      method: 'GET',
      timeout: 10000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.ids || []);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });

    req.end();
  });
}

// ─── Envoyer résultats au serveur OVH ─────────────────────────────────────────

async function sendResults(results) {
  // Format attendu par /api/bulk-insert : { found: [...], dead: [...] }
  const found = results
    .filter(r => r.found && r.data)
    .map(r => ({
      id: r.id,
      nickname: r.data.nickname,
      kid: r.data.kid,
      avatarFrame: r.data.avatarFrame,
      stateLevel: r.data.stateLevel,
      allianceTag: r.data.allianceTag
    }));

  const dead = results
    .filter(r => !r.found && !r.error)
    .map(r => r.id);

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ found, dead });

    const options = {
      hostname: OVH_SERVER.split(':')[0],
      port: OVH_SERVER.split(':')[1] || 80,
      path: '/api/bulk-insert',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data, 'utf8')
      },
      timeout: 10000
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });

    req.write(data);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[${WORKER_ID}] 🚀 Worker GitHub Actions démarré`);

  try {
    // 1. Demander batch
    console.log(`[${WORKER_ID}] 📥 Demande batch de ${BATCH_SIZE} IDs...`);
    const ids = await getBatch();

    if (ids.length === 0) {
      console.log(`[${WORKER_ID}] ⚠️  Aucun ID disponible`);
      return;
    }

    console.log(`[${WORKER_ID}] 📦 Reçu ${ids.length} IDs : ${ids[0]}-${ids[ids.length-1]}`);

    // 2. Scanner en parallèle
    console.log(`[${WORKER_ID}] 🔍 Scan en cours...`);
    const results = await Promise.all(ids.map(id => fetchPlayer(id)));

    const found = results.filter(r => r.found).length;
    const errors = results.filter(r => r.error).length;

    console.log(`[${WORKER_ID}] ✅ Scan terminé : ${found} trouvés, ${errors} erreurs`);

    // 3. Envoyer résultats
    console.log(`[${WORKER_ID}] 📤 Envoi résultats...`);
    await sendResults(results);

    console.log(`[${WORKER_ID}] ✅ Terminé avec succès`);

    // Sauvegarder pour logs GitHub
    writeFileSync('results.json', JSON.stringify({
      worker: WORKER_ID,
      ids_scanned: ids.length,
      found,
      errors,
      results
    }, null, 2));

  } catch (err) {
    console.error(`[${WORKER_ID}] ❌ Erreur : ${err.message}`);
    process.exit(1);
  }
}

main();
