const cron = require('node-cron');
const Database = require('better-sqlite3');
const { postToFacebook } = require('./services/facebook');
const db = new Database('db.sqlite');

/**
 * ฟังก์ชันเริ่มต้นระบบตั้งเวลาโพสต์
 */
function initCron() {
    console.log("\n=========================================");
    console.log("[Cron] Initializing scheduled post checks...");
    
    // ดึงค่าจาก environment variables
    const pageId = process.env.FB_PAGE_ID;
    const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;
    const geminiKey = process.env.GEMINI_API_KEY;

    // Check config readiness (debug)
    const hasPageId = !!(pageId && pageId.trim());
    const hasToken = !!(accessToken && accessToken.trim());
    const hasGemini = !!(geminiKey && geminiKey.trim());

    console.log(`[Debug] FB_PAGE_ID: ${hasPageId ? 'OK' : 'MISSING'}`);
    console.log(`[Debug] FB_PAGE_ACCESS_TOKEN: ${hasToken ? 'OK' : 'MISSING'}`);
    console.log(`[Debug] GEMINI_API_KEY: ${hasGemini ? 'OK' : 'MISSING'}`);

    if (hasPageId && hasToken) {
        console.log("\n[Cron] Status: LIVE MODE (Facebook enabled)");
        console.log(`[Cron] Target Page ID: ${pageId}`);
    } else {
        console.log("\n[Cron] Status: OFFLINE MOCK MODE");
        console.log("[Cron] Tip: If you just updated .env, restart the terminal/server.");
        console.log("[Cron] Posts will be logged to console instead of sent to Facebook.");
    }
    console.log("=========================================\n");
    
    // ตรวจสอบโพสต์ที่ต้องส่งทุกๆ 1 นาที
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date().toISOString();
            
            // ค้นหาโพสต์ที่ได้รับการอนุมัติ (Approved) และถึงเวลาโพสต์แล้ว
            const pendingPosts = db.prepare(`
                SELECT * FROM posts 
                WHERE status = 'Scheduled' 
                AND scheduled_at <= ?
            `).all(now);

            if (pendingPosts.length > 0) {
                console.log(`[Cron] [${new Date().toLocaleTimeString()}] Found ${pendingPosts.length} scheduled posts to send...`);
            }

            for (const post of pendingPosts) {
                try {
                    // เรียกใช้ Facebook Service 
                    // (ฟังก์ชันนี้จะทำ Mocking ให้อัตโนมัติหากไม่มี API Credentials)
                    const result = await postToFacebook(post.content, post.image_data);
                    
                    if (result && result.success) {
                        db.prepare("UPDATE posts SET status = 'Posted' WHERE id = ?").run(post.id);
                        console.log(`[Cron] [OK] Post ID: ${post.id} sent and marked as 'Posted'`);
                        if (result.id) console.log(`[Cron] Facebook ID: ${result.id}`);
                        if (result.permalink) console.log(`[Cron] Permalink: ${result.permalink}`);
                    }
                } catch (error) {
                    console.error(`[Cron] [ERROR] Post ID ${post.id}:`, error.message);
                }
            }
        } catch (error) {
            console.error("[Cron] [CRITICAL] Database check failed:", error.message);
        }
    });
}

// ส่งออกในรูปแบบ Object เพื่อให้ server.js เรียกใช้ได้ถูกต้อง
module.exports = { initCron };
