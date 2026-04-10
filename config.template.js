// ============================================================
// PROJECT MAP — Builder Configuration Template
// ============================================================
// Copy this file to config.js and fill in each value.
// This is the ONLY file you need to change per builder.
// ============================================================

// ── FIREBASE PROJECT ────────────────────────────────────────
// 1. Go to https://console.firebase.google.com
// 2. Create a new project (e.g., "smith-builders-portal")
// 3. Add a Web App → copy the config values below
// 4. Enable: Authentication > Email/Password
// 5. Create Firestore Database (production mode)
// 6. Enable Storage
// 7. Set up Hosting

const FIREBASE_CONFIG = {
  apiKey:            "",    // From Firebase Console > Project Settings > Web App
  authDomain:        "",    // e.g., "smith-builders-portal.firebaseapp.com"
  projectId:         "",    // e.g., "smith-builders-portal"
  storageBucket:     "",    // e.g., "smith-builders-portal.firebasestorage.app"
  messagingSenderId: "",    // From Firebase Console
  appId:             ""     // From Firebase Console
};

// ── PORTAL BRANDING ─────────────────────────────────────────

const PORTAL_CONFIG = {
  // Company & branding
  companyName:     '',              // e.g., "SMITH BUILDERS" — shown in nav, headers, title
  tagline:         'Client Portal', // e.g., "Client Portal" or "Powered by Dune"
  logoUrl:         '',              // URL to logo image (leave empty for text-only)

  // Theme colors (defaults shown — customize to match builder's brand)
  primaryColor:    '#1a1a1a',       // Nav bar, dark elements
  accentColor:     '#C4A57B',       // Accent — buttons, highlights (gold default)
  backgroundColor: '#FAF9F6',       // Page background (warm off-white default)
  surfaceColor:    '#FFFFFF',       // Card backgrounds
  borderColor:     '#e5e3de',       // Borders
  textSecondary:   '#8A7B6B',       // Muted text

  // Portal URL (custom domain pointing to Firebase Hosting)
  portalUrl:       '',              // e.g., "https://portal.smithbuilders.com"

  // Support contact
  supportEmail:    '',              // e.g., "info@smithbuilders.com"
  supportPhone:    '',              // e.g., "(435) 555-0100"

  // QuickBooks Online (leave empty to disable)
  qboClientId:     '',              // From Intuit Developer Portal
  qboEnvironment:  'production',    // 'sandbox' or 'production'
};
