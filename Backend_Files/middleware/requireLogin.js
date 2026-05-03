// middleware/requireLogin.js

function requireLogin(req, res, next) {
  // Optional logging for debugging
  console.log('🍪 Session cookie:', req.headers.cookie);
  console.log('📦 Session data:', req.session);

  if (!req.session || !req.session.user) {
    console.warn('❌ [Auth] No session user — rejecting');
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Attach the user to req for downstream use
  req.user = req.session.user;
  next();
}

module.exports = requireLogin;