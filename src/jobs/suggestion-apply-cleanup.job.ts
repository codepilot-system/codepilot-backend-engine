import cron from 'node-cron';
import { cleanupStaleApplies } from '../services/suggestions/suggestions.service';

// Run every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('[CRON] Starting Suggestion Apply Cleanup Job...');
  try {
    await cleanupStaleApplies();
    console.log('[CRON] Suggestion Apply Cleanup Complete.');
  } catch (error) {
    console.error('[CRON] Suggestion Apply Cleanup Failed:', error);
  }
});

console.log('[CRON] Suggestion Apply Cleanup Job initialized (Runs every 5 minutes)');
