const axios = require('axios');

// อ่านค่า .env
const apiKey = process.env.GEMINI_API_KEY;
const useMockEnv = (process.env.GEMINI_MOCK || '').toLowerCase() === 'true';

/**
 * ✅ ฟังก์ชันจำลองข้อมูล (Mock) กรณี API มีปัญหา หรืออยู่ในโหมดทดสอบ
 */
function generateMock(systemPrompt, userPrompt, expectJson) {
    const base = `${systemPrompt || ''} ${userPrompt || ''}`.trim();
    if (expectJson) {
        const sample = {
            posts: [
                {
                    day: 0,
                    time: '10:00',
                    type: 'Warmup',
                    content: `[MOCK JSON] ตัวอย่างโพสต์สำหรับ: ${userPrompt.substring(0, 50)}...`
                }
            ]
        };
        return JSON.stringify(sample);
    }
    return `[MOCK TEXT] ตัวอย่างแคปชันสำหรับ: ${userPrompt.substring(0, 50)}...`;
}

/**
 * ✅ ฟังก์ชันหลักสำหรับเรียกใช้ Gemini API
 */
async function callGemini(systemPrompt, userPrompt, imageData = null, expectJson = false) {
    // 1. ตรวจสอบโหมด Mock
    if (useMockEnv) {
        console.warn('⚠️ Gemini: กำลังรันในโหมด MOCK (ตามการตั้งค่าใน .env)');
        const mockData = generateMock(systemPrompt, userPrompt, expectJson);
        return expectJson ? JSON.parse(mockData) : mockData;
    }

    // 2. ตรวจสอบ API Key
    if (!apiKey || apiKey === "") {
        console.error('❌ Missing GEMINI_API_KEY: โปรดตรวจสอบไฟล์ .env');
        const mockData = generateMock(systemPrompt, userPrompt, expectJson);
        return expectJson ? JSON.parse(mockData) : mockData;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    
    // จัดการ Payload
    const parts = [{ text: userPrompt }];
    if (imageData) {
        // ตัดส่วน prefix base64 ออกถ้ามี
        const base64Data = imageData.includes('base64,') ? imageData.split('base64,')[1] : imageData;
        parts.push({ inlineData: { mimeType: 'image/png', data: base64Data } });
    }

    const payload = {
        contents: [{ role: "user", parts: parts }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: expectJson ? 'application/json' : 'text/plain'
        }
    };

    let retries = 0;
    let triedWithoutImage = false;

    // 3. เริ่มกระบวนการเรียก API พร้อมระบบ Retry (Exponential Backoff)
    while (retries < 5) {
        try {
            const response = await axios.post(url, payload);
            const resultText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            if (expectJson) {
                try {
                    return typeof resultText === 'string' ? JSON.parse(resultText) : resultText;
                } catch (e) {
                    console.error('Gemini returned invalid JSON, retrying or falling back');
                    throw new Error('Invalid JSON format from AI');
                }
            }
            return resultText;

        } catch (error) {
            const errorData = error.response?.data?.error || {};
            const message = errorData.message || error.message;
            console.warn(`⚠️ Gemini API Error (Retry ${retries + 1}/5):`, message);

            // กรณีส่งรูปแล้วพัง ให้ลองส่งแค่ข้อความอย่างเดียวในรอบถัดไป
            if (imageData && !triedWithoutImage) {
                console.log('🔄 ลองใหม่แบบไม่มีรูปภาพ (Fallback to text-only)...');
                payload.contents[0].parts = payload.contents[0].parts.filter(p => !p.inlineData);
                triedWithoutImage = true;
                continue; // ลองใหม่ทันทีโดยไม่เพิ่มรอบ retry
            }

            retries++;
            if (retries === 5) {
                console.error('❌ Gemini API ล้มเหลวครบ 5 ครั้ง: กำลังใช้ข้อมูลจำลอง (Mock Fallback)');
                const mockData = generateMock(systemPrompt, userPrompt, expectJson);
                return expectJson ? JSON.parse(mockData) : mockData;
            }

            // Exponential Backoff: 1s, 2s, 4s, 8s, 16s
            const delay = Math.pow(2, retries) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

module.exports = { callGemini };