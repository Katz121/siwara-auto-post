const axios = require('axios');

// แก้ไขให้ดึงค่าจากไฟล์ .env
const apiKey = process.env.GEMINI_API_KEY; 

/**
 * ฟังก์ชันสำหรับเรียกใช้ Gemini API
 * @param {string} systemPrompt - คำสั่งกำหนดบุคลิก AI
 * @param {string} userPrompt - คำสั่งจากผู้ใช้
 * @param {string|null} imageData - ข้อมูลรูปภาพ (Base64)
 */
async function callGemini(systemPrompt, userPrompt, imageData = null) {
    if (!apiKey) {
        throw new Error("Missing GEMINI_API_KEY in .env file");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    
    const payload = {
        contents: [{
            parts: [
                { text: userPrompt },
                ...(imageData ? [{ inlineData: { mimeType: "image/png", data: imageData.split(',')[1] || imageData } }] : [])
            ]
        }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { 
            // ถ้ามีรูปภาพจะขอเป็น text ธรรมดา ถ้าไม่มี (สร้าง 7 วัน) จะขอเป็น JSON
            responseMimeType: imageData ? "text/plain" : "application/json" 
        }
    };

    // การส่งคำขอแบบ Exponential Backoff (Retry 5 ครั้ง)
    let retries = 0;
    while (retries < 5) {
        try {
            const response = await axios.post(url, payload);
            const resultText = response.data.candidates[0].content.parts[0].text;
            
            // ส่งกลับข้อมูลตามรูปแบบที่ได้รับ
            return imageData ? { content: resultText } : JSON.parse(resultText);
        } catch (error) {
            retries++;
            if (retries === 5) {
                console.error("Gemini API Max Retries Reached:", error.response?.data || error.message);
                throw new Error("AI Generation Failed after 5 retries");
            }
            const delay = Math.pow(2, retries) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

module.exports = { callGemini };