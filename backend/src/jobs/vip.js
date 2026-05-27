const prisma = require('../config/db');

const VIP_THRESHOLD = 100;

async function checkAllVipStatuses() {
  try {
    const candidates = await prisma.providerProfile.findMany({
      where: { vipStatus: false, vipPoints: { gte: VIP_THRESHOLD } },
      select: { id: true },
    });
    for (const p of candidates) {
      await prisma.providerProfile.update({
        where: { id: p.id },
        data: { vipStatus: true, vipEarnedAt: new Date() },
      });
    }
  } catch (err) {
    console.error('VIP check job error:', err.message);
  }
}

module.exports = { checkAllVipStatuses };
