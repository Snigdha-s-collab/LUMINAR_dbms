require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const { setLocals } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static Files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Body Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions
app.use(session({
    secret: process.env.SESSION_SECRET || 'luminar-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Flash Messages
app.use(flash());

// Global Middleware
app.use(setLocals);

// Update cart count for logged in users
const db = require('./config/db');
app.use(async (req, res, next) => {
    if (req.session && req.session.user) {
        try {
            const [rows] = await db.query(
                'SELECT COALESCE(SUM(Quantity), 0) as count FROM Cart WHERE Cust_id = ?',
                [req.session.user.Cust_id]
            );
            req.session.cartCount = rows[0].count;
            res.locals.cartCount = rows[0].count;
        } catch (err) {
            // silently continue
        }
    }
    next();
});

// Routes
const authRoutes = require('./routes/auth');
const quizRoutes = require('./routes/quiz');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const reviewRoutes = require('./routes/reviews');
const assistantRoutes = require('./routes/assistant');
const cartRoutes = require('./routes/cart');
const productImageRoutes = require('./routes/productImage');

app.use('/auth', authRoutes);
app.use('/quiz', quizRoutes);
app.use('/products', productRoutes);
app.use('/orders', orderRoutes);
app.use('/reviews', reviewRoutes);
app.use('/assistant', assistantRoutes);
app.use('/cart', cartRoutes);
app.use('/product-image', productImageRoutes);

// Home Page
app.get('/', async (req, res) => {
    try {
        // Featured products
        const [featured] = await db.query(
            'SELECT p.*, b.Brand_name FROM Product p JOIN Brand b ON p.Brand_id = b.Brand_id ORDER BY RANDOM() LIMIT 8'
        );
        // Top rated products
        const [topRated] = await db.query(`
            SELECT p.*, b.Brand_name, COALESCE(AVG(r.Rating), 0) as avg_rating, COUNT(r.review_id) as review_count
            FROM Product p
            JOIN Brand b ON p.Brand_id = b.Brand_id
            LEFT JOIN Review r ON p.Product_id = r.Product_id
            GROUP BY p.Product_id
            HAVING COALESCE(AVG(r.Rating), 0) > 0
            ORDER BY avg_rating DESC, review_count DESC
            LIMIT 4
        `);
        // Brands
        const [brands] = await db.query('SELECT * FROM Brand ORDER BY Brand_name');
        
        res.render('home', { featured, topRated, brands });
    } catch (err) {
        console.error('Home page error:', err);
        res.render('home', { featured: [], topRated: [], brands: [] });
    }
});

// Profile Page
const { isAuthenticated } = require('./middleware/auth');
app.get('/profile', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.Cust_id;
        const [orders] = await db.query(
            'SELECT * FROM Orders WHERE Cust_id = ? ORDER BY Order_date DESC LIMIT 5', [userId]
        );
        const [reviews] = await db.query(
            'SELECT r.*, p.Product_name FROM Review r JOIN Product p ON r.Product_id = p.Product_id WHERE r.Cust_id = ? ORDER BY r.Created_at DESC LIMIT 5', [userId]
        );
        const [quizResult] = await db.query(
            'SELECT * FROM Skin_quiz_responses WHERE Cust_id = ? ORDER BY Created_at DESC LIMIT 1', [userId]
        );
        res.render('profile', { orders, reviews, quizResult: quizResult[0] || null });
    } catch (err) {
        console.error('Profile error:', err);
        res.render('profile', { orders: [], reviews: [], quizResult: null });
    }
});

// 404
app.use((req, res) => {
    res.status(404).render('404');
});

// Start Server (after database initialization)
db.initialize().then(async () => {
    // Update all product image URLs to use our dynamic SVG endpoint
    try {
        const [allProducts] = await db.query('SELECT Product_id FROM Product');
        for (const p of allProducts) {
            await db.query(
                'UPDATE Product SET Image_url = ? WHERE Product_id = ?',
                [`/product-image/${p.Product_id}`, p.Product_id]
            );
        }
        console.log(`✅ Updated ${allProducts.length} product image URLs`);
    } catch (err) {
        console.error('Image URL update warning:', err.message);
    }

    app.listen(PORT, () => {
        console.log(`\n✨ LUMINAR is running at http://localhost:${PORT}\n`);
    });
}).catch(err => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
});
