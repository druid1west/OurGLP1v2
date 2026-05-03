const express = require('express');
const router = express.Router();
const pool = require('../db'); // your PostgreSQL connection
const requireLogin = require('../middleware/requireLogin');

// POST: Add new exercise log
router.post('/', requireLogin, async (req, res) => {
  const { day, startTime, endTime, type, calories } = req.body;

  if (!day || !startTime || !endTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO user_exercise_logs
         (user_id, day_of_week, start_time, end_time, exercise_type, calories_burned)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.session.user.id, day, startTime, endTime, type, calories]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error inserting exercise log:', err);
    res.status(500).json({ error: 'Failed to save exercise log' });
  }
});

// GET: Fetch all exercise logs for current user
router.get('/', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM user_exercise_logs
       WHERE user_id = $1
       ORDER BY day_of_week, start_time`,
      [req.session.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching exercise logs:', err);
    res.status(500).json({ error: 'Failed to fetch exercise logs' });
  }
});

module.exports = router;