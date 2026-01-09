const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const db = new Database('db.sqlite');

// ดึงโพสต์ทั้งหมด
router.get('/', (req, res) => {
    try {
        const posts = db.prepare("SELECT * FROM posts ORDER BY scheduled_at ASC").all();
        res.json(posts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ✅ โค้ดส่วนที่ต้องมีเพื่อให้ปุ่ม "บันทึกการแก้ไข" ทำงาน
router.patch('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { content, image_data } = req.body;
        
        const stmt = db.prepare("UPDATE posts SET content = ?, image_data = ? WHERE id = ?");
        stmt.run(content, image_data, id);
        
        res.json({ success: true, message: "Updated successfully" });
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

module.exports = router;
