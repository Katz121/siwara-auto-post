const axios = require('axios');

/**
 * ฟังก์ชันหลักในการส่งโพสต์ไป Facebook
 */
async function postToFacebook(content, imageData = null) {
    const pageId = process.env.FB_PAGE_ID;
    const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;

    // ตรวจสอบว่ามีการตั้งค่าครบหรือไม่
    if (!pageId || !accessToken || pageId === 'YOUR_PAGE_ID') {
        console.log("⚠️ [Facebook Service] สถานะ: OFFLINE MOCK MODE (ไม่ได้โพสต์จริง)");
        console.log("--- เนื้อหาที่จะโพสต์ ---");
        console.log(content);
        if (imageData) console.log("--- มีรูปภาพแนบมาด้วย (Base64) ---");
        console.log("-----------------------");
        return { success: true, id: "MOCK_ID_" + Date.now() };
    }

    try {
        let url = `https://graph.facebook.com/v19.0/${pageId}/`;
        let params = { access_token: accessToken };

        let response;
        if (imageData) {
            // กรณีมีรูปภาพ (ต้องส่งไปที่ /photos)
            url += 'photos';
            // แปลง Base64 เป็น Buffer สำหรับส่ง
            const base64Data = imageData.split(',')[1] || imageData;
            const buffer = Buffer.from(base64Data, 'base64');
            
            // ใช้ FormData สำหรับส่งไฟล์
            const FormData = require('form-data');
            const form = new FormData();
            form.append('source', buffer, { filename: 'post_image.png' });
            form.append('message', content);
            form.append('access_token', accessToken);

            response = await axios.post(url, form, { headers: form.getHeaders() });
        } else {
            // กรณีข้อความล้วน
            url += 'feed';
            params.message = content;
            response = await axios.post(url, null, { params });
        }

        const id = response.data.id || response.data.post_id || null;
        let permalink = null;
        if (id) {
            try {
                const meta = await axios.get(`https://graph.facebook.com/v19.0/${id}`, { params: { fields: 'permalink_url', access_token: accessToken } });
                permalink = meta.data.permalink_url || null;
            } catch (errMeta) {
                // ไม่จำเป็นต้อง fail ถ้าเรียก meta ไม่ได้
                console.warn('Could not fetch permalink:', errMeta.message || errMeta);
            }
        }

        return { success: true, id, permalink };
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error("❌ [Facebook API Error]:", errorMsg);
        throw new Error(errorMsg);
    }
}

module.exports = { postToFacebook };