const express = require('express');
const router = express.Router();
const { getDb } = require('../database/init');
const { verifyToken, isAdmin, optionalAuth } = require('../middleware/auth');

// GET /api/reviews/product/:productId
router.get('/product/:productId', optionalAuth, (req, res) => {
    try {
        const { productId } = req.params;
        const db = getDb();

        const reviews = db.prepare(`
            SELECT r.*, u.name as user_name, u.avatar as user_avatar
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.product_id = ? AND (r.is_approved = 1 OR ? = 1)
            ORDER BY r.created_at DESC
        `).all(productId, req.user && req.user.role === 'admin' ? 1 : 0);

        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total_reviews,
                AVG(rating) as avg_rating,
                SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as stars_5,
                SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as stars_4,
                SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as stars_3,
                SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as stars_2,
                SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as stars_1
            FROM reviews
            WHERE product_id = ? AND is_approved = 1
        `).get(productId);

        res.json({
            success: true,
            reviews,
            stats: {
                total: stats.total_reviews || 0,
                average: stats.avg_rating ? Math.round(stats.avg_rating * 10) / 10 : 0,
                breakdown: {
                    5: stats.stars_5 || 0,
                    4: stats.stars_4 || 0,
                    3: stats.stars_3 || 0,
                    2: stats.stars_2 || 0,
                    1: stats.stars_1 || 0
                }
            }
        });
    } catch (err) {
        console.error('Error fetching reviews:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
    }
});

// POST /api/reviews - Add customer review
router.post('/', verifyToken, (req, res) => {
    try {
        const { product_id, rating, title, comment, images } = req.body;
        const userId = req.user.id;

        if (!product_id || !rating) {
            return res.status(400).json({ success: false, message: 'Product ID and rating are required' });
        }

        const ratingNum = parseInt(rating, 10);
        if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            return res.status(400).json({ success: false, message: 'Rating must be an integer between 1 and 5' });
        }

        const db = getDb();
        const product = db.prepare('SELECT id FROM products WHERE id = ?').get(product_id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        // Auto-approve or queue for moderation (default 1 for instant visibility, editable by admin)
        const isApproved = 1;

        const result = db.prepare(`
            INSERT INTO reviews (product_id, user_id, rating, title, comment, images, is_approved)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            product_id,
            userId,
            ratingNum,
            title ? title.trim() : null,
            comment ? comment.trim() : null,
            JSON.stringify(images || []),
            isApproved
        );

        // Recalculate product rating_avg & rating_count
        const agg = db.prepare(`
            SELECT COUNT(*) as cnt, AVG(rating) as avg_r 
            FROM reviews 
            WHERE product_id = ? AND is_approved = 1
        `).get(product_id);

        db.prepare(`
            UPDATE products 
            SET rating_avg = ?, rating_count = ?
            WHERE id = ?
        `).run(agg.avg_r ? Math.round(agg.avg_r * 10) / 10 : 0, agg.cnt || 0, product_id);

        res.status(201).json({
            success: true,
            message: 'Review submitted successfully',
            reviewId: result.lastInsertRowid
        });
    } catch (err) {
        console.error('Error submitting review:', err);
        res.status(500).json({ success: false, message: 'Failed to submit review' });
    }
});

// PUT /api/reviews/:id - Update own review
router.put('/:id', verifyToken, (req, res) => {
    try {
        const { id } = req.params;
        const { rating, title, comment } = req.body;
        const db = getDb();

        const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        if (review.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized to update this review' });
        }

        const ratingNum = rating ? parseInt(rating, 10) : review.rating;

        db.prepare(`
            UPDATE reviews 
            SET rating = ?, title = ?, comment = ?
            WHERE id = ?
        `).run(ratingNum, title || review.title, comment || review.comment, id);

        res.json({ success: true, message: 'Review updated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update review' });
    }
});

// DELETE /api/reviews/:id
router.delete('/:id', verifyToken, (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();

        const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        if (review.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized to delete this review' });
        }

        db.prepare('DELETE FROM reviews WHERE id = ?').run(id);

        // Update product rating
        const agg = db.prepare('SELECT COUNT(*) as cnt, AVG(rating) as avg_r FROM reviews WHERE product_id = ? AND is_approved = 1').get(review.product_id);
        db.prepare('UPDATE products SET rating_avg = ?, rating_count = ? WHERE id = ?')
            .run(agg.avg_r ? Math.round(agg.avg_r * 10) / 10 : 0, agg.cnt || 0, review.product_id);

        res.json({ success: true, message: 'Review deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to delete review' });
    }
});

// PUT /api/reviews/:id/approve (Admin)
router.put('/:id/approve', verifyToken, isAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const { is_approved } = req.body;
        const db = getDb();

        const approvedVal = is_approved ? 1 : 0;
        db.prepare('UPDATE reviews SET is_approved = ? WHERE id = ?').run(approvedVal, id);

        const review = db.prepare('SELECT product_id FROM reviews WHERE id = ?').get(id);
        if (review) {
            const agg = db.prepare('SELECT COUNT(*) as cnt, AVG(rating) as avg_r FROM reviews WHERE product_id = ? AND is_approved = 1').get(review.product_id);
            db.prepare('UPDATE products SET rating_avg = ?, rating_count = ? WHERE id = ?')
                .run(agg.avg_r ? Math.round(agg.avg_r * 10) / 10 : 0, agg.cnt || 0, review.product_id);
        }

        res.json({ success: true, message: `Review ${approvedVal ? 'approved' : 'rejected'}` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update review status' });
    }
});

// POST /api/reviews/:id/reply (Admin)
router.post('/:id/reply', verifyToken, isAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const { reply } = req.body;
        const db = getDb();

        db.prepare('UPDATE reviews SET admin_reply = ? WHERE id = ?').run(reply ? reply.trim() : null, id);
        res.json({ success: true, message: 'Admin reply saved' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to save reply' });
    }
});

module.exports = router;
