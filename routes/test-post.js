const express = require('express');
const router = express.Router();
const { postToFacebook } = require('../services/facebook');

// POST /api/test-post
// body: { message: string, confirm?: boolean }
router.post('/', async (req, res) => {
  const { message, confirm } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing `message` in request body' });
  }

  // Preview mode (safe): do not post unless confirm === true
  if (!confirm) {
    return res.json({ preview: true, willPost: { message }, note: 'Send with {"message":"...","confirm":true} to post for real' });
  }

  try {
    const result = await postToFacebook(message, null);
    return res.json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
