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
        // Check if we need to upgrade to 150+ products (only for existing DBs)
        const prodResult = db.exec("SELECT COUNT(*) as c FROM Product");
        const prodCount = prodResult[0]?.values[0][0] || 0;
        if (prodCount < 140) {
            console.log('📦 Upgrading product catalog to 150+ face products...');
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
// Seed Data — 150+ FACE-ONLY products
// ============================================
function seedDatabase() {
    db.run("BEGIN TRANSACTION");

    // ----- Category-specific product images (curated from Unsplash — face skincare only) -----
    const categoryImages = {
        Cleanser: [
            'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1609097154293-1d04b5e8184d?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1619451334792-150fd785ee74?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1585652757141-8837d023e12a?w=400&h=400&fit=crop'
        ],
        Serum: [
            'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1583209814683-c023dd293cc6?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1617897903246-719242758050?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1576426863848-c21f53c60b19?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop'
        ],
        Moisturizer: [
            'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1617897903246-719242758050?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=400&h=400&fit=crop'
        ],
        Sunscreen: [
            'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1619451334792-150fd785ee74?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1583209814683-c023dd293cc6?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1585652757141-8837d023e12a?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1576426863848-c21f53c60b19?w=400&h=400&fit=crop'
        ],
        Toner: [
            'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop'
        ],
        Mask: [
            'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1583209814683-c023dd293cc6?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop'
        ],
        'Eye Care': [
            'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop'
        ],
        Treatment: [
            'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1583209814683-c023dd293cc6?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1617897903246-719242758050?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&h=400&fit=crop'
        ],
        'Lip Care': [
            'https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&h=400&fit=crop'
        ],
        Mist: [
            'https://images.unsplash.com/photo-1617897903246-719242758050?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop',
            'https://images.unsplash.com/photo-1570194065650-d99fb4ee6420?w=400&h=400&fit=crop'
        ]
    };

    const imageCounters = {};
    function getImg(category) {
        const pool = categoryImages[category] || categoryImages.Cleanser;
        if (!imageCounters[category]) imageCounters[category] = 0;
        const img = pool[imageCounters[category] % pool.length];
        imageCounters[category]++;
        return img;
    }

    // ===== 20 Brands =====
    const brands = [
        ['CeraVe', 'USA'], ['The Ordinary', 'Canada'], ['La Roche-Posay', 'France'],
        ['Neutrogena', 'USA'], ['Innisfree', 'South Korea'], ['Cetaphil', 'USA'],
        ['Minimalist', 'India'], ['Dot & Key', 'India'], ['Plum', 'India'],
        ['COSRX', 'South Korea'], ["Paula's Choice", 'USA'], ['Biotique', 'India'],
        ['Mamaearth', 'India'], ['Laneige', 'South Korea'], ['Simple', 'UK'],
        ["Re'equil", 'India'], ['The Derma Co', 'India'], ['Pilgrim', 'India'],
        ['Aqualogica', 'India'], ['Fixderma', 'India']
    ];
    brands.forEach(b => db.run("INSERT INTO Brand (Brand_name, Country) VALUES (?, ?)", b));

    // ===== 155+ Face-Only Products =====
    // Format: [name, category, skinType, price, brandId, description, ingredients, howToUse]
    const products = [
        // ==================== CLEANSERS (20) ====================
        ['Hydrating Facial Cleanser', 'Cleanser', 'Dry', 899, 1,
         'Gentle, non-foaming cleanser with ceramides and hyaluronic acid. Removes dirt and makeup while locking in moisture for dry, compromised skin.',
         'Ceramides, Hyaluronic Acid, Glycerin, Phytosphingosine',
         'Wet face. Massage a small amount onto skin. Rinse with lukewarm water. Use AM and PM.'],
        ['Foaming Facial Cleanser', 'Cleanser', 'Oily', 799, 1,
         'Oil-free foaming cleanser with niacinamide and ceramides. Dissolves excess oil without disrupting the skin barrier.',
         'Niacinamide, Ceramides, Hyaluronic Acid',
         'Wet face with lukewarm water. Apply and gently massage. Rinse thoroughly. Use AM and PM.'],
        ['Squalane Cleanser', 'Cleanser', 'All', 650, 2,
         'Emollient balm-to-milk cleanser powered by squalane. Melts away makeup, sunscreen, and impurities while moisturizing.',
         'Squalane, Sucrose Esters, Sorbitan Laurate',
         'Apply to dry face, massage 60 seconds, emulsify with water and rinse off.'],
        ['Toleriane Purifying Foaming Cleanser', 'Cleanser', 'Sensitive', 1299, 3,
         'Soap-free foaming cleanser for sensitive, oily skin. Fortified with Thermal Spring Water and Ceramide-3.',
         'Niacinamide, Ceramide-3, Thermal Spring Water',
         'Apply to damp face, lather gently, rinse with water. Avoid eye area.'],
        ['Green Tea Cleansing Foam', 'Cleanser', 'Combination', 550, 5,
         'Refreshing daily cleanser with 16 amino acids and Jeju green tea extract. Purifies and controls sebum.',
         'Green Tea Extract, Amino Acids, Betaine',
         'Create lather in hands, apply to damp face, massage 30 seconds, rinse.'],
        ['Gentle Skin Cleanser', 'Cleanser', 'Sensitive', 599, 6,
         'Ultra-gentle, soap-free cleanser trusted by dermatologists for 70+ years. pH-balanced and non-irritating.',
         'Cetyl Alcohol, Propylene Glycol, Sodium Lauryl Sulfate (mild)',
         'Apply to damp skin, massage gently, rinse or wipe off with a soft cloth.'],
        ['Micellar Cleansing Water', 'Cleanser', 'All', 199, 15,
         'No-rinse cleansing water with micelle technology. Lifts dirt, oil, and makeup without tightness.',
         'Micellar Technology, Vitamin B3, Pro-Vitamin B5',
         'Soak a cotton pad and gently wipe across face, eyes, and lips. No rinsing needed.'],
        ['Tea Tree Face Wash', 'Cleanser', 'Oily', 349, 13,
         'Gel-based face wash with tea tree oil and neem extract. Fights acne-causing bacteria while cleansing.',
         'Tea Tree Oil, Neem Extract, Aloe Vera',
         'Lather between palms, apply to wet face, massage 30 seconds, rinse.'],
        ['Salicylic Acid Cleanser', 'Cleanser', 'Oily', 399, 7,
         'Gel cleanser with 1% salicylic acid for deep pore cleansing. Dissolves excess oil and dead skin cells.',
         'Salicylic Acid 1%, Zinc, LHA',
         'Use on wet face, massage gently for 1 minute, rinse. Use AM and PM.'],
        ['Rice Water Cleanser', 'Cleanser', 'Normal', 449, 5,
         'Brightening cleanser with fermented rice water from Jeju Island. Evens skin tone and removes impurities.',
         'Rice Bran Water, Ceramides, Moringa Oil',
         'Apply to damp skin in circular motions, rinse with lukewarm water.'],
        ['Oil-to-Foam Cleanser', 'Cleanser', 'Dry', 299, 9,
         'Luxurious oil-based cleanser that transforms into foam with water. Dissolves makeup and SPF while nourishing.',
         'Olive Oil, Macadamia Oil, Chamomile Extract',
         'Apply to dry face, massage, add water to emulsify, rinse clean.'],
        ['Charcoal Deep Pore Cleanser', 'Cleanser', 'Oily', 249, 13,
         'Activated charcoal cleanser that draws out dirt and toxins from pores. Enriched with clay for gentle exfoliation.',
         'Activated Charcoal, Kaolin Clay, Walnut Shell',
         'Apply to wet face, massage 1 minute focusing on T-zone. Rinse well.'],
        ['Low pH Good Morning Gel Cleanser', 'Cleanser', 'All', 470, 10,
         'Mildly acidic gel cleanser with tea tree oil and BHA. Cleanses gently without stripping moisture barrier.',
         'Tea Tree Oil, BHA, Allantoin',
         'Lather with water, massage onto face for 30 seconds, rinse.'],
        ['Oil Control Face Wash', 'Cleanser', 'Oily', 450, 16,
         'Advanced face wash that controls excess oil for 6-8 hours. Zinc PCA reduces sebum without over-drying.',
         'Zinc PCA, Niacinamide, Willow Bark Extract',
         'Apply to wet face, massage for 1 minute, rinse with cool water. Use AM and PM.'],
        ['1% Salicylic Acid Gel Face Wash', 'Cleanser', 'Oily', 349, 17,
         'Dermatologist-formulated gel face wash with 1% salicylic acid. Clears active acne and prevents new breakouts.',
         'Salicylic Acid 1%, Glycolic Acid, Zinc',
         'Apply small amount on wet face, massage gently, rinse. Use twice daily.'],
        ['Mild Face Wash with Vitamin C', 'Cleanser', 'Normal', 395, 18,
         'Gentle daily face wash with vitamin C and AHA for subtle brightening. Removes impurities without dryness.',
         'Vitamin C, AHA, Aloe Vera, Glycerin',
         'Take coin-sized amount, lather, apply to damp face, massage, and rinse.'],
        ['Glow+ Smoothie Face Wash', 'Cleanser', 'All', 299, 19,
         'Creamy face wash with papaya and vitamin C that gently exfoliates for an instant glow. Suitable for all skin types.',
         'Papaya Extract, Vitamin C, Niacinamide',
         'Apply to damp face, massage 30 seconds, rinse. Use daily AM and PM.'],
        ['Vitamin C+E Super Bright Face Wash', 'Cleanser', 'Normal', 345, 8,
         'Brightening face wash with stable vitamin C and vitamin E. Removes dullness and reveals radiant skin.',
         'Vitamin C, Vitamin E, Orange Peel Extract',
         'Wet face, apply a small amount, massage gently, rinse with water.'],
        ['Cleovera Cleansing Lotion', 'Cleanser', 'Sensitive', 320, 20,
         'Soap-free, pH-balanced cleansing lotion for sensitive and acne-prone skin. Calms irritation while cleansing.',
         'Aloe Vera, Allantoin, Glycerin',
         'Apply on damp face, massage gently, rinse off. Suitable for daily use.'],
        ['Pore Normalizing Cleanser', 'Cleanser', 'Combination', 1850, 11,
         'Premium cleanser that minimizes enlarged pores and removes excess oil. Leaves skin feeling clean, not tight.',
         'Salicylic Acid, Ceramides, Hyaluronic Acid',
         'Apply to wet skin, massage 1 minute, rinse. Best used AM and PM.'],

        // ==================== MOISTURIZERS (18) ====================
        ['Moisturizing Cream', 'Moisturizer', 'Dry', 999, 1,
         'Rich, non-greasy moisturizer with 3 ceramides and MVE technology for 24-hour hydration. Restores skin barrier.',
         'Ceramides 1,3,6-II, Hyaluronic Acid, MVE Technology',
         'Apply liberally on face as needed. Suitable for morning and night.'],
        ['Natural Moisturizing Factors + HA', 'Moisturizer', 'Normal', 590, 2,
         'Lightweight moisturizer that mirrors skin natural moisturizing factors. Non-greasy protective barrier.',
         'Hyaluronic Acid, Amino Acids, Ceramides, Triglycerides',
         'Apply a small amount to face after serums, morning and night.'],
        ['Aqua Cica Moisturizer', 'Moisturizer', 'Sensitive', 845, 8,
         'Soothing gel-cream with CICA (Centella Asiatica) that calms irritated skin. Blue spirulina reduces redness.',
         'Centella Asiatica, Hyaluronic Acid, Blue Spirulina, Niacinamide',
         'Take a pea-sized amount and apply evenly on cleansed face.'],
        ['Oil-Free Moisturizer SPF 25', 'Moisturizer', 'Oily', 749, 4,
         'Lightweight oil-free daily moisturizer with SPF 25. Hydrates without clogging pores or adding shine.',
         'Glycerin, Helioplex Technology, Dimethicone',
         'Apply after cleanser in the morning. Reapply if outdoors.'],
        ['Green Tea Seed Cream', 'Moisturizer', 'Combination', 1250, 5,
         'Nourishing cream with cold-pressed Jeju green tea seed oil. Intense moisture for dry zones, balanced for oily.',
         'Green Tea Seed Oil, Green Tea Extract, Squalane',
         'Apply evenly to face as the last step of skincare routine.'],
        ['Aloe Hydra Cool Soothing Gel', 'Moisturizer', 'Sensitive', 299, 5,
         'Cooling gel moisturizer with 93% Jeju aloe vera extract. Calms irritated and sunburned skin instantly.',
         'Aloe Vera 93%, Centella Asiatica, Panthenol',
         'Apply generously on face. Can be used as emergency soothing treatment.'],
        ['Daily Moisturizing Lotion', 'Moisturizer', 'Normal', 549, 6,
         'Fast-absorbing daily lotion with macadamia nut oil and niacinamide for 24-hour hydration.',
         'Macadamia Nut Oil, Sweet Almond Oil, Glycerin, Niacinamide',
         'Apply to face after cleansing. Suitable for daily morning and night use.'],
        ['Water Sleeping Mask', 'Moisturizer', 'All', 1599, 14,
         'Cult-favorite overnight mask with sleep-biome technology. Delivers intense hydration for plump, dewy skin by morning.',
         'Squalane, Sunflower Seed Oil, Apricot Extract, Probiotics',
         'Apply generous layer as last step of evening routine. Rinse off in the morning.'],
        ['Vitamin E Moisturizing Cream', 'Moisturizer', 'Dry', 199, 12,
         'Nourishing cream with natural Vitamin E and wheatgerm oil. Repairs dry, damaged skin with lasting hydration.',
         'Vitamin E, Wheatgerm Oil, Wild Turmeric',
         'Apply on clean face and neck. Massage gently until absorbed. Use AM and PM.'],
        ['Oil-Free Moisture Gel', 'Moisturizer', 'Oily', 149, 9,
         'Ultra-light oil-free gel with green tea and aloe vera. Hydrates oily skin without shine or heaviness.',
         'Green Tea Extract, Aloe Vera, Hyaluronic Acid',
         'Apply a thin layer on clean face. Can be used under makeup.'],
        ['Ceramide Barrier Cream', 'Moisturizer', 'Sensitive', 399, 7,
         'Fragrance-free barrier repair cream with ceramides and squalane. Reduces redness and irritation within 24 hours.',
         'Ceramides, Squalane, Panthenol, Madecassoside',
         'Apply generously on affected areas. Layer for extra protection.'],
        ['Ceramide & HA Moisturizer', 'Moisturizer', 'Dry', 695, 16,
         'Advanced moisturizer with ceramide complex and hyaluronic acid for deep hydration and barrier repair.',
         'Ceramide Complex, Hyaluronic Acid, Shea Butter',
         'Apply on clean face after serum. Use AM and PM.'],
        ['1% Hyaluronic Acid Moisturizer', 'Moisturizer', 'Normal', 349, 17,
         'Lightweight gel moisturizer with 1% hyaluronic acid for instant hydration. Non-sticky, fast-absorbing.',
         'Hyaluronic Acid 1%, Vitamin E, Aloe Vera',
         'Apply a coin-sized amount on face and neck. Use AM and PM.'],
        ['Retinol Anti-Aging Night Cream', 'Moisturizer', 'Normal', 595, 18,
         'Night cream with encapsulated retinol that reduces fine lines and improves skin texture overnight.',
         'Retinol, Collagen Peptides, Hyaluronic Acid',
         'Apply at night on clean face. Start 2-3 times per week, increase gradually.'],
        ['Hydrate+ Moisturizer', 'Moisturizer', 'Dry', 399, 19,
         'Hydra-boost moisturizer with coconut water and hyaluronic acid. Locks in moisture for 72 hours.',
         'Coconut Water, Hyaluronic Acid, Vitamin E',
         'Apply after toner and serum. Massage until absorbed.'],
        ['Hydro Boost Water Gel', 'Moisturizer', 'All', 899, 4,
         'Water-based gel moisturizer with hyaluronic acid. Provides intense hydration with a weightless feel.',
         'Hyaluronic Acid, Olive Extract, Dimethicone',
         'Apply to clean face and neck morning and evening.'],
        ['Cream Skin Refiner', 'Moisturizer', 'Sensitive', 1850, 14,
         'Silky cream-meets-toner formula that delivers deep moisture to sensitive, dehydrated skin. Strengthens barrier.',
         'White Tea Leaf Extract, Peptides, Ceramides',
         'Pour onto cotton pad or hands, pat gently into face.'],
        ['Moisturizing Cream SPF 30', 'Moisturizer', 'Dry', 290, 20,
         'Dual-action cream that moisturizes dry skin while providing SPF 30 sun protection. Non-greasy formula.',
         'Zinc Oxide, Glycerin, Aloe Vera, Vitamin E',
         'Apply as the last step of morning routine. Reapply every 3-4 hours.'],

        // ==================== SERUMS (25) ====================
        ['Niacinamide 10% + Zinc 1%', 'Serum', 'Oily', 590, 2,
         'High-strength vitamin and mineral formula. Reduces blemishes, congestion, and balances oil production.',
         'Niacinamide 10%, Zinc PCA 1%',
         'Apply a few drops to face AM and PM before heavier creams.'],
        ['Hyaluronic Acid 2% + B5', 'Serum', 'Dry', 630, 2,
         'Multi-depth hydration serum with low, medium, and high molecular weight HA. Instant plumping effect.',
         'Hyaluronic Acid (Multi-weight), Panthenol (Vitamin B5)',
         'Apply a few drops to damp skin AM and PM. Follow with moisturizer.'],
        ['Alpha Arbutin 2% + HA', 'Serum', 'All', 550, 2,
         'Concentrated brightening serum that reduces dark spots and post-acne marks. Inhibits tyrosinase activity.',
         'Alpha Arbutin 2%, Hyaluronic Acid',
         'Apply a few drops to affected areas AM and PM. Use sunscreen during the day.'],
        ['10% Niacinamide Face Serum', 'Serum', 'Oily', 499, 7,
         'Water-based serum with 10% niacinamide for oil control and pore minimizing. Clinically tested and vegan.',
         'Niacinamide 10%, Zinc, Hyaluronic Acid',
         'Apply 4-5 drops on cleansed face, press into skin.'],
        ['Vitamin C Serum', 'Serum', 'Normal', 695, 9,
         'Potent 15% vitamin C serum with Japanese mandarin extract. Brightens dull skin and fights free radical damage.',
         'Ethyl Ascorbic Acid 15%, Mandarin Extract, Hyaluronic Acid',
         'Apply 3-4 drops on clean face in the morning. Always follow with sunscreen.'],
        ['Advanced Snail 96 Mucin Power Essence', 'Serum', 'All', 1350, 10,
         'Bestselling essence with 96% snail secretion filtrate. Heals acne scars, reduces fine lines, improves texture.',
         'Snail Secretion Filtrate 96%, Betaine, Sodium Hyaluronate',
         'After cleansing and toning, apply a small amount and gently pat.'],
        ['Watermelon Glow Niacinamide Serum', 'Serum', 'Combination', 1890, 8,
         'Pore-minimizing glow serum with niacinamide and watermelon extract. Delivers a subtle, healthy glow.',
         'Niacinamide, Watermelon Extract, Hyaluronic Acid, Alpha Arbutin',
         'Apply 3-4 drops on clean face, gently pat in.'],
        ['Pore Tightening Serum', 'Serum', 'Oily', 850, 5,
         'Triple-acid serum with AHA, BHA, PHA and Jeju volcanic cluster water. Tightens pores and refines texture.',
         'Volcanic Cluster Water, AHA, BHA, PHA',
         'Apply to T-zone and areas with visible pores after toning.'],
        ['2% Salicylic Acid Face Serum', 'Serum', 'Oily', 545, 7,
         'Potent exfoliating serum with 2% salicylic acid. Penetrates pores to dissolve sebum and blackheads.',
         'Salicylic Acid 2%, LHA, Zinc',
         'Apply 3-4 drops on clean face in the evening. Start with alternate days.'],
        ['Grape Seed 80 Firming Serum', 'Serum', 'Normal', 1450, 5,
         'Antioxidant powerhouse with 80% grape seed extract. Firms sagging skin and improves elasticity.',
         'Grape Seed Extract 80%, Vitamin E, Panthenol',
         'Apply after toner and before moisturizer. Pat gently into skin.'],
        ['10% Vitamin C Face Serum', 'Serum', 'All', 599, 9,
         'Stable vitamin C serum with Kakadu Plum that brightens skin and fades dark spots without irritation.',
         'Ethyl Ascorbic Acid 10%, Mandarin Extract, Kakadu Plum',
         'Apply 4-5 drops on clean face every morning.'],
        ['Peptide Serum', 'Serum', 'Normal', 399, 7,
         'Multi-peptide serum with five signal peptides and hyaluronic acid. Improves firmness and reduces fine lines.',
         'Matrixyl 3000, Argireline, Copper Peptides, HA',
         'Apply 4-5 drops on clean face AM and PM.'],
        ['Cica Repair Serum', 'Serum', 'Sensitive', 299, 13,
         'Calming serum with centella asiatica for irritated, red skin. Strengthens barrier and speeds healing.',
         'Centella Asiatica, Madecassoside, Panthenol',
         'Apply 3-4 drops on affected areas. Can be used AM and PM.'],
        ['AHA + BHA + PHA 30-Day Miracle Serum', 'Serum', 'Combination', 1099, 10,
         'Triple-action chemical exfoliant that dissolves dead skin cells and unclogs pores over 30 days.',
         'Glycolic Acid, Salicylic Acid, Gluconolactone, Tea Tree',
         'Apply a few drops in the evening after toner. Start 2-3 times per week.'],
        ['Hydrating Serum with Rose Extract', 'Serum', 'Dry', 179, 13,
         'Affordable hydrating serum with Damascus rose water and hyaluronic acid for parched skin.',
         'Rose Water, Hyaluronic Acid, Glycerin',
         'Apply 4-5 drops on damp face. Follow with moisturizer.'],
        ['Bakuchiol Retinol Alternative Serum', 'Serum', 'Sensitive', 549, 7,
         'Plant-based retinol alternative with bakuchiol. Anti-aging benefits without irritation — safe for sensitive skin.',
         'Bakuchiol, Squalane, Vitamin E',
         'Apply 3-4 drops AM and PM. Safe for daytime use unlike retinol.'],
        ['Glow Boosting Serum', 'Serum', 'All', 750, 16,
         'Brightening serum with 3% tranexamic acid and niacinamide. Targets dark spots, melasma, and uneven tone.',
         'Tranexamic Acid 3%, Niacinamide, Hyaluronic Acid',
         'Apply 3-4 drops on dark spots and uneven areas. Use AM and PM.'],
        ['2% Vitamin C Serum', 'Serum', 'Normal', 399, 17,
         'Gentle vitamin C serum for daily brightening. Improves radiance and protects from environmental damage.',
         'Vitamin C 2%, Hyaluronic Acid, Ferulic Acid',
         'Apply 4-5 drops on clean face in the morning. Follow with SPF.'],
        ['10% Cica Peptide Serum', 'Serum', 'Sensitive', 499, 17,
         'Soothing serum with 10% CICA extract and peptides. Calms inflammation and repairs damaged skin.',
         'Centella Asiatica 10%, Peptide Complex, Panthenol',
         'Apply 3-4 drops on irritated areas. Can be used morning and night.'],
        ['2% Retinol Face Serum', 'Serum', 'Normal', 695, 18,
         'Advanced anti-aging serum with encapsulated retinol. Reduces wrinkles and boosts collagen without harsh peeling.',
         'Retinol 2%, Vitamin E, Squalane',
         'Apply at night only. Start with 1-2 times per week. Always use SPF next morning.'],
        ['Radiance+ Oil-Free Serum', 'Serum', 'All', 449, 19,
         'Lightweight, oil-free serum with papaya and vitamin C for instant radiance. Absorbs quickly without stickiness.',
         'Papaya Extract, Vitamin C, Niacinamide, HA',
         'Apply 3-4 drops on clean face AM and PM. Follow with moisturizer.'],
        ['Hyaluronic Acid Serum', 'Serum', 'Dry', 545, 8,
         'Deep hydration serum with 5 forms of hyaluronic acid. Plumps and hydrates at multiple skin depths.',
         'Hyaluronic Acid (5 types), Panthenol, Trehalose',
         'Apply to damp face, pat gently. Follow with cream moisturizer.'],
        ['Propolis Light Ampoule', 'Serum', 'Sensitive', 1150, 10,
         'Concentrated ampoule with 73% propolis extract. Deeply nourishes, soothes inflammation, and strengthens barrier.',
         'Propolis Extract 73%, Panthenol, Betaine',
         'Apply after toner, pat gently until absorbed.'],
        ['10% Niacinamide Booster', 'Serum', 'Oily', 2250, 11,
         'Professional-strength niacinamide booster for severe oil control and pore minimizing. Add to any product.',
         'Niacinamide 10%, Hyaluronic Acid',
         'Mix 2-3 drops into your serum or moisturizer, or apply directly.'],
        ['Vitamin C Face Serum', 'Serum', 'All', 449, 13,
         'Affordable vitamin C serum with orange extract for daily brightening. Fades dark spots and evens skin tone.',
         'Vitamin C, Orange Extract, Turmeric, HA',
         'Apply 4-5 drops on clean face every morning. Follow with sunscreen.'],

        // ==================== SUNSCREENS (20) ====================
        ['Anthelios Melt-in Sunscreen SPF 60', 'Sunscreen', 'All', 1599, 3,
         'Ultra-lightweight oil-free sunscreen with SPF 60 and Cell-Ox Shield technology. No white cast or residue.',
         'Cell-Ox Shield, Mexoryl SX, Avobenzone, Thermal Spring Water',
         'Apply generously 15 minutes before sun exposure. Reapply every 2 hours.'],
        ['Ultra Sheer Dry-Touch Sunscreen SPF 50+', 'Sunscreen', 'Oily', 699, 4,
         'Breakthrough sunscreen with Dry-Touch technology for a clean, matte finish. Helioplex for stable protection.',
         'Helioplex Technology, Avobenzone, Homosalate',
         'Apply liberally 15 minutes before sun exposure. Reapply every 2 hours.'],
        ['Daily UV Defence SPF 50+', 'Sunscreen', 'Sensitive', 999, 6,
         'Gentle mineral-based daily sunscreen for sensitive skin. Non-comedogenic with moisturizing finish.',
         'Zinc Oxide, Titanium Dioxide, Glycerin, Vitamin E',
         'Apply as last step of skincare routine every morning.'],
        ['SPF 50 Sunscreen Aqua Gel', 'Sunscreen', 'Combination', 449, 7,
         'Aqua-gel sunscreen that feels like water. Multi-spectrum UV filters with zero white cast.',
         'Multi-Spectrum UV Filters, Squalane, Centella',
         'Apply generously as last step of morning skincare.'],
        ['Ultra Light Indian Sunscreen SPF 50', 'Sunscreen', 'All', 199, 13,
         'Affordable lightweight sunscreen for Indian skin tones. No white cast with vitamin C antioxidant protection.',
         'Zinc Oxide, Vitamin C, Carrot Seed Extract',
         'Apply generously to face and neck 15 minutes before stepping out.'],
        ['Invisible Fluid Sunscreen SPF 50+', 'Sunscreen', 'Normal', 1399, 3,
         'Ultra-fluid invisible sunscreen with Cell-Ox Shield XL. Virtually undetectable — perfect under makeup.',
         'Cell-Ox Shield XL, Mexoryl XL, Silica',
         'Shake well. Apply to face and neck in the morning.'],
        ['Airy Sunscreen SPF 50', 'Sunscreen', 'Oily', 349, 9,
         'Airy gel-cream with SPF 50 and velvet matte finish for oily skin. Doubles as makeup primer.',
         'Green Tea Extract, Zinc Oxide, Silica, Niacinamide',
         'Apply as the last skincare step. Reapply every 3-4 hours.'],
        ['Moisturizing Sunscreen SPF 30', 'Sunscreen', 'Dry', 149, 12,
         'Budget-friendly moisturizing sunscreen with SPF 30 and aloe vera. Creamy formula for dry skin.',
         'Aloe Vera, Quince Seed, SPF 30 Filters',
         'Apply generously to face and exposed skin every morning.'],
        ['Ultra Matte Dry Touch SPF 50', 'Sunscreen', 'Oily', 695, 16,
         'Best-selling matte sunscreen for oily and acne-prone skin. Zero white cast, zero shine, all-day protection.',
         'Zinc Oxide, Dimethicone, Niacinamide, Carrot Seed',
         'Apply as last step of AM routine. Reapply every 3 hours if outdoors.'],
        ['Sheer Zinc Tinted SPF 50', 'Sunscreen', 'All', 750, 16,
         'Tinted mineral sunscreen with universal shade that blends into Indian skin tones. Zinc-based, gentle formula.',
         'Zinc Oxide, Iron Oxides, Vitamin E, Squalane',
         'Apply evenly on face. The tint adjusts to your skin tone.'],
        ['1% Hyaluronic Sunscreen SPF 50', 'Sunscreen', 'Dry', 449, 17,
         'Hydrating sunscreen with 1% hyaluronic acid for dry skin. Moisturizes while providing broad-spectrum protection.',
         'Hyaluronic Acid 1%, Zinc Oxide, Vitamin E',
         'Apply generously on face and neck. Reapply every 2-3 hours.'],
        ['Shadow SPF 30+ Gel', 'Sunscreen', 'Oily', 385, 20,
         'Lightweight gel sunscreen for oily, acne-prone skin. Non-comedogenic, transparent, and sebum-controlling.',
         'Octinoxate, Silica, Zinc, Allantoin',
         'Apply liberally 20 minutes before sun exposure. Reapply every 3 hours.'],
        ['Shadow SPF 50+ Cream', 'Sunscreen', 'All', 475, 20,
         'Broad-spectrum SPF 50+ cream with PA+++ rating. Silicon-based formula for smooth, even application.',
         'Octinoxate, Zinc Oxide, Silicone, Vitamin E',
         'Apply generously as last skincare step. Reapply every 2 hours outdoors.'],
        ['Glow+ Dewy Sunscreen SPF 50', 'Sunscreen', 'Normal', 499, 19,
         'Dewy-finish sunscreen with SPF 50 and papaya extract. Provides sun protection with a natural glow.',
         'Papaya Extract, Hyaluronic Acid, SPF 50 Filters',
         'Apply as last step before makeup. Reapply every 3 hours.'],
        ['Watermelon Cooling SPF 50', 'Sunscreen', 'Combination', 545, 8,
         'Cooling gel sunscreen with watermelon extract and SPF 50. Refreshing formula for hot, humid weather.',
         'Watermelon Extract, Hyaluronic Acid, Niacinamide',
         'Apply generously 15 minutes before stepping out.'],
        ['SPF 50 PA+++ Sunscreen', 'Sunscreen', 'All', 495, 18,
         'Lightweight daily sunscreen with broad-spectrum PA+++ protection. No white cast, non-greasy formula.',
         'Zinc Oxide, Titanium Dioxide, Vitamin C',
         'Apply as the last step of morning routine.'],
        ['Mineral UV Defense SPF 50', 'Sunscreen', 'Sensitive', 799, 4,
         'Mineral sunscreen specifically for sensitive, reactive skin. 100% mineral filters with soothing botanicals.',
         'Zinc Oxide, Titanium Dioxide, Aloe Vera, Green Tea',
         'Apply generously to face. Suitable for sensitive and post-procedure skin.'],
        ['Aloe Soothing Sun Cream SPF 50', 'Sunscreen', 'Sensitive', 1075, 10,
         'K-beauty sun cream with aloe vera and SPF 50 PA+++. Soothes while protecting from UV damage.',
         'Aloe Vera, SPF 50 PA+++, Centella, Panthenol',
         'Apply on clean face as last skincare step.'],
        ['UV Mune 400 SPF 50+', 'Sunscreen', 'All', 1799, 3,
         'Next-generation sunscreen with Mexoryl 400 providing ultra-broad spectrum protection including long UVA rays.',
         'Mexoryl 400, Mexoryl XL, Cell-Ox Shield',
         'Apply 15 min before sun exposure. Reapply every 2 hours.'],
        ['Youth Extending Daily SPF 50', 'Sunscreen', 'Normal', 2199, 11,
         'Premium anti-aging sunscreen with SPF 50. Contains antioxidants that prevent UV-induced aging signs.',
         'Avobenzone, Octisalate, Green Tea, Vitamin E',
         'Apply as last step of AM skincare. Reapply every 2 hours.'],

        // ==================== TONERS (15) ====================
        ['Effaclar Astringent Lotion Toner', 'Toner', 'Oily', 1199, 3,
         'Micro-exfoliating toner with salicylic acid and glycolic acid. Tightens pores and reduces shine.',
         'Salicylic Acid, Glycolic Acid, Thermal Spring Water',
         'Apply with cotton pad. Avoid eye area. Use once daily in the evening.'],
        ['Glycolic Acid 7% Toning Solution', 'Toner', 'Normal', 750, 2,
         'Exfoliating toner with 7% glycolic acid. Improves radiance, reduces dullness, refines texture.',
         'Glycolic Acid 7%, Amino Acids, Aloe Vera, Ginseng',
         'Apply to cotton pad, sweep across face in the evening.'],
        ['BHA Blackhead Power Liquid', 'Toner', 'Oily', 1100, 10,
         'Gentle BHA exfoliant that dissolves blackheads deep within pores. Willow bark water for less irritation.',
         'Betaine Salicylate 4%, Willow Bark Water, Niacinamide',
         'Apply to cotton pad, sweep across face. Start 2-3 times per week.'],
        ['Green Tea Balancing Toner', 'Toner', 'Combination', 650, 5,
         'Hydrating pH-balancing toner with Jeju green tea. Replenishes moisture while controlling T-zone oil.',
         'Green Tea Extract, Betaine, Hyaluronic Acid',
         'Pour onto hands or cotton pad and pat gently into skin.'],
        ['Rice Toner', 'Toner', 'Dry', 945, 5,
         'Nourishing toner with 80% rice bran ferment filtrate. Brightens and plumps dry, dull skin.',
         'Rice Bran Ferment Filtrate, Niacinamide, Hyaluronic Acid',
         'Pour onto hands or cotton pad, pat into cleansed face.'],
        ['Full Fit Propolis Synergy Toner', 'Toner', 'Sensitive', 1150, 10,
         'Honey-like essence toner with 73% propolis extract. Deeply nourishes and strengthens skin barrier.',
         'Propolis Extract 73%, Betaine, Panthenol, Allantoin',
         'Apply onto face and gently pat until absorbed.'],
        ['Witch Hazel Toner', 'Toner', 'Oily', 149, 9,
         'Pore-refining toner with natural witch hazel and rose water. Alcohol-free formula controls oil.',
         'Witch Hazel, Rose Water, Glycerin',
         'Apply to cotton pad and sweep across clean face AM and PM.'],
        ['Soothing Toner Pad', 'Toner', 'Sensitive', 299, 15,
         'Pre-soaked toner pads with centella asiatica and panthenol. Cleanse, tone, and soothe in one step.',
         'Centella Asiatica, Panthenol, Allantoin',
         'Wipe gently across clean face. Can be used for quick cleansing.'],
        ['Pore Refining Toner', 'Toner', 'Oily', 550, 16,
         'Advanced toner with willow bark and zinc that minimizes pores and controls excess oil all day.',
         'Willow Bark Extract, Zinc PCA, Niacinamide',
         'Apply with cotton pad on T-zone and cheeks after cleansing.'],
        ['5% Niacinamide Daily Toner', 'Toner', 'Oily', 349, 17,
         'Daily toner with 5% niacinamide for oil control. Lightweight, non-sticky formula preps skin for serums.',
         'Niacinamide 5%, Hyaluronic Acid, Green Tea',
         'Pour onto palm and pat into clean face AM and PM.'],
        ['AHA BHA Exfoliating Toner', 'Toner', 'Oily', 495, 18,
         'Dual-acid toner with glycolic and salicylic acid. Removes dead skin and clears pores for smooth texture.',
         'Glycolic Acid, Salicylic Acid, Witch Hazel',
         'Apply with cotton pad in the evening. Start 2-3 times per week.'],
        ['Hydrate+ Toner Essence', 'Toner', 'Dry', 349, 19,
         'Hydrating toner essence with coconut water and hyaluronic acid. Provides instant moisture boost for dry skin.',
         'Coconut Water, Hyaluronic Acid, Aloe Vera',
         'Pat into clean face with palms. Use AM and PM.'],
        ['Skin Perfecting 2% BHA Toner', 'Toner', 'Oily', 2550, 11,
         'Cult-status BHA liquid exfoliant that unclogs pores and smooths wrinkles. #1 rated BHA product worldwide.',
         'Salicylic Acid 2%, Green Tea, Methylpropanediol',
         'Apply with cotton pad. Start once daily, build up to twice daily.'],
        ['AHA/BHA Clarifying Treatment Toner', 'Toner', 'Combination', 850, 10,
         'Clarifying toner with natural AHA and BHA sources. Gently exfoliates while prepping skin for better absorption.',
         'Apple Water, Willow Bark, Glycolic Acid',
         'Apply after cleansing, sweep across face and neck.'],
        ['Cream Skin Toner & Moisturizer', 'Toner', 'Dry', 1650, 14,
         'Hybrid toner-moisturizer with white tea leaf extract. Delivers cream-level hydration in a toner format.',
         'White Tea Leaf Extract, Peptides, Amino Acids',
         'Pour generous amount onto cotton pad, press and pat into skin.'],

        // ==================== MASKS (10) ====================
        ['Volcanic Pore Clay Mask', 'Mask', 'Oily', 750, 5,
         'Deep-cleansing clay mask with Jeju volcanic ash. Draws out impurities and tightens pores in 10 minutes.',
         'Jeju Volcanic Ash, Kaolin, Bentonite',
         'Apply even layer on clean face. Leave 10-15 minutes. Rinse with lukewarm water.'],
        ['AHA 30% + BHA 2% Peeling Solution', 'Mask', 'Normal', 630, 2,
         'Advanced chemical peel with 30% AHA and 2% BHA. Targets texture, dullness, and acne marks.',
         'Glycolic Acid, Salicylic Acid, Lactic Acid, Tartaric Acid',
         'Apply evenly. Leave max 10 minutes. Rinse. Use max 2x per week.'],
        ['Ultimate Repair Sleeping Mask', 'Mask', 'Dry', 895, 10,
         'Overnight sleeping mask with raw propolis and honey. Wake up to plumper, more radiant skin.',
         'Propolis Extract, Hyaluronic Acid, Ceramides, Niacinamide',
         'Apply thin layer as last step of evening routine. Leave overnight.'],
        ['Turmeric Glow Sheet Mask', 'Mask', 'All', 99, 13,
         'Single-use sheet mask with turmeric, vitamin C, and saffron for instant brightening and glow.',
         'Turmeric Extract, Vitamin C, Saffron, Honey',
         'Place on clean face for 15-20 minutes. Pat excess serum into skin.'],
        ['Charcoal Detox Mask', 'Mask', 'Oily', 299, 8,
         'Purifying charcoal and clay mask that detoxifies congested skin. Enriched with vitamin C to brighten.',
         'Activated Charcoal, Kaolin Clay, Vitamin C',
         'Apply thick layer, leave 10-12 minutes, rinse. Use 1-2 times per week.'],
        ['Super Volcanic Clay Mask 2X', 'Mask', 'Oily', 850, 5,
         'Double-strength pore-cleansing mask with 2X Jeju volcanic cluster. Extra deep cleaning power.',
         'Jeju Volcanic Cluster 2X, Kaolin, AHA',
         'Apply on clean face, leave 10 minutes, rinse. Use 1-2x per week.'],
        ['Vitamin C+E Glow Face Mask', 'Mask', 'Normal', 545, 8,
         'Brightening overnight mask with vitamin C, E, and niacinamide. Reveals luminous skin by morning.',
         'Vitamin C, Vitamin E, Niacinamide, Hyaluronic Acid',
         'Apply as last step of PM routine. Wash off in the morning.'],
        ['Ubtan Face Mask', 'Mask', 'All', 349, 13,
         'Traditional ubtan mask with turmeric and saffron for tan removal and brightening. Ayurvedic formula.',
         'Turmeric, Saffron, Sandalwood, Rose Water',
         'Apply thick layer, leave 15-20 minutes, rinse with water.'],
        ['AHA BHA Peel Mask', 'Mask', 'Normal', 499, 17,
         'At-home peel mask with glycolic and salicylic acids. Professional-grade resurfacing for smoother skin.',
         'Glycolic Acid, Salicylic Acid, Aloe Vera',
         'Apply thin layer, leave 8-10 minutes, rinse. Use 1-2x per week.'],
        ['Red Vine Peel Off Mask', 'Mask', 'Combination', 445, 18,
         'Antioxidant-rich peel-off mask with red vine extract. Removes dead skin and impurities for clearer skin.',
         'Red Vine Extract, Glycolic Acid, Witch Hazel',
         'Apply even layer, let dry 15-20 minutes, peel off gently.'],

        // ==================== EYE CARE (8) ====================
        ['Caffeine Solution 5% + EGCG', 'Eye Care', 'All', 520, 2,
         'Targeted eye serum with 5% caffeine and EGCG from green tea. Reduces puffiness and dark circles.',
         'Caffeine 5%, EGCG (from Green Tea), Hyaluronic Acid',
         'Apply small amount around eye area AM and PM. Pat gently with ring finger.'],
        ['Hydro Boost Eye Gel-Cream', 'Eye Care', 'Dry', 899, 4,
         'Ultra-hydrating eye gel-cream with hyaluronic acid. Smooths fine lines and plumps under-eye area.',
         'Hyaluronic Acid, Olive Extract, Dimethicone',
         'Gently dab around eye area morning and night with ring finger.'],
        ['Vitamin K Eye Cream', 'Eye Care', 'All', 249, 9,
         'Affordable eye cream with vitamin K and peptides targeting dark circles from poor circulation.',
         'Vitamin K, Peptides, Caffeine, Shea Butter',
         'Dot small amount under eyes and pat until absorbed. Use AM and PM.'],
        ['Peptide Eye Gel', 'Eye Care', 'Normal', 449, 7,
         'Cooling eye gel with multi-peptides that firms eye area and reduces puffiness with metal applicator.',
         'Matrixyl, Caffeine, Cucumber Extract, HA',
         'Apply using metal tip around eyes. Gently pat in.'],
        ['Under Eye Cream with Retinol', 'Eye Care', 'All', 499, 17,
         'Anti-aging under eye cream with retinol and peptides. Reduces dark circles, fine lines, and crow feet.',
         'Retinol, Peptides, Caffeine, Vitamin E',
         'Apply tiny amount under eyes at night. Pat gently with ring finger.'],
        ['Under Eye Cream Night Gel', 'Eye Care', 'All', 445, 8,
         'Overnight eye gel with caffeine and green tea. Works while you sleep to reduce puffiness and dark circles.',
         'Caffeine, Green Tea, Hyaluronic Acid, Peptides',
         'Apply before bed around eye area. Pat gently until absorbed.'],
        ['Bye Bye Dark Circles Eye Cream', 'Eye Care', 'All', 399, 13,
         'Brightening under-eye cream with daisy extract and peptides. Targets stubborn genetic dark circles.',
         'Daisy Extract, Peptides, Vitamin C, Cucumber',
         'Dot under eyes morning and night. Massage gently until absorbed.'],
        ['Under Eye Cream with Caffeine', 'Eye Care', 'All', 695, 16,
         'Depuffing eye cream with 3% caffeine complex. Clinically proven to reduce puffiness by 40% in 4 weeks.',
         'Caffeine Complex 3%, Peptides, Vitamin K',
         'Apply morning and night with gentle patting motion.'],

        // ==================== TREATMENTS (20) ====================
        ['Azelaic Acid Suspension 10%', 'Treatment', 'All', 450, 2,
         'Multi-functional treatment targeting hyperpigmentation, acne, and rosacea simultaneously.',
         'Azelaic Acid 10%, Dimethicone',
         'Apply small amount to affected areas AM and PM after water-based serums.'],
        ['2% BHA Liquid Exfoliant', 'Treatment', 'Oily', 2450, 11,
         'Cult-status leave-on exfoliant with 2% salicylic acid. Unclogs pores and evens skin tone.',
         'Salicylic Acid 2%, Green Tea, Methylpropanediol',
         'Apply with cotton pad. Do not rinse off. Use once or twice daily.'],
        ['Retinol 0.5% in Squalane', 'Treatment', 'Normal', 490, 2,
         'Pure retinol in hydrating squalane base. Reduces fine lines while preventing retinol-related dryness.',
         'Retinol 0.5%, Squalane',
         'Apply small amount to clean face in evening only. Start 2x per week.'],
        ['Salicylic Acid 2% Masque', 'Treatment', 'Oily', 899, 2,
         'Concentrated treatment masque with 2% salicylic acid and charcoal for deep-cleaning congested pores.',
         'Salicylic Acid 2%, Kaolin, Charcoal, Squalane',
         'Apply to clean face, leave 10 minutes, rinse. Use 1-2 times per week.'],
        ['Anti-Acne Kit - Complete Solution', 'Treatment', 'Oily', 1499, 7,
         '3-step anti-acne system for Indian skin. Clinically tested to reduce acne by 60% in 8 weeks.',
         'Salicylic Acid, Niacinamide, Zinc, Centella Asiatica',
         'Use cleanser AM/PM, apply serum, follow with moisturizer.'],
        ['Tranexamic Acid 3% Serum', 'Treatment', 'All', 549, 7,
         'Advanced treatment targeting stubborn hyperpigmentation and melasma. Safe for all skin types.',
         'Tranexamic Acid 3%, HPA',
         'Apply 4-5 drops on dark spots AM and PM. Always follow with sunscreen.'],
        ['Retinal 0.2% Cream', 'Treatment', 'Normal', 699, 7,
         'Next-generation retinoid with retinal — 11x faster than retinol. Gentler than prescription retinoids.',
         'Retinal 0.2%, Squalane, Coenzyme Q10',
         'Apply pea-sized amount on clean face at night. Start 1-2x per week.'],
        ['Benzoyl Peroxide 2.5% Cream', 'Treatment', 'Oily', 199, 7,
         'Targeted spot treatment that kills acne-causing bacteria on contact. Lower concentration means less drying.',
         'Benzoyl Peroxide 2.5%, Aloe Vera',
         'Apply thin layer to affected areas after cleansing.'],
        ['Kojic Acid Brightening Cream', 'Treatment', 'All', 329, 12,
         'Ayurvedic-inspired brightening cream with kojic acid. Targets dark spots and tan removal naturally.',
         'Kojic Acid, Licorice Root, Mulberry Extract',
         'Apply to dark spots and pigmented areas twice daily.'],
        ['Glycolic Acid 10% Peel', 'Treatment', 'Normal', 799, 11,
         'Professional-grade peel with 10% glycolic acid. Resurfaces skin and reduces acne scars dramatically.',
         'Glycolic Acid 10%, Green Tea, Chamomile',
         'Apply to clean dry face, leave 5 minutes, rinse. Use 1-2x per week.'],
        ['Anti-Pigmentation Cream', 'Treatment', 'All', 399, 13,
         'Potent cream with daisy extract and vitamin C targeting dark spots and post-inflammatory hyperpigmentation.',
         'Daisy Extract, Vitamin C, Licorice, Niacinamide',
         'Apply on dark spots and pigmented areas twice daily.'],
        ['Pimple Patches - 36 Count', 'Treatment', 'All', 149, 10,
         'Ultra-thin hydrocolloid patches that flatten pimples overnight. Contains 36 patches in 3 sizes.',
         'Hydrocolloid, Cellulose Gum, Polyisobutylene',
         'Clean area, apply patch on blemish, leave 6+ hours or overnight.'],
        ['2% Salicylic Acid Spot Treatment', 'Treatment', 'Oily', 349, 17,
         'Fast-acting spot treatment with 2% salicylic acid. Reduces pimple size and redness within hours.',
         'Salicylic Acid 2%, Tea Tree Oil, Zinc',
         'Apply directly on pimples with clean applicator. Use 2-3 times daily.'],
        ['AHA Cream Exfoliator', 'Treatment', 'Normal', 550, 16,
         'Gentle cream exfoliator with lactic acid and glycolic acid. Dissolves dead skin for smooth, glowing complexion.',
         'Lactic Acid, Glycolic Acid, HA, Ceramides',
         'Apply thin layer on clean face at night. Start 2x per week.'],
        ['1% Retinol Anti-Aging Cream', 'Treatment', 'Normal', 599, 17,
         'Potent retinol cream for reducing wrinkles and age spots. Encapsulated formula for less irritation.',
         'Retinol 1%, Hyaluronic Acid, Vitamin E',
         'Apply small amount at night. Start once per week, build up gradually.'],
        ['AHA BHA Peeling Solution', 'Treatment', 'Normal', 495, 18,
         'At-home peel with glycolic, salicylic, and lactic acids. 10-minute treatment for smoother, brighter skin.',
         'Glycolic Acid, Salicylic Acid, Lactic Acid',
         'Apply to clean face, leave 10 minutes, rinse. Use max 2x per week.'],
        ['Nigrifix Cream for Dark Spots', 'Treatment', 'All', 449, 20,
         'Specialized cream with niacinamide for reducing dark patches and uneven skin tone in body folds.',
         'Niacinamide, Lactic Acid, Vitamin E, Kojic Acid',
         'Apply on darker patches twice daily. Results visible in 6-8 weeks.'],
        ['Glow+ Peel & Reveal Serum', 'Treatment', 'Normal', 449, 19,
         'Gentle chemical peel serum with AHA and papaya enzymes. Reveals brighter skin with weekly use.',
         'AHA, Papaya Enzyme, Vitamin C, Aloe Vera',
         'Apply on clean face at night, leave 10 minutes, rinse.'],
        ['Acne Spot Corrector', 'Treatment', 'Oily', 395, 8,
         'Targeted spot corrector with salicylic acid and tea tree. Dries out pimples overnight without drying skin.',
         'Salicylic Acid, Tea Tree Oil, Niacinamide',
         'Apply on individual pimples before bed. Do not apply on large areas.'],
        ['SA Renewing Retinol Serum', 'Treatment', 'Normal', 1299, 1,
         'Powerful retinol serum with encapsulated technology for gradual release. Reduces wrinkles and smooths texture.',
         'Retinol, Ceramides, Niacinamide',
         'Apply in PM only. Start 2x per week, increase as tolerated. Use SPF in AM.'],

        // ==================== LIP CARE (5) ====================
        ['Lip Balm - Berry', 'Lip Care', 'All', 299, 9,
         'Deeply moisturizing tinted lip balm with natural berry extracts and shea butter. Long-lasting hydration.',
         'Shea Butter, Beeswax, Berry Extract, Vitamin E',
         'Apply as needed throughout the day.'],
        ['Lip Sleeping Mask', 'Lip Care', 'All', 1299, 14,
         'Overnight lip mask with berry complex and vitamin C. Wake up to baby-soft, plump lips.',
         'Berry Complex, Vitamin C, Murumuru Butter, Shea Butter',
         'Apply generous layer on clean lips before bed.'],
        ['SPF 30 Lip Balm', 'Lip Care', 'All', 129, 4,
         'Protective lip balm with SPF 30 that shields from UV damage while providing all-day hydration.',
         'SPF 30 Filters, Beeswax, Vitamin E, Aloe',
         'Apply to lips before sun exposure. Reapply every 2 hours outdoors.'],
        ['Lip Balm with SPF 20', 'Lip Care', 'All', 249, 8,
         'Nourishing lip balm with SPF 20 sun protection and vitamin E. Prevents sun-induced lip darkening.',
         'SPF 20, Shea Butter, Vitamin E, Jojoba Oil',
         'Apply on lips throughout the day. Reapply after eating.'],
        ['Vitamin C Tinted Lip Balm', 'Lip Care', 'All', 199, 13,
         'Brightening lip balm with vitamin C that reduces lip pigmentation. Provides subtle color and hydration.',
         'Vitamin C, Cocoa Butter, Beeswax, Berry Extract',
         'Apply directly on lips. Reapply as needed.'],

        // ==================== MISTS & ESSENCES (8) ====================
        ['Thermal Spring Water Mist', 'Mist', 'Sensitive', 599, 3,
         'Soothing facial mist with La Roche-Posay Thermal Spring Water and antioxidant selenium.',
         'La Roche-Posay Thermal Spring Water, Selenium',
         'Hold 8 inches from face, mist liberally. Let air dry or pat in.'],
        ['Rose Water Face Mist', 'Mist', 'All', 149, 12,
         'Pure refreshing rose water mist that hydrates, tones, and sets makeup. Steam-distilled Damascus roses.',
         'Pure Rose Water, Glycerin',
         'Spritz on clean face or over makeup. Use anytime for refreshment.'],
        ['Snail Mucin Essence', 'Mist', 'All', 899, 10,
         'Nutrient-rich essence with 96.3% snail mucin. Repairs damage, fades scars, and leaves skin bouncy.',
         'Snail Mucin 96.3%, Sodium Hyaluronate, Betaine',
         'Apply after toner, pat gently until absorbed. Use AM and PM.'],
        ['Cucumber Hydration Mist', 'Mist', 'All', 99, 15,
         'Budget-friendly face mist with cucumber extract and aloe vera. Cool, hydrate, and soothe instantly.',
         'Cucumber Extract, Aloe Vera, Glycerin',
         'Mist on face anytime for hydrating refresh. Works over makeup.'],
        ['Vitamin C + Niacinamide Face Mist', 'Mist', 'All', 345, 8,
         'Brightening face mist with vitamin C and niacinamide. Controls oil and adds instant glow over makeup.',
         'Vitamin C, Niacinamide, Hyaluronic Acid',
         'Spritz 2-3 times on face, 8 inches away. Use AM or over makeup.'],
        ['BHA + Salicylic Acid Face Mist', 'Mist', 'Oily', 395, 18,
         'Oil-control face mist with BHA that keeps pores clear throughout the day. Mattifying without drying.',
         'Salicylic Acid, Witch Hazel, Green Tea',
         'Spritz on T-zone and oily areas. Use 2-3 times daily.'],
        ['Hydrate+ Face Mist', 'Mist', 'All', 299, 19,
         'Hydrating face mist with coconut water and hyaluronic acid. Instant moisture boost anytime, anywhere.',
         'Coconut Water, Hyaluronic Acid, Aloe Vera',
         'Mist on face whenever skin feels dry. Can be used over makeup.'],
        ['Green Tea Mineral Mist', 'Mist', 'Normal', 650, 5,
         'Antioxidant-rich mineral mist with Jeju green tea. Sets makeup and provides continuous hydration.',
         'Green Tea Extract, Mineral Water, Amino Acids',
         'Spritz after makeup or anytime for a dewy, refreshed look.']
    ];

    products.forEach(p => {
        const imageUrl = getImg(p[1]); // p[1] is the Category
        db.run(
            "INSERT INTO Product (Product_name, Category, P_Skin_type, Price, Brand_id, Description, Image_url, Ingredients, How_to_use) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [p[0], p[1], p[2], p[3], p[4], p[5], imageUrl, p[6], p[7]]
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
