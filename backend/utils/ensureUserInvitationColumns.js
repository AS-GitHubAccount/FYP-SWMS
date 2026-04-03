/**
 * Ensures users table supports email invitations (no admin-set passwords).
 * - passwordHash nullable for pending invites
 * - accountStatus: ACTIVE | PENDING_INVITE
 * - inviteTokenHash + inviteTokenExpires (SHA-256 of raw token)
 */

const db = require('../config/database');

async function columnExists(table, col) {
    const [r] = await db.execute(
        `SELECT COUNT(*) AS c FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, col]
    );
    return (r[0] && r[0].c) > 0;
}

async function ensureUserInvitationColumns() {
    try {
        if (!(await columnExists('users', 'accountStatus'))) {
            await db.execute(
                `ALTER TABLE users ADD COLUMN accountStatus VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'`
            );
        }
        if (!(await columnExists('users', 'inviteTokenHash'))) {
            await db.execute(`ALTER TABLE users ADD COLUMN inviteTokenHash VARCHAR(64) NULL`);
        }
        if (!(await columnExists('users', 'inviteTokenExpires'))) {
            await db.execute(`ALTER TABLE users ADD COLUMN inviteTokenExpires DATETIME NULL`);
        }
        try {
            await db.execute('ALTER TABLE users MODIFY COLUMN passwordHash VARCHAR(255) NULL');
        } catch (e) {
            /* ignore if already nullable or permission */
        }
    } catch (err) {
        console.error('[ensureUserInvitationColumns]', err.message);
    }
}

module.exports = { ensureUserInvitationColumns };
