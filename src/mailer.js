const escapeHtml = require('escape-html');

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (error) {
  console.warn("Le module 'nodemailer' est requis pour l'envoi des emails mais il est introuvable.");
}

const hasGlobalFetch = typeof fetch === 'function';

const BRAND_NAME = process.env.MAIL_BRAND_NAME || "Cécil'Artiste";
const BRAND_COLOR = process.env.MAIL_BRAND_COLOR || '#d16ba5';
const BRAND_WEBSITE = process.env.MAIL_BRAND_URL || 'https://cecilartiste.com';
const BRAND_LOGO = process.env.MAIL_BRAND_LOGO || null;

let cachedTransporter;
let cachedProvider;

function getProvider() {
  if (cachedProvider) {
    return cachedProvider;
  }

  const explicitProvider = (process.env.MAIL_PROVIDER || '').trim().toLowerCase();
  const allowedProviders = new Set(['smtp', 'sendmail', 'resend']);
  if (explicitProvider && allowedProviders.has(explicitProvider)) {
    cachedProvider = explicitProvider;
    return cachedProvider;
  }

  if (explicitProvider && !allowedProviders.has(explicitProvider)) {
    console.warn(
      `Fournisseur d'emails inconnu "${explicitProvider}". Utilisation du mode SMTP par défaut.`
    );
    cachedProvider = 'smtp';
    return cachedProvider;
  }

  if (process.env.RESEND_API_KEY) {
    cachedProvider = 'resend';
    return cachedProvider;
  }

  cachedProvider = 'smtp';
  return cachedProvider;
}

function resolveDefaultFrom() {
  const { SMTP_FROM, SMTP_USER, MAIL_FROM } = process.env;

  const candidates = [MAIL_FROM, SMTP_FROM, SMTP_USER]
    .filter(Boolean)
    .map(candidate => candidate.trim())
    .filter(candidate => candidate.includes('@'));

  if (candidates.length > 0) {
    const fromAddress = candidates[0];
    if (fromAddress.includes('<') && fromAddress.includes('>')) {
      return fromAddress;
    }
    return `${BRAND_NAME} <${fromAddress}>`;
  }

  return null;
}

function ensureTransporter() {
  const provider = getProvider();

  if (provider === 'resend') {
    return null;
  }

  if (cachedTransporter !== undefined) {
    return cachedTransporter;
  }

  if (!nodemailer) {
    cachedTransporter = null;
    return cachedTransporter;
  }

  if (provider === 'sendmail') {
    cachedTransporter = nodemailer.createTransport({
      sendmail: true,
      newline: 'unix',
      path: process.env.SENDMAIL_PATH || '/usr/sbin/sendmail',
    });
  } else {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, SMTP_URL } = process.env;

    const extraOptions = {};

    if (process.env.SMTP_IGNORE_TLS === 'true') {
      extraOptions.ignoreTLS = true;
    }

    if (process.env.SMTP_REQUIRE_TLS === 'true') {
      extraOptions.requireTLS = true;
    }

    if (process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false') {
      extraOptions.tls = {
        ...(extraOptions.tls || {}),
        rejectUnauthorized: false,
      };
    }

    if (SMTP_URL) {
      cachedTransporter = nodemailer.createTransport(SMTP_URL, extraOptions);
    } else {
      if (!SMTP_HOST) {
        cachedTransporter = null;
        return cachedTransporter;
      }

      const port = Number.parseInt(SMTP_PORT || '587', 10);
      const secure = SMTP_SECURE ? SMTP_SECURE === 'true' : port === 465;

      const transportConfig = {
        host: SMTP_HOST,
        port,
        secure,
        ...extraOptions,
      };

      if (SMTP_USER && SMTP_PASS) {
        transportConfig.auth = {
          user: SMTP_USER,
          pass: SMTP_PASS,
        };
      }

      cachedTransporter = nodemailer.createTransport(transportConfig);
    }
  }

  const defaultFrom = resolveDefaultFrom();
  if (defaultFrom && cachedTransporter) {
    cachedTransporter.defaults = {
      ...(cachedTransporter.defaults || {}),
      from: defaultFrom,
    };
  }

  return cachedTransporter;
}

function isEmailConfigured() {
  const provider = getProvider();

  if (provider === 'resend') {
    return Boolean(process.env.RESEND_API_KEY);
  }

  const transporter = ensureTransporter();
  return Boolean(transporter);
}

function buildContactEmailPayload({ to, name, email, subject, message }) {
  const replyToAddress = (email || '').replace(/[\r\n]+/g, '').trim();
  const rawSubject = (subject || '').replace(/[\r\n]+/g, ' ').trim();

  const safeName = escapeHtml(name || 'Inconnu');
  const safeEmail = escapeHtml(email || 'Non renseigné');
  const safeSubject = escapeHtml(rawSubject || 'Demande de contact');
  const safeMessage = escapeHtml(message || '').replace(/\r?\n/g, '<br>');

  const previewText = `${safeName} vient de vous écrire via le formulaire de contact.`;

  const messageParagraphs = safeMessage
    .split('<br>')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `<p style="margin:0 0 12px;line-height:1.6;">${line}</p>`) 
    .join('') || '<p style="margin:0 0 12px;line-height:1.6;">(Message vide)</p>';

  const htmlContent = `<!DOCTYPE html>
  <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${BRAND_NAME} · Nouveau message</title>
      <style>
        @media only screen and (max-width: 600px) {
          .inner-container {
            padding: 20px !important;
          }
        }
      </style>
    </head>
    <body style="margin:0;padding:0;background-color:#f5f6fb;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      <span style="display:none !important;color:transparent;height:0;opacity:0;visibility:hidden;width:0;">
        ${previewText}
      </span>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f5f6fb;padding:24px 0;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" width="600" class="inner-container" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 20px 45px rgba(34, 0, 51, 0.08);padding:32px;">
              <tr>
                <td style="padding-bottom:24px;border-bottom:1px solid rgba(0,0,0,0.08);">
                  <table role="presentation" width="100%">
                    <tr>
                      <td>
                        <h1 style="margin:0;font-size:24px;color:${BRAND_COLOR};">${BRAND_NAME}</h1>
                        <p style="margin:6px 0 0;font-size:14px;color:#6b7280;">Nouveau message de votre site</p>
                      </td>
                      ${
                        BRAND_LOGO
                          ? `<td align="right"><img src="${escapeHtml(
                              BRAND_LOGO
                            )}" alt="${BRAND_NAME}" style="max-height:48px;" /></td>`
                          : ''
                      }
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 0;border-bottom:1px solid rgba(0,0,0,0.08);">
                  <p style="margin:0 0 16px;font-size:16px;color:#111827;">
                    Vous avez reçu un nouveau message via le formulaire de contact.
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#111827;">
                    <tr>
                      <td style="padding:8px 0;color:#6b7280;width:130px;">Nom</td>
                      <td style="padding:8px 0;font-weight:600;color:#111827;">${safeName}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;color:#6b7280;width:130px;">Email</td>
                      <td style="padding:8px 0;font-weight:600;color:#111827;"><a href="mailto:${safeEmail}" style="color:${BRAND_COLOR};text-decoration:none;">${safeEmail}</a></td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;color:#6b7280;width:130px;">Objet</td>
                      <td style="padding:8px 0;font-weight:600;color:#111827;">${safeSubject}</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 0;">
                  <h2 style="margin:0 0 12px;font-size:18px;color:#111827;">Message</h2>
                  ${messageParagraphs}
                </td>
              </tr>
              <tr>
                <td style="padding-top:16px;border-top:1px solid rgba(0,0,0,0.08);">
                  <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">
                    Ce message vous a été envoyé automatiquement depuis votre site ${BRAND_NAME}.${
                      BRAND_WEBSITE
                        ? ` <a href="${escapeHtml(BRAND_WEBSITE)}" style="color:${BRAND_COLOR};text-decoration:none;">Visiter le site</a>`
                        : ''
                    }
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;

  const textContent = [
    `${BRAND_NAME} – Nouveau message de contact`,
    '',
    `Nom : ${name || 'Inconnu'}`,
    `Email : ${email || 'Non renseigné'}`,
    `Objet : ${rawSubject || 'Demande de contact'}`,
    '',
    message || '(Message vide)',
    '',
    `Message reçu depuis ${BRAND_WEBSITE || 'votre site.'}`,
  ].join('\n');

  return {
    to,
    subject: rawSubject ? `[Contact] ${rawSubject}` : 'Demande de contact',
    text: textContent,
    html: htmlContent,
    replyTo: replyToAddress || undefined,
  };
}

async function sendWithResend(mailOptions) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY est requis pour utiliser le fournisseur Resend");
  }

  const defaultFrom = resolveDefaultFrom() || process.env.RESEND_FROM;
  if (!defaultFrom) {
    throw new Error("Aucune adresse d'expéditeur n'a été définie pour Resend");
  }

  if (!hasGlobalFetch) {
    throw new Error("fetch n'est pas disponible dans cet environnement Node.js");
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: defaultFrom,
      to: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
      subject: mailOptions.subject,
      html: mailOptions.html,
      text: mailOptions.text,
      reply_to: mailOptions.replyTo,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Échec de l'envoi via Resend: ${response.status} ${errorBody}`);
  }

  return response.json();
}

async function sendContactNotification({ to, name, email, subject, message }) {
  const provider = getProvider();
  const mailOptions = buildContactEmailPayload({ to, name, email, subject, message });

  if (provider === 'resend') {
    return sendWithResend(mailOptions);
  }

  const transporter = ensureTransporter();
  if (!transporter) {
    throw new Error("Aucun transport d'email n'est configuré");
  }

  const defaultFrom = resolveDefaultFrom();
  if (defaultFrom && !mailOptions.from) {
    mailOptions.from = defaultFrom;
  }

  return transporter.sendMail(mailOptions);
}

module.exports = {
  isEmailConfigured,
  sendContactNotification,
};
