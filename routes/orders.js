const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// GET Checkout Page
router.get('/checkout', isAuthenticated, async (req, res) => {
    try {
        const [items] = await db.query(`
            SELECT c.*, p.Product_name, p.Price, p.Image_url, b.Brand_name
            FROM Cart c
            JOIN Product p ON c.Product_id = p.Product_id
            JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE c.Cust_id = ?
        `, [req.session.user.Cust_id]);

        if (items.length === 0) {
            req.flash('error', 'Your cart is empty');
            return res.redirect('/cart');
        }

        const subtotal = items.reduce((sum, item) => sum + (item.Price * item.Quantity), 0);
        const shipping = subtotal > 999 ? 0 : 99;
        const tax = Math.round(subtotal * 0.18 * 100) / 100;
        const total = subtotal + shipping + tax;

        res.render('checkout', { items, subtotal, shipping, tax, total });
    } catch (err) {
        console.error('Checkout error:', err);
        res.redirect('/cart');
    }
});

// POST Create Order
router.post('/create', isAuthenticated, async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const userId = req.session.user.Cust_id;
        const { address, payMethod, cardNumber, cardExpiry, cardCvv, upiId } = req.body;

        // Get cart items
        const [items] = await connection.query(`
            SELECT c.*, p.Price FROM Cart c
            JOIN Product p ON c.Product_id = p.Product_id
            WHERE c.Cust_id = ?
        `, [userId]);

        if (items.length === 0) {
            await connection.rollback();
            req.flash('error', 'Your cart is empty');
            return res.redirect('/cart');
        }

        const subtotal = items.reduce((sum, item) => sum + (item.Price * item.Quantity), 0);
        const shipping = subtotal > 999 ? 0 : 99;
        const tax = Math.round(subtotal * 0.18 * 100) / 100;
        const totalAmount = subtotal + shipping + tax;

        // Create Order
        const trackingNumber = 'LMR' + Date.now().toString(36).toUpperCase() + uuidv4().substring(0, 6).toUpperCase();
        const [orderResult] = await connection.query(
            'INSERT INTO Orders (Cust_id, tot_amt, Order_status, Shipping_address, Tracking_number) VALUES (?, ?, ?, ?, ?)',
            [userId, totalAmount, 'Processing', address, trackingNumber]
        );
        const orderId = orderResult.insertId;

        // Create Order Details
        for (const item of items) {
            await connection.query(
                'INSERT INTO Order_details (Order_id, Product_id, Quantity, Unit_price) VALUES (?, ?, ?, ?)',
                [orderId, item.Product_id, item.Quantity, item.Price]
            );
        }

        // Create Payment
        const transactionId = 'TXN' + uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();

        // Simulate payment processing (95% success rate)
        const paymentSuccess = Math.random() < 0.95;
        const payStatus = paymentSuccess ? 'Completed' : 'Failed';

        await connection.query(
            'INSERT INTO Payment (Order_id, amount, Pay_method, Pay_status, Transaction_id) VALUES (?, ?, ?, ?, ?)',
            [orderId, totalAmount, payMethod, payStatus, transactionId]
        );

        if (paymentSuccess) {
            // Update order status
            await connection.query(
                'UPDATE Orders SET Order_status = ? WHERE Order_id = ?',
                ['Confirmed', orderId]
            );
            // Clear cart
            await connection.query('DELETE FROM Cart WHERE Cust_id = ?', [userId]);

            // Award reward points: 10 points per ₹100 spent
            const rewardPoints = Math.floor(subtotal / 100) * 10;
            if (rewardPoints > 0) {
                await connection.query(
                    'UPDATE Customer SET Reward_points = Reward_points + ? WHERE Cust_id = ?',
                    [rewardPoints, userId]
                );
                await connection.query(
                    'INSERT INTO Reward_log (Cust_id, Points, Type, Description) VALUES (?, ?, ?, ?)',
                    [userId, rewardPoints, 'order', `Earned ${rewardPoints} points from Order #${orderId} (₹${subtotal.toLocaleString('en-IN')} spent)`]
                );
                // Update session
                if (req.session.user) {
                    req.session.user.Reward_points = (req.session.user.Reward_points || 0) + rewardPoints;
                }
            }

            await connection.commit();

            const pointsMsg = rewardPoints > 0 ? ` | Earned ${rewardPoints} reward points! 🎉` : '';
            req.flash('success', `Order placed successfully! Order ID: #${orderId} | Transaction: ${transactionId}${pointsMsg}`);
            res.redirect(`/orders/${orderId}`);
        } else {
            await connection.query(
                'UPDATE Orders SET Order_status = ? WHERE Order_id = ?',
                ['Cancelled', orderId]
            );
            await connection.commit();
            req.flash('error', `Payment failed (Transaction: ${transactionId}). Please try again.`);
            res.redirect('/orders/checkout');
        }
    } catch (err) {
        await connection.rollback();
        console.error('Order create error:', err);
        req.flash('error', 'Failed to place order. Please try again.');
        res.redirect('/orders/checkout');
    } finally {
        connection.release();
    }
});

// GET Order History
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const [orders] = await db.query(`
            SELECT o.*, p.Pay_status, p.Pay_method, p.Transaction_id,
            COUNT(od.Product_id) as item_count
            FROM Orders o
            LEFT JOIN Payment p ON o.Order_id = p.Order_id
            LEFT JOIN Order_details od ON o.Order_id = od.Order_id
            WHERE o.Cust_id = ?
            GROUP BY o.Order_id
            ORDER BY o.Order_date DESC
        `, [req.session.user.Cust_id]);

        res.render('orders', { orders });
    } catch (err) {
        console.error('Orders error:', err);
        res.render('orders', { orders: [] });
    }
});

// GET Single Order Detail
router.get('/:id', isAuthenticated, async (req, res) => {
    try {
        const [orders] = await db.query(`
            SELECT o.* FROM Orders o WHERE o.Order_id = ? AND o.Cust_id = ?
        `, [req.params.id, req.session.user.Cust_id]);

        if (orders.length === 0) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }

        const order = orders[0];

        // Get order items
        const [items] = await db.query(`
            SELECT od.*, p.Product_name, p.Image_url, p.P_Skin_type, b.Brand_name
            FROM Order_details od
            JOIN Product p ON od.Product_id = p.Product_id
            JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE od.Order_id = ?
        `, [req.params.id]);

        // Get payment info
        const [payments] = await db.query(
            'SELECT * FROM Payment WHERE Order_id = ?', [req.params.id]
        );

        // Generate timeline
        const statuses = ['Processing', 'Confirmed', 'Shipped', 'Out for Delivery', 'Delivered'];
        const currentIdx = statuses.indexOf(order.Order_status);
        const timeline = statuses.map((status, i) => ({
            status,
            completed: order.Order_status === 'Cancelled' ? false : i <= currentIdx,
            current: i === currentIdx
        }));

        res.render('order-detail', {
            order, items,
            payment: payments[0] || null,
            timeline,
            isCancelled: order.Order_status === 'Cancelled'
        });
    } catch (err) {
        console.error('Order detail error:', err);
        res.redirect('/orders');
    }
});

// POST Cancel Order
router.post('/:id/cancel', isAuthenticated, async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [orders] = await connection.query(
            'SELECT * FROM Orders WHERE Order_id = ? AND Cust_id = ? AND Order_status IN (?, ?)',
            [req.params.id, req.session.user.Cust_id, 'Processing', 'Confirmed']
        );

        if (orders.length === 0) {
            await connection.rollback();
            req.flash('error', 'Order cannot be cancelled');
            return res.redirect('/orders');
        }

        // Cancel order
        await connection.query(
            'UPDATE Orders SET Order_status = ? WHERE Order_id = ?',
            ['Cancelled', req.params.id]
        );

        // Refund payment
        await connection.query(
            'UPDATE Payment SET Pay_status = ? WHERE Order_id = ?',
            ['Refunded', req.params.id]
        );

        await connection.commit();
        req.flash('success', 'Order cancelled and refund initiated');
        res.redirect(`/orders/${req.params.id}`);
    } catch (err) {
        await connection.rollback();
        console.error('Cancel order error:', err);
        req.flash('error', 'Failed to cancel order');
        res.redirect('/orders');
    } finally {
        connection.release();
    }
});

module.exports = router;
