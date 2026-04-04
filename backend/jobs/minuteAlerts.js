// cron: alert check every minute
const cron = require('node-cron');
const { checkAllProducts, autoResolveAlerts } = require('../utils/alertChecker');

const CRON_SCHEDULE = '* * * * *'; // Every minute

function startMinuteAlertsJob() {
    cron.schedule(CRON_SCHEDULE, async () => {
        try {
            console.log('--- SYSTEM HEARTBEAT: Checking for Alerts ---');
            await checkAllProducts();
            await autoResolveAlerts();
        } catch (err) {
            console.error('[minuteAlerts] Alert check failed:', err.message);
        }
    });
    console.log('[minuteAlerts] Scheduled: runs every 60 seconds (alert check + auto-resolve)');
}

module.exports = { startMinuteAlertsJob };
