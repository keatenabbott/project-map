# Project Map — Client Portal

A branded client portal for custom home builders.
Powered by Dune Homes.

## Per-Client Setup
1. Edit `config.js` with the builder's branding and contact info
2. Update `firebase.json` and `.firebaserc` with their Firebase project ID
3. Deploy: `npx firebase-tools deploy --only hosting`

## Files
- `config.js` — per-client branding config (edit this for each builder)
- `app.js` — portal application logic (rarely needs editing)
- `styles.css` — all styling (rarely needs editing)
- `index.html` — HTML shell (rarely needs editing)
- `qbo-callback.html` — QuickBooks OAuth callback page
