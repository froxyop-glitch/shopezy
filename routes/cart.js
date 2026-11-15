const express = require('express');
const router = express.Router();
const { getDb } = require('../database/init');
const { verifyToken } = require('../middleware/auth');

// GET / - user's cart with product details and totals
router.get('/', verifyToken, (req, res) => {
    try {
        const db = getDb();

        const cartItems = db.prepare(`
            SELECT ci.*, 
                   p.name, p.slug, p.price, p.compare_price, p.thumbnail, p.images, p.stock, p.is_active,
                   pv.name as variant_name, pv.price as variant_price, pv.stock as variant_stock, pv.attributes as variant_attributes
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            LEFT JOIN product_variants pv ON ci.variant_id = pv.id
            WHERE ci.user_id = ?
            ORDER BY ci.created_at DESC
        `).all(req.user.id);

        let subtotal = 0;
        const items = cartItems.map(item => {
            const itemPrice = item.variant_price || item.price;
            const itemTotal = itemPrice * item.quantity;
            subtotal += itemTotal;

            return {
                id: item.id,
                product_id: item.product_id,
                variant_id: item.variant_id,
                quantity: item.quantity,
                product_name: item.name,
                product_slug: item.slug,
                price: itemPrice,
                compare_price: item.compare_price,
                thumbnail: item.thumbnail,
                images: JSON.parse(item.images || '[]'),
                stock: item.variant_stock !== null && item.variant_stock !== undefined ? item.variant_stock : item.stock,
                is_active: item.is_active,
                variant_name: item.variant_name,
                variant_attributes: item.variant_attributes ? JSON.parse(item.variant_attributes) : null,
                item_total: itemTotal,
                created_at: item.created_at
            };
        });

        // Get settings for shipping and tax
        const settings = {};
        const settingsRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('shipping_fee', 'free_shipping_threshold', 'tax_rate')").all();
        for (const row of settingsRows) {
            settings[row.key] = row.value;
        }
        db.close();

        const shippingFee = subtotal >= parseFloat(settings.free_shipping_threshold || 999)
            ? 0
            : parseFloat(settings.shipping_fee || 40);
        const taxRate = parseFloat(settings.tax_rate || 0) / 100;
        const tax = Math.round(subtotal * taxRate * 100) / 100;
        const total = subtotal + shippingFee + tax;

        res.json({
            success: true,
            cart: {
                items,
                item_count: items.length,
                subtotal: Math.round(subtotal * 100) / 100,
                shipping_fee: shippingFee,
                tax,
                total: Math.round(total * 100) / 100,
                free_shipping_threshold: parseFloat(settings.free_shipping_threshold || 999)
            }
        });
    } catch (error) {
        console.error('Cart fetch error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch cart.' });
    }
});

// POST /add - add item to cart
router.post('/add', verifyToken, (req, res) => {
    try {
        const { product_id, quantity, variant_id } = req.body;

        if (!product_id) {
            return res.status(400).json({ success: false, message: 'Product ID is required.' });
        }

        const qty = parseInt(quantity) || 1;
        if (qty < 1) {
            return res.status(400).json({ success: false, message: 'Quantity must be at least 1.' });
        }

        const db = getDb();

        // Check if product exists and is active
        const product = db.prepare('SELECT id, name, stock, price, is_active FROM products WHERE id = ?').get(parseInt(product_id));
        if (!product) {
            db.close();
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }

        if (!product.is_active) {
            db.close();
            return res.status(400).json({ success: false, message: 'Product is currently unavailable.' });
        }

        // Check variant if provided
        let availableStock = product.stock;
        if (variant_id) {
            const variant = db.prepare('SELECT id, stock FROM product_variants WHERE id = ? AND product_id = ?').get(parseInt(variant_id), parseInt(product_id));
            if (!variant) {
                db.close();
                return res.status(404).json({ success: false, message: 'Product variant not found.' });
            }
            availableStock = variant.stock;
        }

        // Check if item already in cart
        let existingItem;
        if (variant_id) {
            existingItem = db.prepare('SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ? AND variant_id = ?')
                .get(req.user.id, parseInt(product_id), parseInt(variant_id));
        } else {
            existingItem = db.prepare('SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ? AND variant_id IS NULL')
                .get(req.user.id, parseInt(product_id));
        }

        if (existingItem) {
            const newQty = existingItem.quantity + qty;
            if (newQty > availableStock) {
                db.close();
                return res.status(400).json({ success: false, message: `Only ${availableStock} items available in stock.` });
            }
            db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(newQty, existingItem.id);
        } else {
            if (qty > availableStock) {
                db.close();
                return res.status(400).json({ success: false, message: `Only ${availableStock} items available in stock.` });
            }
            db.prepare(`
                INSERT INTO cart_items (user_id, product_id, variant_id, quantity) VALUES (?, ?, ?, ?)
            `).run(req.user.id, parseInt(product_id), variant_id ? parseInt(variant_id) : null, qty);
        }

        // Return updated cart count
        const cartCount = db.prepare('SELECT COUNT(*) as count FROM cart_items WHERE user_id = ?').get(req.user.id).count;
        db.close();

        res.json({
            success: true,
            message: 'Item added to cart.',
            cart_count: cartCount
        });
    } catch (error) {
        console.error('Add to cart error:', error);
        res.status(500).json({ success: false, message: 'Failed to add item to cart.' });
    }
});

// PUT /:id - update quantity
router.put('/:id', verifyToken, (req, res) => {
    try {
        const cartItemId = parseInt(req.params.id);
        const { quantity } = req.body;

        if (!quantity || parseInt(quantity) < 1) {
            return res.status(400).json({ success: false, message: 'Quantity must be at least 1.' });
        }

        const qty = parseInt(quantity);
        const db = getDb();

        const cartItem = db.prepare('SELECT * FROM cart_items WHERE id = ? AND user_id = ?').get(cartItemId, req.user.id);
        if (!cartItem) {
            db.close();
            return res.status(404).json({ success: false, message: 'Cart item not found.' });
        }

        // Check stock
        let availableStock;
        if (cartItem.variant_id) {
            const variant = db.prepare('SELECT stock FROM product_variants WHERE id = ?').get(cartItem.variant_id);
            availableStock = variant ? variant.stock : 0;
        } else {
            const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(cartItem.product_id);
            availableStock = product ? product.stock : 0;
        }

        if (qty > availableStock) {
            db.close();
            return res.status(400).json({ success: false, message: `Only ${availableStock} items available in stock.` });
        }

        db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(qty, cartItemId);
        db.close();

        res.json({ success: true, message: 'Cart updated.' });
    } catch (error) {
        console.error('Update cart error:', error);
        res.status(500).json({ success: false, message: 'Failed to update cart.' });
    }
});

// DELETE /clear/all - clear entire cart
router.delete('/clear/all', verifyToken, (req, res) => {
    try {
        const db = getDb();
        db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
        db.close();

        res.json({ success: true, message: 'Cart cleared.' });
    } catch (error) {
        console.error('Clear cart error:', error);
        res.status(500).json({ success: false, message: 'Failed to clear cart.' });
    }
});

// DELETE /:id - remove item from cart
router.delete('/:id', verifyToken, (req, res) => {
    try {
        const cartItemId = parseInt(req.params.id);
        const db = getDb();

        const cartItem = db.prepare('SELECT id FROM cart_items WHERE id = ? AND user_id = ?').get(cartItemId, req.user.id);
        if (!cartItem) {
            db.close();
            return res.status(404).json({ success: false, message: 'Cart item not found.' });
        }

        db.prepare('DELETE FROM cart_items WHERE id = ?').run(cartItemId);

        const cartCount = db.prepare('SELECT COUNT(*) as count FROM cart_items WHERE user_id = ?').get(req.user.id).count;
        db.close();

        res.json({ success: true, message: 'Item removed from cart.', cart_count: cartCount });
    } catch (error) {
        console.error('Remove from cart error:', error);
        res.status(500).json({ success: false, message: 'Failed to remove item from cart.' });
    }
});

// POST /apply-coupon - validate and apply coupon code
router.post('/apply-coupon', verifyToken, (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ success: false, message: 'Coupon code is required.' });
        }

        const db = getDb();

        const coupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND is_active = 1').get(code.toUpperCase().trim());

        if (!coupon) {
            db.close();
            return res.status(404).json({ success: false, message: 'Invalid coupon code.' });
        }

        // Check expiry
        if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
            db.close();
            return res.status(400).json({ success: false, message: 'This coupon has expired.' });
        }

        // Check usage limit
        if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
            db.close();
            return res.status(400).json({ success: false, message: 'This coupon has reached its usage limit.' });
        }

        // Calculate cart subtotal
        const cartItems = db.prepare(`
            SELECT ci.quantity, p.price, pv.price as variant_price
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            LEFT JOIN product_variants pv ON ci.variant_id = pv.id
            WHERE ci.user_id = ?
        `).all(req.user.id);

        if (cartItems.length === 0) {
            db.close();
            return res.status(400).json({ success: false, message: 'Your cart is empty.' });
        }

        let subtotal = 0;
        for (const item of cartItems) {
            subtotal += (item.variant_price || item.price) * item.quantity;
        }

        // Check minimum order
        if (coupon.min_order && subtotal < coupon.min_order) {
            db.close();
            return res.status(400).json({
                success: false,
                message: `Minimum order amount of ₹${coupon.min_order} is required for this coupon.`
            });
        }

        // Calculate discount
        let discount = 0;
        if (coupon.discount_type === 'percentage') {
            discount = (subtotal * coupon.discount_value) / 100;
            if (coupon.max_discount && discount > coupon.max_discount) {
                discount = coupon.max_discount;
            }
        } else {
            discount = coupon.discount_value;
        }

        discount = Math.round(discount * 100) / 100;
        db.close();

        res.json({
            success: true,
            message: 'Coupon applied successfully!',
            coupon: {
                code: coupon.code,
                description: coupon.description,
                discount_type: coupon.discount_type,
                discount_value: coupon.discount_value,
                discount_amount: discount,
                max_discount: coupon.max_discount
            }
        });
    } catch (error) {
        console.error('Apply coupon error:', error);
        res.status(500).json({ success: false, message: 'Failed to apply coupon.' });
    }
});

module.exports = router;
