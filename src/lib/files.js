// Private document storage. Files are written outside the public web root with random
// names and are only ever streamed back through authenticated routes.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { run, one } from '../db.js';
import { randomToken } from './core.js';

const ALLOWED = {
  'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic',
  'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/csv': '.csv', 'text/plain': '.txt',
};
const EXT_OK = new Set(Object.values(ALLOWED).concat(['.jpeg']));
const DIR = path.join(config.dataDir, 'files');

// Magic-byte sniffing for the binary types we accept, so a renamed executable is rejected.
function sniff(buf) {
  const b = buf.subarray(0, 12);
  if (b.slice(0, 4).toString() === '%PDF') return 'pdf';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b.slice(1, 4).toString() === 'PNG') return 'png';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (b.slice(4, 8).toString() === 'ftyp') return 'heic';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'zip-office';
  if (b[0] === 0xd0 && b[1] === 0xcf) return 'ole-office';
  return 'text';
}

export function validateFiles(list = []) {
  const errors = [];
  if (list.length > config.uploads.maxFiles) errors.push(`Attach up to ${config.uploads.maxFiles} files.`);
  for (const f of list) {
    const ext = path.extname(f.name || '').toLowerCase();
    if (!EXT_OK.has(ext)) errors.push(`${f.name}: file type not accepted (PDF, images, Word, Excel, CSV).`);
    if (f.size > config.uploads.maxFileBytes) errors.push(`${f.name}: larger than 10 MB.`);
  }
  return errors;
}

export async function storeFiles(list, ownerType, ownerId, uploadedBy, customerVisible = 0) {
  const saved = [];
  for (const f of list) {
    const buf = Buffer.from(await f.arrayBuffer());
    const ext = path.extname(f.name).toLowerCase();
    const kind = sniff(buf);
    const textExt = ['.csv', '.txt'].includes(ext);
    if (kind === 'text' && !textExt) continue; // claimed binary but isn't
    if (kind !== 'text' && textExt) continue;
    const stored = `${Date.now()}-${randomToken(12)}${ext}`;
    fs.writeFileSync(path.join(DIR, stored), buf, { mode: 0o600 });
    const id = run('INSERT INTO files (owner_type,owner_id,original_name,stored_name,mime,size,uploaded_by,customer_visible,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      ownerType, ownerId, path.basename(f.name).slice(0, 180), stored, f.type || '', buf.length, uploadedBy, customerVisible, new Date().toISOString()).lastInsertRowid;
    saved.push(Number(id));
  }
  return saved;
}

export function streamFile(res, fileId, { inline = false } = {}) {
  const f = one('SELECT * FROM files WHERE id=?', fileId);
  if (!f) return false;
  const p = path.join(DIR, path.basename(f.stored_name));
  if (!fs.existsSync(p)) return false;
  const safeName = f.original_name.replace(/[^\w.\- ]+/g, '_');
  res.writeHead(200, {
    'Content-Type': f.mime && ALLOWED[f.mime] ? f.mime : 'application/octet-stream',
    'Content-Length': fs.statSync(p).size,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  fs.createReadStream(p).pipe(res);
  return true;
}

export const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
