// Authentication Middleware
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    req.flash('error', 'Please login to access this page');
    res.redirect('/auth/login');
}

function isGuest(req, res, next) {
    if (req.session && req.session.user) {
        return res.redirect('/');
    }
    next();
}

// Make user data available to all views
function setLocals(req, res, next) {
    res.locals.user = req.session ? req.session.user : null;
    res.locals.success = req.flash ? req.flash('success') : [];
    res.locals.error = req.flash ? req.flash('error') : [];
    res.locals.cartCount = req.session ? (req.session.cartCount || 0) : 0;
    next();
}

module.exports = { isAuthenticated, isGuest, setLocals };
