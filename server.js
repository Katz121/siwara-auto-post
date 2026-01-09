const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const db = new Database('db.sqlite');

// --- 1. เตรียมฐานข้อมูล (Database Init) ---
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

// --- 2. Middleware ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * ✅ Helper: ฟังก์ชันปรับเวลาให้ปลอดภัยสำหรับ Facebook
 */
function getSafeScheduleTime(requestedTime) {
    const now = new Date();
    const minSafeTime = new Date(now.getTime() + 15 * 60 * 1000); // ขั้นต่ำ 15 นาทีจากตอนนี้
    const targetTime = new Date(requestedTime);

    if (isNaN(targetTime.getTime()) || targetTime < minSafeTime) {
        return minSafeTime.toISOString();
    }
    return targetTime.toISOString();
}

// --- 3. API Routes ---

// API สำหรับดึงข้อมูลคอนฟิก
app.get('/api/config', (req, res) => {
    res.json({ 
        isConfigured: !!(process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN), 
        pageId: process.env.FB_PAGE_ID || null 
    });
});

// API สำหรับดึงรายการโพสต์
app.get('/api/posts', (req, res) => {
    try {
        const posts = db.prepare('SELECT * FROM posts ORDER BY scheduled_at ASC').all();
        res.json(posts);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ✅ API สำหรับอนุมัติและตั้งเวลาโพสต์
app.patch('/api/approve/:id', async (req, res) => {
    const postId = req.params.id;
    
    try {
        const lockResult = db.prepare("UPDATE posts SET status = 'Processing' WHERE id = ? AND status = 'Draft'").run(postId);
        
        if (lockResult.changes === 0) {
            return res.status(409).json({ error: "โพสต์นี้กำลังดำเนินการ หรือถูกอนุมัติไปแล้ว" });
        }

        const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
        if (!post) {
            db.prepare("UPDATE posts SET status = 'Draft' WHERE id = ?").run(postId);
            return res.status(404).json({ error: "ไม่พบโพสต์" });
        }

        const pageId = process.env.FB_PAGE_ID;
        const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;

        const safeTimeStr = getSafeScheduleTime(post.scheduled_at);
        const scheduleDate = new Date(safeTimeStr);
        
        if (safeTimeStr !== post.scheduled_at) {
            db.prepare("UPDATE posts SET scheduled_at = ? WHERE id = ?").run(safeTimeStr, postId);
        }

        const unixTimestamp = Math.floor(scheduleDate.getTime() / 1000);
        let fbResponse;

        if (post.image_data && post.image_data.startsWith('data:image')) {
            const base64Data = post.image_data.split(';base64,').pop();
            const imageBuffer = Buffer.from(base64Data, 'base64');
            
            const formData = new FormData();
            formData.append('access_token', accessToken);
            formData.append('source', imageBuffer, { filename: `post_${postId}.jpg` });
            formData.append('caption', post.content);
            formData.append('published', 'false'); 
            formData.append('scheduled_publish_time', unixTimestamp.toString());

            fbResponse = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/photos`, formData, {
                headers: formData.getHeaders()
            });
        } else {
            fbResponse = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
                message: post.content,
                published: false,
                scheduled_publish_time: unixTimestamp,
                access_token: accessToken
            });
        }

        db.prepare("UPDATE posts SET status = 'Scheduled' WHERE id = ?").run(postId);
        res.json({ success: true, message: "อนุมัติและตั้งเวลาสำเร็จ" });

    } catch (error) {
        db.prepare("UPDATE posts SET status = 'Draft' WHERE id = ?").run(postId);
        const fbError = error.response?.data?.error;
        console.error("[Approve Error]:", fbError || error.message);
        res.status(500).json({ error: fbError ? fbError.message : error.message });
    }
});

// API สำหรับลบโพสต์
app.delete('/api/posts/:id', (req, res) => {
    db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ✅ แก้ไขการโหลด Routes ให้แสดง Error ที่ชัดเจน
try {
    const generateRoutes = require('./routes/generate');
    app.use('/api/generate', generateRoutes);
} catch (e) {
    console.error("❌ CRITICAL ERROR: ไม่สามารถโหลดไฟล์ routes/generate.js ได้!");
    console.error("สาเหตุ:", e.stack); 
}

// ✅ ส่วนที่แก้ไขเพื่อเปิดให้เข้าผ่าน IP ได้
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // รับทุกการเชื่อมต่อจากภายนอก

app.listen(PORT, HOST, () => {
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    let localIp = 'localhost';
    
    // ค้นหาเลข IP ของเครื่องคอมพิวเตอร์ในวงแลน
    for (const interfaceName in networkInterfaces) {
        for (const iface of networkInterfaces[interfaceName]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIp = iface.address;
            }
        }
    }

    console.log(`\n==============================================`);
    console.log(`🚀 SIWARA CAFE SERVER ONLINE`);
    console.log(`📍 Local:   http://localhost:${PORT}`);
    console.log(`🏠 Network: http://${localIp}:${PORT}`); // แสดงเลข IP จริงที่ใช้เข้าผ่านมือถือได้
    console.log(`==============================================\n`);
});