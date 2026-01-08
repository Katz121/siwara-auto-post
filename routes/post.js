const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const db = new Database('db.sqlite');

// ดึงโพสต์ทั้งหมด
router.get('/', (req, res) => {
    try {
        const posts = db.prepare("SELECT * FROM posts ORDER BY scheduled_at DESC").all();
        res.json(posts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ลบโพสต์
router.delete('/:id', (req, res) => {
    try {
        db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// สำคัญที่สุด: ต้องมีบรรทัดนี้เพื่อให้ server.js มองเห็นเส้นทางข้างบน
module.exports = router;