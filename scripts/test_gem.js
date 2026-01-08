(require('dotenv').config());
const { callGemini } = require('../services/gem');
(async () => {
  try {
    const system = 'ทดสอบระบบ Gem';
    const user = 'ช่วยเขียนแคปชันสั้นๆ ให้เรียกลูกค้า';
    const res = await callGemini(system, user, null, false);
    console.log('RESULT:', res);
  } catch (e) {
    console.error('ERROR:', e.message, e.response?.data || '');
    process.exit(1);
  }
})();
