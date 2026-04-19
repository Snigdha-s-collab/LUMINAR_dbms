const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');

// POST Create Review — allows multiple reviews per user per product
router.post('/', isAuthenticated, async (req, res) => {
    try {
        const { productId, rating, comment } = req.body;
        const userId = req.session.user.Cust_id;

        if (!rating || rating < 1 || rating > 5) {
            req.flash('error', 'Please select a rating (1-5)');
            return res.redirect('back');
        }

        // Always create a new review (multiple reviews allowed)
        await db.query(
            'INSERT INTO Review (Cust_id, Product_id, Rating, Comment) VALUES (?, ?, ?, ?)',
            [userId, productId, rating, comment || null]
        );
        req.flash('success', 'Review submitted successfully! ⭐');

        res.redirect(`/products/${productId}`);
    } catch (err) {
        console.error('Review error:', err);
        req.flash('error', 'Failed to submit review');
        res.redirect('back');
    }
});

// DELETE Review
router.post('/delete', isAuthenticated, async (req, res) => {
    try {
        const { reviewId, productId } = req.body;
        await db.query(
            'DELETE FROM Review WHERE review_id = ? AND Cust_id = ?',
            [reviewId, req.session.user.Cust_id]
        );
        req.flash('success', 'Review deleted');
        res.redirect(`/products/${productId}`);
    } catch (err) {
        console.error('Delete review error:', err);
        req.flash('error', 'Failed to delete review');
        res.redirect('back');
    }
});

module.exports = router;
