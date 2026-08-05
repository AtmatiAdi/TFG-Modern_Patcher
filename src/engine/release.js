'use strict';
// Pobieranie wydan (GitHub Releases) - bez zadnych zaleznosci, na wbudowanym https.
//
// Kazde zrodlo w sources.json wskazuje repozytorium i maske zalacznika. Bierzemy
// najnowsze wydanie, ktore TE MASKE spelnia - dzieki temu jedno repo moze wydawac
// wiele modow, kazdy wlasnym tempem. Plik laduje w cache na dysku, wiec kolejne
// uruchomienia (i praca bez sieci) dzialaja z tego, co juz jest.

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const API = 'https://api.github.com';
const UA = 'TFG-Patcher';

/** Katalog cache: %LOCALAPPDATA%\TFG-Patcher\cache, poza Windows ~/.cache/tfg-patcher. */
function cacheDir() {
  if (process.env.TFG_CACHE_DIR) return process.env.TFG_CACHE_DIR;
  const base = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : (process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
  return path.join(base, process.platform === 'win32' ? 'TFG-Patcher' : 'tfg-patcher', 'cache');
}

/**
 * Token jest opcjonalny. Potrzebny tylko do repozytoriow prywatnych i gdy ktos
 * przekroczy limit 60 zapytan na godzine dla niezalogowanych.
 */
function token() {
  if (process.env.TFG_GITHUB_TOKEN) return process.env.TFG_GITHUB_TOKEN.trim();
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  const file = path.join(path.dirname(cacheDir()), 'token.txt');
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (raw) return raw;
  } catch { /* brak pliku - jedziemy anonimowo */ }
  return null;
}

function headers(accept) {
  const h = { 'User-Agent': UA, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  const t = token();
  if (t) h.Authorization = 'Bearer ' + t;
  return h;
}

/** GET z podazaniem za przekierowaniami (zalaczniki leca na inny host). */
function get(url, accept, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('za duzo przekierowan'));
    const req = https.get(url, { headers: headers(accept) }, res => {
      const code = res.statusCode;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location, accept, redirects + 1));
      }
      if (code !== 200) {
        res.resume();
        // 404 na repo prywatne jest CELOWE po stronie GitHuba - nie zdradza, ze cos
        // takiego istnieje. Dlatego ten sam kod znaczy trzy rozne rzeczy.
        const hint = code === 404 ? ' (repo prywatne bez tokenu, zla nazwa repo albo brak wydan)'
          : code === 403 ? ' (limit zapytan albo brak dostepu - ustaw TFG_GITHUB_TOKEN)'
          : code === 401 ? ' (token odrzucony)' : '';
        return reject(new Error(`HTTP ${code}${hint}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(20000, () => req.destroy(new Error('przekroczony czas oczekiwania')));
    req.on('error', reject);
  });
}

function globToRe(glob) {
  return new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

function shape(json) {
  return {
    tag: json.tag_name,
    name: json.name || json.tag_name,
    published: json.published_at,
    prerelease: Boolean(json.prerelease),
    draft: Boolean(json.draft),
    assets: (json.assets || []).map(a => ({ name: a.name, size: a.size, id: a.id, url: a.url })),
  };
}

/**
 * Najnowsze wydanie repozytorium, ktore FAKTYCZNIE zawiera szukany zalacznik.
 *
 * Nie wystarczy `releases/latest`: w jednym repozytorium moze mieszkac kilka modow,
 * a wtedy "najnowsze wydanie" bywa wydaniem calkiem innego moda i nie ma w nim naszego
 * jara. Maska zalacznika jest tu jedynym identyfikatorem moda - dzieki temu kazdy mod
 * w repo ma wlasne tempo wersjonowania i nie trzeba dopinac wydan pozostalych.
 *
 * Sciezka szybka (jedno zapytanie) obsluguje przypadek typowy: repo z jednym modem.
 */
async function findRelease(repo, assetGlob) {
  const re = globToRe(assetGlob);
  const hasAsset = rel => rel.assets.some(a => re.test(a.name));

  const latestBody = await get(`${API}/repos/${repo}/releases/latest`, 'application/vnd.github+json');
  const latest = shape(JSON.parse(latestBody.toString('utf8')));
  if (hasAsset(latest)) return latest;

  const listBody = await get(`${API}/repos/${repo}/releases?per_page=100`, 'application/vnd.github+json');
  const list = JSON.parse(listBody.toString('utf8')).map(shape);
  // GitHub zwraca od najnowszego; drafty i prereleasy pomijamy, tak jak robi to
  // `releases/latest` - wydanie robocze nie ma trafiac do ludzi.
  const hit = list.find(rel => !rel.draft && !rel.prerelease && hasAsset(rel));
  if (!hit) {
    throw new Error(`zadne wydanie nie ma zalacznika pasujacego do "${assetGlob}"`);
  }
  return hit;
}

function pickAsset(release, glob) {
  const re = globToRe(glob);
  const hits = release.assets.filter(a => re.test(a.name));
  if (!hits.length) {
    throw new Error(`wydanie ${release.tag} nie ma zalacznika pasujacego do "${glob}"`);
  }
  // Najnowszy wygrywa, gdyby ktos wrzucil kilka pasujacych.
  return hits.sort((a, b) => b.id - a.id)[0];
}

/** Sciezka, pod ktora trzymamy pobrany plik. */
function assetPath(repo, tag, name) {
  return path.join(cacheDir(), repo.replace('/', '__'), tag, name);
}

/**
 * Zwraca sciezke do pliku zalacznika, pobierajac go tylko gdy jeszcze go nie ma.
 * Rozmiar z API sluzy za kontrole kompletnosci - przerwane pobranie nie zostaje
 * uznane za wazny plik.
 */
async function fetchAsset(repo, tag, asset, log = () => {}) {
  const dest = assetPath(repo, tag, asset.name);
  if (fs.existsSync(dest) && fs.statSync(dest).size === asset.size) {
    return dest;
  }
  log(`    pobieram ${asset.name} (${Math.round(asset.size / 1024)} KB)`);
  const data = await get(asset.url, 'application/octet-stream');
  if (asset.size && data.length !== asset.size) {
    throw new Error(`pobrano ${data.length} B zamiast ${asset.size} B`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dest);
  return dest;
}

/** Najnowszy plik w cache dla danego zrodla - ratunek, gdy nie ma sieci. */
function newestCached(repo, glob) {
  const root = path.join(cacheDir(), repo.replace('/', '__'));
  if (!fs.existsSync(root)) return null;
  const re = globToRe(glob);
  let best = null;
  for (const tag of fs.readdirSync(root)) {
    const dir = path.join(root, tag);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!re.test(name)) continue;
      const file = path.join(dir, name);
      const mtime = fs.statSync(file).mtimeMs;
      if (!best || mtime > best.mtime) best = { file, name, tag, mtime };
    }
  }
  return best;
}

module.exports = { cacheDir, token, findRelease, pickAsset, fetchAsset, newestCached, assetPath };
