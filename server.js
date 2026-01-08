require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { initCron } = require('./cron');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/posts', require('./routes/post'));
app.use('/api/generate', require('./routes/generate'));
app.use('/api/approve', require('./routes/approve'));
app.use('/api/test-post', require('./routes/test-post'));

app.use(express.static('public'));

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', pid: process.pid });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  initCron();
});