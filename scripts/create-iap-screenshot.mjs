import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const cwd = process.cwd();
const outDir = path.join(cwd, 'app-review-assets');
await fs.mkdir(outDir, { recursive: true });

const logo = await fs.readFile(path.join(cwd, 'src/logo1.png'));
const logoB64 = logo.toString('base64');
const width = 1290;
const height = 2796;

const plans = {
  monthly: {
    title: 'Monthly Subscription',
    productName: 'OurGLP1 Pro Monthly',
    cadence: 'Auto-renewing subscription',
    price: '$4.99',
    period: 'per month',
    button: 'Subscribe for $4.99/month',
    renewal: 'Subscription renews monthly until canceled.',
    review: 'This screen shows the monthly in-app purchase item and the',
    fileBase: 'ourglp1v2-monthly-subscription',
  },
  yearly: {
    title: 'Yearly Subscription',
    productName: 'OurGLP1 Pro Yearly',
    cadence: 'Billed annually',
    price: '$39.99',
    period: 'per year',
    button: 'Subscribe for $39.99/year',
    renewal: 'Subscription renews yearly until canceled.',
    review: 'This screen shows the yearly in-app purchase item and the',
    fileBase: 'ourglp1v2-yearly-subscription',
  },
};

const makeSvg = (plan) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eaf7f4"/>
      <stop offset="0.45" stop-color="#fffaf3"/>
      <stop offset="1" stop-color="#f7fbfb"/>
    </linearGradient>
    <linearGradient id="cta" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f766e"/>
      <stop offset="1" stop-color="#146c61"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="22" stdDeviation="28" flood-color="#143a38" flood-opacity="0.15"/>
    </filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#143a38" flood-opacity="0.10"/>
    </filter>
    <clipPath id="logoClip"><rect x="502" y="208" width="286" height="286" rx="64"/></clipPath>
    <style><![CDATA[
      .font { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif; }
      .heading { fill: #153a38; font-weight: 900; letter-spacing: 0; }
      .body { fill: #536766; font-weight: 500; }
      .muted { fill: #6f807f; font-weight: 600; }
      .teal { fill: #0f766e; }
      .orange { fill: #b45309; }
      .smallcaps { font-size: 32px; font-weight: 850; letter-spacing: 2px; }
      .feature-title { fill: #173d3a; font-size: 38px; font-weight: 830; }
      .feature-desc { fill: #536766; font-size: 29px; font-weight: 530; }
    ]]></style>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <g class="font">
    <text x="645" y="112" text-anchor="middle" font-size="30" class="muted">9:41</text>
    <rect x="1064" y="88" width="68" height="28" rx="8" fill="none" stroke="#59716f" stroke-width="4"/>
    <rect x="1136" y="98" width="6" height="10" rx="3" fill="#59716f"/>
    <rect x="1072" y="96" width="45" height="12" rx="4" fill="#59716f"/>

    <image x="502" y="208" width="286" height="286" href="data:image/png;base64,${logoB64}" clip-path="url(#logoClip)" preserveAspectRatio="xMidYMid slice"/>
    <rect x="502" y="208" width="286" height="286" rx="64" fill="none" stroke="rgba(13,43,43,0.12)" stroke-width="3"/>

    <text x="645" y="592" text-anchor="middle" font-size="34" class="teal smallcaps">OURGLP1V2 PRO</text>
    <text x="645" y="692" text-anchor="middle" font-size="86" class="heading">${plan.title}</text>
    <text x="645" y="764" text-anchor="middle" font-size="38" class="body">Unlock deeper GLP-1 tracking, planning, and review tools.</text>

    <g filter="url(#shadow)"><rect x="100" y="870" width="1090" height="1304" rx="34" fill="#ffffff"/></g>
    <rect x="100" y="870" width="1090" height="1304" rx="34" fill="#ffffff" stroke="rgba(13,43,43,0.10)" stroke-width="3"/>

    <rect x="154" y="936" width="982" height="238" rx="24" fill="#fff7ed" stroke="#f2c89c" stroke-width="3"/>
    <text x="202" y="1010" font-size="34" class="orange smallcaps">SELECTED PLAN</text>
    <text x="202" y="1087" font-size="62" class="heading">${plan.productName}</text>
    <text x="202" y="1146" font-size="34" class="body">${plan.cadence}</text>
    <text x="1068" y="1055" text-anchor="end" font-size="74" font-weight="900" fill="#153a38">${plan.price}</text>
    <text x="1068" y="1112" text-anchor="end" font-size="34" class="muted">${plan.period}</text>

    <text x="154" y="1274" font-size="44" class="heading">Included with Pro</text>

    <g transform="translate(154 1344)">
      <circle cx="30" cy="30" r="30" fill="#e7f5f2"/>
      <path d="M18 31 L27 40 L44 20" fill="none" stroke="#0f766e" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="86" y="30" class="feature-title">Personal plan</text>
      <text x="86" y="76" class="feature-desc">Week-by-week targets for protein, water, fasting, and movement.</text>
    </g>
    <g transform="translate(154 1512)">
      <circle cx="30" cy="30" r="30" fill="#e7f5f2"/>
      <path d="M18 31 L27 40 L44 20" fill="none" stroke="#0f766e" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="86" y="30" class="feature-title">Deeper trends</text>
      <text x="86" y="76" class="feature-desc">Day detail, saved graph history, and pattern review beyond today.</text>
    </g>
    <g transform="translate(154 1680)">
      <circle cx="30" cy="30" r="30" fill="#e7f5f2"/>
      <path d="M18 31 L27 40 L44 20" fill="none" stroke="#0f766e" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="86" y="30" class="feature-title">Archive and share</text>
      <text x="86" y="76" class="feature-desc">Keep weekly summaries and build a cleaner record for appointments.</text>
    </g>

    <rect x="154" y="1878" width="982" height="116" rx="22" fill="#f4fbf9" stroke="#cfe6e1" stroke-width="3"/>
    <text x="645" y="1949" text-anchor="middle" font-size="34" font-weight="800" fill="#173d3a">${plan.renewal}</text>
    <rect x="154" y="2052" width="982" height="86" rx="43" fill="url(#cta)"/>
    <text x="645" y="2108" text-anchor="middle" font-size="34" font-weight="850" fill="#ffffff">${plan.button}</text>

    <text x="645" y="2246" text-anchor="middle" font-size="42" class="heading">Your GLP-1 progress, easier to review.</text>
    <text x="645" y="2304" text-anchor="middle" font-size="32" class="body">Designed for daily logs, trend checks, and weekly summaries.</text>

    <g filter="url(#soft)"><rect x="100" y="2394" width="1090" height="268" rx="28" fill="#ffffff"/></g>
    <rect x="100" y="2394" width="1090" height="268" rx="28" fill="#ffffff" stroke="rgba(13,43,43,0.10)" stroke-width="3"/>
    <text x="154" y="2462" font-size="31" class="muted">Review notes</text>
    <text x="154" y="2518" font-size="32" class="body">${plan.review}</text>
    <text x="154" y="2564" font-size="32" class="body">Pro service unlocked inside OurGLP1v2.</text>
    <text x="154" y="2610" font-size="29" class="muted">Restore Purchases - Terms - Privacy</text>
    <rect x="472" y="2722" width="346" height="12" rx="6" fill="#153a38" opacity="0.78"/>
  </g>
</svg>`;

const selected = process.argv[2] ?? 'monthly';
const plan = plans[selected];

if (!plan) {
  throw new Error(`Unknown plan "${selected}". Use "monthly" or "yearly".`);
}

const svg = makeSvg(plan);
const svgPath = path.join(outDir, `${plan.fileBase}.svg`);
const pngPath = path.join(outDir, `${plan.fileBase}.png`);
await fs.writeFile(svgPath, svg);
await sharp(Buffer.from(svg)).png().toFile(pngPath);

console.log(pngPath);
