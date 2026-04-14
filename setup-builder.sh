#!/bin/bash
# ============================================================
# PROJECT MAP — New Builder Setup Script
# ============================================================
# Run this after creating a Firebase project in the console.
# It handles everything else: config, files, deploy.
# ============================================================

set -e

echo ""
echo "========================================="
echo "  PROJECT MAP — New Builder Setup"
echo "========================================="
echo ""

# ── Step 1: Builder info ────────────────────────────────────

read -p "Builder name (e.g., Smith Builders): " BUILDER_NAME
if [ -z "$BUILDER_NAME" ]; then echo "❌ Builder name is required."; exit 1; fi

# Convert to uppercase for portal display
COMPANY_UPPER=$(echo "$BUILDER_NAME" | tr '[:lower:]' '[:upper:]')

# Generate folder-safe name
FOLDER_NAME=$(echo "$BUILDER_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
PORTAL_DIR="$HOME/${FOLDER_NAME}-portal"

echo ""
read -p "Tagline (e.g., Design+Build, Custom Homes) [Client Portal]: " TAGLINE
TAGLINE=${TAGLINE:-Client Portal}

echo ""
read -p "Firebase Project ID (from console, e.g., smith-builders-portal-abc12): " PROJECT_ID
if [ -z "$PROJECT_ID" ]; then echo "❌ Firebase Project ID is required."; exit 1; fi

echo ""
read -p "Brand accent color hex (e.g., #2C5F2D) [#C4A57B]: " ACCENT_COLOR
ACCENT_COLOR=${ACCENT_COLOR:-#C4A57B}

echo ""
read -p "Background color hex (e.g., #FAF9F6) [#FAF9F6]: " BG_COLOR
BG_COLOR=${BG_COLOR:-#FAF9F6}

echo ""
read -p "Contact email: " SUPPORT_EMAIL
if [ -z "$SUPPORT_EMAIL" ]; then echo "❌ Contact email is required."; exit 1; fi

echo ""
read -p "Contact phone (optional, press Enter to skip): " SUPPORT_PHONE

# ── Step 2: Firebase config ─────────────────────────────────

echo ""
echo "========================================="
echo "  Paste Firebase Web App Config"
echo "========================================="
echo ""
echo "Go to Firebase Console → Project Settings → Your apps → Web app"
echo "Copy each value and paste below."
echo ""

read -p "apiKey: " API_KEY
if [ -z "$API_KEY" ]; then echo "❌ API key is required."; exit 1; fi

read -p "authDomain [${PROJECT_ID}.firebaseapp.com]: " AUTH_DOMAIN
AUTH_DOMAIN=${AUTH_DOMAIN:-${PROJECT_ID}.firebaseapp.com}

read -p "storageBucket [${PROJECT_ID}.firebasestorage.app]: " STORAGE_BUCKET
STORAGE_BUCKET=${STORAGE_BUCKET:-${PROJECT_ID}.firebasestorage.app}

read -p "messagingSenderId: " MESSAGING_ID
if [ -z "$MESSAGING_ID" ]; then echo "❌ Messaging sender ID is required."; exit 1; fi

read -p "appId: " APP_ID
if [ -z "$APP_ID" ]; then echo "❌ App ID is required."; exit 1; fi

# ── Step 3: Confirm ─────────────────────────────────────────

echo ""
echo "========================================="
echo "  Review"
echo "========================================="
echo ""
echo "  Builder:      $BUILDER_NAME ($COMPANY_UPPER)"
echo "  Tagline:      $TAGLINE"
echo "  Firebase:     $PROJECT_ID"
echo "  Accent:       $ACCENT_COLOR"
echo "  Background:   $BG_COLOR"
echo "  Email:        $SUPPORT_EMAIL"
echo "  Phone:        ${SUPPORT_PHONE:-none}"
echo "  Folder:       $PORTAL_DIR"
echo "  Portal URL:   https://${PROJECT_ID}.web.app"
echo ""
read -p "Deploy? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then echo "Cancelled."; exit 0; fi

# ── Step 4: Create portal directory ─────────────────────────

echo ""
echo "→ Creating $PORTAL_DIR..."

if [ -d "$PORTAL_DIR" ]; then
  echo "⚠️  Directory already exists. Overwriting config files only."
else
  MASTER_DIR="$HOME/project-map-git"
  if [ ! -d "$MASTER_DIR" ]; then
    echo "❌ Master codebase not found at $MASTER_DIR"
    echo "   Clone it first: git clone https://github.com/keatenabbott/project-map.git ~/project-map-git"
    exit 1
  fi
  mkdir -p "$PORTAL_DIR"
  cp "$MASTER_DIR"/app.js "$PORTAL_DIR/"
  cp "$MASTER_DIR"/styles.css "$PORTAL_DIR/"
  cp "$MASTER_DIR"/index.html "$PORTAL_DIR/"
  cp "$MASTER_DIR"/firebase.json "$PORTAL_DIR/"
  cp "$MASTER_DIR"/firestore.rules "$PORTAL_DIR/"
  cp "$MASTER_DIR"/cost-code-template.json "$PORTAL_DIR/"
  cp "$MASTER_DIR"/qbo-callback.html "$PORTAL_DIR/"
  cp "$MASTER_DIR"/.firebaserc "$PORTAL_DIR/" 2>/dev/null || true
  echo "  ✓ Codebase copied"
fi

# ── Step 5: Write config.js ─────────────────────────────────

echo "→ Writing config.js..."

cat > "$PORTAL_DIR/config.js" << CONFIGEOF
const FIREBASE_CONFIG = {
  apiKey:            "${API_KEY}",
  authDomain:        "${AUTH_DOMAIN}",
  projectId:         "${PROJECT_ID}",
  storageBucket:     "${STORAGE_BUCKET}",
  messagingSenderId: "${MESSAGING_ID}",
  appId:             "${APP_ID}"
};
const PORTAL_CONFIG = {
  companyName:     '${COMPANY_UPPER}',
  tagline:         '${TAGLINE}',
  logoUrl:         '',
  primaryColor:    '#262626',
  accentColor:     '${ACCENT_COLOR}',
  backgroundColor: '${BG_COLOR}',
  surfaceColor:    '#FFFFFF',
  borderColor:     '#D5CEC6',
  textSecondary:   '#8A7B6B',
  portalUrl:       'https://${PROJECT_ID}.web.app',
  supportEmail:    '${SUPPORT_EMAIL}',
  supportPhone:    '${SUPPORT_PHONE}',
  qboClientId:     '',
  qboEnvironment:  'production',
};
CONFIGEOF
echo "  ✓ config.js written"

# ── Step 6: Update firebase.json + .firebaserc ──────────────

echo "→ Updating Firebase project references..."

cat > "$PORTAL_DIR/.firebaserc" << RCEOF
{
  "projects": {
    "default": "${PROJECT_ID}"
  }
}
RCEOF

# Update the hosting site in firebase.json
sed -i '' "s/\"site\": \"[^\"]*\"/\"site\": \"${PROJECT_ID}\"/" "$PORTAL_DIR/firebase.json" 2>/dev/null || \
sed -i "s/\"site\": \"[^\"]*\"/\"site\": \"${PROJECT_ID}\"/" "$PORTAL_DIR/firebase.json"

echo "  ✓ Firebase references updated"

# ── Step 7: Set Resend email secrets ──────────────────────────

echo "→ Setting Resend email secrets..."
echo "  (These are shared across all builders — same Resend account)"
echo ""
echo "  Paste the RESEND_API_KEY when prompted (same key you use for Dune):"
npx firebase-tools functions:secrets:set RESEND_API_KEY --project "$PROJECT_ID"
echo ""
echo "  Paste the RESEND_FROM_DOMAIN when prompted (e.g., buildprojectmap.com):"
npx firebase-tools functions:secrets:set RESEND_FROM_DOMAIN --project "$PROJECT_ID"
echo "  ✓ Resend secrets configured"

# ── Step 8: Deploy rules + functions + hosting ─────────────────

echo ""
echo "→ Deploying Firestore rules..."
cd "$PORTAL_DIR"
npx firebase-tools deploy --only firestore:rules --project "$PROJECT_ID"

echo "→ Deploying Cloud Functions..."
cd "$MASTER_DIR"
npx firebase-tools deploy --only functions --project "$PROJECT_ID" --force

echo "→ Deploying to Firebase Hosting..."
cd "$PORTAL_DIR"
npx firebase-tools deploy --only hosting --project "$PROJECT_ID"

# ── Step 9: Seed cost code template ──────────────────────────────

echo ""
echo "→ Seeding cost code template..."
TEMPLATE_FILE="$PORTAL_DIR/cost-code-template.json"
if [ -f "$TEMPLATE_FILE" ]; then
  node -e "
    const admin = require('firebase-admin');
    const fs = require('fs');
    admin.initializeApp({ projectId: '$PROJECT_ID' });
    const db = admin.firestore();
    const data = JSON.parse(fs.readFileSync('$TEMPLATE_FILE', 'utf8'));
    const batch = db.batch();
    if (Array.isArray(data)) {
      batch.set(db.collection('costCodeTemplates').doc('master_v1'), {
        name: 'Master Residential', version: 'master_v1',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      data.forEach(function(code, i) {
        var ref = db.collection('costCodeTemplates').doc('master_v1').collection('codes').doc(code.cost_code || ('code_' + i));
        batch.set(ref, code);
      });
    }
    batch.commit().then(function() {
      console.log('  ✓ ' + data.length + ' cost codes seeded');
      process.exit(0);
    }).catch(function(err) {
      console.error('  ✗ Seeding failed:', err.message);
      console.log('  The template will auto-seed on first project creation.');
      process.exit(0);
    });
  " || echo "  ⚠ Template seeding skipped. Will auto-seed on first project creation."
else
  echo "  ⚠ cost-code-template.json not found. Skipping."
fi

# ── Step 10: IAM reminder ────────────────────────────────────────

echo ""
echo "========================================="
echo "  ✅ ${BUILDER_NAME} portal is LIVE"
echo "========================================="
echo ""
echo "  URL:     https://${PROJECT_ID}.web.app"
echo "  Folder:  $PORTAL_DIR"
echo ""
echo "  ⚠ ONE MANUAL STEP REMAINING:"
echo "  Grant Firebase Auth Admin to the compute service account"
echo "  so the welcome email can generate password reset links."
echo ""
echo "  → Go to: console.cloud.google.com/iam-admin/iam?project=${PROJECT_ID}"
echo "  → Find: [PROJECT_NUMBER]-compute@developer.gserviceaccount.com"
echo "  → Add role: Firebase Authentication Admin"
echo "  → Save"
echo ""
echo "  After that, visit the URL and create the admin account."
echo "  To redeploy: cd $PORTAL_DIR && npx firebase-tools deploy --only hosting --project $PROJECT_ID"
echo ""
