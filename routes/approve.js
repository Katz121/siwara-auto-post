const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const db = new Database('db.sqlite');

// อนุมัติโพสต์เพื่อให้พร้อมสำหรับการโพสต์อัตโนมัติ
router.patch('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const stmt = db.prepare("UPDATE posts SET status = 'Approved' WHERE id = ?");
        const result = stmt.run(id);
        
        if (result.changes > 0) {
            res.json({ success: true, message: "Post approved!" });
        } else {
            res.status(404).json({ error: "Post not found" });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;