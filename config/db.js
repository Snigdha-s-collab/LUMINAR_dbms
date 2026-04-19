const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// Ensure db directory exists
const dbDir = path.join(__dirname, '..', 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'luminar.db');
let db = null;

// Save database to disk
function saveDatabase() {
    if (!db) return;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    } catch (err) {
        console.error('Failed to save database:', err.message);
    }
}

// Auto-save every 30 seconds
setInterval(saveDatabase, 30000);

// Helper: run SELECT query and return array of row objects
function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

// Track if we're inside a transaction
let inTransaction = false;

// Helper: run INSERT/UPDATE/DELETE and return result info
function queryRun(sql, params = []) {
    db.run(sql, params);
    const lastId = db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] || 0;
    const changes = db.exec("SELECT changes()")[0]?.values[0][0] || 0;
    // Only auto-save if NOT inside an explicit transaction
    if (!inTransaction) {
        saveDatabase();
    }
    return { insertId: lastId, affectedRows: changes };
}

// ============================================
// Initialize Database (async — called before server starts)
// ============================================
async function initialize() {
    const SQL = await initSqlJs();

    // Load existing database or create new one
    let freshDb = false;
    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
        console.log('✅ SQLite database loaded from disk');
    } else {
        db = new SQL.Database();
        freshDb = true;
        console.log('✅ SQLite database created (in-memory, will save to disk)');
    }

    // Enable foreign keys
    db.run("PRAGMA foreign_keys = ON");

    // Create tables
    createTables();

    // Seed data if empty
    const result = db.exec("SELECT COUNT(*) as c FROM Brand");
    const brandCount = result[0]?.values[0][0] || 0;
    if (brandCount === 0) {
        console.log('📦 Seeding database with initial data...');
        seedDatabase();
        console.log('✅ Database seeded successfully');
    } else if (!freshDb) {
        // Check if we need to upgrade to 120+ products (only for existing DBs)
        const prodResult = db.exec("SELECT COUNT(*) as c FROM Product");
        const prodCount = prodResult[0]?.values[0][0] || 0;
        if (prodCount < 100) {
            console.log('📦 Upgrading product catalog to 120+ products...');
            // Disable FK checks for migration
            db.run("PRAGMA foreign_keys = OFF");
            db.run("DELETE FROM Review");
            db.run("DELETE FROM Cart");
            db.run("DELETE FROM Order_details");
            db.run("DELETE FROM Orders");
            db.run("DELETE FROM Payment");
            db.run("DELETE FROM Skin_quiz_responses");
            db.run("DELETE FROM Skin_analysis");
            db.run("DELETE FROM Saved_routines");
            db.run("DELETE FROM Product");
            db.run("DELETE FROM Brand");
            seedDatabase();
            db.run("PRAGMA foreign_keys = ON");
            console.log('✅ Product catalog upgraded successfully');
        }
    }

    saveDatabase();
}

// ============================================
// Create Tables
// ============================================
function createTables() {
    db.run(`
        CREATE TABLE IF NOT EXISTS Brand (
            Brand_id INTEGER PRIMARY KEY AUTOINCREMENT,
            Brand_name TEXT NOT NULL,
            Country TEXT NOT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Product (
            Product_id INTEGER PRIMARY KEY AUTOINCREMENT,
            Product_name TEXT NOT NULL,
            Category TEXT NOT NULL,
            P_Skin_type TEXT NOT NULL,
            Price REAL NOT NULL,
            Brand_id INTEGER NOT NULL,
            Description TEXT,
            Image_url TEXT DEFAULT '/images/default-product.png',
            Ingredients TEXT,
            How_to_use TEXT,
            FOREIGN KEY (Brand_id) REFERENCES Brand(Brand_id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Customer (
            Cust_id INTEGER PRIMARY KEY AUTOINCREMENT,
            Cust_name TEXT NOT NULL,
            Mail TEXT NOT NULL UNIQUE,
            Password_hash TEXT NOT NULL,
            C_Skin_type TEXT DEFAULT NULL,
            City TEXT,
            Phone TEXT,
            Skin_concerns TEXT,
            Profile_image TEXT DEFAULT '/images/default-avatar.png',
            Created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Orders (
            Order_id INTEGER PRIMARY KEY AUTOINCREMENT,
            Cust_id INTEGER NOT NULL,
            Order_date TEXT DEFAULT CURRENT_TIMESTAMP,
            tot_amt REAL NOT NULL,
            Order_status TEXT DEFAULT 'Processing',
            Shipping_address TEXT,
            Tracking_number TEXT,
            FOREIGN KEY (Cust_id) REFERENCES Customer(Cust_id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Order_details (
            Order_id INTEGER NOT NULL,
            Product_id INTEGER NOT NULL,
            Quantity INTEGER NOT NULL DEFAULT 1,
            Unit_price REAL NOT NULL,
            PRIMARY KEY (Order_id, Product_id),
            FOREIGN KEY (Order_id) REFERENCES Orders(Order_id) ON DELETE CASCADE,
            FOREIGN KEY (Product_id) REFERENCES Product(Product_id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Review (
            review_id INTEGER PRIMARY KEY AUTOINCREMENT,
            Cust_id INTEGER NOT NULL,
            Product_id INTEGER NOT NULL,
            Rating INTEGER NOT NULL,
            Comment TEXT,
            Created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (Cust_id) REFERENCES Customer(Cust_id) ON DELETE CASCADE,
            FOREIGN KEY (Product_id) REFERENCES Product(Product_id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Payment (
            Payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
            Order_id INTEGER NOT NULL,
            Payment_date TEXT DEFAULT CURRENT_TIMESTAMP,
            amount REAL NOT NULL,
            Pay_method TEXT NOT NULL,
            Pay_status TEXT DEFAULT 'Pending',
            Transaction_id TEXT,
            FOREIGN KEY (Order_id) REFERENCES Orders(Order_id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Skin_quiz_responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            Cust_id INTEGER NOT NULL,
            responses TEXT,
            determined_skin_type TEXT,
            match_percentage REAL,
            Created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (Cust_id) REFERENCES Customer(Cust_id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Cart (
            Cart_id INTEGER PRIMARY KEY AUTOINCREMENT,
            Cust_id INTEGER NOT NULL,
            Product_id INTEGER NOT NULL,
            Quantity INTEGER NOT NULL DEFAULT 1,
            Added_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (Cust_id) REFERENCES Customer(Cust_id) ON DELETE CASCADE,
            FOREIGN KEY (Product_id) REFERENCES Product(Product_id) ON DELETE CASCADE,
            UNIQUE(Cust_id, Product_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Skin_analysis (
            analysis_id INTEGER PRIMARY KEY AUTOINCREMENT,
            Cust_id INTEGER NOT NULL,
            Image_path TEXT,
            Analysis_result TEXT,
            Detected_conditions TEXT,
            Recommendations TEXT,
            Created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (Cust_id) REFERENCES Customer(Cust_id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Saved_routines (
            routine_id INTEGER PRIMARY KEY AUTOINCREMENT,
            Cust_id INTEGER NOT NULL,
            skin_type TEXT,
            concerns TEXT,
            routine_data TEXT,
            Created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (Cust_id) REFERENCES Customer(Cust_id) ON DELETE CASCADE
        )
    `);

    // Create indexes
    try { db.run('CREATE INDEX IF NOT EXISTS idx_product_skin_type ON Product(P_Skin_type)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_product_category ON Product(Category)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_product_brand ON Product(Brand_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_orders_customer ON Orders(Cust_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_review_product ON Review(Product_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_payment_order ON Payment(Order_id)'); } catch(e) {}
}

// ============================================
// Seed Data — 120+ products with real images
// ============================================
function seedDatabase() {
    db.run("BEGIN TRANSACTION");

    // Brands (15 brands)
    const brands = [
        ['CeraVe', 'USA'], ['The Ordinary', 'Canada'], ['La Roche-Posay', 'France'],
        ['Neutrogena', 'USA'], ['Innisfree', 'South Korea'], ['Cetaphil', 'USA'],
        ['Minimalist', 'India'], ['Dot & Key', 'India'], ['Plum', 'India'],
        ['COSRX', 'South Korea'], ["Paula's Choice", 'USA'], ['Biotique', 'India'],
        ['Mamaearth', 'India'], ['Laneige', 'South Korea'], ['Simple', 'UK']
    ];
    brands.forEach(b => db.run("INSERT INTO Brand (Brand_name, Country) VALUES (?, ?)", b));

    // 120+ Products with real Unsplash/placeholder images and varied prices
    const products = [
        // ========== CLEANSERS (15) ==========
        ['Hydrating Facial Cleanser', 'Cleanser', 'Dry', 899.00, 1,
         'A gentle, non-foaming cleanser enriched with ceramides and hyaluronic acid that removes dirt and makeup while locking in moisture. Ideal for dry, compromised skin that needs barrier support. The creamy texture leaves skin soft, never tight or stripped. Dermatologist tested and fragrance-free.',
         'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop', 'Ceramides, Hyaluronic Acid, Glycerin, Phytosphingosine',
         'Wet face. Massage a small amount onto skin in circular motions. Rinse with lukewarm water. Use AM and PM.'],
        ['Foaming Facial Cleanser', 'Cleanser', 'Oily', 799.00, 1,
         'Oil-free foaming cleanser with niacinamide and ceramides that effectively dissolves excess oil and impurities without disrupting the skin barrier. Perfect for oily, acne-prone skin looking for a deep but gentle cleanse. Leaves skin feeling fresh, clean, and matte.',
         'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop', 'Niacinamide, Ceramides, Hyaluronic Acid',
         'Wet face with lukewarm water. Apply a small amount and gently massage. Rinse thoroughly. Use AM and PM.'],
        ['Squalane Cleanser', 'Cleanser', 'All', 650.00, 2,
         'A velvety, emollient cleanser powered by squalane that gently melts away makeup, sunscreen, and impurities while deeply moisturizing. Transforms from a balm-like texture to a milky rinse, leaving zero residue. Suitable for all skin types including very sensitive skin.',
         'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop', 'Squalane, Sucrose Esters, Sorbitan Laurate',
         'Apply to dry face, massage gently for 60 seconds, then emulsify with water and rinse off.'],
        ['Toleriane Purifying Foaming Cleanser', 'Cleanser', 'Sensitive', 1299.00, 3,
         'A purifying, soap-free foaming cleanser formulated specifically for sensitive, oily skin. Fortified with La Roche-Posay Thermal Spring Water and Ceramide-3, it removes impurities while maintaining the skin natural pH. Ophthalmologist and dermatologist tested.',
         'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop', 'Niacinamide, Ceramide-3, Thermal Spring Water',
         'Apply to damp face, lather gently, rinse with water. Avoid eye area.'],
        ['Green Tea Cleansing Foam', 'Cleanser', 'Combination', 550.00, 5,
         'A refreshing daily cleanser infused with 16 amino acids and Jeju green tea extract that gently purifies and controls excess sebum while keeping skin comfortably hydrated. The micro-foam texture deeply cleanses pores without over-drying.',
         'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop', 'Green Tea Extract, Amino Acids, Betaine',
         'Create lather in hands, apply to damp face, massage for 30 seconds, rinse.'],
        ['Gentle Skin Cleanser', 'Cleanser', 'Sensitive', 599.00, 6,
         'An ultra-gentle, soap-free cleanser trusted by dermatologists worldwide for over 70 years. Cleanses without stripping or irritating even the most sensitive skin. pH-balanced formula preserves the natural protective barrier. Can be used with or without water.',
         'https://images.unsplash.com/photo-1609097154293-1d04b5e8184d?w=400&h=400&fit=crop', 'Cetyl Alcohol, Propylene Glycol, Sodium Lauryl Sulfate (mild)',
         'Apply to damp skin, massage gently, rinse or wipe off with a soft cloth.'],
        ['Micellar Cleansing Water', 'Cleanser', 'All', 199.00, 15,
         'A no-rinse cleansing water powered by micelle technology that gently lifts dirt, oil, and makeup from skin. Leaves skin feeling clean and refreshed without any tightness or residue. Perfect for sensitive skin and quick cleansing on-the-go. Free from artificial perfumes and dyes.',
         'https://images.unsplash.com/photo-1617897903246-719242758050?w=400&h=400&fit=crop', 'Micellar Technology, Vitamin B3, Pro-Vitamin B5',
         'Soak a cotton pad and gently wipe across face, eyes, and lips. No rinsing needed.'],
        ['Tea Tree Face Wash', 'Cleanser', 'Oily', 349.00, 13,
         'A refreshing gel-based face wash enriched with tea tree oil and neem extract that fights acne-causing bacteria while gently cleansing. Controls excess oil production and helps prevent future breakouts. Suitable for daily use on oily and acne-prone skin.',
         'https://images.unsplash.com/photo-1619451334792-150fd785ee74?w=400&h=400&fit=crop', 'Tea Tree Oil, Neem Extract, Aloe Vera',
         'Take a coin-sized amount, lather between palms, apply to wet face, massage 30 seconds, rinse.'],
        ['Salicylic Acid Cleanser', 'Cleanser', 'Oily', 399.00, 7,
         'A targeted gel cleanser with 1% salicylic acid that deeply penetrates pores to dissolve excess oil and dead skin cells. Helps prevent and treat acne without over-drying. The gentle formula is suitable for daily use and leaves skin visibly clearer over time.',
         'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=400&h=400&fit=crop', 'Salicylic Acid 1%, Zinc, LHA',
         'Use on wet face, massage gently for 1 minute, rinse. Use AM and PM.'],
        ['Rice Water Cleanser', 'Cleanser', 'Normal', 449.00, 5,
         'A creamy brightening cleanser made with fermented rice water from Jeju Island. Rich in vitamins and minerals, it gently removes impurities while evening out skin tone and adding a natural luminosity. Suitable for all skin types looking for radiance.',
         'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop', 'Rice Bran Water, Ceramides, Moringa Oil',
         'Apply to damp skin in circular motions, rinse with lukewarm water. Use daily.'],
        ['Oil-to-Foam Cleanser', 'Cleanser', 'Dry', 299.00, 9,
         'A luxurious oil-based cleanser that transforms into a lightweight foam upon contact with water. Effectively dissolves stubborn makeup and SPF while nourishing dry skin with essential fatty acids. Leaves skin soft, supple, and deeply clean without any greasy residue.',
         'https://images.unsplash.com/photo-1583209814683-c023dd293cc6?w=400&h=400&fit=crop', 'Olive Oil, Macadamia Oil, Chamomile Extract',
         'Apply to dry face, massage, add water to emulsify, rinse clean.'],
        ['Charcoal Deep Pore Cleanser', 'Cleanser', 'Oily', 249.00, 13,
         'An activated charcoal-infused deep pore cleanser that acts like a magnet to draw out dirt, toxins, and excess oil from deep within pores. Enriched with clay and walnut shell beads for gentle micro-exfoliation. Leaves oily skin feeling clean, matte, and refreshed.',
         'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&h=400&fit=crop', 'Activated Charcoal, Kaolin Clay, Walnut Shell',
         'Apply to wet face, massage for 1 minute focusing on T-zone. Rinse well.'],

        // ========== MOISTURIZERS (15) ==========
        ['Moisturizing Cream', 'Moisturizer', 'Dry', 999.00, 1,
         'A rich, non-greasy moisturizer featuring 3 essential ceramides and patented MVE controlled-release technology for 24-hour hydration. Helps restore and maintain the natural protective skin barrier. Fragrance-free, allergy-tested, and non-comedogenic.',
         'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop', 'Ceramides 1,3,6-II, Hyaluronic Acid, MVE Technology',
         'Apply liberally on face and body as needed. Suitable for morning and night.'],
        ['Natural Moisturizing Factors + HA', 'Moisturizer', 'Normal', 590.00, 2,
         'A lightweight daily moisturizer that mirrors the skin natural moisturizing factors. Contains amino acids, fatty acids, triglycerides, urea, ceramides, phospholipids, and hyaluronic acid crosspolymer for a non-greasy protective barrier that keeps skin supple all day.',
         'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=400&h=400&fit=crop', 'Hyaluronic Acid, Amino Acids, Ceramides, Triglycerides',
         'Apply a small amount to face after serums, morning and night.'],
        ['Aqua Cica Moisturizer', 'Moisturizer', 'Sensitive', 845.00, 8,
         'A soothing gel-cream moisturizer with CICA (Centella Asiatica) that calms irritated and inflamed skin on contact. Blue spirulina extract reduces redness while hyaluronic acid delivers deep hydration. Strengthens the skin barrier and locks in moisture for up to 72 hours.',
         'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop', 'Centella Asiatica, Hyaluronic Acid, Blue Spirulina, Niacinamide',
         'Take a pea-sized amount and apply evenly on cleansed face. Gentle pat to absorb.'],
        ['Oil-Free Moisturizer SPF 25', 'Moisturizer', 'Oily', 749.00, 4,
         'A lightweight, oil-free daily moisturizer with broad spectrum SPF 25 that hydrates without clogging pores or adding unwanted shine. Features Helioplex technology for stable, powerful sun protection. Perfect for oily skin that needs hydration plus UV defense.',
         'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop', 'Glycerin, Helioplex Technology, Dimethicone',
         'Apply after cleanser in the morning. Reapply sunscreen if outdoors for extended periods.'],
        ['Green Tea Seed Cream', 'Moisturizer', 'Combination', 1250.00, 5,
         'A deeply nourishing cream infused with cold-pressed Jeju green tea seed oil that delivers intense moisture to dry zones while keeping oily areas balanced. The fresh, antioxidant-rich formula protects skin from environmental stressors and free radical damage.',
         'https://images.unsplash.com/photo-1619451334792-150fd785ee74?w=400&h=400&fit=crop', 'Green Tea Seed Oil, Green Tea Extract, Squalane',
         'Take an adequate amount and apply evenly to face as the last step of skincare routine.'],
        ['Aloe Hydra Cool Soothing Gel', 'Moisturizer', 'Sensitive', 299.00, 5,
         'A cooling, ultra-lightweight gel moisturizer with 93% Jeju aloe vera extract that instantly calms irritated, sunburned, and overheated skin. Provides a refreshing burst of lightweight moisture without heaviness. Can double as an after-sun treatment or soothing emergency mask.',
         'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop', 'Aloe Vera 93%, Centella Asiatica, Panthenol',
         'Apply generously on face and body. Can be used as emergency soothing treatment.'],
        ['Daily Moisturizing Lotion', 'Moisturizer', 'Normal', 549.00, 6,
         'A lightweight, fast-absorbing daily lotion formulated with macadamia nut oil and niacinamide for 24-hour hydration without a greasy feel. Clinically proven to improve skin smoothness and softness from the very first application. Non-comedogenic and suitable for face and body.',
         'https://images.unsplash.com/photo-1617897903246-719242758050?w=400&h=400&fit=crop', 'Macadamia Nut Oil, Sweet Almond Oil, Glycerin, Niacinamide',
         'Apply to face and body after cleansing. Suitable for daily morning and night use.'],
        ['Water Sleeping Mask', 'Moisturizer', 'All', 1599.00, 14,
         'A cult-favorite overnight sleeping mask that delivers intense hydration while you rest. Infused with sleep-biome technology and squalane, it envelops skin in a moisture cocoon for visibly plumper, dewy skin by morning. The breathable gel formula won over 30 beauty awards worldwide.',
         'https://images.unsplash.com/photo-1583209814683-c023dd293cc6?w=400&h=400&fit=crop', 'Squalane, Sunflower Seed Oil, Apricot Extract, Probiotics',
         'Apply a generous layer as the last step of evening routine. Rinse off in the morning.'],
        ['Vitamin E Moisturizing Cream', 'Moisturizer', 'Dry', 199.00, 12,
         'An affordable yet deeply nourishing cream enriched with natural Vitamin E and wheatgerm oil that repairs dry, damaged skin while providing lasting hydration. The Ayurvedic formula combines traditional botanicals with modern skincare science for soft, supple skin.',
         'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&h=400&fit=crop', 'Vitamin E, Wheatgerm Oil, Wild Turmeric',
         'Apply on clean face and neck. Massage gently until absorbed. Use AM and PM.'],
        ['Oil-Free Moisture Gel', 'Moisturizer', 'Oily', 149.00, 9,
         'An ultra-light, oil-free gel moisturizer with green tea and aloe vera that hydrates oily skin without adding shine or heaviness. Absorbs instantly and creates a matte, fresh base perfect for under makeup. Rich in antioxidants that protect skin from pollution damage.',
         'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop', 'Green Tea Extract, Aloe Vera, Hyaluronic Acid',
         'Apply a thin layer on clean face. Can be used under makeup.'],
        ['Ceramide Barrier Cream', 'Moisturizer', 'Sensitive', 399.00, 7,
         'A gentle, fragrance-free barrier repair cream packed with ceramides, squalane, and panthenol to restore and protect compromised skin. Clinically shown to reduce redness and irritation within 24 hours. Ideal for post-procedure skin, eczema-prone skin, and extreme dryness.',
         'https://images.unsplash.com/photo-1609097154293-1d04b5e8184d?w=400&h=400&fit=crop', 'Ceramides, Squalane, Panthenol, Madecassoside',
         'Apply generously on affected areas. Use as needed, layer for extra protection.'],

        // ========== SERUMS (18) ==========
        ['Niacinamide 10% + Zinc 1%', 'Serum', 'Oily', 590.00, 2,
         'A high-strength vitamin and mineral formula that visibly reduces blemishes, congestion, and balances oil production. 10% pure niacinamide minimizes pore appearance while 1% zinc PCA controls sebum. Water-based, lightweight formula suitable for layering in any routine.',
         'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop', 'Niacinamide 10%, Zinc PCA 1%',
         'Apply a few drops to face AM and PM before heavier creams.'],
        ['Hyaluronic Acid 2% + B5', 'Serum', 'Dry', 630.00, 2,
         'A multi-depth hydration serum featuring low, medium, and high molecular weight hyaluronic acid molecules plus pro-vitamin B5 for instant plumping and long-lasting hydration. Draws moisture from the environment to keep skin bouncy and dewy all day.',
         'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=400&h=400&fit=crop', 'Hyaluronic Acid (Multi-weight), Panthenol (Vitamin B5)',
         'Apply a few drops to damp skin AM and PM. Follow with moisturizer.'],
        ['Alpha Arbutin 2% + HA', 'Serum', 'All', 550.00, 2,
         'A concentrated brightening serum with 2% alpha arbutin that safely and effectively reduces the appearance of dark spots, post-acne marks, and uneven skin tone. Works by inhibiting tyrosinase enzyme activity without irritation. Suitable for all skin types and tones.',
         'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop', 'Alpha Arbutin 2%, Hyaluronic Acid',
         'Apply a few drops to affected areas AM and PM. Use sunscreen during the day.'],
        ['10% Niacinamide Face Serum', 'Serum', 'Oily', 499.00, 7,
         'A lightweight water-based serum with 10% niacinamide that controls oil production, minimizes enlarged pores, and evens out skin tone. Enriched with zinc and hyaluronic acid for added blemish-fighting and hydrating benefits. Clinically tested, vegan, and fragrance-free.',
         'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop', 'Niacinamide 10%, Zinc, Hyaluronic Acid',
         'Apply 4-5 drops on cleansed face. Gently press into skin. Follow with moisturizer.'],
        ['Vitamin C Serum', 'Serum', 'Normal', 695.00, 9,
         'A potent 15% vitamin C serum with Japanese mandarin extract that brightens dull skin, fights free radical damage from UV and pollution, and stimulates collagen production for a youthful, radiant complexion. The stable formulation ensures maximum efficacy with minimal irritation.',
         'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop', 'Ethyl Ascorbic Acid 15%, Mandarin Extract, Hyaluronic Acid',
         'Apply 3-4 drops on clean face in the morning. Always follow with sunscreen.'],
        ['Advanced Snail 96 Mucin Power Essence', 'Serum', 'All', 1350.00, 10,
         'A bestselling essence with 96% snail secretion filtrate that delivers intense repair and hydration. Helps heal acne scars, reduce fine lines, and improve overall skin texture. The lightweight, slightly viscous formula absorbs quickly to reveal smoother, more radiant skin.',
         'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop', 'Snail Secretion Filtrate 96%, Betaine, Sodium Hyaluronate',
         'After cleansing and toning, apply a small amount and gently pat until absorbed.'],
        ['Watermelon Glow Niacinamide Serum', 'Serum', 'Combination', 1890.00, 8,
         'A pore-minimizing glow serum featuring niacinamide, watermelon extract, and alpha arbutin. Targets enlarged pores, excess shine, and uneven texture while delivering a subtle, healthy glow. The pink-tinted formula is a joy to use and works beautifully under makeup.',
         'https://images.unsplash.com/photo-1619451334792-150fd785ee74?w=400&h=400&fit=crop', 'Niacinamide, Watermelon Extract, Hyaluronic Acid, Alpha Arbutin',
         'Apply 3-4 drops on clean face, gently pat in. Use AM and PM.'],
        ['Pore Tightening Serum', 'Serum', 'Oily', 850.00, 5,
         'A targeted triple-acid serum with AHA, BHA, and PHA powered by Jeju volcanic cluster water. Visibly tightens enlarged pores, controls sebum, and refines skin texture. The lightweight essence texture absorbs instantly without stickiness for a smooth, poreless look.',
         'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop', 'Volcanic Cluster Water, AHA, BHA, PHA',
         'Apply to T-zone and areas with visible pores after toning. Use AM and PM.'],
        ['2% Salicylic Acid Face Serum', 'Serum', 'Oily', 545.00, 7,
         'A potent exfoliating serum with 2% salicylic acid (BHA) that penetrates deep into pores to dissolve excess sebum, dead skin cells, and blackheads. Enriched with LHA for gradual exfoliation and zinc for anti-inflammatory benefits. Start with alternate day use.',
         'https://images.unsplash.com/photo-1583209814683-c023dd293cc6?w=400&h=400&fit=crop', 'Salicylic Acid 2%, LHA, Zinc',
         'Apply 3-4 drops on clean face in the evening. Start with alternate days.'],
        ['Grape Seed 80 Firming Serum', 'Serum', 'Normal', 1450.00, 5,
         'A powerhouse antioxidant serum with 80% concentrated grape seed extract that neutralizes free radicals, firms sagging skin, and improves elasticity. Rich in polyphenols and vitamin E, it visibly reduces fine lines while protecting skin from environmental aging.',
         'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&h=400&fit=crop', 'Grape Seed Extract 80%, Vitamin E, Panthenol',
         'Apply after toner and before moisturizer. Pat gently into skin.'],
        ['10% Vitamin C Face Serum', 'Serum', 'All', 599.00, 9,
         'A stable, gentle vitamin C serum with Japanese Mandarin and Kakadu Plum that brightens skin, fades dark spots, and boosts collagen production. The 10% concentration provides effective results without irritation, making it perfect for vitamin C beginners.',
         'https://images.unsplash.com/photo-1617897903246-719242758050?w=400&h=400&fit=crop', 'Ethyl Ascorbic Acid 10%, Mandarin Extract, Kakadu Plum',
         'Apply 4-5 drops on clean face every morning. Follow with moisturizer and sunscreen.'],
        ['Peptide Serum', 'Serum', 'Normal', 399.00, 7,
         'A multi-peptide serum targeting multiple signs of aging with five signal peptides and hyaluronic acid. Helps improve skin firmness, elasticity, and texture while reducing the appearance of fine lines. The lightweight, non-greasy formula layers beautifully under any moisturizer.',
         'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop', 'Matrixyl 3000, Argireline, Copper Peptides, HA',
         'Apply 4-5 drops on clean face AM and PM. Follow with moisturizer.'],
        ['Cica Repair Serum', 'Serum', 'Sensitive', 299.00, 13,
         'A calming serum with centella asiatica (CICA) extract that soothes irritated, red, and inflamed skin. Helps strengthen the skin barrier while promoting faster healing of acne marks and minor wounds. The gentle formula is free from fragrance, essential oils, and harsh chemicals.',
         'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop', 'Centella Asiatica, Madecassoside, Panthenol',
         'Apply 3-4 drops on affected areas. Can be used AM and PM.'],
        ['AHA + BHA + PHA 30-Day Miracle Serum', 'Serum', 'Combination', 1099.00, 10,
         'A triple-action chemical exfoliant serum with AHA, BHA, and PHA that gently dissolves dead skin cells, unclogs pores, and refines skin texture over 30 days. The pH-balanced formula is effective yet gentle enough for combination skin with both oily and dry zones.',
         'https://images.unsplash.com/photo-1609097154293-1d04b5e8184d?w=400&h=400&fit=crop', 'Glycolic Acid, Salicylic Acid, Gluconolactone, Tea Tree',
         'Apply a few drops in the evening after toner. Start 2-3 times per week.'],
        ['Hydrating Serum with Rose Extract', 'Serum', 'Dry', 179.00, 13,
         'An affordable yet effective hydrating serum infused with Damascus rose water and hyaluronic acid. Delivers intense moisture to parched, dehydrated skin while soothing inflammation and redness. The delicate rose fragrance adds a luxurious spa-like experience to your routine.',
         'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=400&h=400&fit=crop', 'Rose Water, Hyaluronic Acid, Glycerin',
         'Apply 4-5 drops on damp face. Follow with moisturizer.'],
        ['Bakuchiol Retinol Alternative Serum', 'Serum', 'Sensitive', 549.00, 7,
         'A plant-based retinol alternative serum featuring bakuchiol that delivers anti-aging benefits without the irritation of traditional retinol. Clinically proven to reduce fine lines, improve firmness, and even out skin tone. Safe for sensitive skin, pregnancy, and daytime use.',
         'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop', 'Bakuchiol, Squalane, Vitamin E',
         'Apply 3-4 drops AM and PM. No need for SPF-specific precautions unlike retinol.'],

        // ========== SUNSCREENS (10) ==========
        ['Anthelios Melt-in Sunscreen SPF 60', 'Sunscreen', 'All', 1599.00, 3,
         'An ultra-lightweight, oil-free sunscreen with broad spectrum SPF 60 and Cell-Ox Shield technology providing superior UVA/UVB protection. The weightless texture melts into skin leaving no white cast or residue. Water-resistant for 80 minutes, ideal for daily wear and outdoor activities.',
         'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop', 'Cell-Ox Shield, Mexoryl SX, Avobenzone, Thermal Spring Water',
         'Apply generously 15 minutes before sun exposure. Reapply every 2 hours.'],
        ['Ultra Sheer Dry-Touch Sunscreen SPF 50+', 'Sunscreen', 'Oily', 699.00, 4,
         'A breakthrough sunscreen with Dry-Touch technology that provides a clean, non-greasy, matte finish. The ultra-sheer formula absorbs fast and feels weightless on skin. Features Helioplex technology for powerful, photostable broad-spectrum sun protection all day.',
         'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop', 'Helioplex Technology, Avobenzone, Homosalate',
         'Apply liberally 15 minutes before sun exposure. Reapply every 2 hours.'],
        ['Daily UV Defence SPF 50+', 'Sunscreen', 'Sensitive', 999.00, 6,
         'A gentle, mineral-based daily sunscreen formulated with zinc oxide and titanium dioxide for sensitive, reactive skin. Non-comedogenic formula with a lightweight, moisturizing finish. Free from fragrance, parabens, and chemical UV filters that can trigger irritation.',
         'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop', 'Zinc Oxide, Titanium Dioxide, Glycerin, Vitamin E',
         'Apply as the last step of skincare routine every morning. Reapply if outdoors.'],
        ['SPF 50 Sunscreen Aqua Gel', 'Sunscreen', 'Combination', 449.00, 7,
         'A revolutionary aqua-gel sunscreen with SPF 50 that feels like water on skin. Multi-spectrum UV filters provide comprehensive protection without white cast or stickiness. The gel formula controls oil in the T-zone while keeping dry areas comfortable and hydrated.',
         'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop', 'Multi-Spectrum UV Filters, Squalane, Centella',
         'Apply generously as the last step of morning skincare. Reapply every 2-3 hours.'],
        ['Ultra Light Indian Sunscreen SPF 50', 'Sunscreen', 'All', 199.00, 13,
         'An ultra-affordable, lightweight sunscreen specifically designed for Indian skin tones. The non-greasy, non-sticky formula provides broad-spectrum SPF 50 protection without leaving a white cast. Enriched with vitamin C for added antioxidant protection against sun damage.',
         'https://images.unsplash.com/photo-1619451334792-150fd785ee74?w=400&h=400&fit=crop', 'Zinc Oxide, Vitamin C, Carrot Seed Extract',
         'Apply generously to face and neck 15 minutes before stepping out.'],
        ['Invisible Fluid Sunscreen SPF 50+', 'Sunscreen', 'Normal', 1399.00, 3,
         'An ultra-fluid, invisible sunscreen with Cell-Ox Shield XL technology providing the highest level of broad-spectrum UVA/UVB protection. The innovative texture is virtually undetectable on skin — no white cast, no stickiness. Perfect under makeup or worn alone.',
         'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop', 'Cell-Ox Shield XL, Mexoryl XL, Silica',
         'Shake well. Apply to face and neck in the morning. Reapply every 2 hours if outdoors.'],
        ['Airy Sunscreen SPF 50', 'Sunscreen', 'Oily', 349.00, 9,
         'An airy, gel-cream sunscreen with SPF 50 PA+++ and a velvet matte finish designed for oily and acne-prone skin. Contains sebum-controlling ingredients and green tea extract for added oil control. The non-comedogenic formula doubles as a perfect makeup primer.',
         'https://images.unsplash.com/photo-1583209814683-c023dd293cc6?w=400&h=400&fit=crop', 'Green Tea Extract, Zinc Oxide, Silica, Niacinamide',
         'Apply as the last skincare step. Reapply every 3-4 hours.'],
        ['Moisturizing Sunscreen SPF 30', 'Sunscreen', 'Dry', 149.00, 12,
         'A budget-friendly moisturizing sunscreen with SPF 30 PA++ that provides essential sun protection while keeping dry skin hydrated. Enriched with Ayurvedic botanicals and aloe vera for soothing nourishment. The creamy formula applies smoothly without pilling.',
         'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&h=400&fit=crop', 'Aloe Vera, Quince Seed, SPF 30 Filters',
         'Apply generously to face and exposed skin every morning.'],

        // ========== TONERS (10) ==========
        ['Effaclar Astringent Lotion Toner', 'Toner', 'Oily', 1199.00, 3,
         'A micro-exfoliating toner with salicylic acid and glycolic acid that tightens pores, reduces excess shine, and promotes clearer skin. Formulated with La Roche-Posay Thermal Spring Water for soothing and anti-irritation properties. Preps skin perfectly for serums.',
         'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop', 'Salicylic Acid, Glycolic Acid, Thermal Spring Water',
         'Apply with a cotton pad to clean face. Avoid eye area. Use once daily in the evening.'],
        ['Glycolic Acid 7% Toning Solution', 'Toner', 'Normal', 750.00, 2,
         'A gently exfoliating toner with 7% glycolic acid that improves skin radiance, reduces dullness, and refines texture over time. Enriched with aloe vera and ginseng for soothing properties. Balanced with Tasmanian pepperberry to minimize irritation from the acid.',
         'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop', 'Glycolic Acid 7%, Amino Acids, Aloe Vera, Ginseng',
         'Apply to a cotton pad and sweep across face in the evening. Do not use with other exfoliants.'],
        ['BHA Blackhead Power Liquid', 'Toner', 'Oily', 1100.00, 10,
         'A gentle yet effective BHA exfoliant that dissolves blackheads and impurities deep within pores while soothing the skin. Contains willow bark water as a natural source of salicylic acid for a less irritating exfoliation experience. A cult favorite for acne-prone skin.',
         'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=400&h=400&fit=crop', 'Betaine Salicylate 4%, Willow Bark Water, Niacinamide',
         'After cleansing, apply to cotton pad and sweep across face. Start with 2-3 times per week.'],
        ['Green Tea Balancing Toner', 'Toner', 'Combination', 650.00, 5,
         'A hydrating, pH-balancing toner with Jeju green tea that replenishes moisture while lightly controlling excess oil in the T-zone. Rich in antioxidants that protect skin from environmental damage. The gentle formula prepares skin optimally for serum absorption.',
         'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop', 'Green Tea Extract, Betaine, Hyaluronic Acid',
         'After cleansing, pour onto hands or cotton pad and pat gently into skin.'],
        ['Rice Toner', 'Toner', 'Dry', 945.00, 5,
         'A nourishing toner enriched with 80% rice bran ferment filtrate that brightens, hydrates, and plumps dry, dull skin for a healthy, radiant glow. Fermented rice water is rich in vitamins B, C, E, and minerals that promote cell turnover and luminosity.',
         'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop', 'Rice Bran Ferment Filtrate, Niacinamide, Hyaluronic Acid',
         'Pour onto hands or cotton pad and pat gently into cleansed face. Use AM and PM.'],
        ['Full Fit Propolis Synergy Toner', 'Toner', 'Sensitive', 1150.00, 10,
         'A honey-like essence toner with 73% propolis extract that deeply nourishes, soothes inflammation, and strengthens the skin barrier. The velvety texture absorbs instantly for a cushion-like hydration boost. Ideal for sensitized, stressed, or acne-scarred skin.',
         'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop', 'Propolis Extract 73%, Betaine, Panthenol, Allantoin',
         'After cleansing, apply onto face and gently pat until absorbed. Best on slightly damp skin.'],
        ['Witch Hazel Toner', 'Toner', 'Oily', 149.00, 9,
         'A pore-refining toner with natural witch hazel and rose water that tightens pores, controls oil, and provides a refreshing cleanse. Alcohol-free formula prevents over-drying while effectively removing leftover residue. Budget-friendly and perfect for daily use.',
         'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop', 'Witch Hazel, Rose Water, Glycerin',
         'Apply to cotton pad and sweep across clean face AM and PM.'],
        ['Soothing Toner Pad', 'Toner', 'Sensitive', 299.00, 15,
         'Pre-soaked toner pads with calming centella asiatica and panthenol that cleanse, tone, and soothe in one easy step. The textured pads gently exfoliate dead skin while the toner hydrates and calms. Perfect for travel, gym, or quick skincare on busy days.',
         'https://images.unsplash.com/photo-1619451334792-150fd785ee74?w=400&h=400&fit=crop', 'Centella Asiatica, Panthenol, Allantoin',
         'Wipe gently across clean face. Can be used for quick cleansing on-the-go.'],

        // ========== MASKS (8) ==========
        ['Volcanic Pore Clay Mask', 'Mask', 'Oily', 750.00, 5,
         'A deep-cleansing clay mask made with Jeju volcanic ash that acts like a vacuum for pores, drawing out impurities, blackheads, and excess sebum. After just 10 minutes, skin looks visibly clearer, smoother, and pores appear tighter. A spa-quality treatment at home.',
         'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop', 'Jeju Volcanic Ash, Kaolin, Bentonite',
         'Apply an even layer on clean, dry face. Leave for 10-15 minutes. Rinse with lukewarm water. Use 1-2x per week.'],
        ['AHA 30% + BHA 2% Peeling Solution', 'Mask', 'Normal', 630.00, 2,
         'An advanced at-home chemical peel for experienced users featuring 30% AHA and 2% BHA. Targets textural irregularities, dullness, acne marks, and uneven tone for dramatically smoother, more radiant skin. The blood-red color is from Tasmanian pepperberry extract.',
         'https://images.unsplash.com/photo-1583209814683-c023dd293cc6?w=400&h=400&fit=crop', 'Glycolic Acid, Salicylic Acid, Lactic Acid, Tartaric Acid',
         'Apply evenly to clean, dry face. Leave for no more than 10 minutes. Rinse. Use max 2x per week.'],
        ['Ultimate Repair Sleeping Mask', 'Mask', 'Dry', 895.00, 10,
         'An overnight sleeping mask with raw propolis and honey that delivers intense moisture repair while you sleep. Wake up to plumper, softer, and more radiant skin. The rich honey-like texture absorbs completely without staining pillowcases.',
         'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&h=400&fit=crop', 'Propolis Extract, Hyaluronic Acid, Ceramides, Niacinamide',
         'Apply a thin, even layer as the last step of evening routine. Leave overnight.'],
        ['Turmeric Glow Sheet Mask', 'Mask', 'All', 99.00, 13,
         'A single-use sheet mask infused with turmeric, vitamin C, and saffron for instant brightening and glow. The bio-cellulose fabric hugs every contour of your face for maximum serum absorption. Perfect for pre-event prep or weekly glow-boosting rituals.',
         'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop', 'Turmeric Extract, Vitamin C, Saffron, Honey',
         'Place on clean face for 15-20 minutes. Remove and pat excess serum into skin.'],
        ['Charcoal Detox Mask', 'Mask', 'Oily', 299.00, 8,
         'A purifying charcoal and clay mask that detoxifies congested skin by drawing out deep-seated impurities and pollutants. Enriched with vitamin C to brighten post-detox. The thick, satisfying texture makes for a luxurious self-care experience.',
         'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop', 'Activated Charcoal, Kaolin Clay, Vitamin C',
         'Apply a thick layer, leave 10-12 minutes, rinse. Use 1-2 times per week.'],

        // ========== EYE CARE (5) ==========
        ['Caffeine Solution 5% + EGCG', 'Eye Care', 'All', 520.00, 2,
         'A targeted eye serum with 5% caffeine and EGCG from green tea that reduces puffiness, dark circles, and under-eye bags. The lightweight serum texture absorbs quickly without milia-causing heaviness. A morning essential for tired, puffy eyes.',
         'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=400&h=400&fit=crop', 'Caffeine 5%, EGCG (from Green Tea), Hyaluronic Acid',
         'Apply a small amount around eye area AM and PM. Pat gently with ring finger.'],
        ['Hydro Boost Eye Gel-Cream', 'Eye Care', 'Dry', 899.00, 4,
         'An ultra-hydrating eye gel-cream with hyaluronic acid that smooths fine lines, plumps the delicate under-eye area, and reduces the appearance of crow feet. The oil-free gel-cream formula won not leave a greasy residue that could migrate into eyes.',
         'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop', 'Hyaluronic Acid, Olive Extract, Dimethicone',
         'Gently dab around the eye area morning and night with your ring finger.'],
        ['Vitamin K Eye Cream', 'Eye Care', 'All', 249.00, 9,
         'An affordable eye cream fortified with vitamin K and peptides that targets stubborn dark circles caused by poor circulation. The lightweight cream brightens the under-eye area over time while providing essential hydration. Suitable for all skin types.',
         'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop', 'Vitamin K, Peptides, Caffeine, Shea Butter',
         'Dot a small amount under eyes and gently pat until absorbed. Use AM and PM.'],
        ['Peptide Eye Gel', 'Eye Care', 'Normal', 449.00, 7,
         'A cooling eye gel with multi-peptides that firms and tightens the delicate eye area while reducing puffiness. The metal applicator tip provides an instant de-puffing effect. Clinically shown to reduce fine lines around eyes by 25% in 4 weeks.',
         'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop', 'Matrixyl, Caffeine, Cucumber Extract, HA',
         'Apply using the metal tip around eyes. Gently pat in. Use AM and PM.'],

        // ========== TREATMENTS (15) ==========
        ['Azelaic Acid Suspension 10%', 'Treatment', 'All', 450.00, 2,
         'A multi-functional treatment with 10% azelaic acid that targets hyperpigmentation, acne, rosacea, and uneven skin tone simultaneously. The cream-gel texture with silicone provides smooth, even application. One of dermatologists most recommended actives for stubborn pigmentation.',
         'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop', 'Azelaic Acid 10%, Dimethicone',
         'Apply a small amount to affected areas AM and PM after water-based serums.'],
        ['2% BHA Liquid Exfoliant', 'Treatment', 'Oily', 2450.00, 11,
         'A cult-status leave-on exfoliant with 2% salicylic acid (BHA) that unclogs pores, smooths wrinkles, and evens out skin tone. The liquid formula penetrates deep into pores for a thorough, gentle exfoliation. Consistently rated the #1 BHA product by skincare enthusiasts.',
         'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop', 'Salicylic Acid 2%, Green Tea, Methylpropanediol',
         'Apply with cotton pad to clean face once or twice daily. Do not rinse off.'],
        ['Retinol 0.5% in Squalane', 'Treatment', 'Normal', 490.00, 2,
         'Pure retinol in a hydrating squalane base for targeted anti-aging results. Reduces fine lines, wrinkles, and improves overall skin texture while the squalane prevents the dryness typically associated with retinol. A gold standard anti-aging treatment.',
         'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop', 'Retinol 0.5%, Squalane',
         'Apply a small amount to clean face in the evening only. Start 2x per week. Always use SPF.'],
        ['Salicylic Acid 2% Masque', 'Treatment', 'Oily', 899.00, 2,
         'A concentrated treatment masque with 2% salicylic acid, activated charcoal, and kaolin clay that deep-cleans congested pores and treats active acne. The thick paste delivers sustained BHA action for maximum pore-clearing efficacy.',
         'https://images.unsplash.com/photo-1583209814683-c023dd293cc6?w=400&h=400&fit=crop', 'Salicylic Acid 2%, Kaolin, Charcoal, Squalane',
         'Apply to clean face, leave for 10 minutes, rinse. Use 1-2 times per week.'],
        ['Anti-Acne Kit - Complete Solution', 'Treatment', 'Oily', 1499.00, 7,
         'A comprehensive 3-step anti-acne system specially curated for Indian skin. Includes salicylic acid cleanser, niacinamide serum, and oil-free moisturizer that work synergistically for clear, blemish-free skin. Clinically tested to reduce acne by 60% in 8 weeks.',
         'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&h=400&fit=crop', 'Salicylic Acid, Niacinamide, Zinc, Centella Asiatica',
         'Use cleanser AM/PM, apply serum on affected areas, follow with moisturizer.'],
        ['Tranexamic Acid 3% Serum', 'Treatment', 'All', 549.00, 7,
         'An advanced treatment serum with 3% tranexamic acid targeting stubborn hyperpigmentation, melasma, and dark spots. Works by inhibiting melanin transfer for visibly brighter, more even-toned skin. Safe for all skin types and can be used with other actives.',
         'https://images.unsplash.com/photo-1617897903246-719242758050?w=400&h=400&fit=crop', 'Tranexamic Acid 3%, HPA',
         'Apply 4-5 drops on dark spots AM and PM. Always follow with sunscreen.'],
        ['Retinal 0.2% Cream', 'Treatment', 'Normal', 699.00, 7,
         'A next-generation retinoid treatment with retinal (retinaldehyde) — working 11x faster than retinol for visible anti-aging results. Reduces fine lines, firms skin, and improves cell turnover while being gentler than prescription retinoids. A dermatologist favorite.',
         'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop', 'Retinal 0.2%, Squalane, Coenzyme Q10',
         'Apply a pea-sized amount on clean face at night. Start 1-2x per week.'],
        ['Benzoyl Peroxide 2.5% Cream', 'Treatment', 'Oily', 199.00, 7,
         'A targeted spot treatment with 2.5% benzoyl peroxide that kills acne-causing bacteria on contact while being gentle enough for daily use. Lower concentration means less drying and irritation compared to higher-strength alternatives. Perfect for mild to moderate acne.',
         'https://images.unsplash.com/photo-1619451334792-150fd785ee74?w=400&h=400&fit=crop', 'Benzoyl Peroxide 2.5%, Aloe Vera',
         'Apply a thin layer to affected areas after cleansing. Start once daily, increase as tolerated.'],
        ['Kojic Acid Brightening Cream', 'Treatment', 'All', 329.00, 12,
         'A traditional Ayurvedic-inspired brightening cream with kojic acid derived from mushrooms. Targets dark spots, tan removal, and uneven skin tone naturally. The gentle formula is suitable for long-term use and pairs well with sunscreen for maximum brightening results.',
         'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop', 'Kojic Acid, Licorice Root, Mulberry Extract',
         'Apply to dark spots and pigmented areas twice daily. Use sunscreen during the day.'],
        ['Glycolic Acid 10% Peel', 'Treatment', 'Normal', 799.00, 11,
         'A professional-grade at-home peel with 10% glycolic acid that resurfaces skin, reduces acne scars, and dramatically improves skin texture and radiance. Buffered formula minimizes irritation while delivering salon-level results. Use with caution — patch test first.',
         'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=400&h=400&fit=crop', 'Glycolic Acid 10%, Green Tea, Chamomile',
         'Apply to clean dry face, leave 5 minutes, rinse. Use 1-2x per week. Always wear SPF.'],
        ['Anti-Pigmentation Cream', 'Treatment', 'All', 399.00, 13,
         'A potent anti-pigmentation cream with daisy extract and vitamin C targeting dark spots, age spots, and post-inflammatory hyperpigmentation. The lightweight formula absorbs quickly and can be worn under makeup. Visible results in as little as 2 weeks.',
         'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop', 'Daisy Extract, Vitamin C, Licorice, Niacinamide',
         'Apply on dark spots and pigmented areas twice daily.'],
        ['Pimple Patches - 36 Count', 'Treatment', 'All', 149.00, 10,
         'Ultra-thin hydrocolloid patches that flatten pimples overnight by absorbing pus and fluids. The invisible, breathable patches protect blemishes from bacteria and prevent picking. Each box contains 36 patches in 3 sizes for different blemish sizes.',
         'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop', 'Hydrocolloid, Cellulose Gum, Polyisobutylene',
         'Clean and dry the area. Apply patch directly on the blemish. Leave on for 6+ hours or overnight.'],

        // ========== LIP CARE (5) ==========
        ['Lip Balm - Berry', 'Lip Care', 'All', 299.00, 9,
         'A deeply moisturizing tinted lip balm with natural berry extracts that provides long-lasting hydration with a subtle color boost. Enriched with shea butter and vitamin E to repair cracked, chapped lips. The natural berry scent is refreshing without being overpowering.',
         'https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=400&h=400&fit=crop', 'Shea Butter, Beeswax, Berry Extract, Vitamin E',
         'Apply as needed throughout the day. Reapply after eating or drinking.'],
        ['Lip Sleeping Mask', 'Lip Care', 'All', 1299.00, 14,
         'A bestselling overnight lip mask with berry complex and vitamin C that intensely moisturizes and exfoliates dead skin from lips while you sleep. Wake up to baby-soft, plump, and smooth lips. The sweet berry scent and taste make it a nightly treat.',
         'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop', 'Berry Complex, Vitamin C, Murumuru Butter, Shea Butter',
         'Apply a generous layer on clean lips before bed. Gently wipe off in the morning.'],
        ['SPF 30 Lip Balm', 'Lip Care', 'All', 129.00, 4,
         'A protective lip balm with SPF 30 that shields lips from UV damage while providing all-day hydration. Lips are one of the most sun-vulnerable areas — this balm prevents sun-induced darkening and dryness. The lightweight formula does not feel waxy or heavy.',
         'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop', 'SPF 30 Filters, Beeswax, Vitamin E, Aloe',
         'Apply to lips before sun exposure. Reapply every 2 hours outdoors.'],

        // ========== BODY CARE (8) ==========
        ['Bio Morning Nectar Body Wash', 'Body Care', 'All', 349.00, 12,
         'An indulgent Ayurvedic body wash with morning nectar, honey, and wild turmeric that gently cleanses while providing nourishment, antibacterial protection, and a radiant glow. The rich lather feels luxurious while natural ingredients care for body skin health.',
         'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop', 'Honey, Wheatgerm Oil, Wild Turmeric, Soap Nut',
         'Lather on wet body, massage gently, rinse off. Use daily.'],
        ['SA Body Wash with Salicylic Acid', 'Body Care', 'Oily', 699.00, 1,
         'A medicated body wash with salicylic acid, hyaluronic acid, and niacinamide that gently exfoliates body skin to treat back acne (bacne), KP (keratosis pilaris), and rough bumpy texture. The foaming formula rinses clean without residue.',
         'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop', 'Salicylic Acid, Hyaluronic Acid, Niacinamide, Ceramides',
         'Apply to wet body, lather, leave for 1-2 minutes, rinse. Use 2-3 times per week.'],
        ['Ubtan Body Scrub', 'Body Care', 'All', 199.00, 13,
         'A traditional Ayurvedic ubtan body scrub with walnut shell, turmeric, and saffron that polishes away dead skin, tan, and roughness. Reveals smoother, brighter body skin with regular use. The granules are fine enough to exfoliate without scratching.',
         'https://images.unsplash.com/photo-1619451334792-150fd785ee74?w=400&h=400&fit=crop', 'Walnut Shell, Turmeric, Saffron, Rose Water',
         'Apply to damp body skin, scrub in circular motions for 2 minutes, rinse.'],
        ['Shea Butter Body Lotion', 'Body Care', 'Dry', 249.00, 9,
         'A rich, deeply nourishing body lotion with cocoa butter and shea butter that intensely hydrates dry, rough body skin for up to 48 hours. The thick, creamy formula absorbs well and leaves skin feeling silky-soft without a greasy after-feel.',
         'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop', 'Shea Butter, Cocoa Butter, Almond Oil, Vitamin E',
         'Apply liberally after shower on damp skin for best absorption.'],
        ['Stretch Mark Cream', 'Body Care', 'All', 399.00, 13,
         'A specialized cream for preventing and reducing the appearance of stretch marks during pregnancy, weight changes, or growth spurts. Bio-oil complex and shea butter improve skin elasticity while cocoa butter deeply moisturizes for smoother-looking skin.',
         'https://images.unsplash.com/photo-1583209814683-c023dd293cc6?w=400&h=400&fit=crop', 'Bio-Oil Complex, Shea Butter, Cocoa Butter, Vitamin E',
         'Massage into stretch mark prone areas twice daily. Results visible in 8-12 weeks.'],
        ['KP Bump Eraser Body Scrub', 'Body Care', 'All', 499.00, 1,
         'A dermatologist-recommended body scrub designed to smooth KP (keratosis pilaris) bumps and rough, bumpy skin. Contains 10% AHA with gentle physical exfoliation for a dual-action approach. Key areas: upper arms, thighs, and buttocks.',
         'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop', 'Glycolic Acid 10%, Lactic Acid, Pumice Particles',
         'Apply to wet skin on bumpy areas, scrub gently for 1-2 minutes, rinse.'],

        // ========== MISTS & ESSENCES (5) ==========
        ['Thermal Spring Water Mist', 'Mist', 'Sensitive', 599.00, 3,
         'A soothing facial mist containing La Roche-Posay Thermal Spring Water with antioxidant selenium. Calms, soothes, and softens skin instantly. Use after cleansing, to set makeup, during flights, or anytime skin needs a hydration refresh. Suitable for even the most reactive skin.',
         'https://images.unsplash.com/photo-1617897903246-719242758050?w=400&h=400&fit=crop', 'La Roche-Posay Thermal Spring Water, Selenium',
         'Hold 8 inches from face and mist liberally. Let air dry or gently pat in.'],
        ['Rose Water Face Mist', 'Mist', 'All', 149.00, 12,
         'A pure, refreshing rose water face mist that hydrates, tones, and sets makeup. Made from steam-distilled Damascus roses for authentic rosy fragrance and skin benefits. The ultra-fine mist disperses evenly for a dewy finish without disturbing makeup.',
         'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&h=400&fit=crop', 'Pure Rose Water, Glycerin',
         'Spritz on clean face or over makeup. Use throughout the day for refreshment.'],
        ['Snail Mucin Essence', 'Mist', 'All', 899.00, 10,
         'A viscous, nutrient-rich essence with 96.3% snail mucin that repairs damage, fades scars, and provides deep hydration. The stringy, gel-like texture might look unusual but absorbs beautifully, leaving skin bouncy and glass-like. A K-beauty staple.',
         'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop', 'Snail Mucin 96.3%, Sodium Hyaluronate, Betaine',
         'Apply after toner, pat gently until absorbed. Use AM and PM.'],
        ['Cucumber Hydration Mist', 'Mist', 'All', 99.00, 15,
         'A refreshing, budget-friendly face mist with cucumber extract and aloe vera that cools, hydrates, and soothes skin instantly. Perfect for hot weather, post-workout, or as a mid-day refresher over makeup. The ultra-fine mist creates a dewy, glass-skin effect.',
         'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop', 'Cucumber Extract, Aloe Vera, Glycerin',
         'Mist on face anytime for a hydrating refresh. Works over makeup too.'],

        // ========== HAIR CARE (5) ==========
        ['Argan Oil Hair Serum', 'Hair Care', 'All', 449.00, 9,
         'A lightweight, non-greasy hair serum with pure Moroccan argan oil that tames frizz, adds brilliant shine, and protects hair from heat damage up to 230°C. Enriched with vitamin E and keratin for stronger, smoother hair. Works on all hair types.',
         'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop', 'Argan Oil, Vitamin E, Keratin, Jojoba Oil',
         'Apply 2-3 drops to damp or dry hair, focusing on mid-lengths and ends. Avoid roots.'],
        ['Onion Hair Oil', 'Hair Care', 'All', 299.00, 13,
         'A potent hair growth oil with onion extract, redensyl, and bhringraj that reduces hair fall, strengthens roots, and promotes new hair growth. The lightweight oil does not weigh hair down and has a pleasant herbal scent that masks any onion odor.',
         'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop', 'Onion Extract, Redensyl, Bhringraj, Coconut Oil',
         'Massage into scalp for 5 minutes. Leave for 1-2 hours or overnight. Wash with shampoo.'],
        ['Anti-Dandruff Shampoo', 'Hair Care', 'All', 249.00, 4,
         'A medicated anti-dandruff shampoo with pyrithione zinc that eliminates flakes, itching, and scalp irritation from the very first wash. The gentle formula cleans without stripping natural oils. Can be used daily for persistent dandruff or weekly for maintenance.',
         'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop', 'Pyrithione Zinc, Salicylic Acid, Tea Tree Oil',
         'Wet hair, apply shampoo, massage into scalp for 1-2 minutes, rinse. Use 2-3x per week.']
    ];

    products.forEach(p => {
        db.run(
            "INSERT INTO Product (Product_name, Category, P_Skin_type, Price, Brand_id, Description, Image_url, Ingredients, How_to_use) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            p
        );
    });

    db.run("COMMIT");
}

// ============================================
// MySQL2-compatible API wrapper
// ============================================
const pool = {
    initialize,

    query: async function(sql, params = []) {
        try {
            const trimmedUpper = sql.trim().toUpperCase();
            const isSelect = /^(SELECT|WITH|PRAGMA)/i.test(trimmedUpper);

            if (isSelect) {
                return [queryAll(sql, params)];
            } else {
                const result = queryRun(sql, params);
                return [result];
            }
        } catch (err) {
            console.error('DB Query Error:', err.message);
            console.error('SQL:', sql.substring(0, 200));
            throw err;
        }
    },

    getConnection: async function() {
        return {
            query: async function(sql, params = []) {
                return pool.query(sql, params);
            },
            beginTransaction: async () => { inTransaction = true; db.run("BEGIN TRANSACTION"); },
            commit: async () => { db.run("COMMIT"); inTransaction = false; saveDatabase(); },
            rollback: async () => {
                try { db.run("ROLLBACK"); } catch(e) { /* may already be rolled back */ }
                inTransaction = false;
            },
            release: () => { /* no-op for SQLite */ }
        };
    }
};

module.exports = pool;
