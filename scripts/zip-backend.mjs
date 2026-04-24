// Bundles backend/ into a flat zip where every file extracts into the
// destination webroot directly (no wrapper directory). Drop the zip onto
// your server, extract it in the webroot, `npm install` and `npm start`.
//
// Usage:
//   node scripts/zip-backend.mjs           # writes dist/backend-deploy.zip
//   node scripts/zip-backend.mjs <outfile> # custom output path
//
// The zip omits node_modules and any .env file for safety.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const OUT_DEFAULT = path.join(ROOT, 'dist', 'backend-deploy.zip');
const outPath = path.resolve(process.argv[2] || OUT_DEFAULT);

// Skip these — they don't belong in the deployable zip.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);
const SKIP_FILES = new Set(['.env']);

if (!fs.existsSync(BACKEND_DIR)) {
  console.error(`backend directory not found: ${BACKEND_DIR}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });

const output = fs.createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const kb = (archive.pointer() / 1024).toFixed(1);
  console.log(`[zip-backend] wrote ${outPath} (${kb} KB)`);
});
archive.on('warning', (err) => {
  if (err.code === 'ENOENT') console.warn('[zip-backend] warn:', err.message);
  else throw err;
});
archive.on('error', (err) => { throw err; });
archive.pipe(output);

// Walk the backend directory and add every eligible file under its path
// *relative to backend/* — so the zip entries are `server.js`,
// `models/User.js`, etc, NOT `backend/server.js`.
function walk(dir, baseRel = '') {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = baseRel ? path.posix.join(baseRel, name) : name;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(abs, rel);
    } else {
      if (SKIP_FILES.has(name)) continue;
      archive.file(abs, { name: rel });
    }
  }
}
walk(BACKEND_DIR);

// Also stamp a deploy README into the zip so users know what to do.
const deployReadme = `# HefflHoff backend deployment bundle

Extract this zip DIRECTLY into your webroot (the backend runs from where you
extracted it — no wrapper folder).

    npm install
    cp .env.example .env     # fill in MONGO_URI, JWT_SECRET, PORT, CORS_ORIGIN
    npm run init-db          # create users collection + indexes
    npm start                # boots Express on PORT (default 5001)

A process manager such as pm2 or systemd is recommended for production.
`;
archive.append(deployReadme, { name: 'DEPLOY.txt' });

archive.finalize();
