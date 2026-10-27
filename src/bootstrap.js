// First-start owner account for hosts without shell access (e.g. Render).
// If no owner exists and ADMIN_EMAIL + ADMIN_PASSWORD are set, create it once.
import { one, run } from './db.js';
import { hashPassword } from './lib/auth.js';

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
if (!one("SELECT 1 FROM users WHERE role='owner'") && email && password) {
  if (password.length < 10) console.error('ADMIN_PASSWORD must be at least 10 characters; owner not created.');
  else {
    run("INSERT INTO users (email,name,password_hash,role,created_at) VALUES (?,?,?,'owner',?)",
      email, process.env.ADMIN_NAME || 'Owner', hashPassword(password), new Date().toISOString());
    console.log(`Created owner account ${email}. Remove ADMIN_PASSWORD from the environment now.`);
  }
}
