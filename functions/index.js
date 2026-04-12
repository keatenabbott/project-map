const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { Resend } = require("resend");
const admin = require("firebase-admin");

admin.initializeApp();

const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFromDomain = defineSecret("RESEND_FROM_DOMAIN");

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
                Project Map &mdash; Powered by Dune
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
// Cloud Function — generates real reset link + sends branded email
// ---------------------------------------------------------------------------
exports.sendWelcomeEmail = onCall(
  {
    secrets: [resendApiKey, resendFromDomain],
    enforceAppCheck: false,
  },
  async (request) => {
    const { clientName, clientEmail, companyName, accentColor, portalUrl, supportEmail } = request.data;

    // Validate
    const missing = ["clientName", "clientEmail", "companyName", "supportEmail"].filter((k) => !request.data[k]);
    if (missing.length) {
      throw new HttpsError("invalid-argument", "Missing: " + missing.join(", "));
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      throw new HttpsError("invalid-argument", "Invalid email address.");
    }

    // Generate real password reset link via Admin SDK
    let resetLink;
    try {
      resetLink = await admin.auth().generatePasswordResetLink(clientEmail, {
        url: portalUrl || "https://example.com",
      });
    } catch (err) {
      console.error("Failed to generate reset link:", err);
      throw new HttpsError("internal", "Failed to generate password reset link.");
    }

    // Build email HTML
    const html = buildWelcomeEmail({
      clientName,
      companyName,
      accentColor: accentColor || "#C4A57B",
      portalUrl: portalUrl || "",
      supportEmail,
      resetLink,
    });

    // Send via Resend
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromDomain = process.env.RESEND_FROM_DOMAIN || "yourdomain.com";
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
