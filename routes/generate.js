const express = require('express');
const router = express.Router();
const { callGemini } = require('../services/gem'); // ✅ แก้ไขให้ตรงกับชื่อไฟล์ services/gem.js ของพี่ชายแล้วครับ
const Database = require('better-sqlite3');
const db = new Database('db.sqlite');

/**
 * ✅ ฟังก์ชันช่วยคำนวณเวลาที่ปลอดภัยสำหรับ Facebook (ห้ามต่ำกว่า 10 นาที)
 */
function getSafeScheduleTime(requestedTime) {
    const now = new Date();
    const minSafeTime = new Date(now.getTime() + 15 * 60 * 1000); // +15 นาที
    const targetTime = new Date(requestedTime);
    if (isNaN(targetTime.getTime()) || targetTime < minSafeTime) {
        return minSafeTime.toISOString();
    }
    return targetTime.toISOString();
}

/**
 * ✅ ฟังก์ชันช่วยล้างข้อความ JSON จาก AI ให้สะอาดที่สุด
 * แก้ปัญหา Expected property name หรือ Bad control character
 */
function cleanJsonString(str) {
    if (typeof str !== 'string') return str;
    
    // 1. ลบ Markdown Code Blocks
    let cleaned = str.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // 2. ดึงเฉพาะส่วนที่เป็น JSON Object { ... } เท่านั้น
    const firstOpenBracket = cleaned.indexOf('{');
    const lastCloseBracket = cleaned.lastIndexOf('}');
    
    if (firstOpenBracket !== -1 && lastCloseBracket !== -1) {
        cleaned = cleaned.substring(firstOpenBracket, lastCloseBracket + 1);
    }

    // 3. จัดการอักขระควบคุม (Control Characters)
    return cleaned.replace(/[\u0000-\u001F]/g, (char) => {
        if (char === '\n') return '\\n';
        if (char === '\r') return '\\r';
        if (char === '\t') return '\\t';
        return '';
    });
}

/**
 * ฟังก์ชันแกะข้อมูลกรณี AI ส่ง JSON มาซ้อนในเนื้อหา
 */
function parseAIGeneratedContent(content) {
    try {
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
        if (parsed && typeof parsed === 'object') {
            const caption = parsed.caption || parsed.แคปชัน || parsed.content || "";
            const rationale = parsed.rationale || parsed.เหตุผล || parsed.เหตุผลสั้นๆ || "";
            const hashtags = Array.isArray(parsed.hashtag || parsed.hashtags) ? (parsed.hashtag || parsed.hashtags).join(' ') : (parsed.hashtag || "");
            const imageIdea = parsed.image_idea || parsed.แนวคิดภาพถ่าย || "";
            
            return {
                mainContent: `${caption}\n\n${hashtags}`.trim(),
                strategy: `${rationale}\n📸 ${imageIdea}`.trim()
            };
        }
    } catch (e) {
        // ไม่ใช่ JSON
    }
    return { mainContent: content, strategy: "" };
}

/**
 * Extract content between custom markers [[POST]]...[[/POST]]
 */
function extractPostFromMarkers(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(/\[{1,2}POST\]{1,2}([\s\S]*?)\[{1,2}\/POST\]{1,2}/i);
    return m ? m[1].trim() : null;
}

// --- Routes ---

router.get('/gems', (req, res) => {
    try { res.json(db.prepare("SELECT * FROM gems").all()); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/gems', (req, res) => {
    const { name, instruction } = req.body;
    try {
        const info = db.prepare("INSERT INTO gems (name, instruction, is_active) VALUES (?, ?, 0)").run(name, instruction);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/gems/:id', (req, res) => {
    try {
        db.prepare("UPDATE gems SET name = ?, instruction = ? WHERE id = ?").run(req.body.name, req.body.instruction, req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/gems/:id', (req, res) => {
    try {
        const gem = db.prepare("SELECT is_active FROM gems WHERE id = ?").get(req.params.id);
        if (gem && gem.is_active === 1) return res.status(400).json({ error: "ไม่สามารถลบตัวตนที่ใช้งานอยู่ได้" });
        db.prepare("DELETE FROM gems WHERE id = ?").run(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/gems/:id/activate', (req, res) => {
    try {
        const transaction = db.transaction(() => {
            db.prepare("UPDATE gems SET is_active = 0").run();
            db.prepare("UPDATE gems SET is_active = 1 WHERE id = ?").run(req.params.id);
        });
        transaction();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 🤖 ระบบการเจนคอนเทนต์ (Weekly & Instant)
// ==========================================

router.post('/weekly', async (req, res) => {
    const { instruction } = req.body;
    try {
        const activeGem = db.prepare("SELECT * FROM gems WHERE is_active = 1").get();
        if (!activeGem) throw new Error("กรุณาเลือกและเปิดใช้งาน Gem ก่อน");

        const userPrompt = `ภารกิจ: สร้างคอนเทนต์ 7 วัน (วันละ 2 โพสต์)
        คำสั่งเพิ่มเติมจากเจ้าของร้าน: ${instruction || 'เน้นบรรยากาศร้าน'}
        
        ข้อกำหนดการตอบกลับ:
        - ตอบกลับในรูปแบบ JSON ที่ถูกต้องเท่านั้น
        - โครงสร้าง JSON:
        { 
          "posts": [ 
            { 
              "day": 0, 
              "time": "10:20", 
              "type": "Promotion", 
              "content": "เนื้อหาแคปชันภาษาไทย" 
            } 
          ] 
        }`;

        const response = await callGemini(activeGem.instruction, userPrompt, null, true);
        
        let data;
        if (typeof response === 'object' && response !== null) {
            data = response;
        } else {
            const cleaned = cleanJsonString(response);
            data = JSON.parse(cleaned);
        }
        
        if (!data || !data.posts || !Array.isArray(data.posts)) {
            throw new Error("ข้อมูล JSON ที่ได้รับไม่สมบูรณ์ หรือไม่มีรายการโพสต์");
        }

        const insertStmt = db.prepare(`INSERT INTO posts (scheduled_at, content, post_type, status) VALUES (?, ?, ?, 'Draft')`);
        
        const transaction = db.transaction((posts) => {
            const now = new Date();
            for (const p of posts) {
                const postDate = new Date();
                postDate.setDate(now.getDate() + (p.day || 0));
                const [h, m] = (p.time || "10:00").split(':');
                postDate.setHours(parseInt(h), parseInt(m), 0, 0);
                
                const safeTime = getSafeScheduleTime(postDate);
                const parsed = parseAIGeneratedContent(p.content);
                const finalDisplay = parsed.strategy ? `${parsed.mainContent}\n\n💡 กลยุทธ์: ${parsed.strategy}` : parsed.mainContent;
                
                let cleanFinal = finalDisplay.replace(/\[{1,2}POST\]{1,2}([\s\S]*?)\[{1,2}\/POST\]{1,2}/i, '$1');
                cleanFinal = cleanFinal.replace(/\[{1,2}META\]{1,2}[\s\S]*?\[{1,2}\/META\]{1,2}/i, '').trim();

                insertStmt.run(safeTime, cleanFinal, p.type || 'General');
            }
        });
        transaction(data.posts);
        res.json({ success: true, count: data.posts.length });
    } catch (error) {
        console.error("[Weekly Gen Error]:", error.message);
        res.status(500).json({ error: "AI ประมวลผลล้มเหลว: " + error.message });
    }
});

router.post('/instant', async (req, res) => {
    try {
        let { instruction, image } = req.body;
        const activeGem = db.prepare("SELECT * FROM gems WHERE is_active = 1").get();
        if (!activeGem) throw new Error("กรุณาเปิดใช้งาน Gem ก่อน");

        let content;
        const extracted = extractPostFromMarkers(instruction || '');
        if (extracted) {
            content = extracted;
        } else {
            content = await callGemini(activeGem.instruction, instruction || "ช่วยเขียนแคปชันให้น่าสนใจ", image || null, false);
        }

        const contentStr = typeof content === 'string' ? content : (content.content || JSON.stringify(content));
        const parsed = parseAIGeneratedContent(contentStr);
        const finalDisplay = parsed.strategy ? `${parsed.mainContent}\n\n💡 กลยุทธ์: ${parsed.strategy}` : parsed.mainContent;
        let cleanFinal = finalDisplay.replace(/\[{1,2}POST\]{1,2}([\s\S]*?)\[{1,2}\/POST\]{1,2}/i, '$1');
        cleanFinal = cleanFinal.replace(/\[{1,2}META\]{1,2}[\s\S]*?\[{1,2}\/META\]{1,2}/i, '').trim();

        const safeTime = getSafeScheduleTime(new Date());
        db.prepare(`INSERT INTO posts (scheduled_at, content, post_type, image_data, status) VALUES (?, ?, 'Instant', ?, 'Draft')`)
          .run(safeTime, cleanFinal, image || null);

        res.json({ success: true });
    } catch (error) {
        console.error("[Generate Instant Error]:", error.message);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;