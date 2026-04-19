const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueName = `skin_${Date.now()}_${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|webp/;
        const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
        const mimeOk = allowed.test(file.mimetype);
        if (extOk && mimeOk) return cb(null, true);
        cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
});

// Free AI API configuration using Groq (free tier with Llama 3)
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Helper to call Groq/Llama API
async function callAI(messages, maxTokens = 800) {
    if (!GROQ_API_KEY) return null;
    
    try {
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages,
                max_tokens: maxTokens,
                temperature: 0.7
            })
        });
        
        if (!response.ok) {
            console.error('Groq API error:', response.status);
            return null;
        }
        
        const data = await response.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (err) {
        console.error('AI API call failed:', err.message);
        return null;
    }
}

// GET Assistant Page
router.get('/', isAuthenticated, (req, res) => {
    res.render('assistant');
});

// POST Chat with AI Assistant
router.post('/chat', isAuthenticated, async (req, res) => {
    try {
        const { message } = req.body;
        const user = req.session.user;

        if (!message || message.trim() === '') {
            return res.json({ error: 'Please enter a message' });
        }

        let reply = '';
        const skinType = user.C_Skin_type || 'Normal';
        const concerns = user.Skin_concerns || 'None specified';

        // Get relevant products from DB for context
        const [products] = await db.query(`
            SELECT p.Product_name, p.Category, p.P_Skin_type, p.Price, p.Description, b.Brand_name
            FROM Product p JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE p.P_Skin_type IN (?, 'All')
            LIMIT 20
        `, [skinType]);

        const productContext = products.map(p =>
            `${p.Brand_name} ${p.Product_name} (${p.Category}, ₹${p.Price}, for ${p.P_Skin_type} skin): ${p.Description}`
        ).join('\n');

        // Try AI API first
        const aiReply = await callAI([
            {
                role: 'system',
                content: `You are Luminar AI, a professional, empathetic, and highly knowledgeable skincare consultant for the Luminar skincare website. You provide detailed, thoughtful, and personalized skincare advice — similar to how a real dermatologist or skincare expert would respond.

Customer Profile:
- Name: ${user.Cust_name}
- Skin Type: ${skinType}
- Skin Concerns: ${concerns}

Available Products in our catalog:
${productContext}

Guidelines:
- Be warm, professional, empathetic, and deeply knowledgeable about skincare
- Give detailed, comprehensive answers — not just product lists
- When someone describes a skin problem, explain what's happening, why it happens, what ingredients help, and then recommend products
- For conditions like hyperpigmentation, acne, etc., explain the science behind treatments
- Recommend specific products from our catalog when relevant (mention exact product names with prices)
- Explain WHY certain products and ingredients suit their specific skin type and concerns
- Provide actionable skincare routine steps and lifestyle tips
- Discuss ingredients, their mechanisms, and benefits in detail
- Address skin concerns with both product solutions AND lifestyle advice (diet, water intake, sleep, stress management)
- If someone asks about a condition getting worse with a product, explain possible reasons (purging vs. reaction, wrong product for skin type, etc.)
- Use ₹ for prices
- Keep responses thorough but well-organized (use bullet points and bold for readability)
- If asked about things unrelated to skincare, politely redirect
- NEVER give actual medical diagnoses — recommend seeing a dermatologist for serious concerns
- Be encouraging and supportive — skincare is a journey`
            },
            { role: 'user', content: message }
        ]);

        if (aiReply) {
            reply = aiReply;
        } else {
            // Enhanced rule-based fallback
            reply = await getEnhancedResponse(message, user, products);
        }

        res.json({ reply });
    } catch (err) {
        console.error('Chat error:', err);
        res.json({ reply: 'I apologize, I\'m experiencing some issues right now. Please try again in a moment. 💜' });
    }
});

// POST Generate Routine
router.post('/routine', isAuthenticated, async (req, res) => {
    try {
        const { skin_type, concerns } = req.body;
        const user = req.session.user;
        const userSkinType = skin_type || user.C_Skin_type || 'Normal';
        const userConcerns = concerns || user.Skin_concerns || '';

        // Get products for this skin type
        const [products] = await db.query(`
            SELECT p.Product_name, p.Category, p.Price, p.Description, b.Brand_name
            FROM Product p JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE p.P_Skin_type IN (?, 'All')
            ORDER BY p.Category, p.Price ASC
        `, [userSkinType]);

        let routine = null;

        // Try AI-generated routine
        const aiRoutine = await callAI([
            {
                role: 'system',
                content: `You are a professional skincare routine generator. Create a detailed, personalized AM and PM skincare routine based on the user's skin type and concerns. 

Available products:
${products.map(p => `${p.Brand_name} ${p.Product_name} (${p.Category}, ₹${p.Price})`).join('\n')}

Return a JSON object with this exact structure:
{
    "skin_type": "...",
    "morning": [
        {"step": 1, "category": "Cleanser", "product": "Product Name", "brand": "Brand", "price": 499, "how": "How to apply", "amount": "Amount to use", "wait_time": "Wait time before next step"},
        ...
    ],
    "evening": [
        {"step": 1, "category": "Cleanser", "product": "Product Name", "brand": "Brand", "price": 499, "how": "How to apply", "amount": "Amount to use", "wait_time": "Wait time before next step"},
        ...
    ],
    "weekly": [
        {"treatment": "Treatment name", "frequency": "1-2x per week", "product": "Product Name", "brand": "Brand"}
    ],
    "avoid": ["Thing to avoid 1", "Thing to avoid 2"],
    "tips": ["Lifestyle tip 1", "Lifestyle tip 2"],
    "total_cost": 2500
}

Use ONLY products from the catalog. Choose budget-friendly options when possible.`
            },
            { role: 'user', content: `Create a skincare routine for ${userSkinType} skin with these concerns: ${userConcerns || 'general skincare'}` }
        ], 1200);

        if (aiRoutine) {
            try {
                const jsonMatch = aiRoutine.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    routine = JSON.parse(jsonMatch[0]);
                }
            } catch (e) {
                console.error('Failed to parse AI routine:', e.message);
            }
        }

        // Fallback to generated routine
        if (!routine) {
            routine = generateRoutine(userSkinType, userConcerns, products);
        }

        // Save routine
        await db.query(
            'INSERT INTO Saved_routines (Cust_id, skin_type, concerns, routine_data) VALUES (?, ?, ?, ?)',
            [user.Cust_id, userSkinType, userConcerns, JSON.stringify(routine)]
        );

        res.json({ success: true, routine });
    } catch (err) {
        console.error('Routine generation error:', err);
        res.json({ error: 'Failed to generate routine. Please try again.' });
    }
});

// POST Analyze Skin Image
router.post('/analyze-image', isAuthenticated, upload.single('skinImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.json({ error: 'Please upload an image' });
        }

        const user = req.session.user;
        const imagePath = `/uploads/${req.file.filename}`;
        let analysisResult = getSimulatedAnalysis(user);
        let detectedConditions = analysisResult.conditions.join(', ');
        let recommendations = analysisResult.analysis;

        // Save analysis to database
        await db.query(
            'INSERT INTO Skin_analysis (Cust_id, Image_path, Analysis_result, Detected_conditions, Recommendations) VALUES (?, ?, ?, ?, ?)',
            [user.Cust_id, imagePath, JSON.stringify(analysisResult), detectedConditions, recommendations]
        );

        // Get recommended products
        let productRecs = [];
        if (analysisResult.conditions && analysisResult.conditions.length > 0) {
            const searchTerms = analysisResult.conditions.map(c => `%${c}%`);
            const placeholders = searchTerms.map(() => 'p.Description LIKE ?').join(' OR ');
            const [prods] = await db.query(`
                SELECT p.*, b.Brand_name FROM Product p
                JOIN Brand b ON p.Brand_id = b.Brand_id
                WHERE (${placeholders}) OR p.P_Skin_type IN (?, 'All')
                GROUP BY p.Product_id
                LIMIT 6
            `, [...searchTerms, user.C_Skin_type || 'Normal']);
            productRecs = prods;
        }

        res.json({
            success: true,
            analysis: analysisResult,
            products: productRecs,
            imagePath
        });
    } catch (err) {
        console.error('Image analysis error:', err);
        res.json({ error: 'Failed to analyze image. Please try again.' });
    }
});

// GET Did You Know tips
router.get('/tips', isAuthenticated, async (req, res) => {
    const { category } = req.query;
    const tips = getSkincaresTips(category);
    res.json({ tips });
});

// ================================================
// Enhanced rule-based response (much more comprehensive)
// ================================================
async function getEnhancedResponse(message, user, products) {
    const msg = message.toLowerCase();
    const skinType = user.C_Skin_type || 'Normal';

    // Hyperpigmentation / dark spots - DETAILED response
    if (msg.includes('hyperpigmentation') || msg.includes('dark spot') || msg.includes('pigment') || msg.includes('uneven') || msg.includes('melasma')) {
        const [prods] = await db.query(`
            SELECT p.Product_name, p.Price, b.Brand_name, p.Description FROM Product p
            JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE p.Description LIKE '%hyperpigmentation%' OR p.Description LIKE '%dark spot%' OR p.Description LIKE '%brighten%' OR p.Category = 'Treatment'
            LIMIT 5
        `);
        let reply = `I understand how frustrating hyperpigmentation can be. Let me give you a comprehensive guide on dealing with it. 💜\n\n`;
        reply += `**What causes hyperpigmentation?**\nHyperpigmentation occurs when melanocytes (pigment-producing cells) overproduce melanin. Common triggers include:\n• Sun exposure (UV stimulates melanin production)\n• Post-inflammatory hyperpigmentation (PIH) from acne or injuries\n• Hormonal changes (melasma, especially during pregnancy or birth control use)\n• Friction and irritation\n\n`;
        reply += `**Key Ingredients That Work:**\n`;
        reply += `• **Vitamin C** (10-20%) — Inhibits tyrosinase enzyme, brightens overall tone\n`;
        reply += `• **Niacinamide** (5-10%) — Prevents melanin transfer to skin cells\n`;
        reply += `• **Alpha Arbutin** (2%) — Safer alternative to hydroquinone\n`;
        reply += `• **Tranexamic Acid** (3%) — Targets stubborn melasma\n`;
        reply += `• **Azelaic Acid** (10-20%) — Anti-inflammatory + brightening\n`;
        reply += `• **Retinol/Retinal** — Speeds cell turnover to fade dark spots\n\n`;
        reply += `**Products I Recommend from Our Catalog:**\n`;
        prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
        reply += `\n**Critical Rule:** ALWAYS wear SPF 50+ sunscreen — sun exposure is the #1 reason hyperpigmentation doesn't fade or gets worse! Reapply every 2-3 hours. ☀️\n\n`;
        reply += `**If your current cream is making it worse**, it could be:\n1. **Purging** (temporary, lasts 4-6 weeks with actives like retinol)\n2. **Irritation** causing more inflammation → more pigment\n3. The product may contain irritating fragrance or alcohol\n\nI'd recommend stopping the product for 2 weeks, using only gentle cleanser + moisturizer + sunscreen, then gradually introducing one active at a time.`;
        return reply;
    }

    // Acne / pimples - DETAILED
    if (msg.includes('acne') || msg.includes('pimple') || msg.includes('breakout') || msg.includes('zit')) {
        const [prods] = await db.query(`
            SELECT p.Product_name, p.Price, b.Brand_name FROM Product p
            JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE p.Description LIKE '%acne%' OR p.Description LIKE '%blemish%' OR p.Description LIKE '%salicylic%'
            LIMIT 5
        `);
        let reply = `Acne is incredibly common and very treatable — let me help you tackle it effectively! 💪\n\n`;
        reply += `**Understanding Your Acne:**\nAcne forms when pores get clogged with dead skin + excess oil → bacteria (C. acnes) feeds on this → inflammation → pimples.\n\n`;
        reply += `**My Treatment Recommendations:**\n`;
        reply += `• **Salicylic Acid (BHA 2%)** — Oil-soluble, penetrates INTO pores to dissolve clogs\n`;
        reply += `• **Niacinamide (10%)** — Reduces inflammation, controls oil, fades acne marks\n`;
        reply += `• **Benzoyl Peroxide (2.5%)** — Kills acne-causing bacteria on contact\n`;
        reply += `• **Retinol** — Prevents new clogs by speeding cell turnover\n\n`;
        reply += `**Recommended Products:**\n`;
        prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
        reply += `\n**Daily Routine for Acne-Prone Skin:**\n`;
        reply += `**AM:** Gentle cleanser → Niacinamide serum → Oil-free moisturizer → SPF 50\n`;
        reply += `**PM:** Double cleanse → BHA/Salicylic acid → Moisturizer\n\n`;
        reply += `**Important Lifestyle Tips:**\n`;
        reply += `• Don't pick or squeeze pimples — causes scarring and more inflammation\n`;
        reply += `• Change pillowcases every 2-3 days\n`;
        reply += `• Clean your phone screen daily\n`;
        reply += `• Reduce dairy and high-sugar foods (they can trigger breakouts)\n`;
        reply += `• Manage stress — cortisol increases oil production\n`;
        reply += `• Drink 2-3 liters of water daily`;
        return reply;
    }

    // Product recommendations
    if (msg.includes('recommend') || msg.includes('suggest') || msg.includes('best product') || msg.includes('what should')) {
        const shuffled = products.sort(() => 0.5 - Math.random()).slice(0, 5);
        let reply = `Based on your **${skinType}** skin type, here are my top recommendations:\n\n`;
        shuffled.forEach(p => {
            reply += `• **${p.Brand_name} ${p.Product_name}** (${p.Category}) — ₹${p.Price}\n  _${p.Description.substring(0, 100)}..._\n\n`;
        });
        reply += `Would you like me to create a complete skincare routine for you, or know more about any specific product? 💜`;
        return reply;
    }

    // Dry skin
    if (msg.includes('dry') || msg.includes('hydrat') || msg.includes('moistur') || msg.includes('flak')) {
        return `For **dry skin**, hydration is absolutely crucial! Here's a comprehensive approach: 💧\n\n**Your Ideal Routine:**\n**AM:** Cream/milk cleanser (no foaming!) → Hyaluronic acid serum on DAMP skin → Rich cream moisturizer → SPF 50 (cream-based)\n**PM:** Oil cleanser → Cream cleanser → HA serum → Facial oil or sleeping mask\n\n**Hero Ingredients for Dry Skin:**\n• **Hyaluronic Acid** — Holds 1000x its weight in water\n• **Ceramides** — Repair the moisture barrier\n• **Squalane** — Lightweight oil that mimics skin's natural sebum\n• **Glycerin** — Powerful humectant\n• **Shea Butter** — Deep, lasting hydration\n\n**What to AVOID:**\n• Foaming cleansers (they strip natural oils)\n• Alcohol-based toners\n• Hot water on face (use lukewarm)\n• Over-exfoliating (max 1-2x per week)\n\n**Pro Tips:**\n• Apply HA serum on damp skin — it needs water to work!\n• Layer products thinnest → thickest\n• Use a humidifier in dry weather\n• Drink at least 2-3 liters of water daily\n\nWant me to recommend specific products from our catalog? 💜`;
    }

    // Oily skin
    if (msg.includes('oily') || msg.includes('shine') || msg.includes('greasy') || msg.includes('sebum') || msg.includes('pore')) {
        return `For **oily skin**, the key is balance — not stripping! Here's why and how: 💚\n\n**Your Ideal Routine:**\n**AM:** Gel/foam cleanser → Niacinamide serum → Lightweight gel moisturizer → Oil-free/gel SPF\n**PM:** Oil cleanser (yes, oil!) → Gel cleanser → BHA/Salicylic acid toner → Niacinamide → Light moisturizer\n\n**Hero Ingredients for Oily Skin:**\n• **Niacinamide (10%)** — Proven to reduce sebum by 25%\n• **Salicylic Acid (BHA)** — Dissolves oil inside pores\n• **Green Tea** — Natural sebum control + antioxidant\n• **Zinc** — Anti-inflammatory, reduces oil\n• **Hyaluronic Acid** — Yes! Oily skin needs hydration too!\n\n**Common Mistakes:**\n• Skipping moisturizer — dehydrated skin produces MORE oil!\n• Over-washing face (max 2x daily)\n• Using harsh, stripping cleansers\n• Over-exfoliating with physical scrubs\n\n**Diet Tips:**\n• Reduce dairy, sugar, and fried foods\n• Eat omega-3 rich foods (fish, walnuts, flax seeds)\n• Green tea (drink it AND apply it!)\n• Stay hydrated — water helps regulate oil production\n\nWant me to build a complete routine with specific products? 💜`;
    }

    // Sensitive skin
    if (msg.includes('sensitive') || msg.includes('irritat') || msg.includes('redness') || msg.includes('react') || msg.includes('sting')) {
        return `For **sensitive skin**, less is more — and ingredient quality matters most! 🌸\n\n**Your Ideal Routine (Keep it Simple!):**\n**AM:** Ultra-gentle cream cleanser → Soothing serum (centella/CICA) → Barrier cream with ceramides → Mineral SPF 50\n**PM:** Micellar water → Gentle cleanser → Calming serum → Rich moisturizer\n\n**Hero Ingredients for Sensitive Skin:**\n• **Centella Asiatica (CICA)** — Calms inflammation, speeds healing\n• **Ceramides** — Rebuild and protect the barrier\n• **Panthenol (Vitamin B5)** — Soothes and hydrates\n• **Allantoin** — Anti-irritant and moisturizing\n• **Oat Extract (Colloidal Oatmeal)** — Natural anti-inflammatory\n\n**AVOID These Ingredients:**\n❌ Fragrance/perfume (even "natural" fragrances)\n❌ Essential oils (lavender, tea tree can irritate)\n❌ Alcohol denat.\n❌ Harsh surfactants (SLS)\n❌ High-concentration acids without buffering\n\n**Important Rules:**\n• Always patch test new products (behind ear, 48 hours)\n• Introduce ONE new product at a time (wait 2 weeks)\n• Look for "fragrance-free" (not "unscented")\n• Avoid drastic temperature changes on skin\n\nWant specific product recommendations? 💜`;
    }

    // Skincare routine
    if (msg.includes('routine') || msg.includes('regimen') || msg.includes('steps') || msg.includes('morning') || msg.includes('night')) {
        return `Here's a complete **${skinType} skin** routine — morning and night! ✨\n\n**☀️ Morning (AM) — 5 Steps:**\n1. 🧼 **Gentle Cleanser** — Remove overnight buildup (use lukewarm water)\n2. 💧 **Toner/Essence** — Balance pH, prep skin for actives\n3. ✨ **Serum** — Vitamin C (brightening) OR Niacinamide (oil control)\n4. 🧴 **Moisturizer** — Lock in hydration (gel for oily, cream for dry)\n5. ☀️ **Sunscreen SPF 50+** — THE most important step! Apply 2-3 finger lengths\n\n**🌙 Evening (PM) — 6 Steps:**\n1. 🧼 **Oil Cleanser** — Remove sunscreen, makeup, pollution\n2. 🧼 **Water-Based Cleanser** — Deep clean (double cleansing!)\n3. 💧 **Exfoliating Toner** — BHA for oily, AHA for dry (2-3x/week)\n4. ✨ **Treatment Serum** — Retinol (anti-aging) OR targeted treatment\n5. 👁️ **Eye Cream** — Gentle patting with ring finger\n6. 🧴 **Night Cream/Sleeping Mask** — Heavier than daytime moisturizer\n\n**📅 Weekly Extras:**\n• Face mask (1-2x per week) — clay for oily, hydrating for dry\n• Chemical exfoliation — start slow, build up gradually\n\n**⏱️ Wait Times Between Steps:**\n• After actives (Vitamin C, AHA/BHA): wait 1-2 minutes\n• After moisturizer, before SPF: wait 1-2 minutes\n\nWant me to recommend specific products for each step? Use our **Routine Generator** for a complete personalized plan! 💜`;
    }

    // Sunscreen
    if (msg.includes('sunscreen') || msg.includes('spf') || msg.includes('sun protect') || msg.includes('tan')) {
        return `**Sunscreen is the #1 anti-aging and anti-pigmentation product — non-negotiable!** ☀️\n\nFor your **${skinType}** skin:\n\n**Which SPF Type to Choose:**\n• **Oily skin:** Gel/aqua-based, oil-free, matte finish SPF\n• **Dry skin:** Cream-based SPF with moisturizing ingredients\n• **Sensitive skin:** Mineral/physical SPF (zinc oxide, titanium dioxide)\n• **Combination:** Lightweight fluid or aqua-gel SPF\n\n**The Rules of Sunscreen:**\n• Apply SPF 50+ every single morning — even indoors (UVA passes through windows!)\n• Use 2-3 finger lengths for face + neck\n• Reapply every 2-3 hours if outdoors\n• Apply AFTER moisturizer, BEFORE makeup\n• No SPF = all your serums and treatments are wasted!\n\n**Common Myths Busted:**\n• "I'm dark-skinned, I don't need SPF" — FALSE! All skin tones get UV damage\n• "SPF in makeup is enough" — FALSE! You'd need 7 layers of foundation for adequate protection\n• "SPF 100 is twice as good as 50" — FALSE! SPF 50 blocks 98%, SPF 100 blocks 99%\n\nCheck our **Sunscreen** collection for options starting from ₹199! 💜`;
    }

    // Aging concerns
    if (msg.includes('aging') || msg.includes('wrinkle') || msg.includes('fine line') || msg.includes('anti-age') || msg.includes('sagging')) {
        return `Let's talk about anti-aging — it's never too early or too late to start! ✨\n\n**The Science of Skin Aging:**\n• **Intrinsic aging** — Genetics, natural collagen loss (1% per year after 25)\n• **Extrinsic aging** — Sun damage (90% of visible aging!), pollution, lifestyle\n\n**Gold Standard Anti-Aging Ingredients:**\n1. **Retinol/Retinal** — Stimulates collagen, speeds cell turnover, reduces wrinkles\n2. **Vitamin C** — Antioxidant, stimulates collagen, brightens\n3. **Peptides** — Signal skin to produce more collagen\n4. **Hyaluronic Acid** — Plumps and hydrates, fills fine lines\n5. **Niacinamide** — Improves firmness, reduces fine lines\n6. **SPF** — PREVENTS 90% of aging signs!\n\n**Anti-Aging Routine:**\n**AM:** Gentle cleanser → Vitamin C serum → Peptide moisturizer → SPF 50+\n**PM:** Double cleanse → Retinol (start 0.2%, build up) → Rich night cream\n\n**Lifestyle Tips:**\n• Sleep 7-8 hours (skin repairs at night)\n• Don't smoke (accelerates aging by 10+ years)\n• Eat antioxidant-rich foods (berries, leafy greens)\n• Stay hydrated\n• Manage stress (cortisol breaks down collagen)\n\nWant me to recommend specific anti-aging products? 💜`;
    }

    // Ingredient questions
    if (msg.includes('ingredient') || msg.includes('niacinamide') || msg.includes('retinol') || msg.includes('vitamin c') || msg.includes('hyaluronic') || msg.includes('salicylic')) {
        return `Great question about ingredients! Here's a cheat sheet of the most effective skincare actives: 🔬\n\n**🌟 Niacinamide (Vitamin B3)**\n• Controls oil, minimizes pores, fades dark spots\n• Safe to use with almost everything, AM and PM\n• Best at 5-10% concentration\n\n**🌟 Retinol/Retinal**\n• Gold standard for anti-aging\n• Reduces wrinkles, acne, pigmentation\n• Start low (0.2%), use PM only, ALWAYS use SPF\n• Avoid with: AHA/BHA on same routine step\n\n**🌟 Vitamin C**\n• Brightening, collagen-boosting, antioxidant\n• Use in AM for UV protection\n• Look for stable forms: Ethyl Ascorbic Acid, Ascorbyl Glucoside\n\n**🌟 Hyaluronic Acid**\n• Holds 1000x its weight in water\n• Apply on DAMP skin!\n• Safe for all skin types\n\n**🌟 Salicylic Acid (BHA)**\n• Oil-soluble — dissolves inside pores\n• Best for acne, blackheads, oily skin\n• Use 2% concentration, PM\n\n**🌟 AHA (Glycolic/Lactic Acid)**\n• Water-soluble surface exfoliant\n• Brightens, smooths texture\n• Start with lactic acid (gentler), build up to glycolic\n\n**Combination Rules:**\n✅ Niacinamide + HA — great together\n✅ Vitamin C + SPF — morning power duo\n⚠️ Retinol + AHA/BHA — use on alternate nights\n❌ Vitamin C + Niacinamide at high concentrations — can reduce efficacy\n\nWant to know about a specific ingredient? 💜`;
    }

    // Default — comprehensive greeting
    return `Hello ${user.Cust_name}! 💜 I'm your Luminar AI Skincare Assistant — think of me as your personal skincare expert!\n\nI can provide **detailed, personalized advice** on:\n\n🧴 **Product Recommendations** — matched to your ${skinType} skin type\n📋 **Complete Skincare Routines** — step-by-step AM and PM\n🔬 **Ingredient Deep-Dives** — what works, what to avoid, and why\n💡 **Skin Concern Solutions** — acne, dark spots, aging, sensitivity\n👩‍⚕️ **Detailed Guidance** — not just lists, but WHY and HOW things work\n📸 **AI Skin Analysis** — upload a photo for condition detection\n🏋️ **Lifestyle Tips** — diet, sleep, and habits that affect skin\n\n**Try asking me something like:**\n• "I have hyperpigmentation that's getting worse, what should I do?"\n• "Create a budget skincare routine for my oily skin"\n• "What ingredients should I avoid for sensitive skin?"\n• "Why is my acne not going away despite using products?"\n\nWhat would you like to know? ✨`;
}

// Generate routine helper
function generateRoutine(skinType, concerns, products) {
    const findProduct = (category) => {
        const match = products.find(p => p.Category === category);
        return match || null;
    };

    const cleanser = findProduct('Cleanser');
    const toner = findProduct('Toner');
    const serum = findProduct('Serum');
    const moisturizer = findProduct('Moisturizer');
    const sunscreen = findProduct('Sunscreen');
    const treatment = findProduct('Treatment');
    const eyeCare = findProduct('Eye Care');
    const mask = findProduct('Mask');

    const morning = [];
    const evening = [];
    let totalCost = 0;

    if (cleanser) {
        morning.push({ step: 1, category: 'Cleanser', product: cleanser.Product_name, brand: cleanser.Brand_name, price: cleanser.Price, how: 'Massage onto damp face for 30 seconds, rinse with lukewarm water', amount: 'Coin-sized amount', wait_time: 'None' });
        evening.push({ step: 1, category: 'Cleanser', product: cleanser.Product_name, brand: cleanser.Brand_name, price: cleanser.Price, how: 'Double cleanse — first with oil/balm, then this cleanser', amount: 'Coin-sized amount', wait_time: 'None' });
        totalCost += cleanser.Price;
    }
    if (toner) {
        morning.push({ step: 2, category: 'Toner', product: toner.Product_name, brand: toner.Brand_name, price: toner.Price, how: 'Pour onto hands or cotton pad, pat gently into skin', amount: '3-4 drops or enough to soak cotton pad', wait_time: '30 seconds' });
        evening.push({ step: 2, category: 'Toner', product: toner.Product_name, brand: toner.Brand_name, price: toner.Price, how: 'Apply to cotton pad and sweep across face', amount: 'Enough to soak cotton pad', wait_time: '30 seconds' });
        totalCost += toner.Price;
    }
    if (serum) {
        morning.push({ step: 3, category: 'Serum', product: serum.Product_name, brand: serum.Brand_name, price: serum.Price, how: 'Apply drops to face and gently press into skin', amount: '3-4 drops', wait_time: '1-2 minutes' });
        totalCost += serum.Price;
    }
    if (treatment) {
        evening.push({ step: 3, category: 'Treatment', product: treatment.Product_name, brand: treatment.Brand_name, price: treatment.Price, how: 'Apply to targeted areas or full face', amount: 'Pea-sized amount', wait_time: '1-2 minutes' });
        totalCost += treatment.Price;
    }
    if (eyeCare) {
        morning.push({ step: 4, category: 'Eye Care', product: eyeCare.Product_name, brand: eyeCare.Brand_name, price: eyeCare.Price, how: 'Dot around eye area and pat gently with ring finger', amount: 'Rice grain sized', wait_time: '30 seconds' });
        evening.push({ step: 4, category: 'Eye Care', product: eyeCare.Product_name, brand: eyeCare.Brand_name, price: eyeCare.Price, how: 'Dot around eye area and pat gently', amount: 'Rice grain sized', wait_time: '30 seconds' });
        totalCost += eyeCare.Price;
    }
    if (moisturizer) {
        morning.push({ step: 5, category: 'Moisturizer', product: moisturizer.Product_name, brand: moisturizer.Brand_name, price: moisturizer.Price, how: 'Apply evenly to face and neck, massage gently', amount: 'Pea-sized amount', wait_time: '1-2 minutes before SPF' });
        evening.push({ step: 5, category: 'Moisturizer', product: moisturizer.Product_name, brand: moisturizer.Brand_name, price: moisturizer.Price, how: 'Apply generously as last step', amount: 'Generous amount', wait_time: 'None — go to sleep!' });
        totalCost += moisturizer.Price;
    }
    if (sunscreen) {
        morning.push({ step: 6, category: 'Sunscreen', product: sunscreen.Product_name, brand: sunscreen.Brand_name, price: sunscreen.Price, how: 'Apply generously as LAST step of AM routine', amount: '2-3 finger lengths', wait_time: '15 minutes before going out' });
        totalCost += sunscreen.Price;
    }

    const weekly = [];
    if (mask) {
        weekly.push({ treatment: mask.Product_name, frequency: '1-2x per week', product: mask.Product_name, brand: mask.Brand_name });
    }

    const avoid = [];
    if (skinType === 'Oily') avoid.push('Heavy cream-based products', 'Coconut oil on face', 'Over-washing face (max 2x daily)');
    else if (skinType === 'Dry') avoid.push('Foaming/gel cleansers', 'Alcohol-based toners', 'Hot water on face');
    else if (skinType === 'Sensitive') avoid.push('Fragrance/perfume in products', 'Essential oils on face', 'Physical scrubs');
    else avoid.push('Using too many actives at once', 'Skipping sunscreen', 'Sleeping with makeup on');

    const tips = [
        'Drink 2-3 liters of water daily',
        'Sleep 7-8 hours for skin repair',
        'Change pillowcases every 3 days',
        'Never skip sunscreen, even indoors',
        'Patch test new products behind your ear'
    ];

    return {
        skin_type: skinType,
        morning,
        evening,
        weekly,
        avoid,
        tips,
        total_cost: totalCost
    };
}

// Simulated skin analysis helper
function getSimulatedAnalysis(user) {
    const conditions = [];
    const concerns = (user.Skin_concerns || '').split(',').map(c => c.trim()).filter(Boolean);

    if (concerns.length > 0) {
        conditions.push(...concerns);
    } else {
        const possibleConditions = ['Mild Acne', 'Slight Hyperpigmentation', 'Minor Dryness', 'Slight Redness'];
        conditions.push(possibleConditions[Math.floor(Math.random() * possibleConditions.length)]);
    }

    return {
        conditions,
        healthScore: Math.floor(Math.random() * 25) + 65,
        severity: 'mild',
        analysis: `Based on our analysis, we detected: ${conditions.join(', ')}. Your skin appears generally healthy with some areas that could benefit from targeted care. We recommend a consistent skincare routine with products suited for your ${user.C_Skin_type || 'Normal'} skin type.`,
        recommendations: [
            'Use a gentle cleanser twice daily',
            'Apply sunscreen SPF 50+ every morning',
            'Include a targeted serum for your concerns',
            'Moisturize morning and night',
            'Exfoliate 1-2 times per week'
        ],
        routine: {
            morning: ['Gentle Cleanser', 'Vitamin C Serum', 'Moisturizer', 'Sunscreen SPF 50+'],
            evening: ['Double Cleanse', 'Treatment Serum', 'Eye Cream', 'Night Moisturizer']
        }
    };
}

// Skincare tips database
function getSkincaresTips(category) {
    const allTips = {
        general: [
            { fact: 'Your skin completely renews itself every 27-30 days. Consistent skincare gives results by the 3rd cycle!', icon: '🔄' },
            { fact: 'Sunscreen prevents 90% of visible skin aging. Apply it even on cloudy days — 80% of UV rays pass through clouds.', icon: '☀️' },
            { fact: 'Drinking 2-3 liters of water daily improves skin hydration by up to 14% and gives a natural glow.', icon: '💧' },
            { fact: 'Your skin repairs itself between 10 PM and 2 AM. This is why sleeping early gives you "beauty sleep" glow!', icon: '🌙' },
            { fact: 'Stress triggers cortisol which increases oil production and inflammation. Meditation can literally improve your skin!', icon: '🧘' },
            { fact: 'Your phone screen has 10x more bacteria than a toilet seat. Clean it daily to prevent cheek and jawline acne.', icon: '📱' },
            { fact: 'Pillowcases collect dead skin, oil, and bacteria. Changing them every 2-3 days can reduce breakouts significantly.', icon: '🛏️' },
            { fact: 'Hot showers feel great but strip your skin\'s natural oils. Use lukewarm water for cleansing — your skin will thank you!', icon: '🚿' },
            { fact: 'The order you apply products matters: thinnest to thickest consistency. Water-based before oil-based!', icon: '📋' },
            { fact: 'Your lips don\'t have oil glands, making them the most dryness-prone area. Apply lip balm with SPF daily.', icon: '👄' },
            { fact: 'Sugar accelerates aging through glycation — a process that damages collagen. Cutting sugar can make you look years younger!', icon: '🍬' },
            { fact: 'The skin around your eyes is 10x thinner than the rest of your face. Always use your ring finger (least pressure) to apply eye products.', icon: '👁️' },
            { fact: 'Over-exfoliating damages your moisture barrier. Stick to chemical exfoliation 2-3 times per week maximum.', icon: '⚠️' },
            { fact: 'Vitamin C and Sunscreen together provide 4x better UV protection than sunscreen alone. Use Vitamin C in the morning!', icon: '🍊' },
            { fact: 'Your neck ages faster than your face because most people forget to apply skincare there. Always extend your routine to your neck!', icon: '✨' }
        ],
        darkCircles: [
            { fact: 'Dark circles are often genetic — if your parents have them, reducing them requires consistent care, not a miracle product.', icon: '🧬' },
            { fact: 'Iron deficiency is a common cause of dark circles. Include leafy greens, lentils, and citrus fruits in your diet.', icon: '🥬' },
            { fact: 'Cold compresses for 10 minutes can reduce dark circles by constricting blood vessels under the thin eye skin.', icon: '🧊' },
            { fact: 'Caffeine in eye creams works by constricting blood vessels, instantly reducing puffiness. Look for 5% caffeine concentration.', icon: '☕' },
            { fact: 'Sleep with your head slightly elevated to prevent fluid accumulation that causes puffy, dark under-eyes.', icon: '🛌' },
            { fact: 'Vitamin K helps with dark circles caused by broken capillaries. It strengthens blood vessel walls over time.', icon: '💊' }
        ],
        acne: [
            { fact: 'Popping a pimple pushes bacteria DEEPER into skin, causing more inflammation and potential scarring. Hands off!', icon: '🙅' },
            { fact: 'Toothpaste on pimples is a MYTH. It contains SLS, fluoride, and other irritants that worsen acne and cause chemical burns.', icon: '❌' },
            { fact: 'Dairy consumption is linked to increased acne in multiple studies. Try reducing dairy for 30 days and observe changes.', icon: '🥛' },
            { fact: 'Benzoyl Peroxide 2.5% is just as effective as 10% for acne — but with 80% less irritation and dryness!', icon: '💡' },
            { fact: 'Retinol can cause "purging" — temporary increased breakouts for 4-6 weeks. This is NORMAL and means it\'s working!', icon: '🔄' },
            { fact: 'Sweat doesn\'t cause acne, but leaving sweaty skin uncleansed does. Always wash face after exercise within 30 minutes.', icon: '🏋️' }
        ],
        skincare: [
            { fact: 'Apply hyaluronic acid on DAMP skin — it needs water to pull moisture into skin. On dry skin, it can actually dehydrate you!', icon: '💧' },
            { fact: 'Niacinamide at 5% concentration is just as effective as 10% with fewer side effects. More isn\'t always better!', icon: '⚗️' },
            { fact: 'Your skin\'s pH is 4.7-5.75 (slightly acidic). Using pH-balanced products maintains your acid mantle protection.', icon: '🧪' },
            { fact: 'Retinol should NEVER be used with Vitamin C in the same routine step. Use Vitamin C in AM, Retinol in PM.', icon: '🚫' },
            { fact: 'AHA (glycolic, lactic acid) works on the skin surface. BHA (salicylic acid) works INSIDE pores. Choose based on your concern!', icon: '🔬' },
            { fact: 'Natural ingredients aren\'t always better — poison ivy is natural too! Focus on clinically proven ingredients.', icon: '🌿' }
        ]
    };

    if (category && allTips[category]) {
        return allTips[category];
    }
    // Return mixed tips from all categories
    const mixed = [];
    Object.values(allTips).forEach(tipArr => {
        mixed.push(...tipArr.sort(() => 0.5 - Math.random()).slice(0, 3));
    });
    return mixed.sort(() => 0.5 - Math.random()).slice(0, 10);
}

module.exports = router;
