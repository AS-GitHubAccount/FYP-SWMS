// node test-email.js
require('dotenv').config();
const nodemailer = require('nodemailer');

const emailConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
};

console.log('\nSMTP test\n');
console.log('SMTP Host:', emailConfig.host);
console.log('SMTP Port:', emailConfig.port);
console.log('SMTP Secure:', emailConfig.secure);
console.log('SMTP User:', emailConfig.auth.user);
console.log('SMTP Pass:', emailConfig.auth.pass ? (emailConfig.auth.pass.substring(0, 4) + '****') : 'NOT SET');
console.log('\n');

if (!emailConfig.auth.user || !emailConfig.auth.pass) {
    console.error('SMTP_USER or SMTP_PASS missing in .env\n');
    process.exit(1);
}

if (emailConfig.auth.pass.includes('REPLACE') || emailConfig.auth.pass.includes('PASTE')) {
    console.error('SMTP_PASS still looks like a placeholder.\n');
    process.exit(1);
}

const transporter = nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: emailConfig.auth
});

transporter.verify(function(error, success) {
    if (error) {
        console.error('SMTP verify failed:', error.message);
        process.exit(1);
    } else {
        console.log('SMTP OK');
        const testEmail = emailConfig.auth.user;
        transporter.sendMail({
            from: `"SWMS Test" <${emailConfig.auth.user}>`,
            to: testEmail,
            subject: 'SWMS - Email Test',
            text: 'This is a test email from SWMS. If you receive this, email configuration is working!'
        }, (error, info) => {
            if (error) {
                console.error('Send failed:', error.message);
                process.exit(1);
            } else {
                console.log('Sent test mail to', testEmail, info.messageId || '');
                process.exit(0);
            }
        });
    }
});










