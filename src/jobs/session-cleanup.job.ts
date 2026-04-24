import cron from 'node-cron';
import prisma from '../lib/prisma';

cron.schedule('0 2 * * *', async () => {
  console.log('[CRON] Starting Session Cleanup Job...');
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await prisma.session.deleteMany({
      where: {
        createdAt: {
          lt: thirtyDaysAgo
        }
      }
    });

    console.log(`[CRON] Session Cleanup Complete. Deleted ${result.count} expired sessions.`);
  } catch (error) {
    console.error('[CRON] Session Cleanup Failed:', error);
  }
});

console.log('[CRON] Session Cleanup Job initialized (Runs at 02:00 AM)');
