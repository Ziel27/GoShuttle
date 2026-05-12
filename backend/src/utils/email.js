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

const createTransporter = () => {
  const smtpHost = getSmtpValue('SMTP_HOST');
  const smtpPort = Number(getSmtpValue('SMTP_PORT') || 587);
  const smtpUser = getSmtpValue('SMTP_USER');
  const smtpPass = getSmtpValue('SMTP_PASS', 'SMTP_PASSWORD');
  const fromEmail = getSmtpValue('SMTP_FROM', 'SMTP_FROM_EMAIL', 'SMTP_USER');

  if (!smtpHost || !smtpUser || !smtpPass || !fromEmail || !nodemailer) {
    return null;
  }

  return {
    transport: nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    }),
    fromEmail,
  };
};

const sendWarningEmail = async ({ toEmail, toName, warningNumber, note, issuedBy }) => {
  const ctx = createTransporter();
  if (!ctx) {
    console.warn('[WARN] SMTP not configured — warning email not sent.');
    return false;
  }

  const ordinal = warningNumber === 1 ? '1st' : '2nd';
  const nextStep = warningNumber >= 2
    ? 'This is your <strong>final warning</strong>. Further violations may result in permanent account deactivation.'
    : 'Please take note of this warning. A second violation will result in account deactivation.';

  const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"></head>
    <body style="font-family:'Segoe UI',Arial,sans-serif;background:#fefce8;margin:0;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #fde68a;overflow:hidden;">
        <div style="background:#92400e;padding:24px 28px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#fff;">Account Warning — GoShuttle</p>
          <p style="margin:4px 0 0;font-size:13px;color:#fcd34d;">${ordinal} Warning Issued</p>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 14px;font-size:14px;color:#1e293b;">Dear <strong>${toName}</strong>,</p>
          <p style="margin:0 0 14px;font-size:14px;color:#1e293b;line-height:1.6;">
            Your GoShuttle account has received a <strong>${ordinal} warning</strong> from the administration team.
          </p>
          <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:0 0 20px;">
            <p style="margin:0 0 6px;font-size:12px;color:#92400e;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Warning Reason</p>
            <p style="margin:0;font-size:14px;color:#78350f;line-height:1.6;">${note}</p>
          </div>
          <p style="margin:0 0 14px;font-size:14px;color:#1e293b;line-height:1.6;">${nextStep}</p>
          <p style="margin:0;font-size:13px;color:#64748b;">Issued by: ${issuedBy}</p>
        </div>
        <div style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">This is an automated notification from GoShuttle.</p>
        </div>
      </div>
    </body></html>
  `;

  const text = `GoShuttle Account Warning (${ordinal})\n\nDear ${toName},\n\nYou have received your ${ordinal} warning.\n\nReason: ${note}\n\n${nextStep}\n\nIssued by: ${issuedBy}`;

  try {
    await ctx.transport.sendMail({
      from: ctx.fromEmail,
      to: toEmail,
      subject: `[GoShuttle] Account Warning (${ordinal} Warning)`,
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error('[ERROR] Failed to send warning email:', err.message);
    return false;
  }
};

const sendDeactivationEmail = async ({ toEmail, toName, note, issuedBy }) => {
  const ctx = createTransporter();
  if (!ctx) {
    console.warn('[WARN] SMTP not configured — deactivation email not sent.');
    return false;
  }

  const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"></head>
    <body style="font-family:'Segoe UI',Arial,sans-serif;background:#fef2f2;margin:0;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #fecaca;overflow:hidden;">
        <div style="background:#991b1b;padding:24px 28px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#fff;">Account Deactivated — GoShuttle</p>
          <p style="margin:4px 0 0;font-size:13px;color:#fca5a5;">Your account has been deactivated</p>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 14px;font-size:14px;color:#1e293b;">Dear <strong>${toName}</strong>,</p>
          <p style="margin:0 0 14px;font-size:14px;color:#1e293b;line-height:1.6;">
            Your GoShuttle account has been <strong>deactivated</strong> by the administration team after receiving 2 prior warnings.
          </p>
          <div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:0 0 20px;">
            <p style="margin:0 0 6px;font-size:12px;color:#991b1b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Reason for Deactivation</p>
            <p style="margin:0;font-size:14px;color:#7f1d1d;line-height:1.6;">${note}</p>
          </div>
          <p style="margin:0 0 14px;font-size:14px;color:#1e293b;line-height:1.6;">
            You will no longer be able to log in to your account. If you believe this was a mistake, please contact your community admin.
          </p>
          <p style="margin:0;font-size:13px;color:#64748b;">Issued by: ${issuedBy}</p>
        </div>
        <div style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">This is an automated notification from GoShuttle.</p>
        </div>
      </div>
    </body></html>
  `;

  const text = `GoShuttle Account Deactivated\n\nDear ${toName},\n\nYour account has been deactivated.\n\nReason: ${note}\n\nIssued by: ${issuedBy}`;

  try {
    await ctx.transport.sendMail({
      from: ctx.fromEmail,
      to: toEmail,
      subject: '[GoShuttle] Account Deactivated',
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error('[ERROR] Failed to send deactivation email:', err.message);
    return false;
  }
};

module.exports = { sendWarningEmail, sendDeactivationEmail };
