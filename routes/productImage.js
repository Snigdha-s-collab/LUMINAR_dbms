const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Category icons (SVG paths) for each product category
const categoryIcons = {
    'Cleanser': '<path d="M60 25c-4 0-7 3-7 7v3h-8c-3 0-5 2-5 5v35c0 8 9 15 20 15s20-7 20-15V40c0-3-2-5-5-5h-8v-3c0-4-3-7-7-7zm-3 10h6v3h-6v-3zm-12 8h30v32c0 5-7 10-15 10s-15-5-15-10V43z" fill="currentColor" opacity="0.9"/><circle cx="60" cy="58" r="6" fill="currentColor" opacity="0.4"/>',
    'Moisturizer': '<path d="M50 20h20c2 0 4 2 4 4v5H46v-5c0-2 2-4 4-4zm-9 13h38c3 0 5 2 5 5v30c0 8-10 17-24 17S36 76 36 68V38c0-3 2-5 5-5z" fill="currentColor" opacity="0.9"/><ellipse cx="60" cy="55" rx="14" ry="10" fill="currentColor" opacity="0.3"/>',
    'Serum': '<path d="M55 15h10c1 0 2 1 2 2v8h3c2 0 3 1 3 3v5l-5 7v30c0 5-4 10-8 10s-8-5-8-10V40l-5-7v-5c0-2 1-3 3-3h3v-8c0-1 1-2 2-2z" fill="currentColor" opacity="0.9"/><circle cx="60" cy="60" r="5" fill="currentColor" opacity="0.4"/><circle cx="60" cy="50" r="3" fill="currentColor" opacity="0.3"/>',
    'Sunscreen': '<circle cx="60" cy="45" r="20" fill="currentColor" opacity="0.2"/><path d="M60 25l3 8h8l-6 5 2 8-7-5-7 5 2-8-6-5h8z" fill="currentColor" opacity="0.7"/><path d="M45 50h30c3 0 5 2 5 5v15c0 8-8 15-20 15s-20-7-20-15V55c0-3 2-5 5-5z" fill="currentColor" opacity="0.9"/>',
    'Toner': '<path d="M52 15h16c2 0 3 1 3 3v7H49v-7c0-2 1-3 3-3zm-7 14h30c2 0 4 2 4 4v38c0 6-8 12-19 12S41 77 41 71V33c0-2 2-4 4-4z" fill="currentColor" opacity="0.9"/><path d="M50 40h20v3H50z" fill="currentColor" opacity="0.3"/><path d="M50 47h20v3H50z" fill="currentColor" opacity="0.3"/>',
    'Mask': '<path d="M60 20c-18 0-30 12-30 28 0 10 5 18 12 23l6-8c3 5 7 8 12 8s9-3 12-8l6 8c7-5 12-13 12-23 0-16-12-28-30-28z" fill="currentColor" opacity="0.9"/><circle cx="48" cy="45" r="5" fill="currentColor" opacity="0.3"/><circle cx="72" cy="45" r="5" fill="currentColor" opacity="0.3"/><ellipse cx="60" cy="58" rx="8" ry="4" fill="currentColor" opacity="0.3"/>',
    'Eye Care': '<path d="M60 40c-20 0-35 15-35 15s15 15 35 15 35-15 35-15-15-15-35-15z" fill="currentColor" opacity="0.2"/><circle cx="60" cy="55" r="12" fill="currentColor" opacity="0.9"/><circle cx="60" cy="55" r="6" fill="currentColor" opacity="0.4"/><path d="M48 30l-5-8M72 30l5-8M60 28v-8" stroke="currentColor" stroke-width="2" fill="none" opacity="0.5"/>',
    'Treatment': '<path d="M55 15h10v10h10v10H65v25c0 5-2 10-5 10s-5-5-5-10V35H45V25h10V15z" fill="currentColor" opacity="0.9"/>',
    'Lip Care': '<path d="M60 30c-12 0-25 8-25 18 0 15 12 27 25 27s25-12 25-27c0-10-13-18-25-18zm0 6c8 0 18 5 18 12 0 3-2 5-6 5-3 0-5-3-12-3s-9 3-12 3c-4 0-6-2-6-5 0-7 10-12 18-12z" fill="currentColor" opacity="0.9"/>',
    'Mist': '<path d="M53 40h14c3 0 5 2 5 5v28c0 5-5 10-12 10s-12-5-12-10V45c0-3 2-5 5-5z" fill="currentColor" opacity="0.9"/><path d="M56 25h8v15h-8z" fill="currentColor" opacity="0.7"/><circle cx="50" cy="20" r="3" fill="currentColor" opacity="0.4"/><circle cx="60" cy="15" r="2" fill="currentColor" opacity="0.3"/><circle cx="70" cy="20" r="3" fill="currentColor" opacity="0.4"/><circle cx="55" cy="12" r="2" fill="currentColor" opacity="0.25"/>',
    'Body Care': '<path d="M50 20h20c2 0 4 2 4 4v5H46v-5c0-2 2-4 4-4zm-9 13h38c3 0 5 2 5 5v30c0 8-10 17-24 17S36 76 36 68V38c0-3 2-5 5-5z" fill="currentColor" opacity="0.9"/>',
};

// Color themes per category — gradient pairs [start, end, accent, textColor]
const categoryColors = {
    'Cleanser':    { bg1: '#0a2e4d', bg2: '#1a4a6e', accent: '#5bb8f5', text: '#b8dff7' },
    'Moisturizer': { bg1: '#1a3a1a', bg2: '#2d5a2d', accent: '#6ddb6d', text: '#b8f0b8' },
    'Serum':       { bg1: '#3d1a4d', bg2: '#5a2d6e', accent: '#c77dff', text: '#e4c0f7' },
    'Sunscreen':   { bg1: '#4d3a0a', bg2: '#6e5a1a', accent: '#ffd93d', text: '#f7edb8' },
    'Toner':       { bg1: '#1a3d4d', bg2: '#2d5a6e', accent: '#5dd8e8', text: '#b8eef7' },
    'Mask':        { bg1: '#4d1a2e', bg2: '#6e2d45', accent: '#ff7eb3', text: '#f7b8d0' },
    'Eye Care':    { bg1: '#2e1a4d', bg2: '#452d6e', accent: '#a77dff', text: '#d4b8f7' },
    'Treatment':   { bg1: '#4d2e1a', bg2: '#6e452d', accent: '#ff9f5b', text: '#f7d4b8' },
    'Lip Care':    { bg1: '#4d1a1a', bg2: '#6e2d2d', accent: '#ff6b6b', text: '#f7b8b8' },
    'Mist':        { bg1: '#1a4d4d', bg2: '#2d6e6e', accent: '#5be8d8', text: '#b8f7f0' },
    'Body Care':   { bg1: '#3d3d1a', bg2: '#5a5a2d', accent: '#d8db5d', text: '#eef0b8' },
};

// GET /product-image/:id — Generate SVG product image dynamically
router.get('/:id', async (req, res) => {
    try {
        const [products] = await db.query(`
            SELECT p.Product_name, p.Category, p.P_Skin_type, b.Brand_name
            FROM Product p JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE p.Product_id = ?
        `, [req.params.id]);

        const product = products[0];
        if (!product) {
            return generateDefaultSVG(res);
        }

        const category = product.Category || 'Cleanser';
        const colors = categoryColors[category] || categoryColors['Cleanser'];
        const icon = categoryIcons[category] || categoryIcons['Cleanser'];

        const brandName = (product.Brand_name || 'Luminar').substring(0, 25);
        // Break product name into lines if too long
        const fullName = product.Product_name || 'Product';
        const nameLines = wrapText(fullName, 22);
        const skinType = product.P_Skin_type || '';

        // Generate unique pattern seed from product id
        const seed = parseInt(req.params.id) || 1;
        const patternRotation = (seed * 37) % 360;
        const patternScale = 0.8 + (seed % 5) * 0.1;

        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors.bg1}"/>
      <stop offset="100%" stop-color="${colors.bg2}"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="white" stop-opacity="0.08"/>
      <stop offset="50%" stop-color="white" stop-opacity="0"/>
      <stop offset="100%" stop-color="white" stop-opacity="0.03"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="${colors.accent}" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="${colors.accent}" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="${colors.accent}" flood-opacity="0.3"/>
    </filter>
  </defs>
  
  <!-- Background -->
  <rect width="400" height="400" rx="12" fill="url(#bg)"/>
  <rect width="400" height="400" rx="12" fill="url(#glow)"/>
  
  <!-- Decorative pattern -->
  <g transform="translate(200,200) rotate(${patternRotation}) scale(${patternScale})" opacity="0.06">
    <circle r="120" fill="none" stroke="${colors.accent}" stroke-width="1"/>
    <circle r="90" fill="none" stroke="${colors.accent}" stroke-width="0.5"/>
    <circle r="150" fill="none" stroke="${colors.accent}" stroke-width="0.5"/>
  </g>
  
  <!-- Top accent line -->
  <rect x="30" y="20" width="60" height="3" rx="2" fill="${colors.accent}" opacity="0.6"/>
  
  <!-- Brand name -->
  <text x="30" y="52" font-family="'Inter','Segoe UI',sans-serif" font-size="14" font-weight="600" fill="${colors.text}" letter-spacing="2" text-transform="uppercase" opacity="0.7">${escapeXml(brandName.toUpperCase())}</text>
  
  <!-- Category icon (centered) -->
  <g transform="translate(140, 80) scale(1.6)" color="${colors.accent}" filter="url(#shadow)">
    ${icon}
  </g>
  
  <!-- Shine overlay on icon -->
  <rect x="140" y="80" width="120" height="100" rx="8" fill="url(#shine)"/>
  
  <!-- Product name -->
  ${nameLines.map((line, i) => 
    `<text x="200" y="${245 + i * 28}" font-family="'Playfair Display','Georgia',serif" font-size="22" font-weight="600" fill="white" text-anchor="middle" opacity="0.95">${escapeXml(line)}</text>`
  ).join('\n  ')}
  
  <!-- Category tag -->
  <rect x="${200 - (category.length * 5 + 16)}" y="${245 + nameLines.length * 28 + 8}" width="${category.length * 10 + 32}" height="26" rx="13" fill="${colors.accent}" opacity="0.2"/>
  <text x="200" y="${245 + nameLines.length * 28 + 26}" font-family="'Inter','Segoe UI',sans-serif" font-size="12" font-weight="500" fill="${colors.accent}" text-anchor="middle" letter-spacing="1">${escapeXml(category.toUpperCase())}</text>
  
  <!-- Skin type badge -->
  ${skinType ? `
  <rect x="290" y="18" width="${skinType.length * 8 + 24}" height="24" rx="12" fill="${colors.accent}" opacity="0.2"/>
  <text x="${302 + skinType.length * 4}" y="35" font-family="'Inter','Segoe UI',sans-serif" font-size="11" font-weight="500" fill="${colors.accent}" text-anchor="middle">${escapeXml(skinType)}</text>
  ` : ''}
  
  <!-- Bottom decorative dots -->
  <circle cx="185" cy="380" r="3" fill="${colors.accent}" opacity="0.3"/>
  <circle cx="200" cy="380" r="3" fill="${colors.accent}" opacity="0.5"/>
  <circle cx="215" cy="380" r="3" fill="${colors.accent}" opacity="0.3"/>
  
  <!-- Corner accent -->
  <rect x="370" y="370" width="20" height="3" rx="2" fill="${colors.accent}" opacity="0.4"/>
</svg>`;

        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
        res.send(svg);
    } catch (err) {
        console.error('Product image error:', err);
        generateDefaultSVG(res);
    }
});

function generateDefaultSVG(res) {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <rect width="400" height="400" rx="12" fill="#1a1625"/>
  <text x="200" y="200" font-family="Inter,sans-serif" font-size="16" fill="#c9a0dc" text-anchor="middle" dominant-baseline="middle">Luminar Skincare</text>
</svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
}

function wrapText(text, maxChars) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
        if (currentLine.length + word.length + 1 <= maxChars) {
            currentLine += (currentLine ? ' ' : '') + word;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine) lines.push(currentLine);
    
    // Max 3 lines
    if (lines.length > 3) {
        lines[2] = lines[2] + '...';
        return lines.slice(0, 3);
    }
    return lines;
}

function escapeXml(str) {
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&apos;');
}

module.exports = router;
