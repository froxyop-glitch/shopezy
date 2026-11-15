const express = require('express');
const router = express.Router();
const { getDb } = require('../database/init');
const { verifyToken } = require('../middleware/auth');

// GET /api/customers/wishlist
router.get('/wishlist', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const wishlist = db.prepare(`
            SELECT w.id as wishlist_id, w.created_at, p.*
            FROM wishlists w
            JOIN products p ON w.product_id = p.id
            WHERE w.user_id = ?
            ORDER BY w.created_at DESC
        `).all(req.user.id);

        res.json({ success: true, wishlist });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch wishlist' });
    }
});

// POST /api/customers/wishlist
router.post('/wishlist', verifyToken, (req, res) => {
    try {
        const { product_id } = req.body;
        if (!product_id) {
            return res.status(400).json({ success: false, message: 'Product ID required' });
        }

        const db = getDb();
        const existing = db.prepare('SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?').get(req.user.id, product_id);
        if (existing) {
            return res.json({ success: true, message: 'Product already in wishlist' });
        }

        db.prepare('INSERT INTO wishlists (user_id, product_id) VALUES (?, ?)').run(req.user.id, product_id);
        res.json({ success: true, message: 'Added to wishlist' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to add to wishlist' });
    }
});

// DELETE /api/customers/wishlist/:productId
router.delete('/wishlist/:productId', verifyToken, (req, res) => {
    try {
        const db = getDb();
        db.prepare('DELETE FROM wishlists WHERE user_id = ? AND product_id = ?').run(req.user.id, req.params.productId);
        res.json({ success: true, message: 'Removed from wishlist' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to remove from wishlist' });
    }
});

// GET /api/customers/notifications
router.get('/notifications', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const notifications = db.prepare(`
            SELECT * FROM notifications 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 20
        `).all(req.user.id);
        res.json({ success: true, notifications });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
    }
});

// PUT /api/customers/notifications/:id/read
router.put('/notifications/:id/read', verifyToken, (req, res) => {
    try {
        const db = getDb();
        db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
        res.json({ success: true, message: 'Notification marked as read' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update notification' });
    }
});

module.exports = router;
