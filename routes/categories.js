const express = require('express');
const router = express.Router();
const { getDb } = require('../database/init');
const { verifyToken, isAdmin } = require('../middleware/auth');

function generateSlug(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// GET / - all active categories with product counts
router.get('/', (req, res) => {
    try {
        const db = getDb();
        const includeInactive = req.query.include_inactive === '1';

        let query;
        if (includeInactive) {
            query = `
                SELECT c.*, COUNT(p.id) as product_count
                FROM categories c
                LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1
                GROUP BY c.id
                ORDER BY c.name ASC
            `;
        } else {
            query = `
                SELECT c.*, COUNT(p.id) as product_count
                FROM categories c
                LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1
                WHERE c.is_active = 1
                GROUP BY c.id
                ORDER BY c.name ASC
            `;
        }

        const categories = db.prepare(query).all();
        db.close();

        res.json({ success: true, categories });
    } catch (error) {
        console.error('Categories list error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch categories.' });
    }
});

// GET /:slug - category with products
router.get('/:slug', (req, res) => {
    try {
        const db = getDb();
        const slug = req.params.slug;

        let category;
        if (/^\d+$/.test(slug)) {
            category = db.prepare('SELECT * FROM categories WHERE id = ?').get(parseInt(slug));
        } else {
            category = db.prepare('SELECT * FROM categories WHERE slug = ?').get(slug);
        }

        if (!category) {
            db.close();
            return res.status(404).json({ success: false, message: 'Category not found.' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const offset = (page - 1) * limit;
        const sort = req.query.sort || 'newest';

        let orderBy = 'p.created_at DESC';
        switch (sort) {
            case 'price_asc': orderBy = 'p.price ASC'; break;
            case 'price_desc': orderBy = 'p.price DESC'; break;
            case 'newest': orderBy = 'p.created_at DESC'; break;
            case 'popular': orderBy = 'p.sold_count DESC'; break;
            case 'rating': orderBy = 'p.rating_avg DESC'; break;
        }

        const totalCount = db.prepare(
            'SELECT COUNT(*) as total FROM products WHERE category_id = ? AND is_active = 1'
        ).get(category.id).total;

        const products = db.prepare(`
            SELECT p.*, c.name as category_name, c.slug as category_slug
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.category_id = ? AND p.is_active = 1
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `).all(category.id, limit, offset);
        db.close();

        const parsedProducts = products.map(p => ({
            ...p,
            images: JSON.parse(p.images || '[]'),
        }));

        // Get subcategories
        const dbSub = getDb();
        const subcategories = dbSub.prepare(
            'SELECT * FROM categories WHERE parent_id = ? AND is_active = 1'
        ).all(category.id);
        dbSub.close();

        res.json({
            success: true,
            category,
            subcategories,
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
        console.error('Category detail error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch category.' });
    }
});

// POST / (admin) - create category
router.post('/', verifyToken, isAdmin, (req, res) => {
    try {
        const { name, description, image, parent_id } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Category name is required.' });
        }

        const db = getDb();
        const slug = generateSlug(name);

        // Check for duplicate slug
        const existing = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
        if (existing) {
            db.close();
            return res.status(409).json({ success: false, message: 'A category with this name already exists.' });
        }

        const result = db.prepare(`
            INSERT INTO categories (name, slug, description, image, parent_id)
            VALUES (?, ?, ?, ?, ?)
        `).run(name.trim(), slug, description || null, image || null, parent_id || null);

        const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
        db.close();

        res.status(201).json({
            success: true,
            message: 'Category created successfully.',
            category
        });
    } catch (error) {
        console.error('Create category error:', error);
        res.status(500).json({ success: false, message: 'Failed to create category.' });
    }
});

// PUT /:id (admin) - update category
router.put('/:id', verifyToken, isAdmin, (req, res) => {
    try {
        const db = getDb();
        const categoryId = parseInt(req.params.id);

        const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
        if (!existing) {
            db.close();
            return res.status(404).json({ success: false, message: 'Category not found.' });
        }

        const { name, description, image, parent_id, is_active } = req.body;

        let slug = existing.slug;
        if (name && name.trim() !== existing.name) {
            slug = generateSlug(name);
        }

        db.prepare(`
            UPDATE categories SET
                name = ?, slug = ?, description = ?, image = ?, parent_id = ?, is_active = ?
            WHERE id = ?
        `).run(
            name ? name.trim() : existing.name,
            slug,
            description !== undefined ? description : existing.description,
            image !== undefined ? image : existing.image,
            parent_id !== undefined ? parent_id : existing.parent_id,
            is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
            categoryId
        );

        const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
        db.close();

        res.json({
            success: true,
            message: 'Category updated successfully.',
            category
        });
    } catch (error) {
        console.error('Update category error:', error);
        res.status(500).json({ success: false, message: 'Failed to update category.' });
    }
});

// DELETE /:id (admin) - deactivate category
router.delete('/:id', verifyToken, isAdmin, (req, res) => {
    try {
        const db = getDb();
        const categoryId = parseInt(req.params.id);

        const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
        if (!category) {
            db.close();
            return res.status(404).json({ success: false, message: 'Category not found.' });
        }

        db.prepare('UPDATE categories SET is_active = 0 WHERE id = ?').run(categoryId);
        db.close();

        res.json({ success: true, message: 'Category deactivated successfully.' });
    } catch (error) {
        console.error('Delete category error:', error);
        res.status(500).json({ success: false, message: 'Failed to deactivate category.' });
    }
});

module.exports = router;
