const express = require('express');
const router = express.Router();

// Admin login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  if (username === 'admin' && password === 'admin123') {
    const token = Buffer.from(JSON.stringify({ 
      id: 1, 
      username: 'admin', 
      role: 'admin',
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    })).toString('base64');
    
    res.json({ 
      success: true, 
      token,
      user: { id: 1, username: 'admin', role: 'admin' }
    });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Verify session
router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    if (decoded.exp < Date.now()) {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;