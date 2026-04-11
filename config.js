// ============================================================
// PROJECT MAP — Builder Configuration
// ============================================================
// This is the ONLY file you need to change per builder.
// Everything else in the codebase reads from these values.
// ============================================================

// ── FIREBASE PROJECT ────────────────────────────────────────
// Create a new Firebase project for each builder at
// https://console.firebase.google.com
// Enable: Authentication (Email/Password), Firestore, Storage, Hosting

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyA2fcaIwuU4S4yor9qFhuX28Y4N-75fvgw",
  authDomain:        "dune-homes-portal-19e69.firebaseapp.com",
  projectId:         "dune-homes-portal-19e69",
  storageBucket:     "dune-homes-portal-19e69.firebasestorage.app",
  messagingSenderId: "363389549163",
  appId:             "1:363389549163:web:1cb2c79da1b17dea7c0f2e"
};

// ── PORTAL BRANDING ─────────────────────────────────────────
// Customize the look, name, and contact info for this builder.

const PORTAL_CONFIG = {
  // Company & branding
  companyName:     'DUNE HOMES',            // Shown in nav, headers, page title
  tagline:         'Client Portal',          // Shown in footer and title bar
  logoUrl:         '',                      // URL to logo image (leave empty for text-only)

  // Theme colors (dark)
  primaryColor:    '#E8E4DE',               // Light text on dark backgrounds
  accentColor:     '#C4A57B',               // Gold accent — buttons, borders, highlights
  backgroundColor: '#1A1A17',               // Dark page background
  surfaceColor:    '#232320',               // Dark card backgrounds
  borderColor:     '#3A3A35',               // Subtle dark borders
  textSecondary:   '#8A857B',               // Muted text on dark

  // Portal URL (the custom domain for this builder's portal)
  portalUrl:       'https://portal.dunehomes.com',

  // Support contact
  supportEmail:    'keaten@dunehomes.com',  // Shown in footer + support references
  supportPhone:    '',                      // Optional

  // QuickBooks Online (leave empty to disable QBO features)
  qboClientId:     'ABVFODEYE2uPLLLPPD0jCkjOgC5Y3eZnL0DSKAlgRA3O8JCOSh',
  qboEnvironment:  'production',            // 'sandbox' or 'production'
};
