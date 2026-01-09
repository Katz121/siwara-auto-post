const BLACKLIST = ["เหล้า", "เบียร์", "บุหรี่", "พนัน"];

function validateContent(content) {
    const foundWords = BLACKLIST.filter(word => content.includes(word));
    return {
        isValid: foundWords.length === 0,
        foundWords: foundWords
    };
}

const FALLBACK_POST = "แวะมาผ่อนคลายกับบรรยากาศดีๆ และกาแฟหอมๆ ที่ Siwara Café ตะกั่วป่า กันได้ทุกวันนะครับ ☕️🌿";

module.exports = { validateContent, FALLBACK_POST };