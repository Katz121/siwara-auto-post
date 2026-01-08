const express = require('express');
const router = express.Router();
const { callGemini } = require('../services/gem');
const Database = require('better-sqlite3');
const db = new Database('db.sqlite');

/**
 * ฟังก์ชันช่วยล้างข้อความ Markdown JSON จาก AI
 */
function cleanJsonString(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/```json/g, '').replace(/```/g, '').trim();
}

/**
 * ฟังก์ชันแกะข้อมูลในกรณีที่ AI ส่งเนื้อหามาเป็น JSON Object ซ้อนภายใน
 */
function parseAIGeneratedContent(content) {
    try {
        // ลองเช็กว่า content ที่ได้มาเป็น JSON string หรือไม่
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
        
        if (parsed && typeof parsed === 'object') {
            // ดึง Caption ออกมา (รองรับทั้ง key ภาษาไทยและอังกฤษ)
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
        // ถ้าไม่ใช่ JSON ให้ส่งคืนค่าเดิม
    }
    return { mainContent: content, strategy: "" };
}

/**
 * Extract content between custom markers [[POST]]...[[/POST]]
 */
function extractPostFromMarkers(text) {
    if (typeof text !== 'string') return null;
    // support [POST] or [[POST]] variants
    const m = text.match(/\[{1,2}POST\]{1,2}([\s\S]*?)\[{1,2}\/POST\]{1,2}/i);
    return m ? m[1].trim() : null;
}

// ==========================================
// 💎 ระบบจัดการ IDENTITY GEMS (ตัวตน AI)
// ==========================================

router.get('/gems', (req, res) => {
    try {
        const gems = db.prepare("SELECT * FROM gems").all();
        res.json(gems);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/gems', (req, res) => {
    const { name, instruction } = req.body;
    try {
        const stmt = db.prepare("INSERT INTO gems (name, instruction, is_active) VALUES (?, ?, 0)");
        const info = stmt.run(name, instruction);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.patch('/gems/:id', (req, res) => {
    const { id } = req.params;
    const { name, instruction } = req.body;
    try {
        db.prepare("UPDATE gems SET name = ?, instruction = ? WHERE id = ?").run(name, instruction, id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/gems/:id', (req, res) => {
    const { id } = req.params;
    try {
        const gem = db.prepare("SELECT is_active FROM gems WHERE id = ?").get(id);
        if (gem && gem.is_active === 1) {
            return res.status(400).json({ error: "ไม่สามารถลบตัวตนที่ใช้งานอยู่ได้" });
        }
        db.prepare("DELETE FROM gems WHERE id = ?").run(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.patch('/gems/:id/activate', (req, res) => {
    const { id } = req.params;
    try {
        const transaction = db.transaction(() => {
            db.prepare("UPDATE gems SET is_active = 0").run();
            db.prepare("UPDATE gems SET is_active = 1 WHERE id = ?").run(id);
        });
        transaction();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 🤖 ระบบการเจนคอนเทนต์ (AI GENERATION)
// ==========================================

router.post('/weekly', async (req, res) => {
    const { instruction } = req.body;
    try {
        const activeGem = db.prepare("SELECT * FROM gems WHERE is_active = 1").get();
        if (!activeGem) throw new Error("กรุณาเลือกและเปิดใช้งาน Gem ก่อน");

        const systemPrompt = activeGem.instruction;
        
        const userPrompt = `คำสั่งเพิ่มเติมจากเจ้าของร้าน: ${instruction || 'เน้นบรรยากาศร้านทั่วไป'}
        
        ภารกิจ: สร้างคอนเทนต์ 7 วัน (วันละ 2 โพสต์)
        ตอบกลับในรูปแบบ JSON ตามโครงสร้างนี้เท่านั้น:
        {
          "posts": [
            {
              "day": 0, 
              "time": "10:20",
              "type": "Warmup/Promotion/Knowledge",
              "content": "เนื้อหาโพสต์ที่สร้างตามข้อกำหนดของ Gem"
            }
          ]
        }`;

        const rawResponse = await callGemini(systemPrompt, userPrompt);
        const cleaned = typeof rawResponse === 'string' ? cleanJsonString(rawResponse) : JSON.stringify(rawResponse);
        const data = JSON.parse(cleaned);
        
        const insertStmt = db.prepare(`INSERT INTO posts (scheduled_at, content, post_type, status) VALUES (?, ?, ?, 'Draft')`);
        
        const transaction = db.transaction((posts) => {
            const now = new Date();
            for (const p of posts) {
                const postDate = new Date();
                postDate.setDate(now.getDate() + (p.day || 0));
                const [h, m] = (p.time || "10:00").split(':');
                postDate.setHours(parseInt(h), parseInt(m), 0, 0);
                
                // ใช้ Smart Parser แกะข้อมูลที่ AI เจนออกมา
                const parsed = parseAIGeneratedContent(p.content);
                const finalDisplay = parsed.strategy ? `${parsed.mainContent}\n\n💡 กลยุทธ์: ${parsed.strategy}` : parsed.mainContent;
                // sanitize: remove any [[POST]]...[[/POST]] or [[META]] blocks if present
                let cleanFinal = finalDisplay.replace(/\[{1,2}POST\]{1,2}([\s\S]*?)\[{1,2}\/POST\]{1,2}/i, '$1');
                cleanFinal = cleanFinal.replace(/\[{1,2}META\]{1,2}[\s\S]*?\[{1,2}\/META\]{1,2}/i, '').trim();
                insertStmt.run(postDate.toISOString(), cleanFinal, p.type || 'General');
            }
        });
        transaction(data.posts);
        res.json({ success: true, count: data.posts.length });
    } catch (error) {
        console.error("Weekly Gen Error:", error.message);
        res.status(500).json({ error: "AI ประมวลผลล้มเหลว: " + error.message });
    }
});

router.post('/instant', async (req, res) => {
    try {
        let { instruction, image } = req.body;

        const activeGem = db.prepare("SELECT * FROM gems WHERE is_active = 1").get();
        if (!activeGem) throw new Error("กรุณาเปิดใช้งาน Gem ก่อน");

        // If user provided raw content containing [[POST]] markers, use it directly
        let content;
        const extracted = extractPostFromMarkers(instruction || '');
        if (extracted) {
            content = extracted;
        } else {
            content = await callGemini(activeGem.instruction, instruction || "ช่วยเขียนแคปชันให้น่าสนใจ", image || null, false);
        }

        // If the AI returned an object (mock/JSON), convert to string
        const contentStr = typeof content === 'string' ? content : (content.content || JSON.stringify(content));

        // Use Smart Parser with instant posts
        const parsed = parseAIGeneratedContent(contentStr);
        const finalDisplay = parsed.strategy ? `${parsed.mainContent}\n\n💡 กลยุทธ์: ${parsed.strategy}` : parsed.mainContent;
                // sanitize any markers left in finalDisplay
                let cleanFinal = finalDisplay.replace(/\[{1,2}POST\]{1,2}([\s\S]*?)\[{1,2}\/POST\]{1,2}/i, '$1');
                cleanFinal = cleanFinal.replace(/\[{1,2}META\]{1,2}[\s\S]*?\[{1,2}\/META\]{1,2}/i, '').trim();

                db.prepare(`INSERT INTO posts (scheduled_at, content, post_type, image_data, status) VALUES (?, ?, 'Instant', ?, 'Draft')`)
                    .run(new Date().toISOString(), cleanFinal, image || null);

        res.json({ success: true });
    } catch (error) {
        console.error("[Generate Instant Error]:", error.message);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;