const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { isGuest, isAuthenticated } = require('../middleware/auth');

// GET Login Page
router.get('/login', isGuest, (req, res) => {
    res.render('login');
});

// GET Register Page
router.get('/register', isGuest, (req, res) => {
    res.render('register');
});

// POST Register
router.post('/register', isGuest, async (req, res) => {
    try {
        const { name, email, password, confirmPassword, city, phone } = req.body;

        // Validation
        if (!name || !email || !password) {
            req.flash('error', 'Please fill in all required fields');
            return res.redirect('/auth/register');
        }
        if (password !== confirmPassword) {
            req.flash('error', 'Passwords do not match');
            return res.redirect('/auth/register');
        }
        if (password.length < 6) {
            req.flash('error', 'Password must be at least 6 characters');
            return res.redirect('/auth/register');
        }

        // Check if email exists
        const [existing] = await db.query('SELECT Cust_id FROM Customer WHERE Mail = ?', [email]);
        if (existing.length > 0) {
            req.flash('error', 'An account with this email already exists');
            return res.redirect('/auth/register');
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert customer
        const [result] = await db.query(
            'INSERT INTO Customer (Cust_name, Mail, Password_hash, City, Phone) VALUES (?, ?, ?, ?, ?)',
            [name, email, hashedPassword, city || null, phone || null]
        );

        // Auto-login
        const [user] = await db.query('SELECT * FROM Customer WHERE Cust_id = ?', [result.insertId]);
        req.session.user = user[0];
        req.flash('success', 'Welcome to Luminar! Let\'s determine your skin type.');
        res.redirect('/quiz');
    } catch (err) {
        console.error('Register error:', err);
        req.flash('error', 'Registration failed. Please try again.');
        res.redirect('/auth/register');
    }
});

// POST Login
router.post('/login', isGuest, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            req.flash('error', 'Please enter email and password');
            return res.redirect('/auth/login');
        }

        // Find user
        const [users] = await db.query('SELECT * FROM Customer WHERE Mail = ?', [email]);
        if (users.length === 0) {
            req.flash('error', 'Invalid email or password');
            return res.redirect('/auth/login');
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.Password_hash);
        if (!isMatch) {
            req.flash('error', 'Invalid email or password');
            return res.redirect('/auth/login');
        }

        // Set session
        req.session.user = user;
        req.flash('success', `Welcome back, ${user.Cust_name}!`);

        // Redirect to quiz if no skin type set
        if (!user.C_Skin_type) {
            return res.redirect('/quiz');
        }
        res.redirect('/');
    } catch (err) {
        console.error('Login error:', err);
        req.flash('error', 'Login failed. Please try again.');
        res.redirect('/auth/login');
    }
});

// GET Logout
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        res.redirect('/');
    });
});

module.exports = router;
