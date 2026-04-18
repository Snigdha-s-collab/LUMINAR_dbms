const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');

// GET Cart Page
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const [items] = await db.query(`
            SELECT c.*, p.Product_name, p.Price, p.Image_url, p.P_Skin_type, b.Brand_name
            FROM Cart c
            JOIN Product p ON c.Product_id = p.Product_id
            JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE c.Cust_id = ?
            ORDER BY c.Added_at DESC
        `, [req.session.user.Cust_id]);

        const total = items.reduce((sum, item) => sum + (item.Price * item.Quantity), 0);
        res.render('cart', { items, total });
    } catch (err) {
        console.error('Cart error:', err);
        res.render('cart', { items: [], total: 0 });
    }
});

// POST Add to Cart
router.post('/add', isAuthenticated, async (req, res) => {
    try {
        const { productId, quantity } = req.body;
        const qty = parseInt(quantity) || 1;

        await db.query(`
            INSERT INTO Cart (Cust_id, Product_id, Quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(Cust_id, Product_id) DO UPDATE SET Quantity = Quantity + ?
        `, [req.session.user.Cust_id, productId, qty, qty]);

        req.flash('success', 'Product added to cart!');

        // Return JSON for AJAX requests
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            const [countResult] = await db.query(
                'SELECT COALESCE(SUM(Quantity), 0) as count FROM Cart WHERE Cust_id = ?',
                [req.session.user.Cust_id]
            );
            return res.json({ success: true, cartCount: countResult[0].count });
        }
        res.redirect('back');
    } catch (err) {
        console.error('Add to cart error:', err);
        req.flash('error', 'Failed to add to cart');
        res.redirect('back');
    }
});

// POST Update Cart Quantity
router.post('/update', isAuthenticated, async (req, res) => {
    try {
        const { productId, quantity } = req.body;
        const qty = parseInt(quantity);

        if (qty <= 0) {
            await db.query('DELETE FROM Cart WHERE Cust_id = ? AND Product_id = ?',
                [req.session.user.Cust_id, productId]);
        } else {
            await db.query('UPDATE Cart SET Quantity = ? WHERE Cust_id = ? AND Product_id = ?',
                [qty, req.session.user.Cust_id, productId]);
        }

        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.json({ success: true });
        }
        res.redirect('/cart');
    } catch (err) {
        console.error('Update cart error:', err);
        res.redirect('/cart');
    }
});

// POST Remove from Cart
router.post('/remove', isAuthenticated, async (req, res) => {
    try {
        await db.query('DELETE FROM Cart WHERE Cust_id = ? AND Product_id = ?',
            [req.session.user.Cust_id, req.body.productId]);

        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.json({ success: true });
        }
        req.flash('success', 'Item removed from cart');
        res.redirect('/cart');
    } catch (err) {
        console.error('Remove from cart error:', err);
        res.redirect('/cart');
    }
});

module.exports = router;
