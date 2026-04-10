# Project Map — New Builder Setup Guide

## What You Need
- A Google account (for Firebase)
- The builder's company name, colors, logo, and support email
- A custom domain (optional but recommended — e.g., `portal.smithbuilders.com`)

## Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click **Add Project** → name it (e.g., `smith-builders-portal`)
3. Disable Google Analytics (not needed) → Create

### Enable Services

4. **Authentication** → Get Started → Sign-in method → Enable **Email/Password**
5. **Firestore Database** → Create Database → Start in **production mode** → Choose region
6. **Storage** → Get Started → Start in **production mode**
7. **Hosting** → Get Started → follow the prompts

### Get Firebase Config

8. Go to **Project Settings** (gear icon) → scroll to **Your apps** → click **Web** (`</>`)
9. Register app (any nickname) → copy the `firebaseConfig` values

## Step 2: Configure the Portal

1. Copy `config.template.js` → `config.js`
2. Paste the Firebase config values into `FIREBASE_CONFIG`
3. Fill in `PORTAL_CONFIG` with the builder's branding:
   - `companyName` — their company name (ALL CAPS recommended)
   - `tagline` — "Client Portal" or their custom tagline
   - `accentColor` — their brand color (hex code)
   - `portalUrl` — the custom domain they'll use
   - `supportEmail` — their contact email

## Step 3: Deploy Firestore Rules

Copy `firestore.rules` to the Firebase project:

```bash
npx firebase-tools login
npx firebase-tools use --add   # select the new project
npx firebase-tools deploy --only firestore:rules
```

## Step 4: Seed the Cost Code Template

The master cost code template needs to be loaded into Firestore:

1. Go to Firebase Console → Firestore
2. Create collection `costCodeTemplates`
3. Create document `master_v1`
4. Import the data from `cost-code-template.json` (use the Firebase CLI or a script)

Or — create the first admin account (Step 5), log in, and use the portal's built-in project creation wizard which seeds from the template automatically.

## Step 5: Deploy to Firebase Hosting

```bash
npx firebase-tools deploy --only hosting
```

The portal is now live at `<project-id>.web.app`.

## Step 6: Custom Domain (Optional)

1. Firebase Console → Hosting → Add custom domain
2. Enter the domain (e.g., `portal.smithbuilders.com`)
3. Add the DNS records Firebase provides to the builder's domain registrar
4. Wait for SSL provisioning (usually 10-30 minutes)

## Step 7: Create Admin Account

1. Visit the portal URL
2. First visit shows the "Create Admin Account" setup screen
3. Enter the builder's name, email, and password
4. They're now the admin and can create projects, add clients, etc.

---

## Files Overview

| File | Purpose | Change per builder? |
|------|---------|-------------------|
| `config.js` | Firebase + branding config | **YES — only file to change** |
| `config.template.js` | Blank template for new builders | No |
| `app.js` | All portal logic | No |
| `styles.css` | All styling | No |
| `index.html` | HTML shell | No |
| `firebase.json` | Hosting + Firestore config | No |
| `firestore.rules` | Security rules | No |
| `cost-code-template.json` | Master cost codes (257 items) | No (customized in-app) |
| `qbo-callback.html` | QuickBooks OAuth callback | No (reads from config.js) |

## QuickBooks Setup (Optional)

If the builder wants QuickBooks invoice sync:

1. Create an app at [Intuit Developer Portal](https://developer.intuit.com)
2. Set redirect URI to `https://<portal-domain>/qbo-callback.html`
3. Copy the Client ID into `config.js` → `qboClientId`
4. Deploy Cloud Functions for the OAuth token exchange (separate setup)

## Estimated Time

| Task | Time |
|------|------|
| Firebase project creation | 10 min |
| Config.js customization | 15 min |
| Deploy + DNS | 20 min |
| Admin account + first project | 10 min |
| **Total** | **~1 hour** |
