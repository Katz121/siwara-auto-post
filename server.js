const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const cors = require('cors');
require('dotenv').config();

const app = express();
const db = new Database('db.sqlite');

// --- 1. Middleware ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// --- 2. Database Init ---
try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scheduled_at DATETIME NOT NULL,
        post_type TEXT,
        content TEXT NOT NULL,
        image_data TEXT,
        status TEXT DEFAULT 'Draft',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS gems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        instruction TEXT,
        is_active INTEGER DEFAULT 0
      );
    `);
} catch (err) {
    console.error("[DB Error]", err.message);
}

// --- 3. Routes Registration ---
// สำคัญ: ต้องตรวจสอบว่าไฟล์เหล่านี้ module.exports = router; ไว้อย่างถูกต้อง
try {
    const generateRoutes = require('./routes/generate');
    const postRoutes = require('./routes/post');
    const approveRoutes = require('./routes/approve');

    app.use('/api/generate', generateRoutes);
    app.use('/api/posts', postRoutes);
    app.use('/api/approve', approveRoutes);
    
    console.log("[System] API Routes registered successfully.");
} catch (err) {
    console.error("[Router Error] ไม่สามารถโหลด Routes ได้:", err.message);
    console.log("ตรวจสอบว่าในโฟลเดอร์ routes มีไฟล์ครบและใส่ module.exports = router หรือยัง");
}

// API สำหรับ Gems
app.get('/api/gems', (req, res) => {
    const gems = db.prepare("SELECT * FROM gems").all();
    res.json(gems);
});

// หน้าแรก
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- 4. Scheduler ---
try {
    const { initCron } = require('./cron');
    initCron();
} catch (err) {
    console.error("[Cron Error]", err.message);
}

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Siwara Server: http://localhost:${PORT}`);
});