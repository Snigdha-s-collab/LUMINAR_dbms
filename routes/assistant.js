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

// AI mode disabled - using rule-based assistant (no OpenAI key needed)
let openai = null;

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

        if (openai) {
            // Real AI Mode with OpenAI
            const userContext = `
                Customer: ${user.Cust_name}
                Skin Type: ${user.C_Skin_type || 'Not determined'}
                Skin Concerns: ${user.Skin_concerns || 'None specified'}
            `;

            // Get relevant products from DB for context
            const [products] = await db.query(`
                SELECT p.Product_name, p.Category, p.P_Skin_type, p.Price, p.Description, b.Brand_name
                FROM Product p JOIN Brand b ON p.Brand_id = b.Brand_id
                WHERE p.P_Skin_type IN (?, 'All')
                LIMIT 15
            `, [user.C_Skin_type || 'All']);

            const productContext = products.map(p =>
                `${p.Brand_name} ${p.Product_name} (${p.Category}, ₹${p.Price}, for ${p.P_Skin_type} skin): ${p.Description}`
            ).join('\n');

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are Luminar AI, a professional skincare consultant for the Luminar skincare website. You help users with personalized skincare advice, product recommendations, and skin concern analysis.

Customer Profile:
${userContext}

Available Products in our catalog:
${productContext}

Guidelines:
- Be warm, professional, and knowledgeable about skincare
- Recommend products from our catalog when relevant (mention exact product names)
- Explain why certain products suit their skin type
- Provide skincare routine tips
- Discuss ingredients and their benefits
- Address skin concerns with solutions
- Use ₹ for prices
- Keep responses concise but informative (2-3 paragraphs max)
- If asked about things unrelated to skincare, politely redirect the conversation`
                    },
                    { role: 'user', content: message }
                ],
                max_tokens: 500,
                temperature: 0.7
            });

            reply = completion.choices[0].message.content;
        } else {
            // Rule-based fallback mode
            reply = await getRuleBasedResponse(message, user);
        }

        res.json({ reply });
    } catch (err) {
        console.error('Chat error:', err);
        res.json({ reply: 'I apologize, I\'m experiencing some issues right now. Please try again in a moment. 💜' });
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
        let analysisResult = {};
        let detectedConditions = '';
        let recommendations = '';

        if (openai) {
            // Real AI image analysis with GPT-4 Vision
            const imageBuffer = fs.readFileSync(req.file.path);
            const base64Image = imageBuffer.toString('base64');

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a professional dermatological AI assistant for the Luminar skincare website. Analyze the skin image and provide:
1. Detected skin conditions (acne, hyperpigmentation, dark circles, redness, dryness, wrinkles, blackheads, sun damage, etc.)
2. Skin health score (1-100)
3. Specific product recommendations from common skincare categories
4. A personalized skincare routine

Respond in JSON format:
{
    "conditions": ["condition1", "condition2"],
    "healthScore": 75,
    "severity": "mild/moderate/severe",
    "analysis": "Detailed analysis text...",
    "recommendations": ["recommendation1", "recommendation2"],
    "routine": { "morning": ["step1", "step2"], "evening": ["step1", "step2"] }
}

Be professional and empathetic. Do not diagnose medical conditions - recommend seeing a dermatologist for serious concerns.`
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: `Analyze this skin image. Customer skin type: ${user.C_Skin_type || 'Unknown'}, concerns: ${user.Skin_concerns || 'None specified'}` },
                            { type: 'image_url', url: { url: `data:image/jpeg;base64,${base64Image}` } }
                        ]
                    }
                ],
                max_tokens: 800
            });

            const responseText = completion.choices[0].message.content;
            try {
                // Try to parse JSON from the response
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    analysisResult = JSON.parse(jsonMatch[0]);
                } else {
                    analysisResult = { analysis: responseText, conditions: [], healthScore: 0 };
                }
            } catch (e) {
                analysisResult = { analysis: responseText, conditions: [], healthScore: 0 };
            }

            detectedConditions = (analysisResult.conditions || []).join(', ');
            recommendations = analysisResult.analysis || '';
        } else {
            // Simulated analysis fallback
            analysisResult = getSimulatedAnalysis(user);
            detectedConditions = analysisResult.conditions.join(', ');
            recommendations = analysisResult.analysis;
        }

        // Save analysis to database
        await db.query(
            'INSERT INTO Skin_analysis (Cust_id, Image_path, Analysis_result, Detected_conditions, Recommendations) VALUES (?, ?, ?, ?, ?)',
            [user.Cust_id, imagePath, JSON.stringify(analysisResult), detectedConditions, recommendations]
        );

        // Get recommended products based on detected conditions
        let productRecs = [];
        if (analysisResult.conditions && analysisResult.conditions.length > 0) {
            const searchTerms = analysisResult.conditions.map(c => `%${c}%`);
            const placeholders = searchTerms.map(() => 'p.Description LIKE ?').join(' OR ');
            const [products] = await db.query(`
                SELECT p.*, b.Brand_name FROM Product p
                JOIN Brand b ON p.Brand_id = b.Brand_id
                WHERE (${placeholders}) OR p.P_Skin_type IN (?, 'All')
                GROUP BY p.Product_id
                LIMIT 6
            `, [...searchTerms, user.C_Skin_type || 'Normal']);
            productRecs = products;
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

// Rule-based response helper
async function getRuleBasedResponse(message, user) {
    const msg = message.toLowerCase();
    const skinType = user.C_Skin_type || 'Normal';

    // Product recommendation queries
    if (msg.includes('recommend') || msg.includes('suggest') || msg.includes('best product') || msg.includes('what should')) {
        const [products] = await db.query(`
            SELECT p.Product_name, p.Category, p.Price, b.Brand_name
            FROM Product p JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE p.P_Skin_type IN (?, 'All')
            ORDER BY RANDOM() LIMIT 4
        `, [skinType]);

        let reply = `Based on your **${skinType}** skin type, here are some products I'd recommend:\n\n`;
        products.forEach(p => {
            reply += `• **${p.Brand_name} ${p.Product_name}** (${p.Category}) — ₹${p.Price}\n`;
        });
        reply += `\nWould you like more details about any of these products? 💜`;
        return reply;
    }

    // Skin concern queries
    if (msg.includes('acne') || msg.includes('pimple') || msg.includes('breakout')) {
        const [products] = await db.query(`
            SELECT p.Product_name, p.Price, b.Brand_name FROM Product p
            JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE p.Description LIKE '%acne%' OR p.Description LIKE '%blemish%' OR p.Category = 'Treatment'
            LIMIT 3
        `);
        let reply = `For acne and breakouts, here's what I recommend:\n\n`;
        reply += `**Key Ingredients to Look For:** Salicylic Acid, Niacinamide, Benzoyl Peroxide, Tea Tree Oil\n\n`;
        products.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
        reply += `\n**Tips:** Don't over-wash your face, keep it to twice a day. Avoid touching your face and change pillowcases regularly. 💜`;
        return reply;
    }

    if (msg.includes('hyperpigmentation') || msg.includes('dark spot') || msg.includes('pigment') || msg.includes('uneven')) {
        const [products] = await db.query(`
            SELECT p.Product_name, p.Price, b.Brand_name FROM Product p
            JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE p.Description LIKE '%hyperpigmentation%' OR p.Description LIKE '%dark spot%' OR p.Description LIKE '%brighten%'
            LIMIT 3
        `);
        let reply = `For hyperpigmentation and dark spots:\n\n`;
        reply += `**Key Ingredients:** Vitamin C, Niacinamide, Alpha Arbutin, Tranexamic Acid, Azelaic Acid\n\n`;
        products.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
        reply += `\n**Important:** Always wear SPF 50+ sunscreen — sun exposure is the #1 cause of hyperpigmentation! ☀️`;
        return reply;
    }

    if (msg.includes('dry') || msg.includes('hydrat') || msg.includes('moistur') || msg.includes('flak')) {
        return `For **dry skin**, hydration is key! Here's a routine:\n\n**AM:** Gentle cream cleanser → Hyaluronic acid serum → Rich moisturizer → SPF 50\n**PM:** Oil cleanser → Cream cleanser → HA serum → Night cream/sleeping mask\n\n**Key Ingredients:** Hyaluronic Acid, Ceramides, Glycerin, Squalane, Shea Butter\n\nAvoid harsh foaming cleansers and alcohol-based toners. Look for products labeled "for dry skin" in our catalog! 💧`;
    }

    if (msg.includes('oily') || msg.includes('shine') || msg.includes('greasy') || msg.includes('sebum')) {
        return `For **oily skin**, balance is everything!\n\n**AM:** Gel/foam cleanser → Niacinamide serum → Lightweight gel moisturizer → Oil-free SPF\n**PM:** Double cleanse (oil + gel) → BHA/Salicylic acid → Light moisturizer\n\n**Key Ingredients:** Niacinamide, Salicylic Acid, Hyaluronic Acid, Green Tea\n\n**Pro tip:** Don't skip moisturizer! Dehydrated oily skin produces MORE oil to compensate. Use oil-free, gel-based formulas. 💚`;
    }

    if (msg.includes('routine') || msg.includes('regimen') || msg.includes('steps')) {
        return `Here's a basic **${skinType} skin** routine:\n\n**Morning (AM):**\n1. 🧼 Gentle Cleanser\n2. 💧 Toner\n3. ✨ Serum (Vitamin C or Niacinamide)\n4. 🧴 Moisturizer\n5. ☀️ Sunscreen SPF 50+\n\n**Evening (PM):**\n1. 🧼 Double Cleanse (oil + water-based)\n2. 💧 Toner\n3. ✨ Treatment Serum (Retinol or AHA/BHA)\n4. 👁️ Eye Cream\n5. 🧴 Night Cream/Moisturizer\n\nWant me to recommend specific products for any of these steps? 💜`;
    }

    if (msg.includes('sunscreen') || msg.includes('spf') || msg.includes('sun protect')) {
        return `**Sunscreen is the #1 anti-aging product!** ☀️\n\nFor your **${skinType}** skin:\n- **Oily skin:** Choose gel/aqua-based, oil-free SPF\n- **Dry skin:** Cream-based SPF with moisturizing ingredients\n- **Sensitive skin:** Mineral/physical SPF (zinc oxide)\n\n**Rules:**\n• Apply SPF 50+ every morning (even indoors!)\n• Reapply every 2-3 hours if outdoors\n• Use 2-3 finger lengths for face\n• Apply AFTER moisturizer, BEFORE makeup\n\nCheck our Sunscreen collection for options that suit your skin! 💜`;
    }

    // Default response
    return `Hello ${user.Cust_name}! 💜 I'm your Luminar AI Skincare Assistant.\n\nI can help you with:\n• **Product recommendations** based on your ${skinType} skin type\n• **Skincare routines** tailored for you\n• **Skin concern solutions** (acne, dark spots, aging, etc.)\n• **Ingredient guidance** (what works & what to avoid)\n• **Upload a photo** for AI skin analysis!\n\nWhat would you like to know about? Just ask! ✨`;
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
            'Moisturize morning and night'
        ],
        routine: {
            morning: ['Gentle Cleanser', 'Vitamin C Serum', 'Moisturizer', 'Sunscreen SPF 50+'],
            evening: ['Double Cleanse', 'Treatment Serum', 'Eye Cream', 'Night Moisturizer']
        }
    };
}

module.exports = router;
