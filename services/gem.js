const axios = require('axios');

// อ่านค่า .env
const apiKey = process.env.GEMINI_API_KEY;
const useMockEnv = (process.env.GEMINI_MOCK || '').toLowerCase() === 'true';

function generateMock(systemPrompt, userPrompt, expectJson) {
    const base = `${systemPrompt || ''} ${userPrompt || ''}`.trim();
    if (expectJson) {
        const sample = {
            posts: [
                {
                    day: 0,
                    time: '10:00',
                    type: 'Warmup',
                    content: `ตัวอย่างโพสต์: ${base}`
                }
            ]
        };
        return JSON.stringify(sample);
    }
    return `ตัวอย่างแคปชัน: ${base}`;
}

/**
 * ฟังก์ชันสำหรับเรียกใช้ Gemini API
 */
async function callGemini(systemPrompt, userPrompt, imageData = null, expectJson = false) {
    // ถ้าโหมด mock ถูกตั้งค่า ให้คืน mock ทันที
    if (useMockEnv) {
        return expectJson ? JSON.parse(generateMock(systemPrompt, userPrompt, true)) : generateMock(systemPrompt, userPrompt, false);
    }

    if (!apiKey) {
        throw new Error('Missing GEMINI_API_KEY in .env file');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{
            parts: [
                { text: userPrompt },
                ...(imageData ? [{ inlineData: { mimeType: 'image/png', data: imageData.split(',')[1] || imageData } }] : [])
            ]
        }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: expectJson ? 'application/json' : 'text/plain'
        }
    };

    let retries = 0;
    let triedWithoutImage = false;
    while (retries < 5) {
        try {
            const response = await axios.post(url, payload);
            // Some responses include multiple parts; join all text parts safely
            const parts = response.data.candidates?.[0]?.content?.parts || [];
            const textParts = parts.filter(p => typeof p.text === 'string').map(p => p.text);
            const resultText = textParts.join('\n').trim() || (parts[0] && parts[0].text) || '';

            if (expectJson) {
                try {
                    return typeof resultText === 'string' ? JSON.parse(resultText) : resultText;
                } catch (e) {
                    console.warn('Failed to parse JSON from Gemini response, returning raw text');
                    return resultText;
                }
            }

            // Always return a predictable structure when imageData was provided
            return imageData ? { content: resultText } : resultText;
        } catch (error) {
            console.warn('Gemini call failed:', error.response?.data?.error || error.message || error);

            // If we sent an image, try once more without the image (some models or network paths fail on inline images)
            if (imageData && !triedWithoutImage) {
                triedWithoutImage = true;
                try {
                    console.warn('Retrying Gemini call without image payload as a fallback');
                    // build payload without inlineData
                    const payloadNoImage = JSON.parse(JSON.stringify(payload));
                    if (payloadNoImage.contents && payloadNoImage.contents[0] && Array.isArray(payloadNoImage.contents[0].parts)) {
                        payloadNoImage.contents[0].parts = payloadNoImage.contents[0].parts.filter(p => !p.inlineData);
                    }
                    const response2 = await axios.post(url, payloadNoImage);
                    const parts2 = response2.data.candidates?.[0]?.content?.parts || [];
                    const textParts2 = parts2.filter(p => typeof p.text === 'string').map(p => p.text);
                    const resultText2 = textParts2.join('\n').trim() || (parts2[0] && parts2[0].text) || '';
                    if (expectJson) {
                        try { return typeof resultText2 === 'string' ? JSON.parse(resultText2) : resultText2; } catch (e) { return resultText2; }
                    }
                    return imageData ? { content: resultText2 } : resultText2;
                } catch (err2) {
                    console.warn('Retry without image also failed:', err2.response?.data || err2.message || err2);
                    // fall through to retry logic
                }
            }

            retries++;
            if (retries === 5) {
                console.error('Gemini API Max Retries Reached:', error.response?.data || error.message);
                console.warn('Using local mock fallback for Gemini');
                return expectJson ? JSON.parse(generateMock(systemPrompt, userPrompt, true)) : generateMock(systemPrompt, userPrompt, false);
            }
            const delay = Math.pow(2, retries) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

module.exports = { callGemini };