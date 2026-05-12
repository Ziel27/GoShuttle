let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

const getSmtpValue = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
};

/**
 * POST /api/support/contact
 * Authenticated users (passenger or driver) submit a support concern.
 * The message is emailed to the company's support inbox.
 */
const sendSupportMessage = async (req, res) => {
  try {
    const { subject, message } = req.body;
    const user = req.user;

    if (!subject || !String(subject).trim()) {
      return res.status(400).json({ error: 'Subject is required.' });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    if (String(message).trim().length < 10) {
      return res.status(400).json({ error: 'Please describe your concern in more detail (at least 10 characters).' });
    }

    const smtpHost = getSmtpValue('SMTP_HOST');
    const smtpPort = Number(getSmtpValue('SMTP_PORT') || 587);
    const smtpUser = getSmtpValue('SMTP_USER');
    const smtpPass = getSmtpValue('SMTP_PASS', 'SMTP_PASSWORD');
    const fromEmail = getSmtpValue('SMTP_FROM', 'SMTP_FROM_EMAIL', 'SMTP_USER');
    const supportInbox = getSmtpValue('SUPPORT_EMAIL', 'SMTP_FROM', 'SMTP_FROM_EMAIL', 'SMTP_USER');

    if (!smtpHost || !smtpUser || !smtpPass || !fromEmail || !nodemailer) {
      console.warn('[WARN] SMTP not configured — support email not sent.');
      return res.status(503).json({ error: 'Email service is not available. Please try again later.' });
    }

    const senderName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
    const senderEmail = user.email;
    const userRole = user.role || 'user';

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f7f6;margin:0;padding:24px;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
          <div style="background:#1a2e1a;padding:24px 28px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">GoShuttle Support Request</p>
            <p style="margin:4px 0 0;font-size:13px;color:#a8c5a0;">Submitted via the GoShuttle app</p>
          </div>
          <div style="padding:28px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b;width:110px;">From</td>
                <td style="padding:8px 0;font-size:13px;color:#1e293b;font-weight:600;">${senderName} &lt;${senderEmail}&gt;</td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b;">Role</td>
                <td style="padding:8px 0;font-size:13px;color:#1e293b;text-transform:capitalize;">${userRole}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b;">Subject</td>
                <td style="padding:8px 0;font-size:13px;color:#1e293b;font-weight:600;">${String(subject).trim()}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b;">Date</td>
                <td style="padding:8px 0;font-size:13px;color:#1e293b;">${new Date().toLocaleString('en-PH', { dateStyle: 'full', timeStyle: 'short' })}</td>
              </tr>
            </table>
            <div style="border-top:1px solid #e2e8f0;padding-top:20px;">
              <p style="margin:0 0 10px;font-size:13px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
              <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.7;white-space:pre-wrap;">${String(message).trim()}</p>
            </div>
            <div style="margin-top:24px;padding:14px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
              <p style="margin:0;font-size:12px;color:#166534;">
                Reply directly to this email to respond to <strong>${senderName}</strong> at <strong>${senderEmail}</strong>.
              </p>
            </div>
          </div>
          <div style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:11px;color:#94a3b8;">This message was sent through the GoShuttle in-app support form.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textBody = [
      'GoShuttle Support Request',
      '=========================',
      `From: ${senderName} <${senderEmail}>`,
      `Role: ${userRole}`,
      `Subject: ${String(subject).trim()}`,
      `Date: ${new Date().toISOString()}`,
      '',
      'Message:',
      String(message).trim(),
    ].join('\n');

    await transporter.sendMail({
      from: fromEmail,
      to: supportInbox,
      replyTo: `${senderName} <${senderEmail}>`,
      subject: `[Support] ${String(subject).trim()} — ${senderName} (${userRole})`,
      text: textBody,
      html: htmlBody,
    });

    return res.status(200).json({ message: 'Your concern has been sent. Our team will get back to you shortly.' });
  } catch (error) {
    console.error('[ERROR] Failed to send support email:', error.message);
    return res.status(500).json({ error: 'Failed to send your message. Please try again.' });
  }
};

module.exports = { sendSupportMessage };
