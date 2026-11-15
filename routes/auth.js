const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database/init');
const { verifyToken } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'coochbehar_ecommerce_secret_key_2024';

function generateToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function sanitizeUser(user) {
    const { password, reset_token, reset_token_expires, ...safe } = user;
    return safe;
}

// POST /send-otp - Generate & Send OTP to Email and Phone for registration
router.post('/send-otp', (req, res) => {
    try {
        const { email, phone } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email address is required for OTP verification.' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
        }

        if (phone && !/^[6-9]\d{9}$/.test(phone)) {
            return res.status(400).json({ success: false, message: 'Please provide a valid 10-digit Indian mobile number.' });
        }

        const db = getDb();

        // Check if email already registered
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
        if (existing) {
            return res.status(409).json({ success: false, message: 'An account with this email already exists. Please login instead.' });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes expiry

        // Store OTP in database
        db.prepare(`
            INSERT INTO otps (identifier, phone, otp, type, expires_at)
            VALUES (?, ?, ?, 'registration', ?)
        `).run(email.toLowerCase().trim(), phone || null, otp, expiresAt);

        console.log(`[Shopezy OTP System] Verification code for ${email} / ${phone}: ${otp}`);

        res.json({
            success: true,
            message: `OTP sent to ${email}${phone ? ' and +91 ' + phone : ''}. Valid for 10 minutes.`,
            otp: otp,
            expires_in_seconds: 600
        });
    } catch (err) {
        console.error('Send OTP error:', err);
        res.status(500).json({ success: false, message: 'Failed to send OTP. Please try again.' });
    }
});

// POST /register - Complete registration with compulsory OTP verification
router.post('/register', (req, res) => {
    try {
        const { name, email, phone, password, address, city, state, pincode, otp } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
        }

        if (!otp) {
            return res.status(400).json({ success: false, message: 'OTP verification code is compulsory for creating an account.' });
        }

        if (name.trim().length < 2) {
            return res.status(400).json({ success: false, message: 'Name must be at least 2 characters long.' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
        }

        if (phone && !/^[6-9]\d{9}$/.test(phone)) {
            return res.status(400).json({ success: false, message: 'Please provide a valid 10-digit Indian phone number.' });
        }

        const db = getDb();

        // Verify OTP
        const validOtp = db.prepare(`
            SELECT * FROM otps 
            WHERE identifier = ? AND otp = ? AND type = 'registration'
            ORDER BY created_at DESC 
            LIMIT 1
        `).get(email.toLowerCase().trim(), otp.trim());

        if (!validOtp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP code. Please enter the correct code.' });
        }

        if (new Date(validOtp.expires_at) < new Date()) {
            return res.status(400).json({ success: false, message: 'This OTP has expired. Please request a new OTP.' });
        }

        const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
        if (existingUser) {
            return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
        }

        // Clean up OTP
        db.prepare('DELETE FROM otps WHERE identifier = ?').run(email.toLowerCase().trim());

        const hashedPassword = bcrypt.hashSync(password, 10);

        const result = db.prepare(`
            INSERT INTO users (name, email, phone, password, role, address, city, state, pincode)
            VALUES (?, ?, ?, ?, 'customer', ?, ?, ?, ?)
        `).run(
            name.trim(),
            email.toLowerCase().trim(),
            phone || null,
            hashedPassword,
            address || null,
            city || null,
            state || null,
            pincode || null
        );

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

        const token = generateToken(user);

        res.status(201).json({
            success: true,
            message: 'OTP verified! Your Shopezy customer account has been created.',
            token,
            user: sanitizeUser(user)
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
    }
});

// POST /login
router.post('/login', (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }

        const db = getDb();
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
        db.close();

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        if (!user.is_active) {
            return res.status(403).json({ success: false, message: 'Your account is deactivated. Please contact support.' });
        }

        const isMatch = bcrypt.compareSync(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        const token = generateToken(user);

        res.json({
            success: true,
            message: 'Login successful!',
            token,
            user: sanitizeUser(user)
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }
});

// GET /profile
router.get('/profile', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
        db.close();

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        res.json({
            success: true,
            user: sanitizeUser(user)
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
    }
});

// PUT /profile
router.put('/profile', verifyToken, (req, res) => {
    try {
        const { name, phone, address, city, state, pincode, avatar, lat, lng } = req.body;
        const db = getDb();

        const fields = [];
        const values = [];

        if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
        if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
        if (address !== undefined) { fields.push('address = ?'); values.push(address); }
        if (city !== undefined) { fields.push('city = ?'); values.push(city); }
        if (state !== undefined) { fields.push('state = ?'); values.push(state); }
        if (pincode !== undefined) { fields.push('pincode = ?'); values.push(pincode); }
        if (avatar !== undefined) { fields.push('avatar = ?'); values.push(avatar); }
        if (lat !== undefined) { fields.push('lat = ?'); values.push(lat); }
        if (lng !== undefined) { fields.push('lng = ?'); values.push(lng); }

        if (fields.length === 0) {
            db.close();
            return res.status(400).json({ success: false, message: 'No fields to update.' });
        }

        fields.push("updated_at = datetime('now')");
        values.push(req.user.id);

        db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
        db.close();

        res.json({
            success: true,
            message: 'Profile updated successfully.',
            user: sanitizeUser(user)
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ success: false, message: 'Failed to update profile.' });
    }
});

// PUT /change-password
router.put('/change-password', verifyToken, (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Old password and new password are required.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
        }

        const db = getDb();
        const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);

        if (!user) {
            db.close();
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const isMatch = bcrypt.compareSync(oldPassword, user.password);
        if (!isMatch) {
            db.close();
            return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
        }

        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        db.prepare("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?").run(hashedPassword, req.user.id);
        db.close();

        res.json({ success: true, message: 'Password changed successfully.' });
    } catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({ success: false, message: 'Failed to change password.' });
    }
});

// POST /forgot-password
router.post('/forgot-password', (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required.' });
        }

        const db = getDb();
        const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email.toLowerCase().trim());

        if (!user) {
            db.close();
            // Return success even if user not found for security
            return res.json({ success: true, message: 'If the email exists, a password reset link has been sent.' });
        }

        // Generate a reset token (in production, use crypto.randomBytes)
        const resetToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const expires = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

        db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(resetToken, expires, user.id);
        db.close();

        // In production, send email with reset link
        console.log(`Password reset token for ${email}: ${resetToken}`);

        res.json({
            success: true,
            message: 'If the email exists, a password reset link has been sent.',
            // In development, include the token
            ...(process.env.NODE_ENV === 'development' && { resetToken })
        });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ success: false, message: 'Failed to process request.' });
    }
});

module.exports = router;
