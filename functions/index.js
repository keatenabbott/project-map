const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { Resend } = require("resend");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFromDomain = defineSecret("RESEND_FROM_DOMAIN");
const qboClientSecret = defineSecret("QBO_CLIENT_SECRET");
const qboClientId = defineSecret("QBO_CLIENT_ID");

// ═══════════════════════════════════════════════════════════════════════════
// QUICKBOOKS ONLINE — OAuth + API
// ═══════════════════════════════════════════════════════════════════════════

const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_API_BASE = "https://quickbooks.api.intuit.com/v3/company";
const QBO_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

// Helper: get stored QBO settings
async function getQboSettings() {
  const snap = await db.collection("settings").doc("qbo").get();
  return snap.exists ? snap.data() : null;
}

// Helper: refresh access token if expired
async function ensureFreshToken(settings) {
  if (!settings || !settings.refreshToken) throw new Error("No QBO tokens stored");

  // If token is still valid (with 5-min buffer), return as-is
  if (settings.accessTokenExpiry && settings.accessTokenExpiry.toDate() > new Date(Date.now() + 5 * 60000)) {
    return settings;
  }

  // Refresh the token
  const clientId = settings.clientId;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const basicAuth = Buffer.from(clientId + ":" + clientSecret).toString("base64");

  const resp = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + basicAuth,
      "Accept": "application/json",
    },
    body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(settings.refreshToken),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    console.error("Token refresh failed:", errBody);
    throw new Error("Failed to refresh QBO token");
  }

  const tokens = await resp.json();
  const now = new Date();
  const update = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || settings.refreshToken,
    accessTokenExpiry: new Date(now.getTime() + tokens.expires_in * 1000),
    lastRefreshed: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("settings").doc("qbo").update(update);
  return Object.assign({}, settings, update);
}

// Helper: make QBO API call
async function qboApiCall(settings, endpoint) {
  const fresh = await ensureFreshToken(settings);
  const url = QBO_API_BASE + "/" + fresh.realmId + endpoint;
  const resp = await fetch(url, {
    headers: {
      "Authorization": "Bearer " + fresh.accessToken,
      "Accept": "application/json",
    },
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    console.error("QBO API error:", resp.status, errBody);
    throw new Error("QBO API error: " + resp.status);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// qboProcessAuth — Firestore trigger: exchanges OAuth code for tokens
// ---------------------------------------------------------------------------
exports.qboProcessAuth = onDocumentCreated(
  {
    document: "_qboAuth/{docId}",
    secrets: [qboClientSecret, qboClientId],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    const docRef = snap.ref;

    if (data.status !== "pending") return;

    try {
      const { code, realmId, callbackUrl } = data;
      if (!code || !realmId) {
        await docRef.update({ status: "error", error: "Missing code or realmId" });
        return;
      }

      const clientId = process.env.QBO_CLIENT_ID || "";
      const clientSecret = process.env.QBO_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        await docRef.update({ status: "error", error: "QBO credentials not configured" });
        return;
      }

      // Build redirect URI from the callback URL
      const callbackUrlObj = new URL(callbackUrl);
      const redirectUri = callbackUrlObj.origin + callbackUrlObj.pathname;

      const basicAuth = Buffer.from(clientId + ":" + clientSecret).toString("base64");

      // Exchange auth code for tokens
      const resp = await fetch(QBO_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + basicAuth,
          "Accept": "application/json",
        },
        body:
          "grant_type=authorization_code" +
          "&code=" + encodeURIComponent(code) +
          "&redirect_uri=" + encodeURIComponent(redirectUri),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        console.error("QBO token exchange failed:", resp.status, errBody);
        await docRef.update({ status: "error", error: "Token exchange failed: " + resp.status });
        return;
      }

      const tokens = await resp.json();
      const now = new Date();

      // Store tokens in settings/qbo
      await db.collection("settings").doc("qbo").set({
        clientId: clientId,
        realmId: realmId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiry: new Date(now.getTime() + tokens.expires_in * 1000),
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastRefreshed: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Mark auth as complete
      await docRef.update({ status: "complete" });
      console.info("QBO connected: realmId=" + realmId);

    } catch (err) {
      console.error("qboProcessAuth error:", err);
      await docRef.update({ status: "error", error: err.message || "Unknown error" });
    }
  }
);

// ---------------------------------------------------------------------------
// qboProcessRequest — Firestore trigger: handles QBO API requests
// ---------------------------------------------------------------------------
exports.qboProcessRequest = onDocumentCreated(
  {
    document: "_qboRequests/{docId}",
    secrets: [qboClientSecret, qboClientId],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    const docRef = snap.ref;

    if (data.status !== "pending") return;

    try {
      const settings = await getQboSettings();
      if (!settings) {
        await docRef.update({ status: "error", error: "QuickBooks not connected" });
        return;
      }

      let results = [];

      switch (data.type) {
        case "getCustomers": {
          const resp = await qboApiCall(settings, "/query?query=" + encodeURIComponent("SELECT * FROM Customer MAXRESULTS 1000"));
          const customers = (resp.QueryResponse && resp.QueryResponse.Customer) || [];
          results = customers.map((c) => ({
            id: c.Id,
            displayName: c.DisplayName,
            email: c.PrimaryEmailAddr ? c.PrimaryEmailAddr.Address : "",
            phone: c.PrimaryPhone ? c.PrimaryPhone.FreeFormNumber : "",
          }));
          break;
        }

        case "getInvoices": {
          let query = "SELECT * FROM Invoice MAXRESULTS 1000";
          if (data.customerId) {
            query = "SELECT * FROM Invoice WHERE CustomerRef = '" + data.customerId + "' MAXRESULTS 1000";
          }
          const resp = await qboApiCall(settings, "/query?query=" + encodeURIComponent(query));
          const invoices = (resp.QueryResponse && resp.QueryResponse.Invoice) || [];
          results = invoices.map((inv) => ({
            id: inv.Id,
            docNumber: inv.DocNumber || "",
            txnDate: inv.TxnDate || "",
            dueDate: inv.DueDate || "",
            totalAmt: inv.TotalAmt || 0,
            balance: inv.Balance || 0,
            status: inv.Balance === 0 ? "paid" : (new Date(inv.DueDate) < new Date() ? "overdue" : "pending"),
            customerName: inv.CustomerRef ? inv.CustomerRef.name : "",
          }));
          break;
        }

        case "disconnect": {
          // Revoke the refresh token
          const clientId = settings.clientId;
          const clientSecret = process.env.QBO_CLIENT_SECRET;
          const basicAuth = Buffer.from(clientId + ":" + clientSecret).toString("base64");

          try {
            await fetch(QBO_REVOKE_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Basic " + basicAuth,
              },
              body: JSON.stringify({ token: settings.refreshToken }),
            });
          } catch (revokeErr) {
            console.warn("Token revoke failed (non-fatal):", revokeErr.message);
          }

          // Delete stored tokens
          await db.collection("settings").doc("qbo").delete();
          results = [];
          console.info("QBO disconnected");
          break;
        }

        default:
          await docRef.update({ status: "error", error: "Unknown request type: " + data.type });
          return;
      }

      await docRef.update({ status: "complete", results: results });

    } catch (err) {
      console.error("qboProcessRequest error:", err);
      await docRef.update({ status: "error", error: err.message || "Unknown error" });
    }
  }
);


// ═══════════════════════════════════════════════════════════════════════════
// WELCOME EMAIL + CLIENT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// HTML email template
// ---------------------------------------------------------------------------
function buildWelcomeEmail({ clientName, companyName, accentColor, portalUrl, supportEmail, resetLink }) {
  const accent = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(accentColor) ? accentColor : "#C4A57B";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to ${companyName}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    body { margin:0 !important; padding:0 !important; width:100% !important; }
    @media (prefers-color-scheme:dark) {
      .email-body { background-color:#1A1A17 !important; }
      .card { background-color:#232320 !important; border-color:#3A3A35 !important; }
      .body-text { color:#D1D5DB !important; }
      .footer-text { color:#6B7280 !important; }
      .divider { border-color:#3A3A35 !important; }
    }
    @media only screen and (max-width:600px) {
      .container { width:100% !important; }
      .card { padding:32px 24px !important; }
      .cta-button { padding:14px 28px !important; font-size:15px !important; }
    }
  </style>
</head>
<body class="email-body" style="margin:0;padding:0;background-color:#FAF9F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#FAF9F6;padding:40px 16px;">
    <tr>
      <td align="center">

        <table class="container card" role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;width:100%;background-color:#FFFFFF;border-radius:12px;
                      border:1px solid #E5E3DE;overflow:hidden;">

          <!-- Branded header -->
          <tr>
            <td style="background-color:${accent};padding:32px 40px 28px;text-align:center;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#FFFFFF;letter-spacing:0.08em;line-height:1.2;">
                ${companyName}
              </p>
              <p style="margin:6px 0 0;font-size:11px;font-weight:500;color:rgba(255,255,255,0.7);letter-spacing:1.5px;text-transform:uppercase;">
                Client Portal
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="card" style="background-color:#FFFFFF;padding:36px 40px 28px;">
              <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#1A1A1A;letter-spacing:-0.3px;">
                Hi ${clientName},
              </p>
              <p class="body-text" style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#4A4A4A;">
                Your client portal is ready. Click below to set your password and get started.
              </p>

              <!-- CTA button -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 28px;">
                <tr>
                  <td align="center" style="border-radius:8px;background-color:${accent};">
                    <a class="cta-button" href="${resetLink}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;
                              color:#FFFFFF;text-decoration:none;border-radius:8px;
                              background-color:${accent};">
                      Set Your Password
                    </a>
                  </td>
                </tr>
              </table>

              <p class="body-text" style="margin:0;font-size:12px;line-height:1.6;color:#8A857B;text-align:center;">
                Button not working?
                <a href="${resetLink}" style="color:${accent};text-decoration:underline;">Click here</a>
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <hr class="divider" style="border:none;border-top:1px solid #E5E3DE;margin:0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px;">
              <p class="footer-text" style="margin:0 0 6px;font-size:12px;color:#8A857B;line-height:1.6;text-align:center;">
                Questions? Contact us at
                <a href="mailto:${supportEmail}" style="color:${accent};text-decoration:none;">${supportEmail}</a>
              </p>
              <p class="footer-text" style="margin:0;font-size:11px;color:#B4B4B4;text-align:center;letter-spacing:0.2px;">
                Project Map &mdash; Powered by ${companyName}
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`.trim();
}

// ---------------------------------------------------------------------------
// deleteClientAccount — HTTPS callable: deletes Firebase Auth user
// ---------------------------------------------------------------------------
exports.deleteClientAccount = onCall(
  { enforceAppCheck: false, invoker: "public" },
  async (request) => {
    const { uid } = request.data;
    if (!uid) {
      throw new HttpsError("invalid-argument", "Missing uid.");
    }
    try {
      await admin.auth().deleteUser(uid);
    } catch (err) {
      if (err.code !== "auth/user-not-found") {
        console.error("Failed to delete auth user:", err);
        throw new HttpsError("internal", "Failed to delete user account.");
      }
    }
    console.info(`Deleted auth account for uid: ${uid}`);
    return { success: true };
  }
);

// ---------------------------------------------------------------------------
// sendWelcomeEmail — HTTPS callable: branded welcome email via Resend
// ---------------------------------------------------------------------------
exports.sendWelcomeEmail = onCall(
  {
    secrets: [resendApiKey, resendFromDomain],
    enforceAppCheck: false,
    invoker: "public",
  },
  async (request) => {
    const { clientName, clientEmail, companyName, accentColor, portalUrl, supportEmail } = request.data;

    const missing = ["clientName", "clientEmail", "companyName", "supportEmail"].filter((k) => !request.data[k]);
    if (missing.length) {
      throw new HttpsError("invalid-argument", "Missing: " + missing.join(", "));
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      throw new HttpsError("invalid-argument", "Invalid email address.");
    }

    let resetLink;
    try {
      resetLink = await admin.auth().generatePasswordResetLink(clientEmail, {
        url: portalUrl || "https://example.com",
      });
    } catch (err) {
      console.error("Failed to generate reset link:", err);
      throw new HttpsError("internal", "Failed to generate password reset link.");
    }

    const html = buildWelcomeEmail({
      clientName,
      companyName,
      accentColor: accentColor || "#C4A57B",
      portalUrl: portalUrl || "",
      supportEmail,
      resetLink,
    });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromDomain = process.env.RESEND_FROM_DOMAIN;
    if (!fromDomain) {
      throw new HttpsError("internal", "RESEND_FROM_DOMAIN not configured.");
    }
    const fromAddress = `${companyName} <onboarding@${fromDomain}>`;

    let result;
    try {
      result = await resend.emails.send({
        from: fromAddress,
        to: [clientEmail],
        subject: `Welcome to ${companyName} — Set Your Password`,
        html,
      });
    } catch (err) {
      console.error("Resend API error:", err);
      throw new HttpsError("internal", "Failed to send welcome email.");
    }

    if (result.error) {
      console.error("Resend error:", result.error);
      throw new HttpsError("internal", result.error.message || "Email send failed.");
    }

    console.info(`Welcome email sent to ${clientEmail} (id: ${result.data?.id})`);
    return { success: true, emailId: result.data?.id };
  }
);
