const cron = require('node-cron');
const Database = require('better-sqlite3');
const { publishToFacebook } = require('./services/facebook');
const db = new Database('db.sqlite');

/**
 * ฟังก์ชันเริ่มต้นระบบตั้งเวลาโพสต์
 */
function initCron() {
    console.log("\n=========================================");
    console.log("[Cron] ระบบกำลังเริ่มตรวจสอบค่าคอนฟิก...");
    
    // ดึงค่าจาก environment variables
    const pageId = process.env.FB_PAGE_ID;
    const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;
    const geminiKey = process.env.GEMINI_API_KEY;

    // ตรวจสอบความพร้อมและแสดงผลเพื่อการตรวจสอบ (Debug)
    const hasPageId = !!(pageId && pageId.trim());
    const hasToken = !!(accessToken && accessToken.trim());
    const hasGemini = !!(geminiKey && geminiKey.trim());

    console.log(`[Debug] FB_PAGE_ID: ${hasPageId ? '✅ พบข้อมูล' : '❌ ว่างเปล่า'}`);
    console.log(`[Debug] FB_PAGE_ACCESS_TOKEN: ${hasToken ? '✅ พบข้อมูล' : '❌ ว่างเปล่า'}`);
    console.log(`[Debug] GEMINI_API_KEY: ${hasGemini ? '✅ พบข้อมูล' : '❌ ว่างเปล่า'}`);

    if (hasPageId && hasToken) {
        console.log("\n[Cron] ✅ สถานะ: LIVE MODE (พร้อมเชื่อมต่อ Facebook)");
        console.log(`[Cron] Target Page ID: ${pageId}`);
    } else {
        console.log("\n[Cron] ⚠️ สถานะ: OFFLINE MOCK MODE");
        console.log("[Cron] คำแนะนำ: หากคุณใส่ค่าใน .env แล้วแต่ยังขึ้น Error นี้ ให้ลองปิดและเปิด Terminal ใหม่");
        console.log("[Cron] ระบบจะทำการ Log ข้อความลง Console แทนการโพสต์จริงเพื่อความปลอดภัย");
    }
    console.log("=========================================\n");
    
    // ตรวจสอบโพสต์ที่ต้องส่งทุกๆ 1 นาที
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date().toISOString();
            
            // ค้นหาโพสต์ที่ได้รับการอนุมัติ (Approved) และถึงเวลาโพสต์แล้ว
            const pendingPosts = db.prepare(`
                SELECT * FROM posts 
                WHERE status = 'Approved' 
                AND scheduled_at <= ?
            `).all(now);

            if (pendingPosts.length > 0) {
                console.log(`[Cron] [${new Date().toLocaleTimeString()}] ตรวจพบ ${pendingPosts.length} รายการที่ต้องโพสต์...`);
            }

            for (const post of pendingPosts) {
                try {
                    // เรียกใช้ Facebook Service 
                    // (ฟังก์ชันนี้จะทำ Mocking ให้อัตโนมัติหากไม่มี API Credentials)
                    const success = await publishToFacebook(post);
                    
                    if (success) {
                        db.prepare("UPDATE posts SET status = 'Posted' WHERE id = ?").run(post.id);
                        console.log(`[Cron] [สำเร็จ] โพสต์ ID: ${post.id} ถูกส่งออกและเปลี่ยนสถานะเป็น 'Posted'`);
                    }
                } catch (error) {
                    console.error(`[Cron] [ผิดพลาด] โพสต์ ID ${post.id}:`, error.message);
                }
            }
        } catch (error) {
            console.error("[Cron] [วิกฤต] ระบบตรวจสอบฐานข้อมูลผิดพลาด:", error.message);
        }
    });
}

// ส่งออกในรูปแบบ Object เพื่อให้ server.js เรียกใช้ได้ถูกต้อง
module.exports = { initCron };