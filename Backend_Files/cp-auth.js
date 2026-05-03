require('dotenv').config({ path: '../.env' });
console.log('✅ Loaded auth routes');

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const crypto = require('crypto');
const { sendResetEmail } = require('../mailer');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });



// === POST /login route
router.post('/login', async (req, res) => {
  if (req.originalUrl === '/auth/login') {
    console.warn('⚠️ WARNING: Incoming request to deprecated /auth/login path!');
    console.warn('🌍 Request IP:', req.ip);
  }

  const email = req.body.email?.toLowerCase().trim();
  const password = req.body.password;

  if (!email || !password) {
    console.warn('⚠️ Missing fields in login request');
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    console.log('🔍 [Auth] Verifying credentials for:', email);
    const client = await pool.connect();
    const result = await client.query(
      'SELECT * FROM users WHERE LOWER(email) = $1',
      [email]
    );

    if (result.rowCount === 0) {
      client.release();
      console.warn('⚠️ Invalid email or password');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    client.release();

    if (!valid) {
      console.warn('⚠️ Invalid password for:', email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      medication_name: user.medication_name,
      medication_dose: user.medication_dose,
      profile_photo: user.profile_photo,
      height: user.height,
      weight: user.weight,
      bmi: user.bmi,
      fasting_schedule: user.fasting_schedule,
      fasting_start: user.fasting_start,
    };

    req.session.save((err) => {
      if (err) {
        console.error('❌ Error saving session:', err);
        return res.status(500).json({ error: 'Session save failed' });
      }

      console.log('✅ Session saved for user:', req.session.user);
      res.status(200).json({ message: 'Login successful' });
    });
  } catch (err) {
    console.error('❌ [Auth] Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// === POST /register
  router.post('/register', async (req, res) => {
  const { first_name, last_name, email, password } = req.body;

   if (!email || !password || !first_name || !last_name) {
   return res.status(400).json({ error: 'Missing required fields' });
   }

     try {
     const client = await pool.connect();

    // Check if email already exists (case-insensitive)
    const existing = await client.query(
      'SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (existing.rowCount > 0) {
      client.release();
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert new user
    await client.query(
      `INSERT INTO users (first_name, last_name, email, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [first_name, last_name, email.toLowerCase(), passwordHash]
    );

    client.release();
    console.log('✅ New user registered:', email);
    res.status(200).json({ message: 'Registration successful' });
  } catch (err) {
    console.error('❌ [Auth] Registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
     }
    });

// === POST /logout
router.post('/logout', (req, res) => {
  console.log('🚪 [Auth] Logout request received');

  req.session.destroy((err) => {
    if (err) {
      console.error('❌ [Auth] Failed to destroy session:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }

    res.clearCookie('glp1.sid', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    });

    console.log('✅ [Auth] Session destroyed and cookie cleared');
    res.status(200).json({ message: 'Logged out' });
  });
});

// === GET /me — return current session user
router.get('/me', (req, res) => {
  console.log('📡 [Auth] /auth/me request received');
  console.log('📦 Session:', req.session);

  if (!req.session?.user) {
    return res.status(200).json({});
  }

  return res.status(200).json(req.session.user);
});

// === POST /reset-password-request
router.post('/reset-password-request', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    console.warn('⚠️ Email is required for password reset');
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const client = await pool.connect();
    const result = await client.query('SELECT id FROM users WHERE email = $1', [email]);

    if (result.rowCount === 0) {
      client.release();
      return res.status(200).json({ success: true }); // Prevent user enumeration
    }

    const userId = result.rows[0].id;
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 3600000); // 1 hour

    await client.query(
      `UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE id = $3`,
      [token, expiry, userId]
    );
    client.release();

    const resetLink = `https://app.ourglp1.com/reset-password/${token}`;
    await sendResetEmail(email, resetLink);

    console.log('✅ Reset link sent to:', email);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ [Auth] Reset password request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === POST /reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Missing token or password' });
  }

  try {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT id, reset_token_expiry FROM users WHERE reset_token = $1',
      [token]
    );

    if (result.rowCount === 0) {
      client.release();
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const user = result.rows[0];
    const expiry = new Date(user.reset_token_expiry);
    if (Date.now() > expiry) {
      client.release();
      return res.status(400).json({ error: 'Reset token has expired' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `UPDATE users
       SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL
       WHERE id = $2`,
      [passwordHash, user.id]
    );
    client.release();

    console.log('✅ Password reset for user ID:', user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ [Auth] Reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === GET /reset-password/:token (validation)
router.get('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT id, reset_token_expiry FROM users WHERE reset_token = $1',
      [token]
    );

    if (result.rowCount === 0) {
      client.release();
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const expiry = new Date(result.rows[0].reset_token_expiry);
    if (Date.now() > expiry) {
      client.release();
      return res.status(400).json({ error: 'Reset token has expired' });
    }

    client.release();
    res.json({ message: 'Token is valid. Render reset password form here.' });
  } catch (err) {
    console.error('❌ [Auth] Token validation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;                                                                                                                                                                                   
                                                    