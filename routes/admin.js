const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database/init');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Multer storage for Admin Image Uploads (Products & Banners)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const type = req.query.type === 'banner' ? 'banners' : 'products';
        const dir = path.join(__dirname, '..', 'uploads', type);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const type = req.query.type === 'banner' ? 'banner' : 'product';
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E6);
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${type}-${unique}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// All routes here require Admin authentication
router.use(verifyToken, isAdmin);

// POST /api/admin/upload - Upload product picture or offer banner
router.post('/upload', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image file uploaded' });
        }
        const type = req.query.type === 'banner' ? 'banners' : 'products';
        const fileUrl = `/uploads/${type}/${req.file.filename}`;
        res.json({
            success: true,
            message: 'Image uploaded successfully',
            url: fileUrl,
            filename: req.file.filename
        });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ success: false, message: 'Image upload failed' });
    }
});

// GET /api/admin/dashboard - Comprehensive Analytics
router.get('/dashboard', (req, res) => {
    try {
        const db = getDb();

        const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
        const totalRevenue = db.prepare("SELECT SUM(total) as rev FROM orders WHERE payment_status = 'paid' OR status = 'delivered'").get().rev || 0;
        const totalCustomers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'customer'").get().count;
        const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1').get().count;
        const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'confirmed', 'processing')").get().count;
        const outForDelivery = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'out_for_delivery'").get().count;
        const totalDrivers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'delivery'").get().count;

        // Recent Orders
        const recentOrders = db.prepare(`
            SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone
            FROM orders o
            JOIN users u ON o.user_id = u.id
            ORDER BY o.created_at DESC
            LIMIT 8
        `).all();

        // Top Selling Products
        const topProducts = db.prepare(`
            SELECT id, name, price, stock, thumbnail, sold_count, rating_avg
            FROM products
            ORDER BY sold_count DESC, rating_avg DESC
            LIMIT 5
        `).all();

        // Orders by Status distribution
        const statusDistribution = db.prepare(`
            SELECT status, COUNT(*) as count
            FROM orders
            GROUP BY status
        `).all();

        // Recent 7 days sales
        const salesByDay = db.prepare(`
            SELECT date(created_at) as order_date, SUM(total) as daily_total, COUNT(*) as order_count
            FROM orders
            GROUP BY date(created_at)
            ORDER BY order_date DESC
            LIMIT 7
        `).all();

        res.json({
            success: true,
            stats: {
                totalOrders,
                totalRevenue: Math.round(totalRevenue),
                totalCustomers,
                totalProducts,
                pendingOrders,
                outForDelivery,
                totalDrivers
            },
            recentOrders,
            topProducts,
            statusDistribution,
            salesByDay
        });
    } catch (err) {
        console.error('Admin dashboard error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard data' });
    }
});

// GET /api/admin/orders - Get all orders with filter
router.get('/orders', (req, res) => {
    try {
        const { status, search } = req.query;
        const db = getDb();

        let sql = `
            SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone,
                   d.name as driver_name, d.phone as driver_phone
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN users d ON o.delivery_boy_id = d.id
            WHERE 1=1
        `;
        const params = [];

        if (status && status !== 'all') {
            sql += ' AND o.status = ?';
            params.push(status);
        }

        if (search) {
            sql += ' AND (o.order_number LIKE ? OR u.name LIKE ? OR u.phone LIKE ?)';
            const term = `%${search}%`;
            params.push(term, term, term);
        }

        sql += ' ORDER BY o.created_at DESC';

        const orders = db.prepare(sql).all(...params);

        const ordersWithDetails = orders.map(order => {
            const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
            let shippingAddress = {};
            try { shippingAddress = JSON.parse(order.shipping_address || '{}'); } catch (e) {}
            return {
                ...order,
                shipping_address: shippingAddress,
                items
            };
        });

        res.json({ success: true, orders: ordersWithDetails });
    } catch (err) {
        console.error('Admin orders error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
});

// PUT /api/admin/orders/:id/status - Update order status
router.put('/orders/:id/status', (req, res) => {
    try {
        const { id } = req.params;
        const { status, payment_status } = req.body;
        const db = getDb();

        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const now = new Date().toISOString();
        let deliveredAt = order.delivered_at;
        if (status === 'delivered') deliveredAt = now;

        db.prepare(`
            UPDATE orders 
            SET status = COALESCE(?, status),
                payment_status = COALESCE(?, payment_status),
                delivered_at = ?,
                updated_at = ?
            WHERE id = ?
        `).run(status || null, payment_status || null, deliveredAt, now, id);

        res.json({ success: true, message: 'Order updated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update order' });
    }
});

// PUT /api/admin/orders/:id/assign-delivery - Assign delivery boy to order
router.put('/orders/:id/assign-delivery', (req, res) => {
    try {
        const { id } = req.params;
        const { delivery_boy_id } = req.body;
        const db = getDb();

        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const driver = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'delivery'").get(delivery_boy_id);
        if (!driver) {
            return res.status(400).json({ success: false, message: 'Invalid delivery partner selected' });
        }

        const now = new Date().toISOString();
        db.prepare(`
            UPDATE orders 
            SET delivery_boy_id = ?, 
                status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
                updated_at = ?
            WHERE id = ?
        `).run(delivery_boy_id, now, id);

        // Add initial tracking entry at default Cooch Behar hub (Khagrabari warehouse: 26.3350, 89.4350)
        db.prepare(`
            INSERT INTO delivery_tracking (order_id, delivery_boy_id, status, lat, lng, notes)
            VALUES (?, ?, 'assigned', 26.3350, 89.4350, ?)
        `).run(id, delivery_boy_id, `Assigned to ${driver.name} at Cooch Behar Central Hub`);

        res.json({ success: true, message: `Assigned to ${driver.name} successfully` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to assign delivery partner' });
    }
});

// GET /api/admin/customers - All customers
router.get('/customers', (req, res) => {
    try {
        const db = getDb();
        const customers = db.prepare(`
            SELECT u.id, u.name, u.email, u.phone, u.city, u.pincode, u.is_active, u.created_at,
                   COUNT(o.id) as orders_count,
                   COALESCE(SUM(o.total), 0) as total_spent
            FROM users u
            LEFT JOIN orders o ON u.id = o.user_id
            WHERE u.role = 'customer'
            GROUP BY u.id
            ORDER BY u.created_at DESC
        `).all();

        res.json({ success: true, customers });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch customers' });
    }
});

// PUT /api/admin/customers/:id/status
router.put('/customers/:id/status', (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        const db = getDb();
        db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(is_active ? 1 : 0, new Date().toISOString(), id);
        res.json({ success: true, message: `Customer status updated to ${is_active ? 'Active' : 'Inactive'}` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update customer status' });
    }
});

// GET /api/admin/delivery-boys - All delivery staff
router.get('/delivery-boys', (req, res) => {
    try {
        const db = getDb();
        const drivers = db.prepare(`
            SELECT u.id, u.name, u.email, u.phone, u.address, u.is_active, u.lat, u.lng, u.created_at,
                   COUNT(CASE WHEN o.status = 'out_for_delivery' THEN 1 END) as active_deliveries,
                   COUNT(CASE WHEN o.status = 'delivered' THEN 1 END) as completed_deliveries
            FROM users u
            LEFT JOIN orders o ON u.id = o.delivery_boy_id
            WHERE u.role = 'delivery'
            GROUP BY u.id
            ORDER BY u.created_at DESC
        `).all();

        res.json({ success: true, drivers });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch delivery partners' });
    }
});

// POST /api/admin/delivery-boys - Create new delivery partner
router.post('/delivery-boys', (req, res) => {
    try {
        const { name, email, phone, password, address, lat, lng } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Name, email and password are required' });
        }

        const db = getDb();
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
        if (existing) {
            return res.status(409).json({ success: false, message: 'User with this email already exists' });
        }

        const hashed = bcrypt.hashSync(password, 10);
        const result = db.prepare(`
            INSERT INTO users (name, email, phone, password, role, address, city, state, pincode, lat, lng, is_active)
            VALUES (?, ?, ?, ?, 'delivery', ?, 'Cooch Behar', 'West Bengal', '736101', ?, ?, 1)
        `).run(
            name.trim(),
            email.toLowerCase().trim(),
            phone || '9876543210',
            hashed,
            address || 'Cooch Behar Central',
            lat || 26.3239,
            lng || 89.4510
        );

        res.status(201).json({ success: true, message: 'Delivery partner created successfully', id: result.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to create delivery partner' });
    }
});

// GET /api/admin/reviews - All reviews for moderation
router.get('/reviews', (req, res) => {
    try {
        const db = getDb();
        const reviews = db.prepare(`
            SELECT r.*, p.name as product_name, p.thumbnail as product_thumbnail, u.name as customer_name, u.email as customer_email
            FROM reviews r
            JOIN products p ON r.product_id = p.id
            JOIN users u ON r.user_id = u.id
            ORDER BY r.created_at DESC
        `).all();

        res.json({ success: true, reviews });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
    }
});

// GET /api/admin/coupons
router.get('/coupons', (req, res) => {
    try {
        const db = getDb();
        const coupons = db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
        res.json({ success: true, coupons });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch coupons' });
    }
});

// POST /api/admin/coupons
router.post('/coupons', (req, res) => {
    try {
        const { code, description, discount_type, discount_value, min_order, max_discount, usage_limit, expires_at } = req.body;
        if (!code || !discount_value) {
            return res.status(400).json({ success: false, message: 'Coupon code and discount value required' });
        }

        const db = getDb();
        const existing = db.prepare('SELECT id FROM coupons WHERE code = ?').get(code.toUpperCase().trim());
        if (existing) {
            return res.status(409).json({ success: false, message: 'Coupon code already exists' });
        }

        db.prepare(`
            INSERT INTO coupons (code, description, discount_type, discount_value, min_order, max_discount, usage_limit, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            code.toUpperCase().trim(),
            description || '',
            discount_type || 'percentage',
            parseFloat(discount_value),
            parseFloat(min_order) || 0,
            max_discount ? parseFloat(max_discount) : null,
            usage_limit ? parseInt(usage_limit, 10) : null,
            expires_at || null
        );

        res.status(201).json({ success: true, message: 'Coupon created successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to create coupon' });
    }
});

// DELETE /api/admin/coupons/:id
router.delete('/coupons/:id', (req, res) => {
    try {
        const db = getDb();
        db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
        res.json({ success: true, message: 'Coupon deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to delete coupon' });
    }
});

// GET /api/admin/banners
router.get('/banners', (req, res) => {
    try {
        const db = getDb();
        const banners = db.prepare('SELECT * FROM banners ORDER BY position ASC, created_at DESC').all();
        res.json({ success: true, banners });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch banners' });
    }
});

// POST /api/admin/banners
router.post('/banners', (req, res) => {
    try {
        const { title, image, link, position, is_active } = req.body;
        if (!image) {
            return res.status(400).json({ success: false, message: 'Banner image URL is required' });
        }
        const db = getDb();
        db.prepare(`
            INSERT INTO banners (title, image, link, position, is_active)
            VALUES (?, ?, ?, ?, ?)
        `).run(title || '', image, link || '', parseInt(position, 10) || 0, is_active ? 1 : 0);

        res.status(201).json({ success: true, message: 'Banner added successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to add banner' });
    }
});

// PUT /api/admin/banners/:id - Update or toggle banner
router.put('/banners/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { title, image, link, position, is_active } = req.body;
        const db = getDb();
        const existing = db.prepare('SELECT * FROM banners WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Banner not found' });
        }
        db.prepare(`
            UPDATE banners SET
                title = COALESCE(?, title),
                image = COALESCE(?, image),
                link = COALESCE(?, link),
                position = COALESCE(?, position),
                is_active = COALESCE(?, is_active)
            WHERE id = ?
        `).run(
            title !== undefined ? title : existing.title,
            image !== undefined ? image : existing.image,
            link !== undefined ? link : existing.link,
            position !== undefined ? parseInt(position, 10) : existing.position,
            is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
            id
        );
        res.json({ success: true, message: 'Banner updated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update banner' });
    }
});

// DELETE /api/admin/banners/:id
router.delete('/banners/:id', (req, res) => {
    try {
        const db = getDb();
        db.prepare('DELETE FROM banners WHERE id = ?').run(req.params.id);
        res.json({ success: true, message: 'Banner deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to delete banner' });
    }
});

// GET /api/admin/settings
router.get('/settings', (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT key, value FROM settings').all();
        const settings = {};
        rows.forEach(r => { settings[r.key] = r.value; });
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch settings' });
    }
});

// PUT /api/admin/settings
router.put('/settings', (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ success: false, message: 'Invalid settings payload' });
        }
        const db = getDb();
        const upsert = db.prepare(`
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
        for (const [k, v] of Object.entries(settings)) {
            upsert.run(k, String(v));
        }
        res.json({ success: true, message: 'Settings updated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update settings' });
    }
});

// PUT /api/admin/change-admin-password - Change Admin Password
router.put('/change-admin-password', (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) {
            return res.status(400).json({ success: false, message: 'Current and new password are required' });
        }
        if (new_password.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
        }

        const db = getDb();
        const adminUser = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
        if (!bcrypt.compareSync(current_password, adminUser.password)) {
            return res.status(400).json({ success: false, message: 'Current password is incorrect' });
        }

        const hashed = bcrypt.hashSync(new_password, 10);
        db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?').run(hashed, new Date().toISOString(), req.user.id);

        res.json({ success: true, message: 'Admin password changed successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to change admin password' });
    }
});

module.exports = router;
