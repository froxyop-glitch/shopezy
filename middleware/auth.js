const jwt = require('jsonwebtoken');
const { getDb } = require('../database/init');

const JWT_SECRET = process.env.JWT_SECRET || 'coochbehar_ecommerce_secret_key_2024';

function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!token) {
        return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const db = getDb();
        const user = db.prepare('SELECT id, name, email, phone, role, avatar, address, city, state, pincode, lat, lng, is_active FROM users WHERE id = ?').get(decoded.id);
        db.close();

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid token. User not found.' });
        }

        if (!user.is_active) {
            return res.status(403).json({ success: false, message: 'Account is deactivated. Please contact support.' });
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token has expired. Please login again.' });
        }
        return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
}

function isAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        return next();
    }
    return res.status(403).json({ success: false, message: 'Access denied. Admin privileges required.' });
}

function isDelivery(req, res, next) {
    if (req.user && req.user.role === 'delivery') {
        return next();
    }
    return res.status(403).json({ success: false, message: 'Access denied. Delivery personnel only.' });
}

function isCustomer(req, res, next) {
    if (req.user && req.user.role === 'customer') {
        return next();
    }
    return res.status(403).json({ success: false, message: 'Access denied. Customer account required.' });
}

function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        req.user = null;
        return next();
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!token) {
        req.user = null;
        return next();
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const db = getDb();
        const user = db.prepare('SELECT id, name, email, phone, role, avatar, address, city, state, pincode, lat, lng, is_active FROM users WHERE id = ?').get(decoded.id);
        db.close();

        if (user && user.is_active) {
            req.user = user;
        } else {
            req.user = null;
        }
    } catch (error) {
        req.user = null;
    }

    next();
}

module.exports = { verifyToken, isAdmin, isDelivery, isCustomer, optionalAuth };
