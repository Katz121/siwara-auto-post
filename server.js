const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data'); // สำหรับจัดการการส่งไฟล์รูปภาพ
require('dotenv').config();

const app = express();
const db = new Database('db.sqlite');

// --- 1. Middleware ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- 2. Database Init ---
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

// --- 3. Routes ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'preview.html'));
});

// ✅ API สำหรับการ "อนุมัติและตั้งเวลาโพสต์อัตโนมัติ" (Approve & Schedule)
// เมื่อกดอนุมัติ ระบบจะส่งข้อมูลไปจองคิวบน Facebook ทันทีตามเวลาที่กำหนดไว้
app.patch('/api/approve/:id', async (req, res) => {
    const postId = req.params.id;
    
    try {
        console.log(`[Schedule] เริ่มกระบวนการอนุมัติและตั้งเวลาโพสต์ ID: ${postId}`);
        
        // 1. ดึงข้อมูลโพสต์
        const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
        if (!post) return res.status(404).json({ error: "ไม่พบโพสต์" });

        const pageId = process.env.FB_PAGE_ID;
        const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;

        if (!pageId || !accessToken) {
            return res.status(400).json({ error: "กรุณาตั้งค่า FB_PAGE_ID และ TOKEN ใน .env" });
        }

        // 2. คำนวณเวลา (Facebook ต้องการ Unix Timestamp เป็นวินาที)
        // ข้อกำหนด Facebook: ต้องตั้งล่วงหน้าอย่างน้อย 10 นาที และไม่เกิน 75 วัน
        const scheduleDate = new Date(post.scheduled_at);
        const unixTimestamp = Math.floor(scheduleDate.getTime() / 1000);
        const nowUnix = Math.floor(Date.now() / 1000);

        if (unixTimestamp < nowUnix + 600) {
            return res.status(400).json({ error: "เวลาตั้งโพสต์ต้องห่างจากปัจจุบันอย่างน้อย 10 นาที" });
        }

        let fbResponse;

        // 3. ส่งข้อมูลไปยัง Facebook แบบตั้งเวลา (published=false)
        if (post.image_data && post.image_data.startsWith('data:image')) {
            // กรณีมีรูปภาพ
            const base64Data = post.image_data.split(';base64,').pop();
            const imageBuffer = Buffer.from(base64Data, 'base64');
            
            const formData = new FormData();
            formData.append('access_token', accessToken);
            formData.append('source', imageBuffer, { filename: `scheduled_${postId}.jpg` });
            formData.append('caption', post.content);
            formData.append('published', 'false'); // สำคัญ: false คือยังไม่โพสต์ทันที
            formData.append('scheduled_publish_time', unixTimestamp.toString()); // เวลาที่จะโพสต์

            fbResponse = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/photos`, formData, {
                headers: formData.getHeaders()
            });
        } else {
            // กรณีข้อความอย่างเดียว
            fbResponse = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
                message: post.content,
                published: false, // สำคัญ: false
                scheduled_publish_time: unixTimestamp,
                access_token: accessToken
            });
        }

        // 4. อัปเดตสถานะใน DB เป็น 'Scheduled' (หรือจะใช้ 'Approved' ตามเดิมก็ได้)
        db.prepare("UPDATE posts SET status = 'Approved' WHERE id = ?").run(postId);
        
        console.log(`[Schedule] สำเร็จ! ตั้งเวลาโพสต์เรียบร้อย (FB ID: ${fbResponse.data.id || fbResponse.data.post_id})`);
        res.json({ success: true, message: "อนุมัติและตั้งเวลาโพสต์บน Facebook สำเร็จ" });

    } catch (error) {
        const fbError = error.response?.data?.error;
        console.error("[Schedule] Error:", fbError || error.message);
        res.status(500).json({ error: fbError ? fbError.message : error.message });
    }
});

// API สำหรับโพสต์ทันที (Publish) ยังคงเก็บไว้เผื่อกดแมนนวล
app.post('/api/publish/:id', async (req, res) => {
    const postId = req.params.id;
    try {
        const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
        if (!post) return res.status(404).json({ error: "ไม่พบโพสต์" });

        const pageId = process.env.FB_PAGE_ID;
        const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;

        let fbResponse;
        if (post.image_data && post.image_data.startsWith('data:image')) {
            const base64Data = post.image_data.split(';base64,').pop();
            const imageBuffer = Buffer.from(base64Data, 'base64');
            const formData = new FormData();
            formData.append('access_token', accessToken);
            formData.append('source', imageBuffer, { filename: `manual_${postId}.jpg` });
            formData.append('caption', post.content);
            fbResponse = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/photos`, formData, { headers: formData.getHeaders() });
        } else {
            fbResponse = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/feed`, { message: post.content, access_token: accessToken });
        }
        db.prepare("UPDATE posts SET status = 'Posted' WHERE id = ?").run(postId);
        res.json({ success: true, message: "โพสต์ทันทีสำเร็จ" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// โหลด Routes อื่นๆ (นำออกหรือคอมเมนต์ส่วน approve ถ้าต้องการใช้ logic ในไฟล์นี้ตรงๆ)
try {
    app.use('/api/generate', require('./routes/generate'));
    app.use('/api/posts', require('./routes/post'));
    // app.use('/api/approve', require('./routes/approve')); // ปิดตัวเดิมเพื่อใช้ตัวใหม่ด้านบน
} catch (e) {
    console.warn("⚠️ Route loading warning:", e.message);
}

app.get('/api/config', (req, res) => {
    res.json({
        isConfigured: !!(process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN),
        pageId: process.env.FB_PAGE_ID || null
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n==============================================`);
    console.log(`🚀 SIWARA CAFE SERVER ONLINE!`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`==============================================\n`);
});