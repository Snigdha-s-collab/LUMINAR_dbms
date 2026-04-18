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
    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
        console.log('✅ SQLite database loaded from disk');
    } else {
        db = new SQL.Database();
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

    // Create indexes
    try { db.run('CREATE INDEX IF NOT EXISTS idx_product_skin_type ON Product(P_Skin_type)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_product_category ON Product(Category)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_product_brand ON Product(Brand_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_orders_customer ON Orders(Cust_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_review_product ON Review(Product_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_payment_order ON Payment(Order_id)'); } catch(e) {}
}

// ============================================
// Seed Data
// ============================================
function seedDatabase() {
    db.run("BEGIN TRANSACTION");

    // Brands
    const brands = [
        ['CeraVe', 'USA'], ['The Ordinary', 'Canada'], ['La Roche-Posay', 'France'],
        ['Neutrogena', 'USA'], ['Innisfree', 'South Korea'], ['Cetaphil', 'USA'],
        ['Minimalist', 'India'], ['Dot & Key', 'India'], ['Plum', 'India'],
        ['COSRX', 'South Korea'], ["Paula's Choice", 'USA'], ['Biotique', 'India']
    ];
    brands.forEach(b => db.run("INSERT INTO Brand (Brand_name, Country) VALUES (?, ?)", b));

    // Products
    const products = [
        // CLEANSERS
        ['Hydrating Facial Cleanser', 'Cleanser', 'Dry', 899.00, 1,
         'A gentle, non-foaming cleanser that removes dirt and makeup while maintaining the skin\'s natural moisture barrier. Enriched with ceramides and hyaluronic acid for deep hydration.',
         '/images/products/cerave-cleanser.png', 'Ceramides, Hyaluronic Acid, Glycerin, Phytosphingosine',
         'Wet face. Massage a small amount onto skin in circular motions. Rinse with lukewarm water. Use AM and PM.'],
        ['Foaming Facial Cleanser', 'Cleanser', 'Oily', 799.00, 1,
         'Oil-free foaming cleanser that effectively removes excess oil and impurities. Contains niacinamide and ceramides to maintain the skin barrier.',
         '/images/products/cerave-foaming.png', 'Niacinamide, Ceramides, Hyaluronic Acid',
         'Wet face with lukewarm water. Apply a small amount and gently massage. Rinse thoroughly. Use AM and PM.'],
        ['Squalane Cleanser', 'Cleanser', 'All', 650.00, 2,
         'A gentle, moisturizing cleanser with squalane that melts away makeup and impurities leaving the skin feeling soft and clean without stripping.',
         '/images/products/ordinary-cleanser.png', 'Squalane, Sucrose Esters, Sorbitan Laurate',
         'Apply to dry face, massage gently, then emulsify with water and rinse off.'],
        ['Toleriane Purifying Foaming Cleanser', 'Cleanser', 'Sensitive', 1299.00, 3,
         'A purifying, foaming cleanser for sensitive, oily skin. Removes impurities while respecting the skin\'s physiological pH.',
         '/images/products/laroche-cleanser.png', 'Niacinamide, Ceramide-3, Thermal Spring Water',
         'Apply to damp face, lather gently, rinse with water. Avoid eye area.'],
        ['Green Tea Cleansing Foam', 'Cleanser', 'Combination', 550.00, 5,
         'A refreshing cleanser infused with Jeju green tea to gently cleanse and control excess sebum while keeping skin hydrated.',
         '/images/products/innisfree-cleanser.png', 'Green Tea Extract, Amino Acids, Betaine',
         'Create lather in hands, apply to damp face, massage for 30 seconds, rinse.'],
        // MOISTURIZERS
        ['Moisturizing Cream', 'Moisturizer', 'Dry', 999.00, 1,
         'Rich, non-greasy moisturizer with 3 essential ceramides and hyaluronic acid. Provides 24-hour hydration and helps restore the skin barrier.',
         '/images/products/cerave-moisturizer.png', 'Ceramides 1,3,6-II, Hyaluronic Acid, MVE Technology',
         'Apply liberally on face and body as needed. Suitable for morning and night.'],
        ['Natural Moisturizing Factors + HA', 'Moisturizer', 'Normal', 590.00, 2,
         'A lightweight moisturizer that protects the outer layer of skin with amino acids, fatty acids, triglycerides, urea, ceramides, and hyaluronic acid.',
         '/images/products/ordinary-moisturizer.png', 'Hyaluronic Acid, Amino Acids, Ceramides, Triglycerides',
         'Apply a small amount to face after serums, morning and night.'],
        ['Aqua Cica Moisturizer', 'Moisturizer', 'Sensitive', 845.00, 8,
         'A soothing gel-cream moisturizer with CICA that calms irritated skin, locks in moisture, and strengthens the skin barrier.',
         '/images/products/dotkey-moisturizer.png', 'Centella Asiatica, Hyaluronic Acid, Blue Spirulina, Niacinamide',
         'Take a pea-sized amount and apply evenly on cleansed face. Gentle pat to absorb.'],
        ['Oil-Free Moisturizer SPF 25', 'Moisturizer', 'Oily', 749.00, 4,
         'Lightweight, oil-free daily moisturizer with broad spectrum SPF 25. Hydrates without clogging pores or adding shine.',
         '/images/products/neutrogena-moisturizer.png', 'Glycerin, Helioplex Technology, Dimethicone',
         'Apply after cleanser in the morning. Reapply sunscreen if outdoors for extended periods.'],
        ['Green Tea Seed Cream', 'Moisturizer', 'Combination', 1250.00, 5,
         'A deeply nourishing cream with Jeju green tea seed oil that delivers intense moisture while keeping oily zones balanced.',
         '/images/products/innisfree-moisturizer.png', 'Green Tea Seed Oil, Green Tea Extract, Squalane',
         'Take an adequate amount and apply evenly to face as the last step of skincare routine.'],
        // SERUMS
        ['Niacinamide 10% + Zinc 1%', 'Serum', 'Oily', 590.00, 2,
         'High-strength vitamin and mineral formula reduces the appearance of blemishes and balances visible sebum activity.',
         '/images/products/ordinary-niacinamide.png', 'Niacinamide 10%, Zinc PCA 1%',
         'Apply a few drops to face AM and PM before heavier creams.'],
        ['Hyaluronic Acid 2% + B5', 'Serum', 'Dry', 630.00, 2,
         'Multi-depth hydration serum with low, medium, and high-molecular weight hyaluronic acid plus vitamin B5 for instant plumping.',
         '/images/products/ordinary-ha.png', 'Hyaluronic Acid (Multi-weight), Panthenol (Vitamin B5)',
         'Apply a few drops to damp skin AM and PM. Follow with moisturizer.'],
        ['Alpha Arbutin 2% + HA', 'Serum', 'All', 550.00, 2,
         'Concentrated serum that reduces the appearance of dark spots and uneven skin tone using pure alpha arbutin.',
         '/images/products/ordinary-arbutin.png', 'Alpha Arbutin 2%, Hyaluronic Acid',
         'Apply a few drops to affected areas AM and PM. Use sunscreen during the day.'],
        ['10% Niacinamide Face Serum', 'Serum', 'Oily', 499.00, 7,
         'Lightweight serum with 10% Niacinamide that controls oil production, minimizes pores, and evens out skin tone.',
         '/images/products/minimalist-niacinamide.png', 'Niacinamide 10%, Zinc, Hyaluronic Acid',
         'Apply 4-5 drops on cleansed face. Gently press into skin. Follow with moisturizer.'],
        ['Vitamin C Serum', 'Serum', 'Normal', 695.00, 9,
         'A potent 15% vitamin C serum with mandarin that brightens skin, fights free radical damage, and promotes collagen production.',
         '/images/products/plum-vitamin-c.png', 'Ethyl Ascorbic Acid 15%, Mandarin Extract, Hyaluronic Acid',
         'Apply 3-4 drops on clean face in the morning. Always follow with sunscreen.'],
        ['Advanced Snail 96 Mucin Power Essence', 'Serum', 'All', 1350.00, 10,
         'A lightweight essence with 96% snail secretion filtrate that repairs damaged skin, hydrates deeply, and improves skin texture.',
         '/images/products/cosrx-snail.png', 'Snail Secretion Filtrate 96%, Betaine, Sodium Hyaluronate',
         'After cleansing and toning, apply a small amount and gently pat until absorbed.'],
        // SUNSCREENS
        ['Anthelios Melt-in Sunscreen SPF 60', 'Sunscreen', 'All', 1599.00, 3,
         'Ultra-lightweight, oil-free sunscreen with broad spectrum SPF 60. Cell-Ox Shield technology provides superior UVA/UVB protection.',
         '/images/products/laroche-sunscreen.png', 'Cell-Ox Shield, Mexoryl SX, Avobenzone, La Roche-Posay Thermal Spring Water',
         'Apply generously 15 minutes before sun exposure. Reapply every 2 hours.'],
        ['Ultra Sheer Dry-Touch Sunscreen SPF 50+', 'Sunscreen', 'Oily', 699.00, 4,
         'Clean-feel, non-greasy sunscreen with Dry-Touch technology. Provides powerful sun protection without a heavy or sticky feel.',
         '/images/products/neutrogena-sunscreen.png', 'Helioplex Technology, Avobenzone, Homosalate',
         'Apply liberally 15 minutes before sun exposure. Reapply every 2 hours.'],
        ['Daily UV Defence SPF 50+', 'Sunscreen', 'Sensitive', 999.00, 6,
         'A gentle, mineral-based daily sunscreen formulated for sensitive skin. Non-comedogenic with a lightweight matte finish.',
         '/images/products/cetaphil-sunscreen.png', 'Zinc Oxide, Titanium Dioxide, Glycerin, Vitamin E',
         'Apply as the last step of skincare routine every morning. Reapply if outdoors.'],
        ['SPF 50 Sunscreen Aqua Gel', 'Sunscreen', 'Combination', 449.00, 7,
         'A lightweight aqua-gel sunscreen with SPF 50 that provides multi-spectrum sun protection without white cast or stickiness.',
         '/images/products/minimalist-sunscreen.png', 'Multi-Spectrum UV Filters, Squalane, Centella',
         'Apply generously as the last step of morning skincare. Reapply every 2-3 hours.'],
        // TONERS
        ['Effaclar Astringent Lotion Toner', 'Toner', 'Oily', 1199.00, 3,
         'Micro-exfoliating toner with salicylic acid and glycolic acid. Tightens pores and reduces excess shine for clearer skin.',
         '/images/products/laroche-toner.png', 'Salicylic Acid, Glycolic Acid, La Roche-Posay Thermal Spring Water',
         'Apply with a cotton pad to clean face. Avoid eye area. Use once daily in the evening.'],
        ['Glycolic Acid 7% Toning Solution', 'Toner', 'Normal', 750.00, 2,
         'An exfoliating toner that improves skin radiance and texture with 7% glycolic acid, amino acids, and aloe vera.',
         '/images/products/ordinary-glycolic.png', 'Glycolic Acid 7%, Amino Acids, Aloe Vera, Ginseng, Tasmanian Pepperberry',
         'Apply to a cotton pad and sweep across face in the evening. Do not use with other exfoliants.'],
        ['BHA Blackhead Power Liquid', 'Toner', 'Oily', 1100.00, 10,
         'A gentle BHA exfoliant that dissolves blackheads and impurities within pores. Contains willow bark water for soothing exfoliation.',
         '/images/products/cosrx-bha.png', 'Betaine Salicylate 4%, Willow Bark Water, Niacinamide',
         'After cleansing, apply to cotton pad and sweep across face. Start with 2-3 times per week.'],
        ['Green Tea Balancing Toner', 'Toner', 'Combination', 650.00, 5,
         'A hydrating toner with Jeju green tea that balances moisture levels while lightly controlling excess oil in T-zone.',
         '/images/products/innisfree-toner.png', 'Green Tea Extract, Betaine, Hyaluronic Acid',
         'After cleansing, pour onto hands or cotton pad and pat gently into skin.'],
        // MASKS
        ['Volcanic Pore Clay Mask', 'Mask', 'Oily', 750.00, 5,
         'A deep-cleansing clay mask with Jeju volcanic ash that draws out impurities and controls sebum production.',
         '/images/products/innisfree-mask.png', 'Jeju Volcanic Ash, Kaolin, Bentonite',
         'Apply an even layer on clean, dry face. Leave for 10-15 minutes. Rinse with lukewarm water. Use 1-2x per week.'],
        ['AHA 30% + BHA 2% Peeling Solution', 'Mask', 'Normal', 630.00, 2,
         'An advanced chemical exfoliation treatment for experienced users. Targets textural irregularities and dullness for boosted radiance.',
         '/images/products/ordinary-peeling.png', 'Glycolic Acid, Salicylic Acid, Lactic Acid, Tartaric Acid, Citric Acid',
         'Apply evenly to clean, dry face. Leave for no more than 10 minutes. Rinse with lukewarm water. Use max 2x per week.'],
        ['Ultimate Repair Sleeping Mask', 'Mask', 'Dry', 895.00, 10,
         'An overnight sleeping mask that delivers intense moisture and repair while you sleep. Formulated with propolis for soothing hydration.',
         '/images/products/cosrx-mask.png', 'Propolis Extract, Hyaluronic Acid, Ceramides, Niacinamide',
         'Apply a thin, even layer as the last step of your evening routine. Leave overnight. Rinse in the morning.'],
        // EYE CARE
        ['Caffeine Solution 5% + EGCG', 'Eye Care', 'All', 520.00, 2,
         'Reduces the appearance of dark circles and puffiness around the eye area. Lightweight serum texture for easy absorption.',
         '/images/products/ordinary-caffeine.png', 'Caffeine 5%, EGCG (from Green Tea), Hyaluronic Acid',
         'Apply a small amount around eye area AM and PM. Pat gently with ring finger.'],
        ['Hydro Boost Eye Gel-Cream', 'Eye Care', 'Dry', 899.00, 4,
         'An ultra-hydrating eye gel-cream with hyaluronic acid that smooths and plumps the delicate under-eye area.',
         '/images/products/neutrogena-eye.png', 'Hyaluronic Acid, Olive Extract, Dimethicone',
         'Gently dab around the eye area morning and night with your ring finger.'],
        // TREATMENTS
        ['Azelaic Acid Suspension 10%', 'Treatment', 'All', 450.00, 2,
         'Brightening formula targets hyperpigmentation, uneven skin tone, and blemishes. Cream-gel texture with silicone for smooth application.',
         '/images/products/ordinary-azelaic.png', 'Azelaic Acid 10%, Dimethicone, Dimethyl Isosorbide',
         'Apply a small amount to affected areas AM and PM after water-based serums.'],
        ['2% BHA Liquid Exfoliant', 'Treatment', 'Oily', 2450.00, 11,
         'A leave-on exfoliant with 2% salicylic acid that unclogs pores, smooths wrinkles, and evens out skin tone and texture.',
         '/images/products/paulas-bha.png', 'Salicylic Acid 2%, Green Tea, Methylpropanediol',
         'Apply with cotton pad to clean face once or twice daily. Do not rinse off. Follow with moisturizer.'],
        ['Retinol 0.5% in Squalane', 'Treatment', 'Normal', 490.00, 2,
         'Pure retinol in a base of squalane for targeted anti-aging benefits. Reduces fine lines, wrinkles, and improves skin texture.',
         '/images/products/ordinary-retinol.png', 'Retinol 0.5%, Squalane',
         'Apply a small amount to clean face in the evening only. Start 2x per week and build up. Always use SPF during the day.'],
        ['Salicylic Acid 2% Masque', 'Treatment', 'Oily', 899.00, 2,
         'A masque with 2% salicylic acid and charcoal that targets pore congestion, blemishes, and acne-prone skin.',
         '/images/products/ordinary-salicylic.png', 'Salicylic Acid 2%, Kaolin, Charcoal, Squalane',
         'Apply to clean face, leave for 10 minutes, rinse. Use 1-2 times per week.'],
        ['Anti-Acne Kit - Complete Solution', 'Treatment', 'Oily', 1499.00, 7,
         'A comprehensive 3-step anti-acne system with salicylic acid cleanser, niacinamide serum, and oil-free moisturizer for clear skin.',
         '/images/products/minimalist-acne.png', 'Salicylic Acid, Niacinamide, Zinc, Centella Asiatica',
         'Use cleanser AM/PM, apply serum on affected areas, follow with moisturizer.'],
        ['Tranexamic Acid 3% Serum', 'Treatment', 'All', 549.00, 7,
         'Targeted treatment for stubborn hyperpigmentation and dark spots. Works by inhibiting melanin transfer for visibly brighter skin.',
         '/images/products/minimalist-tranexamic.png', 'Tranexamic Acid 3%, HPA (Hydroxy Phenoxy Propionic Acid)',
         'Apply 4-5 drops on dark spots and pigmented areas. Use AM and PM. Always follow with sunscreen in the daytime.'],
        // LIP CARE
        ['Lip Balm - Berry', 'Lip Care', 'All', 299.00, 9,
         'A deeply moisturizing tinted lip balm with natural berry extracts. Provides long-lasting hydration with a subtle color boost.',
         '/images/products/plum-lipbalm.png', 'Shea Butter, Beeswax, Berry Extract, Vitamin E',
         'Apply as needed throughout the day. Reapply after eating or drinking.'],
        // BODY CARE
        ['Bio Morning Nectar Body Wash', 'Body Care', 'All', 349.00, 12,
         'An indulgent body wash with morning nectar that gently cleanses while providing nourishment and a radiant glow to the body.',
         '/images/products/biotique-bodywash.png', 'Honey, Wheatgerm Oil, Wild Turmeric, Soap Nut',
         'Lather on wet body, massage gently, rinse off. Use daily.'],
        ['SA Body Wash with Salicylic Acid', 'Body Care', 'Oily', 699.00, 1,
         'A body wash with salicylic acid, hyaluronic acid, and niacinamide that gently exfoliates and hydrates for smoother body skin.',
         '/images/products/cerave-bodywash.png', 'Salicylic Acid, Hyaluronic Acid, Niacinamide, Ceramides',
         'Apply to wet body, lather, leave for 1-2 minutes, rinse. Use 2-3 times per week.'],
        // ADDITIONAL
        ['Watermelon Glow Niacinamide Serum', 'Serum', 'Combination', 1890.00, 8,
         'A pore-minimizing serum with niacinamide and watermelon extract. Reduces shine, tightens pores, and improves skin texture.',
         '/images/products/dotkey-watermelon.png', 'Niacinamide, Watermelon Extract, Hyaluronic Acid, Alpha Arbutin',
         'Apply 3-4 drops on clean face, gently pat in. Use AM and PM.'],
        ['Aloe Hydra Cool Soothing Gel', 'Moisturizer', 'Sensitive', 299.00, 5,
         'A cooling, soothing gel with Jeju aloe vera that instantly calms irritated and sunburned skin while providing lightweight moisture.',
         '/images/products/innisfree-aloe.png', 'Aloe Vera 93%, Centella Asiatica, Panthenol',
         'Apply generously on face and body. Can be used as emergency soothing treatment.'],
        ['Gentle Skin Cleanser', 'Cleanser', 'Sensitive', 599.00, 6,
         'An ultra-gentle, soap-free cleanser that cleans without stripping or irritating sensitive skin. Dermatologist recommended.',
         '/images/products/cetaphil-cleanser.png', 'Cetyl Alcohol, Propylene Glycol, Sodium Lauryl Sulfate (mild)',
         'Apply to damp skin, massage gently, rinse or wipe off with a soft cloth.'],
        ['Rice Toner', 'Toner', 'Dry', 945.00, 5,
         'A nourishing toner enriched with rice bran ferment that brightens, hydrates, and plumps dry and dull skin for a healthy glow.',
         '/images/products/innisfree-rice-toner.png', 'Rice Bran Ferment Filtrate, Niacinamide, Hyaluronic Acid',
         'Pour onto hands or cotton pad and pat gently into cleansed face. Use AM and PM.'],
        ['Full Fit Propolis Synergy Toner', 'Toner', 'Sensitive', 1150.00, 10,
         'A honey-like essence toner with 73% propolis that deeply nourishes, soothes, and strengthens the skin barrier.',
         '/images/products/cosrx-propolis-toner.png', 'Propolis Extract 73%, Betaine, Panthenol, Allantoin',
         'After cleansing, apply onto face and gently pat until absorbed. Best on slightly damp skin.'],
        ['Retinal 0.2% Cream', 'Treatment', 'Normal', 699.00, 7,
         'Next-generation retinoid treatment with retinal (retinaldehyde) that works 11x faster than retinol for anti-aging results.',
         '/images/products/minimalist-retinal.png', 'Retinal 0.2%, Squalane, Coenzyme Q10',
         'Apply a pea-sized amount on clean face at night. Start 1-2x per week. Always use SPF during daytime.'],
        ['Pore Tightening Serum', 'Serum', 'Oily', 850.00, 5,
         'A targeted serum that visibly tightens enlarged pores and controls excess sebum with Jeju volcanic cluster water.',
         '/images/products/innisfree-pore-serum.png', 'Volcanic Cluster Water, AHA, BHA, PHA',
         'Apply to T-zone and areas with visible pores after toning. Use AM and PM.'],
        ['Daily Moisturizing Lotion', 'Moisturizer', 'Normal', 549.00, 6,
         'A lightweight, fast-absorbing body and face lotion that provides 24-hour hydration. Non-greasy formula for everyday use.',
         '/images/products/cetaphil-lotion.png', 'Macadamia Nut Oil, Sweet Almond Oil, Glycerin, Niacinamide',
         'Apply to face and body after cleansing. Suitable for daily morning and night use.'],
        ['2% Salicylic Acid Face Serum', 'Serum', 'Oily', 545.00, 7,
         'A potent exfoliating serum with 2% salicylic acid that penetrates deep into pores to fight acne and blackheads.',
         '/images/products/minimalist-salicylic.png', 'Salicylic Acid 2%, LHA, Zinc',
         'Apply 3-4 drops on clean face in the evening. Start with alternate days.'],
        ['Grape Seed 80 Firming Serum', 'Serum', 'Normal', 1450.00, 5,
         'An antioxidant-rich firming serum with 80% grape seed extract that fights free radicals and firms the skin.',
         '/images/products/innisfree-grape-serum.png', 'Grape Seed Extract 80%, Vitamin E, Panthenol',
         'Apply after toner and before moisturizer. Pat gently into skin.'],
        ['10% Vitamin C Face Serum', 'Serum', 'All', 599.00, 9,
         'A stable vitamin C serum with Japanese Mandarin that brightens skin, fades dark spots, and boosts collagen for a youthful glow.',
         '/images/products/plum-vitc-serum.png', 'Ethyl Ascorbic Acid 10%, Mandarin Extract, Kakadu Plum',
         'Apply 4-5 drops on clean face every morning. Follow with moisturizer and sunscreen.']
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
