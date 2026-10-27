import path from 'node:path';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(); } catch { /* no .env file — rely on real environment */ }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  root: ROOT,
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  noindex: env.NOINDEX === '1', // set on demo deployments so search engines skip them
  production: env.NODE_ENV === 'production',
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  secret: env.APP_SECRET || 'dev-only-secret-change-me',
  mail: {
    provider: (env.MAIL_PROVIDER || 'outbox').toLowerCase(), // outbox | resend | postmark
    resendKey: env.RESEND_API_KEY || '',
    postmarkToken: env.POSTMARK_TOKEN || '',
    from: env.MAIL_FROM || 'LANSAR Freight Shipping <no-reply@lansarfs.com>',
    replyTo: env.MAIL_REPLY_TO || '',
    staff: list(env.STAFF_NOTIFY_EMAILS),
  },
  analytics: {
    ga4: env.GA4_MEASUREMENT_ID || '',
    plausibleDomain: env.PLAUSIBLE_DOMAIN || '',
  },
  uploads: {
    maxFileBytes: 10 * 1024 * 1024,
    maxFiles: 5,
    maxRequestBytes: 55 * 1024 * 1024,
  },
};

// ——— Company facts. Only verified facts belong here. ———
export const company = {
  name: 'LANSAR Freight Shipping Corp',
  short: 'LANSAR',
  phone: '+1 (917) 573-4984',
  phoneHref: '+19175734984',
  whatsappHref: 'https://wa.me/19175734984',
  email: env.PUBLIC_EMAIL || '', // set PUBLIC_EMAIL once the public inbox is confirmed
  city: 'Bronx, New York',
  established: 2015,
  website: 'https://lansarfs.com',
};

// ——— Services. Edit freely; slugs become /services/<slug> pages. ———
export const services = [
  {
    slug: 'ocean-freight', name: 'Ocean Freight', img: 'ocean_freight_aerial', short: 'FCL and LCL',
    lead: 'Full-container (FCL) and shared-container (LCL) ocean shipping from the United States to Africa, booked and documented by one team.',
    points: ['20′, 40′ and 40′ high-cube containers', 'Consolidated LCL for smaller loads', 'Booking, documentation and milestone updates', 'Port-to-port or door-to-port'],
  },
  {
    slug: 'vehicle-shipping', name: 'Vehicle Shipping', img: 'vehicle_roro_shipping', short: 'RoRo and container',
    lead: 'Cars, SUVs, trucks and equipment shipped by roll-on/roll-off or inside a container, with title and export paperwork checked before departure.',
    points: ['RoRo and containerized options', 'Running and non-running vehicles', 'Title and export document review', 'Pickup from dealers, auctions or homes'],
  },
  {
    slug: 'inland-trucking', name: 'Inland Trucking', img: 'inland_trucking', short: 'Pickup and drayage',
    lead: 'Pickup from your door, supplier, auction yard or warehouse, then drayage to the export terminal.',
    points: ['Door pickup across the U.S.', 'Container drayage to port', 'Scheduling coordinated with your booking', 'Pickup confirmation recorded on your file'],
  },
  {
    slug: 'warehousing', name: 'Warehousing & Consolidation', img: 'warehouse_logistics', short: 'Receive, hold, consolidate',
    lead: 'Cargo from multiple suppliers received and consolidated into one shipment, so you pay for one move instead of many.',
    points: ['Receiving from multiple vendors', 'Consolidation into one container', 'Packing and loading coordination', 'Cargo receipt logged to your file'],
  },
  {
    slug: 'documentation', name: 'Export Documentation', img: 'client_consultation', short: 'Paperwork done right',
    lead: 'We help prepare and check the paperwork that holds cargo at port when it is wrong: commercial invoices, packing lists, vehicle titles and bills of lading.',
    points: ['Commercial invoice and packing list review', 'Vehicle title and export paperwork', 'Bill of lading coordination', 'Secure document exchange'],
  },
];

// ——— Destination pages. Confirm lane coverage with operations before publishing new ones.
// Port names are public facts; LANSAR does not publish transit times or rates here. ———
export const destinations = [
  { slug: 'senegal', country: 'Senegal', ports: ['Port of Dakar'], cities: ['Dakar', 'Thiès', 'Touba', 'Saint-Louis'] },
  { slug: 'cote-d-ivoire', country: "Côte d'Ivoire", ports: ['Port of Abidjan', 'Port of San-Pédro'], cities: ['Abidjan', 'Yamoussoukro', 'Bouaké'] },
  { slug: 'ghana', country: 'Ghana', ports: ['Port of Tema', 'Port of Takoradi'], cities: ['Accra', 'Kumasi', 'Tema'] },
  { slug: 'nigeria', country: 'Nigeria', ports: ['Lagos (Apapa)', 'Lagos (Tin Can Island)', 'Onne'], cities: ['Lagos', 'Abuja', 'Port Harcourt'] },
  { slug: 'guinea', country: 'Guinea', ports: ['Port of Conakry'], cities: ['Conakry'] },
  { slug: 'mali', country: 'Mali', ports: ['Via Dakar or Abidjan (landlocked)'], cities: ['Bamako'] },
  { slug: 'togo', country: 'Togo', ports: ['Port of Lomé'], cities: ['Lomé'] },
  { slug: 'cameroon', country: 'Cameroon', ports: ['Port of Douala', 'Port of Kribi'], cities: ['Douala', 'Yaoundé'] },
];

export const africanCountries = [
  'Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cameroon', 'Central African Republic', 'Chad', 'Comoros',
  "Côte d'Ivoire", 'Democratic Republic of the Congo', 'Djibouti', 'Egypt', 'Equatorial Guinea', 'Eritrea', 'Eswatini', 'Ethiopia', 'Gabon', 'Gambia',
  'Ghana', 'Guinea', 'Guinea-Bissau', 'Kenya', 'Lesotho', 'Liberia', 'Libya', 'Madagascar', 'Malawi', 'Mali', 'Mauritania', 'Mauritius', 'Morocco',
  'Mozambique', 'Namibia', 'Niger', 'Nigeria', 'Republic of the Congo', 'Rwanda', 'São Tomé and Príncipe', 'Senegal', 'Seychelles', 'Sierra Leone',
  'Somalia', 'South Africa', 'South Sudan', 'Sudan', 'Tanzania', 'Togo', 'Tunisia', 'Uganda', 'Zambia', 'Zimbabwe',
];

export const shippingModes = {
  fcl: 'Ocean — Full container (FCL)',
  lcl: 'Ocean — Shared container (LCL)',
  vehicle: 'Vehicle shipping',
  trucking: 'Inland trucking only',
  unsure: 'Not sure — advise me',
};

export const containerTypes = ["20′ Standard", "40′ Standard", "40′ High Cube", "20′ Reefer", "40′ Reefer", 'Open Top', 'Flat Rack'];

export const optionalServices = {
  pickup: 'Pickup from my U.S. address',
  warehousing: 'Warehousing / consolidation',
  packing: 'Packing, loading or crating',
  docs: 'Export documentation help',
  insurance: 'Cargo insurance options',
  dest_clearance: 'Destination customs clearance coordination',
  dest_delivery: 'Delivery at destination',
};

export const quoteStatuses = {
  new: 'New', reviewing: 'Reviewing', quoted: 'Quote sent', negotiating: 'Negotiating', won: 'Won — booked', lost: 'Lost', spam: 'Spam / invalid',
};

export const shipmentStatuses = {
  booked: 'Booked', in_progress: 'In progress', in_transit: 'In transit', arrived: 'Arrived', delivered: 'Delivered', on_hold: 'On hold', cancelled: 'Cancelled',
};

export const milestoneCatalog = [
  ['booking_confirmed', 'Booking confirmed'],
  ['pickup_scheduled', 'Pickup scheduled'],
  ['cargo_picked_up', 'Cargo picked up'],
  ['received_warehouse', 'Received at warehouse'],
  ['docs_received', 'Export documents received'],
  ['export_cleared', 'Export clearance completed'],
  ['gate_in', 'Delivered to origin terminal'],
  ['loaded', 'Loaded on vessel'],
  ['departed', 'Departed origin port'],
  ['transshipment', 'At transshipment port'],
  ['arrived', 'Arrived at destination port'],
  ['discharged', 'Discharged at destination'],
  ['import_cleared', 'Import clearance completed'],
  ['out_for_delivery', 'Out for delivery'],
  ['delivered', 'Delivered'],
  ['on_hold', 'On hold — action needed'],
  ['custom', 'Other update'],
];

export const caseTypes = {
  expert: 'Speak to a freight expert',
  general: 'General question',
  shipment: 'About an existing shipment',
  documents: 'Documents & paperwork',
  billing: 'Billing & invoices',
  business_account: 'Business account inquiry',
  complaint: 'Complaint / escalation',
};

export const caseStatuses = {
  open: 'Open', in_progress: 'In progress', waiting_customer: 'Waiting on customer', escalated: 'Escalated', resolved: 'Resolved',
};

if (config.production && (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32)) {
  console.error('APP_SECRET must be set to a random string of at least 32 characters in production.');
  process.exit(1);
}
