// In routes/push.js or wherever you handle push logic
const express = require('express');
const router = express.Router();
const sendPush = require('../sendPush'); // your existing sendPush.js
const requireLogin = require('../middleware/requireLogin'); // optional: restrict to logged-in users

router.post('/test', requireLogin, async (req, res) => {
  try {
    const user = req.user;
    if (!user.push_token) return res.status(400).json({ error: 'No push token found' });

    const fakeReminder = {
      id: 'test',
      title: 'Test Notification',
      reminder_type: 'test',
    };

    await sendPush(user.push_token, fakeReminder);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Test push failed:', err);
    res.status(500).json({ error: 'Push failed' });
  }
});

module.exports = router;