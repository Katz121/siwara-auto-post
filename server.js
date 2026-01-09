const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
const { initCron } = require('./cron');
const { postToFacebook } = require('./services/facebook');
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
const postRoutes = require('./routes/post');
app.use('/api/posts', postRoutes);

// ✅ API สำหรับอนุมัติและตั้งเวลาโพสต์
app.patch('/api/approve/:id', async (req, res) => {
    const postId = req.params.id;
    
    try {
        const lockResult = db.prepare("UPDATE posts SET status = 'Processing' WHERE id = ? AND status = 'Draft'").run(postId);
        
        if (lockResult.changes === 0) {
            return res.status(409).json({ error: "Post is already processing or not in Draft state." });
        }

        const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
        if (!post) {
            db.prepare("UPDATE posts SET status = 'Draft' WHERE id = ?").run(postId);
            return res.status(404).json({ error: "Post not found." });
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
        res.json({ success: true, message: "Post scheduled successfully." });

    } catch (error) {
        db.prepare("UPDATE posts SET status = 'Draft' WHERE id = ?").run(postId);
        const fbError = error.response?.data?.error;
        console.error("[Approve Error]:", fbError || error.message);
        res.status(500).json({ error: fbError ? fbError.message : error.message });
    }
});

// API สำหรับลบโพสต์
// API: publish immediately
app.post('/api/publish/:id', async (req, res) => {
    const postId = req.params.id;
    let originalStatus = null;

    try {
        const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
        if (!post) {
            return res.status(404).json({ error: "Post not found." });
        }

        if (!['Approved', 'Scheduled'].includes(post.status)) {
            return res.status(409).json({ error: "Post is not in Approved/Scheduled state." });
        }

        originalStatus = post.status;
        db.prepare("UPDATE posts SET status = 'Processing' WHERE id = ?").run(postId);
        const result = await postToFacebook(post.content, post.image_data);
        db.prepare("UPDATE posts SET status = 'Posted' WHERE id = ?").run(postId);

        res.json({ success: true, result });
    } catch (error) {
        db.prepare("UPDATE posts SET status = ? WHERE id = ?").run(originalStatus || 'Approved', postId);
        res.status(500).json({ error: error.message });
    }
});


// ✅ แก้ไขการโหลด Routes ให้แสดง Error ที่ชัดเจน
try {
    const generateRoutes = require('./routes/generate');
    app.use('/api/generate', generateRoutes);
} catch (e) {
    console.error("[CRITICAL] Failed to load routes/generate.js");
    console.error("Error stack:", e.stack);
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

initCron();
