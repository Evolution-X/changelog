const https = require('https');
const fs = require('fs');
const path = require('path');

const ORG = 'Evolution-X';
const TOKEN = process.env.GITHUB_TOKEN;

const SKIP_REPOS = new Set([
  'changelog', 'OTA', 'www_gitres', '.github',
  'vendor_evolution-priv_keys-template', 'www', 'wiki', 'XDA',
  'vendor_certification', 'vendor_pixel-framework'
]);

const TRACK_BRANCHES = ['cnb'];

function get(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': 'changelog-bot',
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github+json'
      }
    };
    let data = '';
    https.get(url, opts, res => {
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve([]); }
      });
    }).on('error', reject);
  });
}

async function getAllRepos() {
  let repos = [];
  let page = 1;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  while (true) {
    const batch = await get(
      `https://api.github.com/orgs/${ORG}/repos?per_page=100&page=${page}&sort=pushed&direction=desc`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    const filtered = batch.filter(r => !r.fork && !SKIP_REPOS.has(r.name) && r.pushed_at >= weekAgo);
    repos = repos.concat(filtered);
    if (batch[batch.length - 1].pushed_at < weekAgo) break;
    page++;
  }
  return repos;
}

async function getCommits(repo, since, until) {
  const seen = new Set();
  const commits = [];
  for (const branch of TRACK_BRANCHES) {
    const url =
      `https://api.github.com/repos/${ORG}/${repo}/commits` +
      `?sha=${branch}&since=${since}&until=${until}&per_page=100`;
    const data = await get(url);
    if (!Array.isArray(data)) continue;
    for (const c of data) {
      if (!seen.has(c.sha)) {
        seen.add(c.sha);
        commits.push({
          message: c.commit.message.split('\n')[0].trim(),
          repo
        });
      }
    }
  }
  return commits;
}

async function main() {
  const now = new Date();
  const until = new Date(now);
  until.setUTCHours(0, 0, 0, 0);
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - 1);

  const sinceStr = since.toISOString();
  const untilStr = until.toISOString();

  const dateLabel = `${String(until.getUTCMonth() + 1).padStart(2,'0')}/${String(until.getUTCDate()).padStart(2,'0')}`;

  console.log(`Fetching commits from ${sinceStr} to ${untilStr}`);

  const repos = await getAllRepos();
  console.log(`Found ${repos.length} repos`);

  const outDir = path.join(__dirname, 'changelogs');
  fs.mkdirSync(outDir, { recursive: true });

  const seenPath = path.join(outDir, '.seen_commits');
  const seen = new Set(
    fs.existsSync(seenPath)
      ? fs.readFileSync(seenPath, 'utf8').split('\n').filter(Boolean)
      : []
  );

  const allCommits = [];
  for (const repo of repos) {
    const commits = await getCommits(repo.name, sinceStr, untilStr);
    for (const c of commits) {
      const id = `${c.repo}::${c.message}`;
      if (!seen.has(id)) {
        allCommits.push(c);
        seen.add(id);
      }
    }
    if (commits.length > 0) {
      console.log(`  ${repo.name}: ${commits.length} commit(s)`);
    }
  }

  fs.writeFileSync(seenPath, [...seen].join('\n') + '\n');

  if (allCommits.length === 0) {
    console.log('No new commits found for this period.');
    return;
  }

  const lines = [
    `Notable ROM changes ${dateLabel}:`,
    '==============================',
    ...allCommits.map(c => c.message),
    ''
  ];

  const filename = `${until.getUTCFullYear()}-${String(until.getUTCMonth()+1).padStart(2,'0')}-${String(until.getUTCDate()).padStart(2,'0')}.txt`;
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, lines.join('\n'));
  console.log(`Written to ${outPath}`);

  fs.writeFileSync(path.join(outDir, 'LATEST.txt'), lines.join('\n'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
