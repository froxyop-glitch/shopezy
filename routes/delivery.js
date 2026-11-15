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

// GET /api/delivery/available-pool - Get unassigned orders waiting for riders to claim
router.get('/available-pool', verifyToken, isDelivery, (req, res) => {
    try {
        const db = getDb();
        const orders = db.prepare(`
            SELECT o.*, u.name as customer_name, u.phone as customer_phone, u.email as customer_email
            FROM orders o
            JOIN users u ON o.user_id = u.id
            WHERE o.delivery_boy_id IS NULL AND o.status IN ('pending', 'confirmed', 'processing')
            ORDER BY o.created_at DESC
        `).all();

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
        console.error('Available pool error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch available delivery pool' });
    }
});

// POST /api/delivery/orders/:id/claim - Claim an open order from the pool
router.post('/orders/:id/claim', verifyToken, isDelivery, (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();

        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        if (order.delivery_boy_id) {
            return res.status(400).json({ success: false, message: 'This delivery has already been claimed by another rider' });
        }

        const now = new Date().toISOString();
        db.prepare(`
            UPDATE orders 
            SET delivery_boy_id = ?, 
                status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
                updated_at = ?
            WHERE id = ? AND delivery_boy_id IS NULL
        `).run(req.user.id, now, id);

        // Add tracking entry
        db.prepare(`
            INSERT INTO delivery_tracking (order_id, delivery_boy_id, status, lat, lng, notes)
            VALUES (?, ?, 'confirmed', 26.3350, 89.4350, 'Rider accepted order from pool')
        `).run(id, req.user.id);

        // Notification for the rider
        db.prepare(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES (?, 'Delivery Claimed', ?, 'delivery')
        `).run(req.user.id, `You claimed Order #${order.order_number}. Head towards pickup hub.`);

        // Notification for Admins
        try {
            const adminUsers = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
            const riderUser = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.id);
            const riderName = riderUser ? riderUser.name : 'Rider';
            adminUsers.forEach(adm => {
                db.prepare(`
                    INSERT INTO notifications (user_id, title, message, type)
                    VALUES (?, 'Order Claimed', ?, 'order')
                `).run(adm.id, `Rider ${riderName} claimed Order #${order.order_number} from delivery pool`);
            });
        } catch (e) {}

        res.json({ success: true, message: 'Order successfully claimed and assigned to you!' });
    } catch (err) {
        console.error('Claim order error:', err);
        res.status(500).json({ success: false, message: 'Failed to claim order' });
    }
});

// GET /api/delivery/notifications - Notifications for logged-in rider
router.get('/notifications', verifyToken, isDelivery, (req, res) => {
    try {
        const db = getDb();
        const notifications = db.prepare(`
            SELECT * FROM notifications 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 30
        `).all(req.user.id);
        const unreadCount = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).count;
        res.json({ success: true, notifications, unread_count: unreadCount });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
    }
});

// PUT /api/delivery/notifications/mark-read
router.put('/notifications/mark-read', verifyToken, isDelivery, (req, res) => {
    try {
        const db = getDb();
        db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to mark read' });
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
