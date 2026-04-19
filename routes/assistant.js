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

// Free AI API configuration
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Helper to call Groq/Llama API
async function callGroq(messages, maxTokens = 800) {
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
        if (!response.ok) return null;
        const data = await response.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (err) {
        console.error('Groq API failed:', err.message);
        return null;
    }
}

// Helper to call Google Gemini API (free tier) — with full conversation history
async function callGemini(messages, maxTokens = 800) {
    if (!GEMINI_API_KEY) return null;
    try {
        const systemMsg = messages.find(m => m.role === 'system');
        // Build full conversation for Gemini
        const chatMessages = messages.filter(m => m.role !== 'system');
        const contents = chatMessages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
        // Ensure conversation alternates; if empty, add a placeholder
        if (contents.length === 0) {
            contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
        }
        const body = {
            contents,
            generationConfig: { temperature: 0.8, maxOutputTokens: maxTokens }
        };
        if (systemMsg) {
            body.systemInstruction = { parts: [{ text: systemMsg.content }] };
        }
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (err) {
        console.error('Gemini API failed:', err.message);
        return null;
    }
}

// Unified AI caller — tries Groq first, then Gemini — passes full history
async function callAI(messages, maxTokens = 800) {
    let result = await callGroq(messages, maxTokens);
    if (result) return result;
    result = await callGemini(messages, maxTokens);
    return result;
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

        // Initialize conversation history in session
        if (!req.session.chatHistory) {
            req.session.chatHistory = [];
        }

        let reply = '';
        const skinType = user.C_Skin_type || 'Normal';
        const concerns = user.Skin_concerns || 'None specified';

        // Get relevant products from DB for context — randomize selection
        const [products] = await db.query(`
            SELECT p.Product_name, p.Category, p.P_Skin_type, p.Price, p.Description, b.Brand_name
            FROM Product p JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE p.P_Skin_type IN (?, 'All')
            ORDER BY RANDOM()
            LIMIT 20
        `, [skinType]);

        const productContext = products.map(p =>
            `${p.Brand_name} ${p.Product_name} (${p.Category}, ₹${p.Price}, for ${p.P_Skin_type} skin): ${p.Description}`
        ).join('\n');

        // Build conversation history for AI (last 10 messages for context)
        const recentHistory = req.session.chatHistory.slice(-10);

        const systemPrompt = `You are Luminar AI, a professional, empathetic, and highly knowledgeable skincare consultant for the Luminar skincare website. You respond like a real dermatologist or skincare expert who truly LISTENS to the patient.

Customer Profile:
- Name: ${user.Cust_name}
- Skin Type: ${skinType}
- Skin Concerns: ${concerns}

Available Products in our catalog:
${productContext}

CRITICAL RULES — Follow these STRICTLY:

1. **LISTEN AND ANSWER THE ACTUAL QUESTION FIRST.** Read the user's message carefully. Understand what they are REALLY asking. Answer THEIR specific question before doing anything else.

2. **If the user mentions a specific product causing problems** (e.g., "I was using Cetaphil cleanser and got acne"):
   - FIRST acknowledge what they said
   - Explain possible reasons WHY that product might have caused the issue
   - Suggest whether they should stop or continue
   - THEN, and ONLY THEN, suggest alternatives

3. **DO NOT randomly recommend products.** Only recommend products when:
   - The user explicitly asks for recommendations
   - You have fully answered their question first and product suggestions are a natural next step
   - The context naturally calls for it

4. **Give DETAILED, THOUGHTFUL explanations.** Don't give generic answers.

5. **NEVER repeat a previous response.** Each answer MUST be unique and different from anything you said before in this conversation. If the user asks a similar question, provide NEW information, different product suggestions, or a different angle.

6. **Be conversational and empathetic.** Format well with bold, bullet points, and sections.

7. **Use ₹ for prices** when mentioning products.

8. **If asked about things unrelated to skincare**, politely redirect.

9. **For serious conditions**, recommend seeing a dermatologist.

Remember: You are a skincare ADVISOR first, and a product recommender second.`;

        // Build full message array with history
        const aiMessages = [
            { role: 'system', content: systemPrompt },
            ...recentHistory,
            { role: 'user', content: message }
        ];

        // Try AI API first
        const aiReply = await callAI(aiMessages);

        if (aiReply) {
            reply = aiReply;
        } else {
            // Enhanced rule-based fallback with anti-repetition
            reply = await getEnhancedResponse(message, user, products, req.session);
        }

        // Store in conversation history
        req.session.chatHistory.push(
            { role: 'user', content: message },
            { role: 'assistant', content: reply }
        );
        // Keep history manageable (last 20 messages)
        if (req.session.chatHistory.length > 20) {
            req.session.chatHistory = req.session.chatHistory.slice(-20);
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

        // Get recommended products matching detected conditions and skin type
        let productRecs = [];
        const userSkinType = user.C_Skin_type || 'Normal';
        if (analysisResult.conditions && analysisResult.conditions.length > 0) {
            // Build search terms from detected conditions
            const searchTerms = analysisResult.conditions.flatMap(c => {
                const words = c.toLowerCase().split(/[\s,()]+/).filter(w => w.length > 2);
                return words.map(w => `%${w}%`);
            });
            const placeholders = searchTerms.map(() => 'p.Description LIKE ? OR p.Product_name LIKE ?').join(' OR ');
            const params = searchTerms.flatMap(t => [t, t]);
            const [prods] = await db.query(`
                SELECT p.*, b.Brand_name FROM Product p
                JOIN Brand b ON p.Brand_id = b.Brand_id
                WHERE (${placeholders}) OR p.P_Skin_type IN (?, 'All')
                GROUP BY p.Product_id
                ORDER BY RANDOM()
                LIMIT 6
            `, [...params, userSkinType]);
            productRecs = prods;
        }
        if (productRecs.length < 3) {
            const [fallback] = await db.query(`
                SELECT p.*, b.Brand_name FROM Product p
                JOIN Brand b ON p.Brand_id = b.Brand_id
                WHERE p.P_Skin_type IN (?, 'All')
                ORDER BY RANDOM() LIMIT 6
            `, [userSkinType]);
            productRecs = fallback;
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
async function getEnhancedResponse(message, user, products, session) {
    const msg = message.toLowerCase();
    const skinType = user.C_Skin_type || 'Normal';

    // Track used response keys to avoid repetition
    if (!session.usedResponses) session.usedResponses = [];

    // Helper to pick random items from an array
    function pickRandom(arr, count) {
        const shuffled = [...arr].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }

    // Helper to mark a response key as used and check if it was used before
    function wasUsed(key) {
        if (session.usedResponses.includes(key)) return true;
        session.usedResponses.push(key);
        if (session.usedResponses.length > 30) session.usedResponses = session.usedResponses.slice(-15);
        return false;
    }

    // Get random products for the user's skin type
    async function getRandomProducts(searchTerm, limit = 4) {
        const [prods] = await db.query(`
            SELECT p.Product_name, p.Price, b.Brand_name, p.Description, p.Category FROM Product p
            JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE p.Description LIKE ? OR p.Category LIKE ? OR p.P_Skin_type IN (?, 'All')
            ORDER BY RANDOM()
            LIMIT ?
        `, [`%${searchTerm}%`, `%${searchTerm}%`, skinType, limit]);
        return prods;
    }

    // ===== PRIORITY 1: User mentions a specific product causing problems =====
    const brands = ['cetaphil', 'cerave', 'neutrogena', 'innisfree', 'minimalist', 'plum', 'mamaearth', 'biotique', 'laneige', 'cosrx', 'simple', 'ordinary', 'la roche', 'dot & key', "paula's choice", "derma co", "re'equil", 'pilgrim', 'aqualogica', 'fixderma'];
    let productMentioned = null;
    let problemMentioned = null;

    for (const brand of brands) {
        if (msg.includes(brand)) {
            productMentioned = brand.charAt(0).toUpperCase() + brand.slice(1);
            if (msg.includes('acne') || msg.includes('pimple') || msg.includes('breakout')) problemMentioned = 'acne/breakouts';
            else if (msg.includes('irritat') || msg.includes('burn') || msg.includes('sting') || msg.includes('red')) problemMentioned = 'irritation/redness';
            else if (msg.includes('dry') || msg.includes('peel') || msg.includes('flak')) problemMentioned = 'dryness/peeling';
            else if (msg.includes('oily') || msg.includes('greasy')) problemMentioned = 'excess oiliness';
            else if (msg.includes('worse') || msg.includes('bad') || msg.includes('not working')) problemMentioned = 'worsening condition';
            break;
        }
    }

    if (productMentioned && problemMentioned) {
        const alternatives = await getRandomProducts(skinType, 3);
        const reasons = pickRandom([
            `**Product-Skin Type Mismatch:** Your skin type is **${skinType}**. What works for one skin type can be damaging for another.`,
            `**Ingredient Sensitivity:** Certain surfactants, fragrances, or preservatives in the formula might not agree with your unique skin chemistry.`,
            `**Purging vs. Reaction:** With actives like AHAs, BHAs, or retinol, initial breakouts (purging) can last 4-6 weeks. Beyond that, it's a genuine reaction.`,
            `**Wrong Application Method:** Using too much product, applying it too frequently, or layering incompatible ingredients can trigger problems.`,
            `**Comedogenic Ingredients:** Some formulas contain silicones, coconut derivatives, or fatty alcohols that can clog pores for certain skin types.`,
            `**Damaged Moisture Barrier:** If your barrier was already compromised, even gentle products can sting or cause flare-ups.`
        ], 3);

        let reply = `I completely understand your frustration with **${productMentioned}**, ${user.Cust_name}. Let me break down what might be happening. 💜\n\n`;
        reply += `**Possible reasons for ${problemMentioned}:**\n\n`;
        reasons.forEach((r, i) => { reply += `${i + 1}. ${r}\n\n`; });
        reply += `**My Advice for You Right Now:**\n`;
        reply += `• **${problemMentioned.includes('severe') ? 'Stop immediately' : 'Consider pausing'} ${productMentioned}** and observe your skin for 1-2 weeks\n`;
        reply += `• **Simplify your routine:** gentle cleanser + fragrance-free moisturizer + SPF 50 only\n`;
        reply += `• **Keep a skin diary** — note what improves and what doesn't\n\n`;
        if (alternatives.length > 0) {
            reply += `**Better alternatives for your ${skinType} skin:**\n`;
            alternatives.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** (${p.Category}) — ₹${p.Price}\n`; });
        }
        reply += `\nWould you like me to create a complete gentle routine for your skin recovery? 💜`;
        return reply;
    }

    // Hyperpigmentation / dark spots
    if (msg.includes('hyperpigmentation') || msg.includes('dark spot') || msg.includes('pigment') || msg.includes('uneven') || msg.includes('melasma')) {
        const prods = await getRandomProducts('brighten', 4);
        const variant = wasUsed('hyper1') ? 2 : 1;

        if (variant === 1) {
            let reply = `Let's tackle your hyperpigmentation head-on, ${user.Cust_name}! This is one of my most asked-about concerns. 💜\n\n`;
            reply += `**The Science Behind Dark Spots:**\nMelanocytes (pigment cells) overproduce melanin due to UV exposure, inflammation, or hormonal changes. The key is to:\n1. **Inhibit melanin production** (Vitamin C, Alpha Arbutin, Tranexamic Acid)\n2. **Speed up cell turnover** (Retinol, AHAs)\n3. **Prevent further darkening** (SPF 50+ — this is NON-NEGOTIABLE!)\n\n`;
            reply += `**Your Anti-Pigmentation Arsenal:**\n`;
            reply += `• **Vitamin C (15-20%)** — Morning antioxidant + brightener\n`;
            reply += `• **Alpha Arbutin 2%** — Gentle but effective tyrosinase inhibitor\n`;
            reply += `• **Tranexamic Acid 3%** — Best for stubborn melasma\n`;
            reply += `• **Azelaic Acid 10%** — Dual action: anti-inflammatory + brightening\n\n`;
            reply += `**Products from our catalog:**\n`;
            prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
            reply += `\n☀️ **#1 Rule:** Without SPF 50+, ALL brightening products are useless — sun recreates pigmentation faster than actives can fade it!`;
            return reply;
        } else {
            let reply = `Here's a different approach to your hyperpigmentation concern! 🌟\n\n`;
            reply += `**Layering Strategy for Maximum Brightening:**\n\n`;
            reply += `**AM Brightening Stack:**\n1. Gentle cleanser\n2. Vitamin C serum (apply on damp skin)\n3. Niacinamide moisturizer\n4. SPF 50+ (reapply every 2-3 hours!)\n\n`;
            reply += `**PM Fading Stack:**\n1. Oil cleanser → Water cleanser\n2. Tranexamic Acid OR Alpha Arbutin serum\n3. Azelaic Acid (on dark spots only)\n4. Ceramide moisturizer\n\n`;
            reply += `**Products to try:**\n`;
            prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
            reply += `\n**Timeline:** Expect visible improvement in 6-12 weeks with consistent use. Patience is key! 💪`;
            return reply;
        }
    }

    // Acne / pimples
    if (msg.includes('acne') || msg.includes('pimple') || msg.includes('breakout') || msg.includes('zit')) {
        const prods = await getRandomProducts('acne', 4);
        const variant = wasUsed('acne1') ? 2 : 1;

        if (variant === 1) {
            let reply = `Let's fight your acne together, ${user.Cust_name}! 💪\n\n`;
            reply += `**How Acne Actually Forms:**\nClogged pore (dead skin + sebum) → C. acnes bacteria multiplies → Inflammation → Pimple\n\n`;
            reply += `**My Proven Treatment Approach:**\n`;
            reply += `• **Salicylic Acid (2% BHA)** — Penetrates INTO pores to dissolve clogs\n`;
            reply += `• **Niacinamide (10%)** — Controls oil + reduces inflammation\n`;
            reply += `• **Benzoyl Peroxide (2.5%)** — Kills bacteria (2.5% is as effective as 10% with less dryness!)\n\n`;
            reply += `**Products matched for your skin:**\n`;
            prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
            reply += `\n**Lifestyle changes that help:**\n• Change pillowcases every 2-3 days\n• Clean your phone screen daily\n• Don't touch your face\n• Reduce dairy and high-glycemic foods\n• Drink 2-3L water daily`;
            return reply;
        } else {
            let reply = `Let me give you a fresh perspective on managing acne, ${user.Cust_name}! 🌿\n\n`;
            reply += `**Common Acne Mistakes to Avoid:**\n`;
            reply += `❌ Over-washing your face (max 2x daily!)\n`;
            reply += `❌ Using physical scrubs on active acne\n`;
            reply += `❌ Skipping moisturizer (dehydrated skin = MORE oil!)\n`;
            reply += `❌ Popping pimples (pushes bacteria deeper)\n`;
            reply += `❌ Using too many actives at once\n\n`;
            reply += `**The Right Approach:**\n`;
            reply += `**Week 1-2:** Simplify — gentle cleanser + moisturizer + SPF only\n`;
            reply += `**Week 3-4:** Add ONE active — start with niacinamide (least irritating)\n`;
            reply += `**Week 5-6:** Introduce BHA 2-3 nights per week\n`;
            reply += `**Week 7+:** Assess and adjust\n\n`;
            reply += `**Products I'd suggest:**\n`;
            prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
            reply += `\n**Remember:** Acne treatment takes 6-8 weeks minimum. Don't give up after 2 weeks! 💜`;
            return reply;
        }
    }

    // Product recommendations
    if (msg.includes('recommend') || msg.includes('suggest') || msg.includes('best product') || msg.includes('what should')) {
        const shuffled = pickRandom(products, 5);
        const intros = [
            `Based on your **${skinType}** skin profile, here are my personalized picks:`,
            `I've curated these specifically for **${skinType}** skin, ${user.Cust_name}:`,
            `Here are my top recommendations tailored for your **${skinType}** skin type:`,
            `For your **${skinType}** skin, these products would work wonderfully:`
        ];
        let reply = `${pickRandom(intros, 1)[0]} 💜\n\n`;
        shuffled.forEach(p => {
            reply += `• **${p.Brand_name} ${p.Product_name}** (${p.Category}) — ₹${p.Price}\n  _${p.Description.substring(0, 120)}_\n\n`;
        });
        const closings = [
            `Would you like me to create a complete routine with these products?`,
            `Shall I explain how to use any of these in detail?`,
            `Want me to build a morning and night routine around these?`,
            `Would you like budget alternatives for any of these?`
        ];
        reply += pickRandom(closings, 1)[0] + ` 💜`;
        return reply;
    }

    // Dry skin
    if (msg.includes('dry') || msg.includes('hydrat') || msg.includes('moistur') || msg.includes('flak')) {
        const prods = await getRandomProducts('hydrat', 3);
        const variant = wasUsed('dry1') ? 2 : 1;
        if (variant === 1) {
            let reply = `For your **dry skin** concerns, here's a science-backed hydration plan! 💧\n\n`;
            reply += `**The Hydration Sandwich Method:**\n1. Apply toner/essence on damp skin\n2. Layer hyaluronic acid serum\n3. Seal with a rich cream moisturizer\n4. Add facial oil on TOP (acts as occlusive seal)\n\n`;
            reply += `**Hero Ingredients:**\n• **Hyaluronic Acid** — Holds 1000x its weight in water (apply on DAMP skin!)\n• **Ceramides** — Repair moisture barrier\n• **Squalane** — Mimics natural sebum\n• **Glycerin** — Draws moisture from air\n\n`;
            reply += `**Products for you:**\n`;
            prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
            reply += `\n**Avoid:** Foaming cleansers, alcohol toners, hot water, over-exfoliating 💜`;
            return reply;
        } else {
            let reply = `Let me share some advanced hydration strategies, ${user.Cust_name}! 🌊\n\n`;
            reply += `**Why Dry Skin Gets Worse:**\n• Damaged moisture barrier lets water escape (TEWL)\n• Low humidity environments\n• Hot showers (strip natural oils!)\n• Over-exfoliating\n\n`;
            reply += `**My Recovery Plan:**\n**AM:** Cream cleanser → HA serum (damp skin!) → Ceramide cream → Cream-based SPF\n**PM:** Oil cleanser → Milk cleanser → HA + B5 → Facial oil → Sleeping mask\n\n`;
            reply += `**These products would help:**\n`;
            prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
            reply += `\n**Pro tip:** Use a humidifier and drink 2-3L water daily! 💜`;
            return reply;
        }
    }

    // Oily skin
    if (msg.includes('oily') || msg.includes('shine') || msg.includes('greasy') || msg.includes('sebum') || msg.includes('pore')) {
        const prods = await getRandomProducts('oil control', 3);
        let reply = `The key to managing **oily skin** is balance, not stripping! 💚\n\n`;
        reply += `**Why Over-Stripping Makes It WORSE:**\nWhen you strip too much oil → Skin panics → Produces EVEN MORE oil to compensate!\n\n`;
        reply += `**Smart Oil-Control Routine:**\n**AM:** Gel cleanser → Niacinamide 10% → Gel moisturizer → Matte SPF\n**PM:** Oil cleanser (paradoxically helps!) → Gel cleanser → BHA toner (2-3x/week) → Light moisturizer\n\n`;
        reply += `**Star Ingredients:**\n• **Niacinamide 10%** — Reduces sebum by up to 25%\n• **Salicylic Acid** — Cleans inside the pore\n• **Green Tea** — Natural antioxidant + oil control\n• **Zinc** — Anti-inflammatory\n\n`;
        reply += `**Products for you:**\n`;
        prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
        reply += `\n**Don't skip moisturizer!** Dehydrated oily skin overproduces sebum. 💜`;
        return reply;
    }

    // Sensitive skin
    if (msg.includes('sensitive') || msg.includes('irritat') || msg.includes('redness') || msg.includes('react') || msg.includes('sting')) {
        const prods = await getRandomProducts('sooth', 3);
        let reply = `Sensitive skin needs a "less is more" approach, ${user.Cust_name}! 🌸\n\n`;
        reply += `**Golden Rules for Sensitive Skin:**\n1. **Max 4-5 products** in your routine\n2. **Patch test everything** (inner arm, 48 hours)\n3. **One new product at a time** (wait 2 weeks between)\n4. **"Fragrance-free" ≠ "Unscented"** — always choose fragrance-free\n\n`;
        reply += `**Your Safe Ingredients:**\n✅ Centella Asiatica (CICA) — calms inflammation\n✅ Ceramides — barrier repair\n✅ Panthenol (B5) — soothes\n✅ Colloidal Oatmeal — natural anti-inflammatory\n\n`;
        reply += `**Avoid These:**\n❌ Fragrance, essential oils, alcohol denat, SLS, high-dose acids\n\n`;
        reply += `**Gentle products for you:**\n`;
        prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
        reply += `\nWant me to build a minimal, calming routine? 💜`;
        return reply;
    }

    // Skincare routine
    if (msg.includes('routine') || msg.includes('regimen') || msg.includes('steps') || msg.includes('morning') || msg.includes('night')) {
        const cleanser = pickRandom(products.filter(p => p.Category === 'Cleanser'), 1)[0];
        const serum = pickRandom(products.filter(p => p.Category === 'Serum'), 1)[0];
        const moisturizer = pickRandom(products.filter(p => p.Category === 'Moisturizer'), 1)[0];
        let reply = `Here's a complete **${skinType} skin** routine crafted just for you! ✨\n\n`;
        reply += `**☀️ Morning (AM):**\n`;
        reply += `1. 🧼 **Cleanser** — ${cleanser ? `${cleanser.Brand_name} ${cleanser.Product_name} (₹${cleanser.Price})` : 'Gentle cream/gel cleanser'}\n`;
        reply += `2. 💧 **Toner** — Balance pH, prep skin\n`;
        reply += `3. ✨ **Serum** — ${serum ? `${serum.Brand_name} ${serum.Product_name} (₹${serum.Price})` : 'Vitamin C or Niacinamide'}\n`;
        reply += `4. 🧴 **Moisturizer** — ${moisturizer ? `${moisturizer.Brand_name} ${moisturizer.Product_name} (₹${moisturizer.Price})` : 'Suited to your skin type'}\n`;
        reply += `5. ☀️ **SPF 50+** — 2-3 finger lengths, reapply every 2-3 hours\n\n`;
        reply += `**🌙 Evening (PM):**\n`;
        reply += `1. 🧼 **Oil/Balm Cleanser** — Remove SPF + pollutants\n`;
        reply += `2. 🧼 **Water Cleanser** — Double cleansing!\n`;
        reply += `3. 💧 **Exfoliating Toner** — AHA/BHA 2-3x/week\n`;
        reply += `4. ✨ **Treatment** — Retinol or targeted serum\n`;
        reply += `5. 🧴 **Night Cream** — Richer than daytime moisturizer\n\n`;
        reply += `**⏱️ Wait 1-2 minutes between actives for better absorption!**\n\nUse our **Routine Generator** on the right panel for a fully customized plan! 💜`;
        return reply;
    }

    // Sunscreen
    if (msg.includes('sunscreen') || msg.includes('spf') || msg.includes('sun protect') || msg.includes('tan')) {
        const prods = await getRandomProducts('sunscreen', 3);
        let reply = `**Sunscreen = the ultimate anti-aging + anti-pigmentation product!** ☀️\n\n`;
        reply += `**For your ${skinType} skin, choose:**\n`;
        if (skinType === 'Oily') reply += `→ Gel/aqua-based, matte finish, oil-free formula\n`;
        else if (skinType === 'Dry') reply += `→ Cream-based SPF with moisturizing ingredients\n`;
        else if (skinType === 'Sensitive') reply += `→ Mineral/physical SPF (zinc oxide + titanium dioxide)\n`;
        else reply += `→ Lightweight fluid or aqua-gel texture\n`;
        reply += `\n**Application Rules:**\n• Apply 2-3 finger lengths for face + neck\n• Apply AFTER moisturizer, BEFORE makeup\n• Reapply every 2-3 hours if outdoors\n• Yes, even indoors — UVA passes through windows!\n\n`;
        reply += `**Our top sunscreens:**\n`;
        prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
        reply += `\n**Myth buster:** SPF in makeup isn't enough — you'd need 7 layers of foundation! 😅💜`;
        return reply;
    }

    // Aging concerns
    if (msg.includes('aging') || msg.includes('wrinkle') || msg.includes('fine line') || msg.includes('anti-age') || msg.includes('sagging')) {
        const prods = await getRandomProducts('retinol', 3);
        let reply = `Let's talk anti-aging science, ${user.Cust_name}! ✨\n\n`;
        reply += `**Did you know?** 90% of visible aging is from sun damage, not genetics!\n\n`;
        reply += `**The Anti-Aging Power Trio:**\n1. **Retinol** — Boosts collagen, speeds cell turnover (start 0.2%, PM only)\n2. **Vitamin C** — Antioxidant shield + collagen stimulator (AM)\n3. **SPF 50+** — Prevents 90% of aging signs (daily, rain or shine!)\n\n`;
        reply += `**Your Anti-Aging Routine:**\n**AM:** Cleanser → Vitamin C → Moisturizer → SPF 50+\n**PM:** Double cleanse → Retinol (build up slowly) → Rich night cream\n\n`;
        reply += `**Products to consider:**\n`;
        prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
        reply += `\n**Start retinol slowly:** 1x/week → 2x/week → every other night → nightly (over 6-8 weeks) 💜`;
        return reply;
    }

    // Ingredient questions
    if (msg.includes('ingredient') || msg.includes('niacinamide') || msg.includes('retinol') || msg.includes('vitamin c') || msg.includes('hyaluronic') || msg.includes('salicylic')) {
        const prods = await getRandomProducts(msg.includes('niacinamide') ? 'niacinamide' : msg.includes('retinol') ? 'retinol' : 'vitamin c', 3);
        let reply = `Great question! Here's what science says about key skincare actives: 🔬\n\n`;
        reply += `**Niacinamide (B3):** Controls oil, minimizes pores, fades spots. Safe AM+PM. Best at 5-10%.\n\n`;
        reply += `**Retinol/Retinal:** Anti-aging gold standard. Start 0.2%, PM only. ALWAYS use SPF next day.\n\n`;
        reply += `**Vitamin C:** Brightening + antioxidant. Use AM before SPF. Look for Ethyl Ascorbic Acid (stable).\n\n`;
        reply += `**Hyaluronic Acid:** 1000x its weight in water. Apply on DAMP skin or it backfires!\n\n`;
        reply += `**Salicylic Acid (BHA):** Oil-soluble, cleans INSIDE pores. Best for acne/blackheads.\n\n`;
        reply += `**Safe combos:** ✅ Niacinamide + HA, ✅ Vit C + SPF\n**Caution:** ⚠️ Retinol + AHA/BHA (alternate nights)\n\n`;
        reply += `**Products with these ingredients:**\n`;
        prods.forEach(p => { reply += `• **${p.Brand_name} ${p.Product_name}** — ₹${p.Price}\n`; });
        reply += `\nAsk me about any specific ingredient! 💜`;
        return reply;
    }

    // Budget
    if (msg.includes('budget') || msg.includes('cheap') || msg.includes('affordable') || msg.includes('under')) {
        const [budgetProds] = await db.query(`
            SELECT p.Product_name, p.Price, b.Brand_name, p.Category FROM Product p
            JOIN Brand b ON p.Brand_id = b.Brand_id
            WHERE p.Price <= 500 AND p.P_Skin_type IN (?, 'All')
            ORDER BY RANDOM() LIMIT 6
        `, [skinType]);
        let reply = `Great skincare doesn't have to be expensive! Here are amazing products under ₹500 for your **${skinType}** skin: 💰\n\n`;
        budgetProds.forEach(p => {
            reply += `• **${p.Brand_name} ${p.Product_name}** (${p.Category}) — **₹${p.Price}**\n`;
        });
        reply += `\n**Budget routine tip:** Cleanser + Moisturizer + Sunscreen is all you need to start! You can build from there. 💜`;
        return reply;
    }

    // Hi/Hello/Thanks
    if (msg.match(/^(hi|hello|hey|thanks|thank you|thx|ok|okay|cool|great|nice|good)/)) {
        const greetings = [
            `Hey ${user.Cust_name}! 😊 What skincare question can I help with today? Ask me about routines, ingredients, specific concerns, or product recommendations!`,
            `Hello ${user.Cust_name}! 💜 I'm here to help with any skincare question. Try asking about your specific skin concerns, product recommendations, or ingredient advice!`,
            `Hi there, ${user.Cust_name}! ✨ What's on your mind? I can help with acne, dark spots, routines, anti-aging, product picks, and much more!`,
            `Welcome back, ${user.Cust_name}! 🌟 Ask me anything — whether it's about building a routine, understanding ingredients, or finding the right products for your ${skinType} skin!`
        ];
        return pickRandom(greetings, 1)[0];
    }

    // Default — dynamic greeting with product suggestions
    const randomProds = pickRandom(products, 3);
    const defaultVariants = [
        `I'd love to help you, ${user.Cust_name}! 💜 Based on your **${skinType}** skin, here are some things I can help with:\n\n🧴 **Product Picks:** ${randomProds.map(p => p.Brand_name + ' ' + p.Product_name).join(', ')}\n📋 **Custom Routines** — morning AND night\n🔬 **Ingredient Science** — what works and what to avoid\n💡 **Concern Solutions** — acne, dark spots, aging, sensitivity\n\nTry asking: _"What's the best routine for my ${skinType} skin?"_ or _"How do I fade dark spots?"_ ✨`,

        `Hey ${user.Cust_name}! ✨ I noticed you have **${skinType}** skin. Here's what I can do for you:\n\n• Recommend products from our catalog of 155+ items\n• Build a personalized AM/PM routine\n• Explain ingredient science in simple terms\n• Help troubleshoot skin problems\n\n**Quick picks for you:**\n${randomProds.map(p => `• ${p.Brand_name} ${p.Product_name} — ₹${p.Price}`).join('\n')}\n\nWhat would you like to know? 💜`,

        `Hello ${user.Cust_name}! 🌟 I'm your personal skincare advisor. With your **${skinType}** skin type, I can help you:\n\n✅ Find the perfect cleanser, serum, and moisturizer\n✅ Build a science-backed routine\n✅ Understand which ingredients to use and avoid\n✅ Troubleshoot any skin concerns\n\nJust ask a question like _"I have acne that won't go away"_ or _"Suggest a budget routine"_ and I'll give detailed, personalized advice! 💜`
    ];
    return pickRandom(defaultVariants, 1)[0];
}

// Generate routine helper — fully personalized by skin type AND concerns
function generateRoutine(skinType, concerns, products) {
    const concernsList = (concerns || '').toLowerCase().split(',').map(c => c.trim()).filter(Boolean);

    // Smart product picker: filters by category, prioritizes concern-relevant products
    function findBestProduct(category, preferKeywords) {
        const catProducts = products.filter(p => p.Category === category);
        if (catProducts.length === 0) return null;

        // Try to match products whose name or description includes concern-relevant keywords
        if (preferKeywords && preferKeywords.length > 0) {
            for (const kw of preferKeywords) {
                const match = catProducts.find(p =>
                    (p.Product_name || '').toLowerCase().includes(kw) ||
                    (p.Description || '').toLowerCase().includes(kw)
                );
                if (match) return match;
            }
        }

        // Shuffle and pick a random product from the category to ensure variety
        const shuffled = [...catProducts].sort(() => 0.5 - Math.random());
        return shuffled[0];
    }

    // Concern-specific ingredient keywords to match products
    const concernKeywords = {
        'acne': ['salicylic', 'bha', 'benzoyl', 'tea tree', 'niacinamide', 'acne', 'pimple', 'oil-free', 'clay'],
        'pimple': ['salicylic', 'bha', 'tea tree', 'acne', 'pimple', 'niacinamide'],
        'dark spots': ['vitamin c', 'niacinamide', 'alpha arbutin', 'kojic', 'brightening', 'dark spot'],
        'hyperpigmentation': ['vitamin c', 'niacinamide', 'alpha arbutin', 'kojic', 'brightening', 'pigment'],
        'pigmentation': ['vitamin c', 'niacinamide', 'alpha arbutin', 'brightening', 'pigment'],
        'uneven skin tone': ['vitamin c', 'aha', 'glycolic', 'brightening', 'glow', 'tone'],
        'tanning': ['vitamin c', 'brightening', 'de-tan', 'tan', 'sunscreen', 'glow'],
        'dryness': ['hyaluronic', 'ceramide', 'moisture', 'hydrating', 'squalane', 'cream'],
        'oiliness': ['niacinamide', 'salicylic', 'gel', 'mattifying', 'oil-free', 'oil control'],
        'aging': ['retinol', 'peptide', 'collagen', 'anti-aging', 'wrinkle', 'firming'],
        'wrinkles': ['retinol', 'peptide', 'collagen', 'anti-aging', 'firming'],
        'blackheads': ['bha', 'salicylic', 'charcoal', 'clay', 'pore', 'blackhead'],
        'whiteheads': ['bha', 'salicylic', 'aha', 'exfoliat', 'whitehead'],
        'redness': ['centella', 'cica', 'aloe', 'calming', 'soothing', 'sensitive'],
        'sensitivity': ['centella', 'cica', 'aloe', 'calming', 'fragrance-free', 'gentle', 'sensitive'],
        'dullness': ['vitamin c', 'aha', 'glycolic', 'brightening', 'glow', 'exfoliat'],
        'dark circles': ['caffeine', 'vitamin c', 'eye', 'retinol', 'peptide', 'dark circle'],
        'pores': ['niacinamide', 'bha', 'clay', 'pore', 'minimizing', 'toner'],
        'dehydration': ['hyaluronic', 'ceramide', 'hydrating', 'moisture', 'aqua'],
        'sun damage': ['vitamin c', 'niacinamide', 'sunscreen', 'spf', 'repair'],
        'fine lines': ['retinol', 'peptide', 'hyaluronic', 'anti-aging', 'collagen']
    };

    // Get keywords for the user's concerns
    let keywords = [];
    for (const concern of concernsList) {
        for (const [key, kws] of Object.entries(concernKeywords)) {
            if (concern.includes(key) || key.includes(concern)) {
                keywords.push(...kws);
            }
        }
    }
    // Also add skin-type-specific keywords
    const skinTypeKeywords = {
        'Oily': ['gel', 'oil-free', 'mattifying', 'salicylic', 'niacinamide', 'lightweight'],
        'Dry': ['cream', 'hyaluronic', 'ceramide', 'nourishing', 'rich', 'moisture'],
        'Sensitive': ['gentle', 'centella', 'cica', 'fragrance-free', 'calming', 'soothing'],
        'Combination': ['balancing', 'gel-cream', 'niacinamide', 'hydrating', 'light'],
        'Normal': ['hydrating', 'vitamin c', 'glow', 'nourishing']
    };
    keywords.push(...(skinTypeKeywords[skinType] || []));
    keywords = [...new Set(keywords)]; // deduplicate

    const cleanser = findBestProduct('Cleanser', keywords);
    const toner = findBestProduct('Toner', keywords);
    const serum = findBestProduct('Serum', keywords);
    const moisturizer = findBestProduct('Moisturizer', keywords);
    const sunscreen = findBestProduct('Sunscreen', keywords);
    const treatment = findBestProduct('Treatment', keywords);
    const eyeCare = findBestProduct('Eye Care', keywords);
    const mask = findBestProduct('Mask', keywords);
    const mist = findBestProduct('Mist', keywords);
    const lipCare = findBestProduct('Lip Care', keywords);

    // Build concern-specific instructions
    const amCleanseMethod = skinType === 'Oily' ? 'Use a gel cleanser to remove overnight oil buildup'
        : skinType === 'Dry' ? 'Use a cream/milk cleanser — lukewarm water only'
        : skinType === 'Sensitive' ? 'Gently massage with fingertips, avoid rubbing'
        : 'Massage onto damp face in circular motions for 30 seconds';

    const pmCleanseMethod = skinType === 'Oily' ? 'Double cleanse: oil cleanser first, then gel cleanser'
        : skinType === 'Dry' ? 'Double cleanse: balm first, then cream cleanser'
        : skinType === 'Sensitive' ? 'Single gentle cleanse — skip double cleansing if irritated'
        : 'Double cleanse if wearing sunscreen/makeup';

    const serumHow = concernsList.some(c => c.includes('acne') || c.includes('pimple'))
        ? 'Apply to acne-prone areas, avoid open wounds'
        : concernsList.some(c => c.includes('dark') || c.includes('pigment') || c.includes('tan'))
        ? 'Apply to hyperpigmented areas and entire face for even tone'
        : concernsList.some(c => c.includes('aging') || c.includes('wrinkle') || c.includes('fine'))
        ? 'Apply to fine lines, crow\'s feet, and forehead — pat gently'
        : 'Apply drops to face and press gently into skin';

    const morning = [];
    const evening = [];
    let totalCost = 0;

    if (cleanser) {
        morning.push({ step: 1, category: 'Cleanser', product: cleanser.Product_name, brand: cleanser.Brand_name, price: cleanser.Price, how: amCleanseMethod, amount: 'Coin-sized amount', wait_time: 'None' });
        evening.push({ step: 1, category: 'Cleanser', product: cleanser.Product_name, brand: cleanser.Brand_name, price: cleanser.Price, how: pmCleanseMethod, amount: 'Coin-sized amount', wait_time: 'None' });
        totalCost += cleanser.Price;
    }
    if (toner) {
        const tonerHow = skinType === 'Oily' ? 'Apply with cotton pad to T-zone and oily areas' : 'Pour onto hands and pat into skin — no rubbing';
        morning.push({ step: 2, category: 'Toner', product: toner.Product_name, brand: toner.Brand_name, price: toner.Price, how: tonerHow, amount: '3-4 drops', wait_time: '30 seconds' });
        evening.push({ step: 2, category: 'Toner', product: toner.Product_name, brand: toner.Brand_name, price: toner.Price, how: tonerHow, amount: '3-4 drops', wait_time: '30 seconds' });
        totalCost += toner.Price;
    }
    if (serum) {
        morning.push({ step: 3, category: 'Serum', product: serum.Product_name, brand: serum.Brand_name, price: serum.Price, how: serumHow, amount: '3-4 drops', wait_time: '1-2 minutes' });
        totalCost += serum.Price;
    }
    if (treatment) {
        const treatHow = concernsList.some(c => c.includes('acne')) ? 'Apply as spot treatment on active breakouts only'
            : concernsList.some(c => c.includes('dark') || c.includes('pigment')) ? 'Apply to dark spots and patches before moisturizer'
            : 'Apply to targeted areas or full face as needed';
        evening.push({ step: 3, category: 'Treatment', product: treatment.Product_name, brand: treatment.Brand_name, price: treatment.Price, how: treatHow, amount: 'Pea-sized amount', wait_time: '2 minutes' });
        totalCost += treatment.Price;
    }
    if (eyeCare) {
        morning.push({ step: 4, category: 'Eye Care', product: eyeCare.Product_name, brand: eyeCare.Brand_name, price: eyeCare.Price, how: 'Dot around eye area, pat gently with ring finger', amount: 'Rice grain sized', wait_time: '30 seconds' });
        evening.push({ step: 4, category: 'Eye Care', product: eyeCare.Product_name, brand: eyeCare.Brand_name, price: eyeCare.Price, how: 'Dot and pat under eyes — never pull or rub', amount: 'Rice grain sized', wait_time: '30 seconds' });
        totalCost += eyeCare.Price;
    }
    if (moisturizer) {
        const moistHow = skinType === 'Oily' ? 'Apply lightweight gel moisturizer — focus on dry patches' : 'Apply generously, massage upward in circular motions';
        morning.push({ step: 5, category: 'Moisturizer', product: moisturizer.Product_name, brand: moisturizer.Brand_name, price: moisturizer.Price, how: moistHow, amount: skinType === 'Oily' ? 'Small pea-sized' : 'Generous amount', wait_time: '1-2 minutes before SPF' });
        evening.push({ step: 5, category: 'Moisturizer', product: moisturizer.Product_name, brand: moisturizer.Brand_name, price: moisturizer.Price, how: 'Apply as last step — lock in all previous products', amount: 'Generous amount', wait_time: 'None — go to sleep!' });
        totalCost += moisturizer.Price;
    }
    if (sunscreen) {
        morning.push({ step: 6, category: 'Sunscreen', product: sunscreen.Product_name, brand: sunscreen.Brand_name, price: sunscreen.Price, how: 'Apply generously as LAST AM step. Reapply every 2-3 hours if outdoors', amount: '2-3 finger lengths', wait_time: '15 minutes before sun exposure' });
        totalCost += sunscreen.Price;
    }
    if (lipCare) {
        morning.push({ step: 7, category: 'Lip Care', product: lipCare.Product_name, brand: lipCare.Brand_name, price: lipCare.Price, how: 'Apply to lips after moisturizer', amount: 'Thin layer', wait_time: 'None' });
        totalCost += lipCare.Price;
    }

    const weekly = [];
    if (mask) {
        const maskFreq = skinType === 'Sensitive' ? '1x per week max' : '2-3x per week';
        weekly.push({ treatment: mask.Product_name, frequency: maskFreq, product: mask.Product_name, brand: mask.Brand_name });
    }

    // Concern-specific avoid lists
    const avoidMap = {
        'Oily': ['Heavy oil-based creams & balms', 'Coconut oil on face (comedogenic)', 'Over-washing face (max 2x daily)', 'Alcohol-based toners that strip oils', 'Skipping moisturizer (makes oiliness worse!)'],
        'Dry': ['Foaming/gel cleansers (too stripping)', 'Alcohol-based toners', 'Hot water on face (use lukewarm)', 'Clay masks more than 1x/week', 'Retinol without proper moisturizing'],
        'Sensitive': ['Fragrance/parfum in ANY product', 'Essential oils (lavender, tea tree)', 'Physical scrubs & harsh exfoliants', 'AHA/BHA on irritated skin', 'Introducing multiple new products at once'],
        'Combination': ['Heavy creams on T-zone', 'Over-exfoliating (max 2x/week)', 'Same products for whole face', 'Alcohol-based products on dry areas', 'Skipping moisturizer on oily zones'],
        'Normal': ['Using too many actives at once', 'Skipping sunscreen', 'Sleeping with makeup on', 'Over-exfoliating', 'Picking at skin']
    };
    const concernAvoid = {
        'acne': ['Touching/picking at pimples', 'Heavy makeup over breakouts', 'Dairy and high-sugar foods (triggers)', 'Dirty pillowcases & phone screens'],
        'dark spots': ['Sun exposure without SPF 50+', 'Picking at scabs/marks', 'Lemon juice on face (too acidic)', 'Skipping vitamin C in morning'],
        'tanning': ['Sun without SPF 50+ reapplied every 2h', 'Using bleach/harsh chemicals', 'Skipping antioxidant serums'],
        'aging': ['Rubbing eyes and pulling skin', 'Sleeping on face (causes wrinkles)', 'Neglecting neck and décolletage', 'Skipping retinol/peptides at night'],
        'dryness': ['Long hot showers', 'Foaming cleansers', 'Not moisturizing within 60s of washing'],
        'sensitivity': ['Trying multiple new products at once', 'Products with alcohol or fragrance', 'Hot water and steam on face']
    };

    let avoid = [...(avoidMap[skinType] || avoidMap['Normal'])];
    for (const concern of concernsList) {
        for (const [key, items] of Object.entries(concernAvoid)) {
            if (concern.includes(key)) { avoid.push(...items); break; }
        }
    }
    avoid = [...new Set(avoid)].slice(0, 6);

    // Concern-specific pro tips
    const tipsMap = {
        'Oily': ['Blotting paper > washing — blot excess oil midday', 'Niacinamide 10% regulates sebum production', 'Use gel/water-based products over creams', 'Salicylic acid 2% unclogs pores without drying'],
        'Dry': ['Apply moisturizer to DAMP skin for 3x absorption', 'Hyaluronic acid draws moisture — pair with moisturizer', 'Ceramic-based creams repair the skin barrier', 'Use a humidifier in AC environments'],
        'Sensitive': ['Patch test EVERYTHING behind your ear first', 'Max 4-5 products in your routine', 'Centella/Cica is your best friend ingredient', 'Introduce one product at a time (wait 2 weeks)'],
        'Combination': ['Use different products on T-zone vs. cheeks', 'Gel moisturizer on T-zone, cream on cheeks', 'Multi-masking: clay on nose, hydrating on cheeks'],
        'Normal': ['Maintain what works — don\'t fix what isn\'t broken', 'Focus on prevention: SPF + antioxidants', 'Exfoliate 1-2x/week for extra glow']
    };
    const concernTips = {
        'acne': ['Change pillowcases every 2-3 days', 'Keep phone screen clean — bacteria causes breakouts', 'Ice acne for 1 min to reduce inflammation', 'Don\'t pop pimples — use pimple patches instead'],
        'dark spots': ['Vitamin C in AM + Sunscreen = dark spot killer combo', 'Alpha Arbutin is gentler than hydroquinone', 'Results take 8-12 weeks — be patient!'],
        'tanning': ['Reapply SPF every 2 hours outdoors', 'Vitamin C reverses sun damage over time', 'Wear a hat and sunglasses for extra protection'],
        'aging': ['Retinol is the gold standard — start with 0.025%', 'Peptides boost collagen naturally', 'Sleep on a silk pillowcase to reduce wrinkles'],
        'dryness': ['Layer products thin-to-thick for max hydration', 'Drink 2-3 liters of water daily', 'Avoid products with alcohol denat. at the top of ingredients'],
        'sensitivity': ['Look for "Dermatologist Tested" labels', 'Oat-based products calm inflammation', 'Avoid hot water — lukewarm only']
    };

    let tips = [...(tipsMap[skinType] || tipsMap['Normal'])];
    for (const concern of concernsList) {
        for (const [key, items] of Object.entries(concernTips)) {
            if (concern.includes(key)) { tips.push(...items); break; }
        }
    }
    tips = [...new Set(tips)].slice(0, 6);

    return {
        skin_type: skinType,
        concerns: concerns || 'General skincare',
        morning,
        evening,
        weekly,
        avoid,
        tips,
        total_cost: totalCost
    };
}

// Simulated skin analysis helper — varied, realistic detections
function getSimulatedAnalysis(user) {
    const skinType = user.C_Skin_type || 'Normal';
    const userConcerns = (user.Skin_concerns || '').split(',').map(c => c.trim()).filter(Boolean);

    // All possible detectable conditions with probability weights per skin type
    const conditionPools = {
        'Oily': [
            { name: 'Mild Acne', weight: 35 },
            { name: 'Open Pores', weight: 30 },
            { name: 'Blackheads', weight: 25 },
            { name: 'Whiteheads', weight: 20 },
            { name: 'Excess Sebum', weight: 30 },
            { name: 'Uneven Skin Tone', weight: 15 },
            { name: 'Tiny Bumps (Closed Comedones)', weight: 18 },
            { name: 'Oily T-Zone', weight: 25 },
            { name: 'Post-Acne Marks', weight: 15 },
            { name: 'Slight Redness', weight: 10 }
        ],
        'Dry': [
            { name: 'Dehydration Lines', weight: 35 },
            { name: 'Flaky Patches', weight: 30 },
            { name: 'Dull Complexion', weight: 25 },
            { name: 'Minor Redness', weight: 20 },
            { name: 'Rough Texture', weight: 28 },
            { name: 'Fine Lines (Dehydration)', weight: 22 },
            { name: 'Tightness', weight: 18 },
            { name: 'Slight Pigmentation', weight: 12 },
            { name: 'Uneven Skin Tone', weight: 15 },
            { name: 'Sensitivity Patches', weight: 14 }
        ],
        'Combination': [
            { name: 'Oily T-Zone', weight: 30 },
            { name: 'Dry Cheeks', weight: 25 },
            { name: 'Open Pores (Nose)', weight: 28 },
            { name: 'Blackheads', weight: 20 },
            { name: 'Uneven Texture', weight: 22 },
            { name: 'Mild Acne', weight: 15 },
            { name: 'Slight Pigmentation', weight: 18 },
            { name: 'Dehydration', weight: 16 },
            { name: 'Tiny Bumps', weight: 12 },
            { name: 'Dull Areas', weight: 14 }
        ],
        'Sensitive': [
            { name: 'Redness', weight: 35 },
            { name: 'Irritation Patches', weight: 28 },
            { name: 'Broken Capillaries', weight: 20 },
            { name: 'Flushing', weight: 25 },
            { name: 'Reactive Skin', weight: 30 },
            { name: 'Dry Patches', weight: 18 },
            { name: 'Slight Eczema', weight: 12 },
            { name: 'Rough Texture', weight: 15 },
            { name: 'Uneven Skin Tone', weight: 14 },
            { name: 'Sensitivity to Touch', weight: 22 }
        ],
        'Normal': [
            { name: 'Mild Dullness', weight: 25 },
            { name: 'Slight Uneven Tone', weight: 20 },
            { name: 'Minor Pores', weight: 18 },
            { name: 'Slight Tanning', weight: 22 },
            { name: 'Minor Dark Circles', weight: 15 },
            { name: 'Fine Lines', weight: 12 },
            { name: 'Slight Dehydration', weight: 14 },
            { name: 'Tiny Bumps', weight: 10 },
            { name: 'Minor Pigmentation', weight: 16 },
            { name: 'Slight Texture', weight: 13 }
        ]
    };

    const pool = conditionPools[skinType] || conditionPools['Normal'];

    // Pick 2-4 random conditions weighted by probability
    const conditions = [];
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    const count = 2 + Math.floor(Math.random() * 3); // 2-4 conditions
    for (const item of shuffled) {
        if (conditions.length >= count) break;
        if (Math.random() * 100 < item.weight) {
            conditions.push(item.name);
        }
    }
    // Ensure at least 2
    while (conditions.length < 2) {
        const random = shuffled[Math.floor(Math.random() * shuffled.length)];
        if (!conditions.includes(random.name)) conditions.push(random.name);
    }

    // If user has quiz concerns, include 1-2 of those
    if (userConcerns.length > 0) {
        const mapped = userConcerns.slice(0, 2).map(c => {
            if (c.toLowerCase().includes('acne')) return 'Mild Acne';
            if (c.toLowerCase().includes('pigment')) return 'Hyperpigmentation';
            if (c.toLowerCase().includes('dark spot')) return 'Dark Spots';
            if (c.toLowerCase().includes('tan')) return 'Sun Tanning';
            if (c.toLowerCase().includes('aging')) return 'Early Signs of Aging';
            if (c.toLowerCase().includes('dull')) return 'Dull Complexion';
            if (c.toLowerCase().includes('pore')) return 'Enlarged Pores';
            if (c.toLowerCase().includes('dry')) return 'Dehydration';
            if (c.toLowerCase().includes('wrinkle')) return 'Fine Lines';
            if (c.toLowerCase().includes('uneven')) return 'Uneven Skin Tone';
            return c;
        });
        for (const m of mapped) {
            if (!conditions.includes(m)) {
                conditions[Math.floor(Math.random() * conditions.length)] = m;
            }
        }
    }

    // Health score varies by number and severity of conditions
    const baseScore = skinType === 'Normal' ? 80 : skinType === 'Sensitive' ? 60 : 65;
    const healthScore = Math.min(95, Math.max(45, baseScore + Math.floor(Math.random() * 20) - conditions.length * 3));

    const severity = healthScore >= 80 ? 'mild' : healthScore >= 65 ? 'moderate' : 'needs attention';

    // Skin-type + condition specific recommendations
    const recMap = {
        'Oily': [
            'Use a gentle gel/foam cleanser with Salicylic Acid (BHA)',
            'Apply Niacinamide serum to control oil and minimize pores',
            'Use oil-free, gel-based moisturizer',
            'Apply matte-finish SPF 50+ sunscreen daily',
            'Use Clay mask 1-2x per week to deep clean pores',
            'Exfoliate with BHA 2-3 times per week'
        ],
        'Dry': [
            'Switch to a cream/milk cleanser — avoid foaming formulas',
            'Apply Hyaluronic Acid serum on damp skin for deep hydration',
            'Use rich, ceramide-based moisturizer morning and night',
            'Apply SPF 50+ with added moisture/ceramides',
            'Use hydrating sheet masks 2-3x per week',
            'Apply facial oil (rosehip/jojoba) at night for barrier repair'
        ],
        'Sensitive': [
            'Use fragrance-free, pH-balanced gentle cleanser',
            'Apply Centella (Cica) serum to calm inflammation',
            'Use barrier-repair moisturizer with ceramides',
            'Apply mineral SPF 50+ (zinc oxide based)',
            'Avoid any products with alcohol, fragrance, or essential oils',
            'Introduce new products one at a time — patch test first'
        ],
        'Combination': [
            'Use a balanced gel-cream cleanser',
            'Apply different products on T-zone vs. cheeks (multi-zone care)',
            'Use Niacinamide serum all-over to balance oil and hydration',
            'Apply gel moisturizer on T-zone, cream on dry areas',
            'Use lightweight SPF 50+ gel sunscreen',
            'Use clay mask on nose/forehead, hydrating mask on cheeks'
        ],
        'Normal': [
            'Maintain your gentle cleanser — don\'t over-complicate',
            'Use Vitamin C serum in the morning for glow and protection',
            'Apply a lightweight moisturizer with antioxidants',
            'Use SPF 50+ daily to prevent premature aging',
            'Exfoliate with AHA 1-2x per week for extra radiance',
            'Apply a hydrating mask weekly for maintenance'
        ]
    };

    const recommendations = recMap[skinType] || recMap['Normal'];

    // Analysis text personalized to detected conditions
    const conditionTexts = conditions.slice(0, 3).join(', ');
    const analysis = `Based on our AI analysis, we detected **${conditionTexts}**. ` +
        (severity === 'mild'
            ? `Your skin appears generally healthy with minor areas to address. A consistent skincare routine will help maintain and improve your complexion.`
            : severity === 'moderate'
            ? `Your skin has some areas that need targeted care. We recommend focusing on these concerns with the right products and a consistent routine.`
            : `Your skin needs extra attention. We strongly recommend a dedicated skincare routine with products specifically designed for your ${skinType} skin type and these conditions.`);

    return {
        conditions,
        healthScore,
        severity,
        analysis,
        recommendations,
        routine: {
            morning: skinType === 'Oily'
                ? ['Gel Cleanser', 'BHA Toner', 'Niacinamide Serum', 'Oil-Free Moisturizer', 'Matte SPF 50+']
                : skinType === 'Dry'
                ? ['Cream Cleanser', 'Hydrating Toner', 'Hyaluronic Acid Serum', 'Rich Moisturizer', 'Hydrating SPF 50+']
                : skinType === 'Sensitive'
                ? ['Gentle Micellar Cleanser', 'Cica/Centella Toner', 'Calming Serum', 'Barrier Cream', 'Mineral SPF 50+']
                : skinType === 'Combination'
                ? ['Gel-Cream Cleanser', 'Balancing Toner', 'Niacinamide Serum', 'Gel Moisturizer', 'Lightweight SPF 50+']
                : ['Gentle Cleanser', 'Vitamin C Serum', 'Moisturizer', 'Sunscreen SPF 50+'],
            evening: skinType === 'Oily'
                ? ['Oil Cleanser', 'Gel Cleanser', 'BHA Treatment (2-3x/week)', 'Lightweight Night Moisturizer']
                : skinType === 'Dry'
                ? ['Balm Cleanser', 'Cream Cleanser', 'Retinol (2x/week)', 'Night Cream + Facial Oil']
                : skinType === 'Sensitive'
                ? ['Gentle Cleanser (single cleanse)', 'Cica Serum', 'Barrier Repair Night Cream']
                : skinType === 'Combination'
                ? ['Double Cleanse', 'AHA Treatment (2x/week)', 'Zone-Specific Moisturizer']
                : ['Double Cleanse', 'Treatment Serum', 'Eye Cream', 'Night Moisturizer']
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
