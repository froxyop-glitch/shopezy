const express = require('express');
const router = express.Router();
const { getDb } = require('../database/init');
const { verifyToken, isAdmin } = require('../middleware/auth');

function generateOrderNumber() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = String(Math.floor(1000 + Math.random() * 9000));
    return `CB-${year}${month}${day}-${random}`;
}

// POST / - create order from cart
router.post('/', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const { shipping_address, billing_address, payment_method, notes, coupon_code } = req.body;

        // Get cart items
        const cartItems = db.prepare(`
            SELECT ci.*, 
                   p.name, p.price, p.thumbnail, p.stock, p.is_active,
                   pv.price as variant_price, pv.stock as variant_stock, pv.name as variant_name
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            LEFT JOIN product_variants pv ON ci.variant_id = pv.id
            WHERE ci.user_id = ?
        `).all(req.user.id);

        if (cartItems.length === 0) {
            db.close();
            return res.status(400).json({ success: false, message: 'Your cart is empty.' });
        }

        // Validate stock availability
        for (const item of cartItems) {
            if (!item.is_active) {
                db.close();
                return res.status(400).json({ success: false, message: `${item.name} is no longer available.` });
            }
            const availableStock = item.variant_id ? item.variant_stock : item.stock;
            if (item.quantity > availableStock) {
                db.close();
                return res.status(400).json({
                    success: false,
                    message: `Only ${availableStock} units of "${item.name}" available.`
                });
            }
        }

        // Calculate totals
        let subtotal = 0;
        const orderItems = cartItems.map(item => {
            const price = item.variant_price || item.price;
            const total = price * item.quantity;
            subtotal += total;
            return {
                product_id: item.product_id,
                variant_id: item.variant_id,
                name: item.variant_name ? `${item.name} - ${item.variant_name}` : item.name,
                price,
                quantity: item.quantity,
                total,
                image: item.thumbnail
            };
        });

        // Get settings
        const settings = {};
        const settingsRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('shipping_fee', 'free_shipping_threshold', 'tax_rate')").all();
        for (const row of settingsRows) {
            settings[row.key] = row.value;
        }

        const shippingFee = subtotal >= parseFloat(settings.free_shipping_threshold || 999)
            ? 0
            : parseFloat(settings.shipping_fee || 40);
        const taxRate = parseFloat(settings.tax_rate || 0) / 100;
        const tax = Math.round(subtotal * taxRate * 100) / 100;

        // Apply coupon if provided
        let discount = 0;
        let appliedCouponCode = null;
        if (coupon_code) {
            const coupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND is_active = 1').get(coupon_code.toUpperCase().trim());
            if (coupon) {
                const notExpired = !coupon.expires_at || new Date(coupon.expires_at) >= new Date();
                const withinUsage = !coupon.usage_limit || coupon.used_count < coupon.usage_limit;
                const meetsMinOrder = !coupon.min_order || subtotal >= coupon.min_order;

                if (notExpired && withinUsage && meetsMinOrder) {
                    if (coupon.discount_type === 'percentage') {
                        discount = (subtotal * coupon.discount_value) / 100;
                        if (coupon.max_discount && discount > coupon.max_discount) {
                            discount = coupon.max_discount;
                        }
                    } else {
                        discount = coupon.discount_value;
                    }
                    discount = Math.round(discount * 100) / 100;
                    appliedCouponCode = coupon.code;

                    // Increment coupon usage
                    db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
                }
            }
        }

        const total = Math.round((subtotal + shippingFee + tax - discount) * 100) / 100;

        // Generate unique order number
        let orderNumber = generateOrderNumber();
        let attempts = 0;
        while (db.prepare('SELECT id FROM orders WHERE order_number = ?').get(orderNumber) && attempts < 10) {
            orderNumber = generateOrderNumber();
            attempts++;
        }

        // Prepare addresses
        const shippingAddr = shipping_address
            ? (typeof shipping_address === 'string' ? shipping_address : JSON.stringify(shipping_address))
            : JSON.stringify({
                name: req.user.name,
                phone: req.user.phone,
                address: req.user.address,
                city: req.user.city,
                state: req.user.state,
                pincode: req.user.pincode
            });

        const billingAddr = billing_address
            ? (typeof billing_address === 'string' ? billing_address : JSON.stringify(billing_address))
            : shippingAddr;

        // Calculate estimated delivery (3-5 days from now)
        const estimatedDelivery = new Date();
        estimatedDelivery.setDate(estimatedDelivery.getDate() + 4);

        // Create order
        const orderResult = db.prepare(`
            INSERT INTO orders (order_number, user_id, subtotal, shipping_fee, tax, discount, total, coupon_code, status, payment_method, payment_status, shipping_address, billing_address, notes, estimated_delivery)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'pending', ?, ?, ?, ?)
        `).run(
            orderNumber,
            req.user.id,
            subtotal,
            shippingFee,
            tax,
            discount,
            total,
            appliedCouponCode,
            payment_method || 'cod',
            shippingAddr,
            billingAddr,
            notes || null,
            estimatedDelivery.toISOString()
        );

        const orderId = orderResult.lastInsertRowid;

        // Insert order items
        const insertOrderItem = db.prepare(`
            INSERT INTO order_items (order_id, product_id, variant_id, name, price, quantity, total, image)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of orderItems) {
            insertOrderItem.run(orderId, item.product_id, item.variant_id, item.name, item.price, item.quantity, item.total, item.image);
        }

        // Update product stock and sold count
        const updateStock = db.prepare('UPDATE products SET stock = stock - ?, sold_count = sold_count + ? WHERE id = ?');
        const updateVariantStock = db.prepare('UPDATE product_variants SET stock = stock - ? WHERE id = ?');
        for (const item of cartItems) {
            updateStock.run(item.quantity, item.quantity, item.product_id);
            if (item.variant_id) {
                updateVariantStock.run(item.quantity, item.variant_id);
            }
        }

        // Clear cart
        db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);

        // Create notification
        db.prepare(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES (?, ?, ?, 'order')
        `).run(req.user.id, 'Order Placed!', `Your order ${orderNumber} has been placed successfully. Total: ₹${total}`);

        // Add tracking entry
        db.prepare(`
            INSERT INTO delivery_tracking (order_id, status, notes) VALUES (?, 'pending', 'Order placed by customer')
        `).run(orderId);

        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        db.close();

        res.status(201).json({
            success: true,
            message: 'Order placed successfully!',
            order: {
                ...order,
                shipping_address: JSON.parse(order.shipping_address || '{}'),
                billing_address: JSON.parse(order.billing_address || '{}')
            }
        });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ success: false, message: 'Failed to create order.' });
    }
});

// GET / - user's orders with pagination
router.get('/', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const status = req.query.status || '';

        let where = 'WHERE o.user_id = ?';
        let params = [req.user.id];

        if (status) {
            where += ' AND o.status = ?';
            params.push(status);
        }

        const totalCount = db.prepare(`SELECT COUNT(*) as total FROM orders o ${where}`).get(...params).total;

        const orders = db.prepare(`
            SELECT o.*, 
                   (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
            FROM orders o
            ${where}
            ORDER BY o.created_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset);

        // Get first item image for each order
        const ordersWithItems = orders.map(order => {
            const firstItem = db.prepare('SELECT image, name FROM order_items WHERE order_id = ? LIMIT 1').get(order.id);
            return {
                ...order,
                shipping_address: JSON.parse(order.shipping_address || '{}'),
                billing_address: JSON.parse(order.billing_address || '{}'),
                first_item: firstItem
            };
        });

        db.close();

        res.json({
            success: true,
            orders: ordersWithItems,
            pagination: {
                page,
                limit,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limit),
                hasNext: page < Math.ceil(totalCount / limit),
                hasPrev: page > 1
            }
        });
    } catch (error) {
        console.error('Orders list error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
    }
});

// GET /admin/all - all orders (admin)
router.get('/admin/all', verifyToken, isAdmin, (req, res) => {
    try {
        const db = getDb();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const status = req.query.status || '';
        const search = req.query.search || '';
        const dateFrom = req.query.date_from || '';
        const dateTo = req.query.date_to || '';

        let where = ['1=1'];
        let params = [];

        if (status) {
            where.push('o.status = ?');
            params.push(status);
        }

        if (search) {
            where.push('(o.order_number LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (dateFrom) {
            where.push('o.created_at >= ?');
            params.push(dateFrom);
        }

        if (dateTo) {
            where.push('o.created_at <= ?');
            params.push(dateTo + ' 23:59:59');
        }

        const whereClause = 'WHERE ' + where.join(' AND ');

        const totalCount = db.prepare(`
            SELECT COUNT(*) as total FROM orders o 
            JOIN users u ON o.user_id = u.id
            ${whereClause}
        `).get(...params).total;

        const orders = db.prepare(`
            SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone,
                   d.name as delivery_boy_name
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN users d ON o.delivery_boy_id = d.id
            ${whereClause}
            ORDER BY o.created_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset);

        const ordersWithDetails = orders.map(order => ({
            ...order,
            shipping_address: JSON.parse(order.shipping_address || '{}'),
            billing_address: JSON.parse(order.billing_address || '{}')
        }));

        db.close();

        res.json({
            success: true,
            orders: ordersWithDetails,
            pagination: {
                page,
                limit,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limit),
                hasNext: page < Math.ceil(totalCount / limit),
                hasPrev: page > 1
            }
        });
    } catch (error) {
        console.error('Admin orders list error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
    }
});

// GET /track/:orderNumber - public tracking by order number
router.get('/track/:orderNumber', (req, res) => {
    try {
        const db = getDb();
        const orderNumber = req.params.orderNumber;

        const order = db.prepare(`
            SELECT o.order_number, o.status, o.created_at, o.estimated_delivery, o.delivered_at,
                   o.shipping_fee, o.total, o.payment_method, o.payment_status
            FROM orders o
            WHERE o.order_number = ?
        `).get(orderNumber);

        if (!order) {
            db.close();
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        const tracking = db.prepare(`
            SELECT dt.status, dt.notes, dt.created_at, u.name as delivery_boy_name
            FROM delivery_tracking dt
            LEFT JOIN users u ON dt.delivery_boy_id = u.id
            WHERE dt.order_id = (SELECT id FROM orders WHERE order_number = ?)
            ORDER BY dt.created_at ASC
        `).all(orderNumber);

        db.close();

        res.json({
            success: true,
            order,
            tracking
        });
    } catch (error) {
        console.error('Track order error:', error);
        res.status(500).json({ success: false, message: 'Failed to track order.' });
    }
});

// GET /:id - order details with items and tracking
router.get('/:id', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const orderId = parseInt(req.params.id);

        let order;
        if (req.user.role === 'admin') {
            order = db.prepare(`
                SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone,
                       d.name as delivery_boy_name, d.phone as delivery_boy_phone
                FROM orders o
                JOIN users u ON o.user_id = u.id
                LEFT JOIN users d ON o.delivery_boy_id = d.id
                WHERE o.id = ?
            `).get(orderId);
        } else {
            order = db.prepare(`
                SELECT o.*, d.name as delivery_boy_name, d.phone as delivery_boy_phone
                FROM orders o
                LEFT JOIN users d ON o.delivery_boy_id = d.id
                WHERE o.id = ? AND o.user_id = ?
            `).get(orderId, req.user.id);
        }

        if (!order) {
            db.close();
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        const items = db.prepare(`
            SELECT oi.*, p.slug as product_slug
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        `).all(orderId);

        const tracking = db.prepare(`
            SELECT dt.*, u.name as delivery_boy_name
            FROM delivery_tracking dt
            LEFT JOIN users u ON dt.delivery_boy_id = u.id
            WHERE dt.order_id = ?
            ORDER BY dt.created_at ASC
        `).all(orderId);

        db.close();

        res.json({
            success: true,
            order: {
                ...order,
                shipping_address: JSON.parse(order.shipping_address || '{}'),
                billing_address: JSON.parse(order.billing_address || '{}'),
                items,
                tracking
            }
        });
    } catch (error) {
        console.error('Order detail error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch order.' });
    }
});

// PUT /:id/cancel - cancel order
router.put('/:id/cancel', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const orderId = parseInt(req.params.id);
        const { reason } = req.body;

        const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.user.id);

        if (!order) {
            db.close();
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        if (!['pending', 'confirmed'].includes(order.status)) {
            db.close();
            return res.status(400).json({ success: false, message: 'Order can only be cancelled when pending or confirmed.' });
        }

        // Restore stock
        const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
        const restoreStock = db.prepare('UPDATE products SET stock = stock + ?, sold_count = sold_count - ? WHERE id = ?');
        const restoreVariantStock = db.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ?');
        for (const item of orderItems) {
            restoreStock.run(item.quantity, item.quantity, item.product_id);
            if (item.variant_id) {
                restoreVariantStock.run(item.quantity, item.variant_id);
            }
        }

        // Restore coupon usage
        if (order.coupon_code) {
            db.prepare('UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?').run(order.coupon_code);
        }

        db.prepare(`
            UPDATE orders SET status = 'cancelled', cancelled_at = datetime('now'), cancel_reason = ?, updated_at = datetime('now') WHERE id = ?
        `).run(reason || 'Cancelled by customer', orderId);

        // Add tracking entry
        db.prepare(`
            INSERT INTO delivery_tracking (order_id, status, notes) VALUES (?, 'cancelled', ?)
        `).run(orderId, reason || 'Cancelled by customer');

        // Notification
        db.prepare(`
            INSERT INTO notifications (user_id, title, message, type) VALUES (?, 'Order Cancelled', ?, 'order')
        `).run(req.user.id, `Your order ${order.order_number} has been cancelled.`);

        db.close();

        res.json({ success: true, message: 'Order cancelled successfully.' });
    } catch (error) {
        console.error('Cancel order error:', error);
        res.status(500).json({ success: false, message: 'Failed to cancel order.' });
    }
});

// PUT /:id/status (admin) - update order status
router.put('/:id/status', verifyToken, isAdmin, (req, res) => {
    try {
        const db = getDb();
        const orderId = parseInt(req.params.id);
        const { status, notes } = req.body;

        const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned'];
        if (!status || !validStatuses.includes(status)) {
            db.close();
            return res.status(400).json({ success: false, message: 'Invalid status value.' });
        }

        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        if (!order) {
            db.close();
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        const updates = { status };
        if (status === 'delivered') {
            updates.delivered_at = "datetime('now')";
            updates.payment_status = 'paid';
        }
        if (status === 'cancelled') {
            updates.cancelled_at = "datetime('now')";

            // Restore stock
            const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
            const restoreStock = db.prepare('UPDATE products SET stock = stock + ?, sold_count = sold_count - ? WHERE id = ?');
            const restoreVariantStock = db.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ?');
            for (const item of orderItems) {
                restoreStock.run(item.quantity, item.quantity, item.product_id);
                if (item.variant_id) {
                    restoreVariantStock.run(item.quantity, item.variant_id);
                }
            }
        }

        if (status === 'delivered') {
            db.prepare(`
                UPDATE orders SET status = ?, delivered_at = datetime('now'), payment_status = 'paid', updated_at = datetime('now') WHERE id = ?
            `).run(status, orderId);
        } else if (status === 'cancelled') {
            db.prepare(`
                UPDATE orders SET status = ?, cancelled_at = datetime('now'), cancel_reason = ?, updated_at = datetime('now') WHERE id = ?
            `).run(status, notes || 'Cancelled by admin', orderId);
        } else {
            db.prepare(`
                UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?
            `).run(status, orderId);
        }

        // Add tracking entry
        db.prepare(`
            INSERT INTO delivery_tracking (order_id, delivery_boy_id, status, notes) VALUES (?, ?, ?, ?)
        `).run(orderId, order.delivery_boy_id, status, notes || `Status updated to ${status}`);

        // Notify customer
        const statusMessages = {
            confirmed: 'Your order has been confirmed!',
            processing: 'Your order is being prepared.',
            shipped: 'Your order has been shipped!',
            out_for_delivery: 'Your order is out for delivery!',
            delivered: 'Your order has been delivered!',
            cancelled: 'Your order has been cancelled.',
            returned: 'Your order return is being processed.'
        };

        if (statusMessages[status]) {
            db.prepare(`
                INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'order')
            `).run(order.user_id, `Order ${order.order_number}`, statusMessages[status]);
        }

        db.close();

        res.json({ success: true, message: `Order status updated to ${status}.` });
    } catch (error) {
        console.error('Update order status error:', error);
        res.status(500).json({ success: false, message: 'Failed to update order status.' });
    }
});

// PUT /:id/assign-delivery (admin) - assign delivery boy
router.put('/:id/assign-delivery', verifyToken, isAdmin, (req, res) => {
    try {
        const db = getDb();
        const orderId = parseInt(req.params.id);
        const { delivery_boy_id } = req.body;

        if (!delivery_boy_id) {
            db.close();
            return res.status(400).json({ success: false, message: 'Delivery boy ID is required.' });
        }

        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        if (!order) {
            db.close();
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        const deliveryBoy = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'delivery' AND is_active = 1").get(parseInt(delivery_boy_id));
        if (!deliveryBoy) {
            db.close();
            return res.status(404).json({ success: false, message: 'Delivery boy not found or inactive.' });
        }

        db.prepare(`
            UPDATE orders SET delivery_boy_id = ?, updated_at = datetime('now') WHERE id = ?
        `).run(deliveryBoy.id, orderId);

        // Add tracking entry
        db.prepare(`
            INSERT INTO delivery_tracking (order_id, delivery_boy_id, status, notes) VALUES (?, ?, ?, ?)
        `).run(orderId, deliveryBoy.id, order.status, `Delivery assigned to ${deliveryBoy.name}`);

        // Notify delivery boy
        db.prepare(`
            INSERT INTO notifications (user_id, title, message, type) VALUES (?, 'New Delivery Assigned', ?, 'delivery')
        `).run(deliveryBoy.id, `Order ${order.order_number} has been assigned to you.`);

        db.close();

        res.json({ success: true, message: `Order assigned to ${deliveryBoy.name}.` });
    } catch (error) {
        console.error('Assign delivery error:', error);
        res.status(500).json({ success: false, message: 'Failed to assign delivery.' });
    }
});

module.exports = router;
