const escapeHtml = require('escape-html');

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (error) {
  console.warn('Le module "nodemailer" est requis pour l\'envoi des emails mais il est introuvable.');
}

let cachedTransporter;

function getTransporter() {
  if (cachedTransporter !== undefined) {
    return cachedTransporter;
  }

  if (!nodemailer) {
    cachedTransporter = null;
    return cachedTransporter;
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, SMTP_FROM } = process.env;

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
  };

  if (SMTP_USER && SMTP_PASS) {
    transportConfig.auth = {
      user: SMTP_USER,
      pass: SMTP_PASS,
    };
  }

  if (process.env.SMTP_IGNORE_TLS === 'true') {
    transportConfig.ignoreTLS = true;
  }

  if (process.env.SMTP_REQUIRE_TLS === 'true') {
    transportConfig.requireTLS = true;
  }

  if (process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false') {
    transportConfig.tls = {
      ...(transportConfig.tls || {}),
      rejectUnauthorized: false,
    };
  }

  cachedTransporter = nodemailer.createTransport(transportConfig);

  if (SMTP_FROM && SMTP_FROM.includes('@')) {
    cachedTransporter.defaults = {
      ...(cachedTransporter.defaults || {}),
      from: SMTP_FROM,
    };
  } else if (SMTP_USER && SMTP_USER.includes('@')) {
    cachedTransporter.defaults = {
      ...(cachedTransporter.defaults || {}),
      from: `Cécile <${SMTP_USER}>`,
    };
  }

  return cachedTransporter;
}

function isEmailConfigured() {
  const transporter = getTransporter();
  return Boolean(transporter);
}

async function sendContactNotification({ to, name, email, subject, message }) {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error("Aucun transport d'email n'est configuré");
  }

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, '<br>');

  const textContent = [
    'Vous avez reçu un nouveau message via le formulaire de contact :',
    '',
    `Nom : ${name}`,
    `Email : ${email}`,
    `Objet : ${subject}`,
    '',
    message,
  ].join('\n');

  const htmlContent = `
    <p>Vous avez reçu un nouveau message via le formulaire de contact :</p>
    <ul>
      <li><strong>Nom :</strong> ${safeName}</li>
      <li><strong>Email :</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></li>
      <li><strong>Objet :</strong> ${safeSubject}</li>
    </ul>
    <p><strong>Message :</strong></p>
    <p>${safeMessage}</p>
  `;

  const mailOptions = {
    to,
    from: "Cécil'Artiste <contact@cecilartiste.fr>",
    subject: 'Demande de contact',
    text: textContent,
    html: htmlContent,
    replyTo: email,
  };

  return transporter.sendMail(mailOptions);
}

module.exports = {
  isEmailConfigured,
  sendContactNotification,
};
