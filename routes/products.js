const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { getDb } = require('../database/init');
const { verifyToken, isAdmin, optionalAuth } = require('../middleware/auth');

// Multer config for product images
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '..', 'uploads', 'products'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Only image files (jpeg, jpg, png, gif, webp) are allowed.'));
        }
    }
});

function generateSlug(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        + '-' + Date.now().toString(36);
}

// GET / - list products with pagination, search, category filter, price range, sort
router.get('/', optionalAuth, (req, res) => {
    try {
        const db = getDb();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const offset = (page - 1) * limit;
        const search = req.query.search || req.query.q || '';
        const categoryId = req.query.category_id || req.query.category || '';
        const categorySlug = req.query.category_slug || '';
        const minPrice = parseFloat(req.query.min_price) || 0;
        const maxPrice = parseFloat(req.query.max_price) || 0;
        const brand = req.query.brand || '';
        const sort = req.query.sort || 'newest';
        const featured = req.query.featured;

        let where = ['p.is_active = 1'];
        let params = [];

        if (search) {
            where.push('(p.name LIKE ? OR p.description LIKE ? OR p.brand LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (categoryId) {
            where.push('p.category_id = ?');
            params.push(parseInt(categoryId));
        }

        if (categorySlug) {
            where.push('c.slug = ?');
            params.push(categorySlug);
        }

        if (minPrice > 0) {
            where.push('p.price >= ?');
            params.push(minPrice);
        }

        if (maxPrice > 0) {
            where.push('p.price <= ?');
            params.push(maxPrice);
        }

        if (brand) {
            where.push('p.brand = ?');
            params.push(brand);
        }

        if (featured === '1' || featured === 'true') {
            where.push('p.is_featured = 1');
        }

        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

        let orderBy = 'p.created_at DESC';
        switch (sort) {
            case 'price_asc': orderBy = 'p.price ASC'; break;
            case 'price_desc': orderBy = 'p.price DESC'; break;
            case 'newest': orderBy = 'p.created_at DESC'; break;
            case 'popular': orderBy = 'p.sold_count DESC'; break;
            case 'rating': orderBy = 'p.rating_avg DESC'; break;
            case 'name_asc': orderBy = 'p.name ASC'; break;
            case 'name_desc': orderBy = 'p.name DESC'; break;
        }

        const countQuery = `SELECT COUNT(*) as total FROM products p LEFT JOIN categories c ON p.category_id = c.id ${whereClause}`;
        const totalCount = db.prepare(countQuery).get(...params).total;

        const query = `
            SELECT p.*, c.name as category_name, c.slug as category_slug
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `;

        const products = db.prepare(query).all(...params, limit, offset);
        db.close();

        const parsedProducts = products.map(p => ({
            ...p,
            images: JSON.parse(p.images || '[]'),
        }));

        res.json({
            success: true,
            products: parsedProducts,
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
        console.error('Products list error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch products.' });
    }
});

// GET /featured - featured products
router.get('/featured', (req, res) => {
    try {
        const db = getDb();
        const limit = parseInt(req.query.limit) || 8;

        const products = db.prepare(`
            SELECT p.*, c.name as category_name, c.slug as category_slug
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.is_active = 1 AND p.is_featured = 1
            ORDER BY p.created_at DESC
            LIMIT ?
        `).all(limit);
        db.close();

        const parsedProducts = products.map(p => ({
            ...p,
            images: JSON.parse(p.images || '[]'),
        }));

        res.json({ success: true, products: parsedProducts });
    } catch (error) {
        console.error('Featured products error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch featured products.' });
    }
});

// GET /search?q= - search products
router.get('/search', (req, res) => {
    try {
        const q = req.query.q || '';
        if (!q.trim()) {
            return res.json({ success: true, products: [], query: '' });
        }

        const db = getDb();
        const limit = parseInt(req.query.limit) || 20;

        const products = db.prepare(`
            SELECT p.*, c.name as category_name, c.slug as category_slug
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.is_active = 1 AND (p.name LIKE ? OR p.description LIKE ? OR p.brand LIKE ? OR p.sku LIKE ?)
            ORDER BY 
                CASE WHEN p.name LIKE ? THEN 1
                     WHEN p.brand LIKE ? THEN 2
                     ELSE 3 END,
                p.sold_count DESC
            LIMIT ?
        `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, limit);
        db.close();

        const parsedProducts = products.map(p => ({
            ...p,
            images: JSON.parse(p.images || '[]'),
        }));

        res.json({ success: true, products: parsedProducts, query: q });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ success: false, message: 'Search failed.' });
    }
});

// GET /:id - single product with reviews
router.get('/:id', optionalAuth, (req, res) => {
    try {
        const db = getDb();
        const idOrSlug = req.params.id;

        let product;
        if (/^\d+$/.test(idOrSlug)) {
            product = db.prepare(`
                SELECT p.*, c.name as category_name, c.slug as category_slug
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE p.id = ?
            `).get(parseInt(idOrSlug));
        } else {
            product = db.prepare(`
                SELECT p.*, c.name as category_name, c.slug as category_slug
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE p.slug = ?
            `).get(idOrSlug);
        }

        if (!product) {
            db.close();
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }

        product.images = JSON.parse(product.images || '[]');

        // Fetch variants
        const variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ?').all(product.id);
        const parsedVariants = variants.map(v => ({
            ...v,
            attributes: JSON.parse(v.attributes || '{}')
        }));

        // Fetch approved reviews with user info
        const reviews = db.prepare(`
            SELECT r.*, u.name as user_name, u.avatar as user_avatar
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.product_id = ? AND r.is_approved = 1
            ORDER BY r.created_at DESC
        `).all(product.id);

        const parsedReviews = reviews.map(r => ({
            ...r,
            images: JSON.parse(r.images || '[]')
        }));

        // Related products
        const relatedProducts = db.prepare(`
            SELECT p.*, c.name as category_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.category_id = ? AND p.id != ? AND p.is_active = 1
            ORDER BY p.sold_count DESC
            LIMIT 4
        `).all(product.category_id, product.id);

        const parsedRelated = relatedProducts.map(p => ({
            ...p,
            images: JSON.parse(p.images || '[]'),
        }));

        // Check if user has this in wishlist
        let inWishlist = false;
        if (req.user) {
            const wishItem = db.prepare('SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?').get(req.user.id, product.id);
            inWishlist = !!wishItem;
        }

        db.close();

        res.json({
            success: true,
            product: {
                ...product,
                variants: parsedVariants,
                reviews: parsedReviews,
                related_products: parsedRelated,
                in_wishlist: inWishlist
            }
        });
    } catch (error) {
        console.error('Product detail error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch product.' });
    }
});

// POST / (admin) - create product
router.post('/', verifyToken, isAdmin, upload.array('images', 10), (req, res) => {
    try {
        const db = getDb();
        const {
            name, description, price, compare_price, cost_price, sku,
            stock, category_id, brand, weight, dimensions, is_featured,
            thumbnail, existing_images
        } = req.body;

        if (!name || !price) {
            db.close();
            return res.status(400).json({ success: false, message: 'Name and price are required.' });
        }

        const slug = generateSlug(name);

        let images = [];
        if (existing_images) {
            try { images = JSON.parse(existing_images); } catch (e) { images = []; }
        }
        if (req.files && req.files.length > 0) {
            const uploadedImages = req.files.map(f => `/uploads/products/${f.filename}`);
            images = images.concat(uploadedImages);
        }

        const productThumbnail = thumbnail || (images.length > 0 ? images[0] : null);

        const result = db.prepare(`
            INSERT INTO products (name, slug, description, price, compare_price, cost_price, sku, stock, category_id, brand, weight, dimensions, images, thumbnail, is_featured)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            name.trim(),
            slug,
            description || null,
            parseFloat(price),
            compare_price ? parseFloat(compare_price) : null,
            cost_price ? parseFloat(cost_price) : null,
            sku || null,
            parseInt(stock) || 0,
            category_id ? parseInt(category_id) : null,
            brand || null,
            weight ? parseFloat(weight) : null,
            dimensions || null,
            JSON.stringify(images),
            productThumbnail,
            is_featured ? 1 : 0
        );

        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
        db.close();

        product.images = JSON.parse(product.images || '[]');

        res.status(201).json({
            success: true,
            message: 'Product created successfully.',
            product
        });
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ success: false, message: 'Failed to create product.' });
    }
});

// PUT /:id (admin) - update product
router.put('/:id', verifyToken, isAdmin, upload.array('images', 10), (req, res) => {
    try {
        const db = getDb();
        const productId = parseInt(req.params.id);

        const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
        if (!existing) {
            db.close();
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }

        const {
            name, description, price, compare_price, cost_price, sku,
            stock, category_id, brand, weight, dimensions, is_featured,
            is_active, thumbnail, existing_images
        } = req.body;

        let images = [];
        if (existing_images) {
            try { images = JSON.parse(existing_images); } catch (e) { images = JSON.parse(existing.images || '[]'); }
        } else {
            images = JSON.parse(existing.images || '[]');
        }

        if (req.files && req.files.length > 0) {
            const uploadedImages = req.files.map(f => `/uploads/products/${f.filename}`);
            images = images.concat(uploadedImages);
        }

        const productThumbnail = thumbnail || (images.length > 0 ? images[0] : existing.thumbnail);

        db.prepare(`
            UPDATE products SET
                name = ?, description = ?, price = ?, compare_price = ?, cost_price = ?,
                sku = ?, stock = ?, category_id = ?, brand = ?, weight = ?, dimensions = ?,
                images = ?, thumbnail = ?, is_featured = ?, is_active = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `).run(
            name ? name.trim() : existing.name,
            description !== undefined ? description : existing.description,
            price ? parseFloat(price) : existing.price,
            compare_price !== undefined ? (compare_price ? parseFloat(compare_price) : null) : existing.compare_price,
            cost_price !== undefined ? (cost_price ? parseFloat(cost_price) : null) : existing.cost_price,
            sku !== undefined ? sku : existing.sku,
            stock !== undefined ? parseInt(stock) : existing.stock,
            category_id !== undefined ? (category_id ? parseInt(category_id) : null) : existing.category_id,
            brand !== undefined ? brand : existing.brand,
            weight !== undefined ? (weight ? parseFloat(weight) : null) : existing.weight,
            dimensions !== undefined ? dimensions : existing.dimensions,
            JSON.stringify(images),
            productThumbnail,
            is_featured !== undefined ? (is_featured ? 1 : 0) : existing.is_featured,
            is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
            productId
        );

        const product = db.prepare(`
            SELECT p.*, c.name as category_name
            FROM products p LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id = ?
        `).get(productId);
        db.close();

        product.images = JSON.parse(product.images || '[]');

        res.json({
            success: true,
            message: 'Product updated successfully.',
            product
        });
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ success: false, message: 'Failed to update product.' });
    }
});

// DELETE /:id (admin) - soft delete product
router.delete('/:id', verifyToken, isAdmin, (req, res) => {
    try {
        const db = getDb();
        const productId = parseInt(req.params.id);

        const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
        if (!product) {
            db.close();
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }

        db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(productId);
        db.close();

        res.json({ success: true, message: 'Product deleted successfully.' });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete product.' });
    }
});

module.exports = router;
