const path = require('path');
require('dotenv').config({ path: '../.env' }); // Adjust the path if necessary
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Check if the .env file is being loaded
console.log('MAIL_HOST:', process.env.MAIL_HOST);  // Should print: mail.ourglp1.com
console.log('MAIL_USER:', process.env.MAIL_USER);  // Should print: info@ourglp1.com
console.log('MAIL_FROM:', process.env.MAIL_FROM);  // Should print: "GLP-1 Health <info@ourglp1.com>"

// Check if environment variables are loaded correctly before continuing
if (!process.env.MAIL_HOST || !process.env.MAIL_USER || !process.env.MAIL_PASS) {
  console.error('❌ Missing required environment variables');
} else {
  console.log('✅ Environment variables are loaded correctly');
}

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT),
  secure: process.env.MAIL_SECURE === 'true', // true for 465, false for 587
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,  // Accept self-signed certs (adjust as needed)
  },
});

async function sendResetEmail(toEmail, resetLink) {
  const mailOptions = {
    from: `"GLP-1 Health" <${process.env.MAIL_FROM}>`,
    to: toEmail,
    subject: 'Reset your password',
    text: `You requested a password reset. Click the link below:\n\n${resetLink}`,
    html: `<p>You requested a password reset. Click the link below:</p><p><a href="${resetLink}">${resetLink}</a></p>`,
  };

  await transporter.sendMail(mailOptions);
}

module.exports = { sendResetEmail };