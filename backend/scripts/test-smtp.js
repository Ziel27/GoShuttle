#!/usr/bin/env node
const nodemailer = require('nodemailer');

(async () => {
  const {
    SMTP_HOST,
    SMTP_PORT = '587',
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM,
    TEST_TO,
  } = process.env;

  console.log('SMTP test - env snapshot:');
  console.log('  SMTP_HOST=', SMTP_HOST);
  console.log('  SMTP_PORT=', SMTP_PORT);
  console.log('  SMTP_USER=', SMTP_USER);
  console.log('  SMTP_FROM=', SMTP_FROM);

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    console.error('\nMissing required SMTP env vars. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.');
    process.exit(2);
  }

  const to = TEST_TO || SMTP_USER;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  try {
    console.log('\nVerifying SMTP connection...');
    await transporter.verify();
    console.log('SMTP connection OK. Sending test message to', to);

    const info = await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject: 'GoShuttle SMTP test',
      text: 'This is a test email sent from the GoShuttle SMTP tester script.',
      html: '<p>This is a test email sent from the <strong>GoShuttle</strong> SMTP tester script.</p>',
    });

    console.log('\nMessage sent. MessageId:', info.messageId);
    console.log('Response:', info.response || JSON.stringify(info));
    process.exit(0);
  } catch (err) {
    console.error('\nSMTP test error:');
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
