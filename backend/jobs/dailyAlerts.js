// cron: daily alert sweep
const cron = require('node-cron');
const { checkAllProducts, autoResolveAlerts } = require('../utils/alertChecker');

const CRON_SCHEDULE = '0 9 * * *'; // 9:00 AM every day

async function runDailySummary() {
    try {
        const db = require('../config/database');
        const [pendingBookings] = await db.execute("SELECT COUNT(*) as c FROM bookings WHERE status = 'PENDING'");
        const [activeAlerts] = await db.execute("SELECT COUNT(*) as c FROM alerts WHERE resolved = FALSE");
        const [todayReceiving] = await db.execute("SELECT COUNT(*) as c FROM in_records WHERE receivedDate = CURDATE()");
        const [todayIssuing] = await db.execute("SELECT COUNT(*) as c FROM out_records WHERE issuedDate = CURDATE()");
        const msg = [
            'SWMS Daily Summary',
            `Pending bookings: ${pendingBookings[0].c}`,
            `Active alerts: ${activeAlerts[0].c}`,
            `Receiving today: ${todayReceiving[0].c}`,
            `Issuing today: ${todayIssuing[0].c}`
        ].join('\n');
        const { notifyAdminsByEmail } = require('../utils/emailService');
        await notifyAdminsByEmail('SWMS Daily Summary', msg);
    } catch (e) {
        console.error('[dailyAlerts] summary:', e.message);
    }
}

function startDailyAlertsJob() {
    cron.schedule(CRON_SCHEDULE, async () => {
        console.log('[dailyAlerts] Running daily alert check...');
        try {
            await checkAllProducts();
            await autoResolveAlerts();
            await runDailySummary();
            console.log('[dailyAlerts] Daily alert check completed.');
        } catch (err) {
            console.error('[dailyAlerts] Daily alert check failed:', err.message);
        }
    });
    console.log('[dailyAlerts] Scheduled: runs daily at 9:00 AM');
}

module.exports = { startDailyAlertsJob };
