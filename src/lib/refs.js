// Human-friendly, unambiguous reference numbers (no 0/O, 1/I/L).
import crypto from 'node:crypto';
import { one } from '../db.js';

const ALPH = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const rand = (n) => Array.from(crypto.randomBytes(n), (b) => ALPH[b % ALPH.length]).join('');

const TABLE = { LQ: 'quotes', LFS: 'shipments', LC: 'cases' };

/** LQ-2610-7K3F9 (quote), LFS-2610-8M4QX2 (shipment), LC-2610-R7T4P (service case) */
export function newRef(prefix) {
  const d = new Date();
  const yymm = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0');
  for (let i = 0; i < 10; i++) {
    const ref = `${prefix}-${yymm}-${rand(prefix === 'LFS' ? 6 : 5)}`;
    if (!one(`SELECT 1 FROM ${TABLE[prefix]} WHERE ref = ?`, ref)) return ref;
  }
  throw new Error('Could not allocate reference');
}

export const normalizeRef = (s) => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '').slice(0, 24);
