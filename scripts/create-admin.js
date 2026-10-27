// Usage: npm run create-admin -- owner@lansarfs.com "Full Name" [password]
import { one, run } from '../src/db.js';
import { hashPassword } from '../src/lib/auth.js';
import { randomToken } from '../src/lib/core.js';

const [email, name, pw] = process.argv.slice(2);
if (!email || !name) { console.error('Usage: npm run create-admin -- <email> "<Full Name>" [password]'); process.exit(1); }
const password = pw || randomToken(12);
if (password.length < 10) { console.error('Password must be at least 10 characters.'); process.exit(1); }
const ex = one('SELECT id FROM users WHERE email=?', email.toLowerCase());
if (ex) run("UPDATE users SET name=?, password_hash=?, role='owner', active=1 WHERE id=?", name, hashPassword(password), ex.id);
else run("INSERT INTO users (email,name,password_hash,role,created_at) VALUES (?,?,?,'owner',?)", email.toLowerCase(), name, hashPassword(password), new Date().toISOString());
console.log(`${ex ? 'Updated' : 'Created'} owner account ${email}${pw ? '' : `\nTemporary password: ${password}`}`);
