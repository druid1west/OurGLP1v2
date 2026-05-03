// routes/pushRoutes.js
const express = require('express');
const router = express.Router(); // ✅ THIS LINE is the fix
const pool = require('../models/db');
const requireLogin = require('../middleware/requireLogin');

router.post('/push/token', requireLogin, async (req, res) => {
  const { token, platform } = req.body;
  const userId = req.session?.user?.id;

  console.log('📩 Received push token request:');
  console.log('🧑‍🦰 Session user:', userId);
  console.log('📦 Token:', token);
  console.log('💻 Platform:', platform);

  if (!token) {
    console.warn('❌ Missing token in request body');
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    await pool.query(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO NOTHING`,
      [userId, token, platform || 'ios']
    );

    console.log('✅ Token saved to database');
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error saving push token:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router; // ✅ Don't forget this