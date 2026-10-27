// SQLite persistence using Node's built-in driver. Schema is migrated on boot.
// The schema is plain SQL designed to port to PostgreSQL when volume requires it.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'files'), { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'lansar.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const migrations = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
     password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner','staff','customer')),
     active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_login_at TEXT);
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     csrf TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, ip TEXT, ua TEXT);
   CREATE TABLE customers (
     id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, company TEXT,
     phone TEXT, whatsapp TEXT, country TEXT, kind TEXT, notes TEXT, user_id INTEGER REFERENCES users(id),
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE quotes (
     id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'new',
     customer_id INTEGER REFERENCES customers(id), contact_name TEXT NOT NULL, company TEXT, email TEXT NOT NULL,
     phone TEXT, whatsapp TEXT, preferred_contact TEXT, customer_kind TEXT,
     mode TEXT NOT NULL, origin_country TEXT, origin_state TEXT, origin_city TEXT, origin_zip TEXT, origin_type TEXT,
     dest_country TEXT, dest_city TEXT, dest_port TEXT, dest_type TEXT, ready_date TEXT,
     cargo_json TEXT NOT NULL DEFAULT '{}', services_json TEXT NOT NULL DEFAULT '[]',
     commodity TEXT, cargo_value REAL, cargo_currency TEXT, hazardous INTEGER DEFAULT 0, notes TEXT,
     source TEXT, utm_json TEXT, ip TEXT,
     assigned_to INTEGER REFERENCES users(id), currency TEXT DEFAULT 'USD', valid_until TEXT, customer_message TEXT,
     quoted_total REAL, quoted_at TEXT, lost_reason TEXT, repeat_of TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX quotes_status ON quotes(status);
   CREATE INDEX quotes_email ON quotes(email);
   CREATE TABLE quote_lines (
     id INTEGER PRIMARY KEY, quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
     category TEXT, description TEXT NOT NULL, qty REAL NOT NULL DEFAULT 1, unit_cost REAL NOT NULL DEFAULT 0,
     unit_sell REAL NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE shipments (
     id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, quote_id INTEGER REFERENCES quotes(id),
     customer_id INTEGER REFERENCES customers(id), contact_email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'booked',
     mode TEXT, origin TEXT, destination TEXT, cargo_summary TEXT, carrier TEXT, booking_no TEXT, container_no TEXT,
     bl_no TEXT, vessel TEXT, voyage TEXT, etd TEXT, eta TEXT, eta_note TEXT,
     assigned_to INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE milestones (
     id INTEGER PRIMARY KEY, shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
     code TEXT NOT NULL, label TEXT NOT NULL, location TEXT, occurred_at TEXT NOT NULL, note TEXT,
     visible INTEGER NOT NULL DEFAULT 1, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL);
   CREATE TABLE cases (
     id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, type TEXT NOT NULL, subject TEXT NOT NULL,
     name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, company TEXT, related_ref TEXT, callback INTEGER DEFAULT 0,
     extra_json TEXT, status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal',
     customer_id INTEGER REFERENCES customers(id), assigned_to INTEGER REFERENCES users(id),
     ip TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE case_messages (
     id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     author TEXT NOT NULL CHECK (author IN ('customer','staff','note')), user_id INTEGER REFERENCES users(id),
     body TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE files (
     id INTEGER PRIMARY KEY, owner_type TEXT NOT NULL, owner_id INTEGER NOT NULL, original_name TEXT NOT NULL,
     stored_name TEXT NOT NULL, mime TEXT, size INTEGER, uploaded_by TEXT, customer_visible INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL);
   CREATE INDEX files_owner ON files(owner_type, owner_id);
   CREATE TABLE activity (
     id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, user_id INTEGER REFERENCES users(id),
     action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL);
   CREATE INDEX activity_entity ON activity(entity_type, entity_id);
   CREATE TABLE tasks (
     id INTEGER PRIMARY KEY, title TEXT NOT NULL, entity_type TEXT, entity_id INTEGER, assigned_to INTEGER REFERENCES users(id),
     due_date TEXT, status TEXT NOT NULL DEFAULT 'open', created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, done_at TEXT);
   CREATE TABLE outbox (
     id INTEGER PRIMARY KEY, to_addr TEXT NOT NULL, subject TEXT NOT NULL, html TEXT NOT NULL, text TEXT,
     status TEXT NOT NULL DEFAULT 'queued', provider TEXT, error TEXT, created_at TEXT NOT NULL, sent_at TEXT);
   CREATE TABLE events (
     id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT, ref TEXT, created_at TEXT NOT NULL);`,
];

db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
const cur = db.prepare('SELECT v FROM schema_version').get()?.v ?? 0;
for (let v = cur; v < migrations.length; v++) {
  db.exec('BEGIN');
  try {
    db.exec(migrations[v]);
    db.exec('DELETE FROM schema_version');
    db.prepare('INSERT INTO schema_version (v) VALUES (?)').run(v + 1);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Convenience wrappers
export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function logActivity(entityType, entityId, userId, action, detail = '') {
  run('INSERT INTO activity (entity_type, entity_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?,?)',
    entityType, entityId, userId ?? null, action, detail, new Date().toISOString());
}

export function trackEvent(name, pathName = '', ref = '') {
  run('INSERT INTO events (name, path, ref, created_at) VALUES (?,?,?,?)', name, pathName, ref, new Date().toISOString());
}

/** Find or create a customer record by email; refreshes contact details. */
export function upsertCustomer({ email, name, company, phone, whatsapp, country, kind }) {
  const now = new Date().toISOString();
  const ex = one('SELECT * FROM customers WHERE email = ?', email);
  if (ex) {
    run(`UPDATE customers SET name=?, company=COALESCE(NULLIF(?,''),company), phone=COALESCE(NULLIF(?,''),phone),
         whatsapp=COALESCE(NULLIF(?,''),whatsapp), country=COALESCE(NULLIF(?,''),country), kind=COALESCE(NULLIF(?,''),kind), updated_at=? WHERE id=?`,
    name, company || '', phone || '', whatsapp || '', country || '', kind || '', now, ex.id);
    return ex.id;
  }
  return Number(run('INSERT INTO customers (email,name,company,phone,whatsapp,country,kind,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    email, name, company || null, phone || null, whatsapp || null, country || null, kind || null, now, now).lastInsertRowid);
}
