/**
 * Provider account deletion (2026-07-18) — App Store guideline 5.1.1(v).
 *
 * Erases a marketplace provider account: every row keyed to the provider
 * profile or user, then the profile and user. Uses the generic retry-sweep
 * (same pattern as the demo teardown): every model with a providerId/userId
 * column is swept; FK ordering resolves across passes; validation errors
 * identify models that don't reference the provider at all.
 */

const prisma = require('../config/db');

async function sweep(whereKey, id) {
  const models = Object.keys(prisma).filter((k) => !k.startsWith('$') && !k.startsWith('_'));
  const pending = new Set(models);
  for (let pass = 1; pass <= 6 && pending.size; pass++) {
    for (const model of [...pending]) {
      if (model === 'user' || model === 'providerProfile' || typeof prisma[model]?.deleteMany !== 'function') {
        pending.delete(model);
        continue;
      }
      try {
        await prisma[model].deleteMany({ where: { [whereKey]: id } });
        pending.delete(model);
      } catch (e) {
        if (e.name === 'PrismaClientValidationError') pending.delete(model);
        // FK violations retry next pass.
      }
    }
  }
  return [...pending];
}

async function deleteProviderAccount(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { providerProfile: { select: { id: true } } },
  });
  if (!user) return { deleted: false, reason: 'not-found' };
  if (user.role !== 'PROVIDER') return { deleted: false, reason: 'not-a-provider-account' };
  const pid = user.providerProfile?.id;

  if (pid) {
    const stuck = await sweep('providerId', pid);
    if (stuck.length) throw new Error(`provider-row sweep stuck: ${stuck.join(', ')}`);
  }
  const stuckUser = await sweep('userId', userId);
  if (stuckUser.length) throw new Error(`user-row sweep stuck: ${stuckUser.join(', ')}`);

  if (pid) await prisma.providerProfile.delete({ where: { id: pid } });
  await prisma.user.delete({ where: { id: userId } });
  console.log(`[account-deletion] marketplace provider ${userId} erased`);
  return { deleted: true };
}

module.exports = { deleteProviderAccount };
