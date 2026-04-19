const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');

// GET All Products (with filters)
router.get('/', async (req, res) => {
    try {
        const { category, skin_type, brand, search, sort, recommended, price_range } = req.query;
        let query = `
            SELECT p.*, b.Brand_name,
            COALESCE(AVG(r.Rating), 0) as avg_rating,
            COUNT(r.review_id) as review_count
            FROM Product p
            JOIN Brand b ON p.Brand_id = b.Brand_id
            LEFT JOIN Review r ON p.Product_id = r.Product_id
        `;
        const conditions = [];
        const params = [];

        // If recommended & user is logged in with skin type
        if (recommended === 'true' && req.session.user && req.session.user.C_Skin_type) {
            conditions.push('(p.P_Skin_type = ? OR p.P_Skin_type = ?)');
            params.push(req.session.user.C_Skin_type, 'All');
        }

        if (category) {
            conditions.push('p.Category = ?');
            params.push(category);
        }
        if (skin_type) {
            conditions.push('(p.P_Skin_type = ? OR p.P_Skin_type = ?)');
            params.push(skin_type, 'All');
        }
        if (brand) {
            conditions.push('p.Brand_id = ?');
            params.push(brand);
        }
        if (search) {
            conditions.push('(p.Product_name LIKE ? OR p.Description LIKE ? OR b.Brand_name LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        // Price range filter
        if (price_range) {
            const parts = price_range.split('-');
            if (parts.length === 2) {
                const minPrice = parseFloat(parts[0]);
                const maxPrice = parseFloat(parts[1]);
                conditions.push('p.Price >= ? AND p.Price <= ?');
                params.push(minPrice, maxPrice);
            }
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' GROUP BY p.Product_id';

        // Sorting
        switch (sort) {
            case 'price_asc': query += ' ORDER BY p.Price ASC'; break;
            case 'price_desc': query += ' ORDER BY p.Price DESC'; break;
            case 'rating': query += ' ORDER BY avg_rating DESC'; break;
            case 'name': query += ' ORDER BY p.Product_name ASC'; break;
            default: query += ' ORDER BY p.Product_id DESC';
        }

        const [products] = await db.query(query, params);
        const [categories] = await db.query('SELECT DISTINCT Category FROM Product ORDER BY Category');
        const [brands] = await db.query('SELECT * FROM Brand ORDER BY Brand_name');
        const skinTypes = ['Oily', 'Dry', 'Combination', 'Sensitive', 'Normal', 'All'];

        res.render('products', {
            products, categories, brands, skinTypes,
            filters: { category, skin_type, brand, search, sort, recommended, price_range }
        });
    } catch (err) {
        console.error('Products error:', err);
        res.render('products', { products: [], categories: [], brands: [], skinTypes: [], filters: {} });
    }
});

// GET Single Product Detail
router.get('/:id', async (req, res) => {
    try {
        const [products] = await db.query(`
            SELECT p.*, b.Brand_name, b.Country
            FROM Product p
            JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE p.Product_id = ?
        `, [req.params.id]);

        if (products.length === 0) {
            req.flash('error', 'Product not found');
            return res.redirect('/products');
        }

        const product = products[0];

        // Get reviews with customer names
        const [reviews] = await db.query(`
            SELECT r.*, c.Cust_name, c.Profile_image
            FROM Review r
            JOIN Customer c ON r.Cust_id = c.Cust_id
            WHERE r.Product_id = ?
            ORDER BY r.Created_at DESC
        `, [req.params.id]);

        // Get related products (same category or skin type)
        const [related] = await db.query(`
            SELECT p.*, b.Brand_name,
            COALESCE(AVG(r.Rating), 0) as avg_rating
            FROM Product p
            JOIN Brand b ON p.Brand_id = b.Brand_id
            LEFT JOIN Review r ON p.Product_id = r.Product_id
            WHERE p.Product_id != ? AND (p.Category = ? OR p.P_Skin_type = ?)
            GROUP BY p.Product_id
            ORDER BY RANDOM()
            LIMIT 4
        `, [req.params.id, product.Category, product.P_Skin_type]);

        // Check if current user can review
        let canReview = false;
        if (req.session.user) {
            const [existingReview] = await db.query(
                'SELECT review_id FROM Review WHERE Cust_id = ? AND Product_id = ?',
                [req.session.user.Cust_id, req.params.id]
            );
            canReview = existingReview.length === 0;
        }

        // Calculate rating distribution
        const ratingDist = [0, 0, 0, 0, 0];
        reviews.forEach(r => { ratingDist[r.Rating - 1]++; });

        res.render('product-detail', { product, reviews, related, canReview, ratingDist });
    } catch (err) {
        console.error('Product detail error:', err);
        req.flash('error', 'Failed to load product');
        res.redirect('/products');
    }
});

module.exports = router;
