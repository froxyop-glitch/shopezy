const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/init');
const { verifyToken, isDelivery, isAdmin } = require('../middleware/auth');

// GET /api/delivery/orders - Get orders assigned to logged-in delivery driver
router.get('/orders', verifyToken, isDelivery, (req, res) => {
    try {
        const db = getDb();
        const orders = db.prepare(`
            SELECT o.*, u.name as customer_name, u.phone as customer_phone, u.email as customer_email
            FROM orders o
            JOIN users u ON o.user_id = u.id
            WHERE o.delivery_boy_id = ?
            ORDER BY 
                CASE 
                    WHEN o.status = 'out_for_delivery' THEN 1
                    WHEN o.status = 'processing' THEN 2
                    WHEN o.status = 'shipped' THEN 3
                    WHEN o.status = 'delivered' THEN 4
                    ELSE 5 
                END,
                o.created_at DESC
        `).all(req.user.id);

        // Fetch items for each order
        const ordersWithItems = orders.map(order => {
            const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
            let shippingAddress = {};
            try { shippingAddress = JSON.parse(order.shipping_address || '{}'); } catch (e) {}
            return {
                ...order,
                shipping_address: shippingAddress,
                items
            };
        });

        res.json({ success: true, orders: ordersWithItems });
    } catch (err) {
        console.error('Delivery orders error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch assigned orders' });
    }
});

// PUT /api/delivery/orders/:id/status - Update order delivery status
router.put('/orders/:id/status', verifyToken, isDelivery, (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes, lat, lng } = req.body;
        const db = getDb();

        const order = db.prepare('SELECT * FROM orders WHERE id = ? AND delivery_boy_id = ?').get(id, req.user.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found or not assigned to you' });
        }

        const validStatuses = ['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'returned', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const now = new Date().toISOString();
        let deliveredAt = order.delivered_at;
        let paymentStatus = order.payment_status;

        if (status === 'delivered') {
            deliveredAt = now;
            if (order.payment_method === 'cod') {
                paymentStatus = 'paid';
            }
        }

        db.prepare(`
            UPDATE orders 
            SET status = ?, notes = ?, delivered_at = ?, payment_status = ?, updated_at = ?
            WHERE id = ?
        `).run(status, notes || order.notes, deliveredAt, paymentStatus, now, id);

        // Log in delivery_tracking
        if (lat !== undefined && lng !== undefined) {
            db.prepare(`
                INSERT INTO delivery_tracking (order_id, delivery_boy_id, status, lat, lng, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(id, req.user.id, status, lat, lng, notes || `Status updated to ${status}`);

            // Also update driver's current position in users table
            db.prepare('UPDATE users SET lat = ?, lng = ?, updated_at = ? WHERE id = ?').run(lat, lng, now, req.user.id);
        }

        res.json({ success: true, message: `Order status updated to ${status}` });
    } catch (err) {
        console.error('Update delivery status error:', err);
        res.status(500).json({ success: false, message: 'Failed to update order status' });
    }
});

// POST /api/delivery/orders/:id/location - Update driver live GPS location on Cooch Behar map
router.post('/orders/:id/location', verifyToken, isDelivery, (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng, notes } = req.body;

        if (lat === undefined || lng === undefined) {
            return res.status(400).json({ success: false, message: 'Latitude and Longitude are required' });
        }

        const db = getDb();
        const order = db.prepare('SELECT id, status FROM orders WHERE id = ? AND delivery_boy_id = ?').get(id, req.user.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found or not assigned to you' });
        }

        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO delivery_tracking (order_id, delivery_boy_id, status, lat, lng, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, req.user.id, order.status, lat, lng, notes || 'Location update');

        db.prepare('UPDATE users SET lat = ?, lng = ?, updated_at = ? WHERE id = ?').run(lat, lng, now, req.user.id);

        res.json({ success: true, message: 'Location updated successfully' });
    } catch (err) {
        console.error('Location update error:', err);
        res.status(500).json({ success: false, message: 'Failed to update location' });
    }
});

// GET /api/delivery/orders/:id/tracking - Public/Customer tracking coordinates
router.get('/orders/:id/tracking', (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();

        const trackingHistory = db.prepare(`
            SELECT dt.*, u.name as driver_name, u.phone as driver_phone
            FROM delivery_tracking dt
            LEFT JOIN users u ON dt.delivery_boy_id = u.id
            WHERE dt.order_id = ?
            ORDER BY dt.created_at ASC
        `).all(id);

        const latest = trackingHistory.length > 0 ? trackingHistory[trackingHistory.length - 1] : null;

        res.json({
            success: true,
            current_location: latest ? { lat: latest.lat, lng: latest.lng, status: latest.status, updated_at: latest.created_at } : null,
            history: trackingHistory
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch tracking details' });
    }
});

// GET /api/delivery/active-deliveries (Admin view of all drivers on Cooch Behar map)
router.get('/active-deliveries', verifyToken, isAdmin, (req, res) => {
    try {
        const db = getDb();
        const drivers = db.prepare(`
            SELECT id, name, phone, email, lat, lng, is_active, updated_at
            FROM users
            WHERE role = 'delivery'
        `).all();

        const activeOrders = db.prepare(`
            SELECT o.id, o.order_number, o.status, o.delivery_boy_id, o.shipping_address,
                   u.name as customer_name, u.phone as customer_phone
            FROM orders o
            JOIN users u ON o.user_id = u.id
            WHERE o.status IN ('processing', 'shipped', 'out_for_delivery')
        `).all();

        res.json({ success: true, drivers, active_orders: activeOrders });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch active deliveries' });
    }
});

// PUT /api/delivery/change-password
router.put('/change-password', verifyToken, isDelivery, (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) {
            return res.status(400).json({ success: false, message: 'Current and new password are required' });
        }
        if (new_password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }

        const db = getDb();
        const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
        if (!bcrypt.compareSync(current_password, user.password)) {
            return res.status(400).json({ success: false, message: 'Incorrect current password' });
        }

        const hashed = bcrypt.hashSync(new_password, 10);
        db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?').run(hashed, new Date().toISOString(), req.user.id);

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to change password' });
    }
});

module.exports = router;
