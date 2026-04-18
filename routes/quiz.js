const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');

// Skin Quiz Questions
const quizQuestions = [
    {
        id: 1,
        question: "How does your skin feel after washing your face with a gentle cleanser?",
        options: [
            { text: "Tight, dry, and sometimes flaky", scores: { Dry: 3, Normal: 0, Oily: 0, Combination: 0, Sensitive: 1 } },
            { text: "Clean and comfortable, no tightness", scores: { Dry: 0, Normal: 3, Oily: 0, Combination: 1, Sensitive: 0 } },
            { text: "Still oily or shiny within 30 minutes", scores: { Dry: 0, Normal: 0, Oily: 3, Combination: 1, Sensitive: 0 } },
            { text: "Oily in T-zone but dry/tight on cheeks", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 3, Sensitive: 0 } },
            { text: "Red, irritated, or stinging", scores: { Dry: 1, Normal: 0, Oily: 0, Combination: 0, Sensitive: 3 } }
        ]
    },
    {
        id: 2,
        question: "How does your skin look by midday (without any skincare products)?",
        options: [
            { text: "Dull, rough patches, or visible dry flakes", scores: { Dry: 3, Normal: 0, Oily: 0, Combination: 0, Sensitive: 1 } },
            { text: "Balanced and healthy-looking", scores: { Dry: 0, Normal: 3, Oily: 0, Combination: 1, Sensitive: 0 } },
            { text: "Very shiny all over, visible grease", scores: { Dry: 0, Normal: 0, Oily: 3, Combination: 0, Sensitive: 0 } },
            { text: "Shiny T-zone, normal or dry cheeks", scores: { Dry: 0, Normal: 0, Oily: 1, Combination: 3, Sensitive: 0 } },
            { text: "Uneven texture with redness or blotches", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 0, Sensitive: 3 } }
        ]
    },
    {
        id: 3,
        question: "How often do you experience breakouts?",
        options: [
            { text: "Rarely, but I get dry patches instead", scores: { Dry: 3, Normal: 0, Oily: 0, Combination: 0, Sensitive: 1 } },
            { text: "Occasionally, usually around my period or stress", scores: { Dry: 0, Normal: 3, Oily: 0, Combination: 1, Sensitive: 0 } },
            { text: "Frequently, especially on forehead, nose, and chin", scores: { Dry: 0, Normal: 0, Oily: 3, Combination: 1, Sensitive: 0 } },
            { text: "Mainly on my forehead and nose, cheeks are clear", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 3, Sensitive: 0 } },
            { text: "Breakouts are often accompanied by redness and irritation", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 0, Sensitive: 3 } }
        ]
    },
    {
        id: 4,
        question: "How does your skin react to new products?",
        options: [
            { text: "Often feels even drier or tighter", scores: { Dry: 3, Normal: 0, Oily: 0, Combination: 1, Sensitive: 1 } },
            { text: "Usually adapts well without issues", scores: { Dry: 0, Normal: 3, Oily: 0, Combination: 1, Sensitive: 0 } },
            { text: "Gets more oily or causes breakouts", scores: { Dry: 0, Normal: 0, Oily: 3, Combination: 1, Sensitive: 0 } },
            { text: "Varies — some areas improve, others react", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 3, Sensitive: 1 } },
            { text: "Often stings, burns, or causes redness", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 0, Sensitive: 3 } }
        ]
    },
    {
        id: 5,
        question: "How visible are your pores?",
        options: [
            { text: "Very small, almost invisible", scores: { Dry: 3, Normal: 1, Oily: 0, Combination: 0, Sensitive: 1 } },
            { text: "Moderately visible, normal-sized", scores: { Dry: 0, Normal: 3, Oily: 0, Combination: 1, Sensitive: 0 } },
            { text: "Large and visible, especially on nose and cheeks", scores: { Dry: 0, Normal: 0, Oily: 3, Combination: 1, Sensitive: 0 } },
            { text: "Large on T-zone, small on cheeks", scores: { Dry: 0, Normal: 0, Oily: 1, Combination: 3, Sensitive: 0 } },
            { text: "Same size but often look red or irritated", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 0, Sensitive: 3 } }
        ]
    },
    {
        id: 6,
        question: "How does your skin feel in winter/cold weather?",
        options: [
            { text: "Very dry, cracked, and uncomfortable", scores: { Dry: 3, Normal: 0, Oily: 0, Combination: 0, Sensitive: 1 } },
            { text: "Slightly drier than normal but manageable", scores: { Dry: 1, Normal: 3, Oily: 0, Combination: 1, Sensitive: 0 } },
            { text: "Still oily, not much change", scores: { Dry: 0, Normal: 0, Oily: 3, Combination: 0, Sensitive: 0 } },
            { text: "T-zone stays oily, cheeks get very dry", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 3, Sensitive: 0 } },
            { text: "Gets extremely red, itchy, and reactive", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 0, Sensitive: 3 } }
        ]
    },
    {
        id: 7,
        question: "How does your skin feel after applying sunscreen?",
        options: [
            { text: "Absorbs quickly, skin still feels dry", scores: { Dry: 3, Normal: 0, Oily: 0, Combination: 0, Sensitive: 0 } },
            { text: "Feels comfortable and protected", scores: { Dry: 0, Normal: 3, Oily: 0, Combination: 0, Sensitive: 0 } },
            { text: "Feels greasy and heavy, might break out", scores: { Dry: 0, Normal: 0, Oily: 3, Combination: 1, Sensitive: 0 } },
            { text: "Fine on cheeks but shiny on forehead/nose", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 3, Sensitive: 0 } },
            { text: "Often stings or causes a rash", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 0, Sensitive: 3 } }
        ]
    },
    {
        id: 8,
        question: "What is your biggest skin concern right now?",
        options: [
            { text: "Dryness, flakiness, and dehydration lines", scores: { Dry: 3, Normal: 0, Oily: 0, Combination: 0, Sensitive: 0 } },
            { text: "Maintaining healthy, clear skin", scores: { Dry: 0, Normal: 3, Oily: 0, Combination: 0, Sensitive: 0 } },
            { text: "Excess oil, acne, and large pores", scores: { Dry: 0, Normal: 0, Oily: 3, Combination: 1, Sensitive: 0 } },
            { text: "Mixture of oily and dry zones", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 3, Sensitive: 0 } },
            { text: "Redness, irritation, and frequent reactions", scores: { Dry: 0, Normal: 0, Oily: 0, Combination: 0, Sensitive: 3 } }
        ]
    },
    {
        id: 9,
        question: "Do you have any specific skin conditions?",
        isConcern: true,
        options: [
            { text: "Acne / Pimples", value: "Acne" },
            { text: "Hyperpigmentation / Dark spots", value: "Hyperpigmentation" },
            { text: "Dark circles / Under-eye bags", value: "Dark Circles" },
            { text: "Fine lines / Wrinkles", value: "Anti-aging" },
            { text: "Rosacea / Redness", value: "Redness" },
            { text: "Blackheads / Whiteheads", value: "Blackheads" },
            { text: "Uneven skin tone", value: "Uneven Tone" },
            { text: "Sun damage / Tan", value: "Sun Damage" },
            { text: "None of the above", value: "None" }
        ],
        multiSelect: true
    },
    {
        id: 10,
        question: "What is your age group?",
        options: [
            { text: "Under 18", value: "under18" },
            { text: "18-25", value: "18-25" },
            { text: "26-35", value: "26-35" },
            { text: "36-45", value: "36-45" },
            { text: "46+", value: "46+" }
        ],
        isInfo: true
    }
];

// GET Quiz Page
router.get('/', isAuthenticated, (req, res) => {
    res.render('quiz', { questions: quizQuestions });
});

// POST Submit Quiz
router.post('/submit', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.Cust_id;
        const answers = req.body;

        // Calculate skin type scores
        const scores = { Dry: 0, Normal: 0, Oily: 0, Combination: 0, Sensitive: 0 };
        let concerns = [];

        for (let i = 1; i <= quizQuestions.length; i++) {
            const q = quizQuestions[i - 1];
            const answer = answers[`q${i}`];

            if (q.isConcern && answer) {
                // Multi-select concerns
                concerns = Array.isArray(answer) ? answer : [answer];
            } else if (q.isInfo) {
                // Just info, no scoring
            } else if (answer !== undefined) {
                const optionIndex = parseInt(answer);
                if (q.options[optionIndex] && q.options[optionIndex].scores) {
                    const optScores = q.options[optionIndex].scores;
                    for (const type in optScores) {
                        scores[type] += optScores[type];
                    }
                }
            }
        }

        // Determine skin type
        const maxScore = Math.max(...Object.values(scores));
        const totalPossible = 8 * 3; // 8 scored questions, max 3 per question
        const matchPercentage = Math.min(((maxScore / totalPossible) * 100 + 60).toFixed(1), 99.5);
        let skinType = Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b);

        const concernStr = concerns.filter(c => c !== 'None').join(', ');

        // Save quiz response
        await db.query(
            'INSERT INTO Skin_quiz_responses (Cust_id, responses, determined_skin_type, match_percentage) VALUES (?, ?, ?, ?)',
            [userId, JSON.stringify({ answers, scores, concerns }), skinType, matchPercentage]
        );

        // Update customer skin type and concerns
        await db.query(
            'UPDATE Customer SET C_Skin_type = ?, Skin_concerns = ? WHERE Cust_id = ?',
            [skinType, concernStr || null, userId]
        );

        // Update session
        req.session.user.C_Skin_type = skinType;
        req.session.user.Skin_concerns = concernStr;

        req.flash('success', `Your skin type is ${skinType} (${matchPercentage}% match)! We'll now recommend the best products for you.`);
        res.redirect('/products?recommended=true');
    } catch (err) {
        console.error('Quiz submit error:', err);
        req.flash('error', 'Failed to process quiz. Please try again.');
        res.redirect('/quiz');
    }
});

module.exports = router;
