const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const db = new Database('db.sqlite');

// ดึงรายการโพสต์ทั้งหมดมาแสดงในหน้า Admin
router.get('/', (req, res) => {
    try {
        const posts = db.prepare("SELECT * FROM posts ORDER BY scheduled_at DESC").all();
        res.json(posts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ลบโพสต์ที่ไม่ต้องการ
router.delete('/:id', (req, res) => {
    try {
        db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;