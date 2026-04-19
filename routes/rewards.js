const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');

// Spin cooldown in hours
const SPIN_COOLDOWN_HOURS = 48;

// GET Rewards Page
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.Cust_id;

        // Get current reward points
        const [users] = await db.query(
            'SELECT Reward_points, Last_spin_at FROM Customer WHERE Cust_id = ?',
            [userId]
        );
        const rewardPoints = users[0]?.Reward_points || 0;
        const lastSpinAt = users[0]?.Last_spin_at || null;

        // Calculate spin availability
        let canSpin = true;
        let nextSpinTime = null;
        if (lastSpinAt) {
            const lastSpin = new Date(lastSpinAt);
            const nextSpin = new Date(lastSpin.getTime() + SPIN_COOLDOWN_HOURS * 60 * 60 * 1000);
            const now = new Date();
            if (now < nextSpin) {
                canSpin = false;
                nextSpinTime = nextSpin.toISOString();
            }
        }

        // Get reward history
        const [history] = await db.query(
            'SELECT * FROM Reward_log WHERE Cust_id = ? ORDER BY Created_at DESC LIMIT 20',
            [userId]
        );

        // Update session
        req.session.user.Reward_points = rewardPoints;

        res.render('rewards', {
            rewardPoints,
            canSpin,
            nextSpinTime,
            history,
            cooldownHours: SPIN_COOLDOWN_HOURS
        });
    } catch (err) {
        console.error('Rewards page error:', err);
        res.render('rewards', {
            rewardPoints: 0,
            canSpin: false,
            nextSpinTime: null,
            history: [],
            cooldownHours: SPIN_COOLDOWN_HOURS
        });
    }
});

// POST Spin the Wheel
router.post('/spin', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.Cust_id;

        // Check cooldown
        const [users] = await db.query(
            'SELECT Reward_points, Last_spin_at FROM Customer WHERE Cust_id = ?',
            [userId]
        );

        const lastSpinAt = users[0]?.Last_spin_at || null;
        if (lastSpinAt) {
            const lastSpin = new Date(lastSpinAt);
            const nextSpin = new Date(lastSpin.getTime() + SPIN_COOLDOWN_HOURS * 60 * 60 * 1000);
            if (new Date() < nextSpin) {
                return res.json({
                    error: 'Spin cooldown active!',
                    nextSpinTime: nextSpin.toISOString()
                });
            }
        }

        // Generate random result — weighted probabilities
        // Segments: 0 (no points), 2, 5, 3, 10, 1, 8, 15, 4, 0 (no points)
        const segments = [0, 2, 5, 3, 10, 1, 8, 15, 4, 0, 7, 12, 6, 0, 18, 9];
        const randomIndex = Math.floor(Math.random() * segments.length);
        const points = segments[randomIndex];

        // Calculate expiry — points expire in 7 days
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        const now = new Date().toISOString();

        if (points > 0) {
            // Award points
            await db.query(
                'UPDATE Customer SET Reward_points = Reward_points + ?, Last_spin_at = ? WHERE Cust_id = ?',
                [points, now, userId]
            );

            // Log the reward
            await db.query(
                'INSERT INTO Reward_log (Cust_id, Points, Type, Description, Expires_at) VALUES (?, ?, ?, ?, ?)',
                [userId, points, 'spin', `Won ${points} points from Spin the Wheel!`, expiresAt.toISOString()]
            );

            // Update session
            req.session.user.Reward_points = (users[0]?.Reward_points || 0) + points;
        } else {
            // No points — just update last spin time
            await db.query(
                'UPDATE Customer SET Last_spin_at = ? WHERE Cust_id = ?',
                [now, userId]
            );

            // Log the attempt
            await db.query(
                'INSERT INTO Reward_log (Cust_id, Points, Type, Description) VALUES (?, ?, ?, ?)',
                [userId, 0, 'spin', 'Oops! No reward points this time. Try again later!']
            );
        }

        const nextSpinTime = new Date(new Date(now).getTime() + SPIN_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

        res.json({
            success: true,
            points,
            segmentIndex: randomIndex,
            totalPoints: (users[0]?.Reward_points || 0) + points,
            nextSpinTime
        });
    } catch (err) {
        console.error('Spin error:', err);
        res.json({ error: 'Failed to spin. Please try again.' });
    }
});

// GET Reward Points Balance (API)
router.get('/balance', isAuthenticated, async (req, res) => {
    try {
        const [users] = await db.query(
            'SELECT Reward_points FROM Customer WHERE Cust_id = ?',
            [req.session.user.Cust_id]
        );
        res.json({ points: users[0]?.Reward_points || 0 });
    } catch (err) {
        res.json({ points: 0 });
    }
});

module.exports = router;
