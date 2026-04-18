const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');

// POST Create Review
router.post('/', isAuthenticated, async (req, res) => {
    try {
        const { productId, rating, comment } = req.body;
        const userId = req.session.user.Cust_id;

        if (!rating || rating < 1 || rating > 5) {
            req.flash('error', 'Please select a rating (1-5)');
            return res.redirect('back');
        }

        // Check if user already reviewed this product
        const [existing] = await db.query(
            'SELECT review_id FROM Review WHERE Cust_id = ? AND Product_id = ?',
            [userId, productId]
        );

        if (existing.length > 0) {
            // Update existing review
            await db.query(
                'UPDATE Review SET Rating = ?, Comment = ? WHERE Cust_id = ? AND Product_id = ?',
                [rating, comment || null, userId, productId]
            );
            req.flash('success', 'Review updated successfully!');
        } else {
            // Create new review
            await db.query(
                'INSERT INTO Review (Cust_id, Product_id, Rating, Comment) VALUES (?, ?, ?, ?)',
                [userId, productId, rating, comment || null]
            );
            req.flash('success', 'Review submitted successfully!');
        }

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
