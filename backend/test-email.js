/**
 * Test Email Configuration
 * Run this to verify your SMTP settings are correct
 * 
 * Usage: node test-email.js
 */

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

console.log('\n📧 Testing Email Configuration...\n');
console.log('SMTP Host:', emailConfig.host);
console.log('SMTP Port:', emailConfig.port);
console.log('SMTP Secure:', emailConfig.secure);
console.log('SMTP User:', emailConfig.auth.user);
console.log('SMTP Pass:', emailConfig.auth.pass ? (emailConfig.auth.pass.substring(0, 4) + '****') : 'NOT SET');
console.log('\n');

if (!emailConfig.auth.user || !emailConfig.auth.pass) {
    console.error('❌ ERROR: SMTP_USER or SMTP_PASS not set in .env file');
    console.error('   Please update backend/.env with your Gmail App Password\n');
    process.exit(1);
}

if (emailConfig.auth.pass.includes('REPLACE') || emailConfig.auth.pass.includes('PASTE')) {
    console.error('❌ ERROR: App Password not set - still has placeholder');
    console.error('   Please replace REPLACE_WITH_YOUR_16_CHAR_APP_PASSWORD_NO_SPACES in .env file\n');
    process.exit(1);
}

const transporter = nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: emailConfig.auth
});

// Test connection
transporter.verify(function(error, success) {
    if (error) {
        console.error('❌ Connection failed:', error.message);
        console.error('\nTroubleshooting:');
        console.error('1. Verify 2-Step Verification is enabled on the Google account');
        console.error('2. Generate a new App Password at: https://myaccount.google.com/apppasswords');
        console.error('3. Make sure the password has NO spaces (16 characters total)');
        console.error('4. Check that the email address is correct\n');
        process.exit(1);
    } else {
        console.log('✅ SMTP connection successful!');
        console.log('✅ Email configuration is working correctly\n');
        
        // Try sending a test email
        const testEmail = emailConfig.auth.user; // Send to self
        transporter.sendMail({
            from: `"SWMS Test" <${emailConfig.auth.user}>`,
            to: testEmail,
            subject: 'SWMS - Email Test',
            text: 'This is a test email from SWMS. If you receive this, email configuration is working!'
        }, (error, info) => {
            if (error) {
                console.error('❌ Failed to send test email:', error.message);
                process.exit(1);
            } else {
                console.log('✅ Test email sent successfully!');
                console.log('   Check your inbox:', testEmail);
                console.log('   Message ID:', info.messageId);
                console.log('\n✅ All email tests passed!\n');
                process.exit(0);
            }
        });
    }
});










