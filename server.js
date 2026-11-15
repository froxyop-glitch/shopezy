const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { initDatabase } = require('./database/init');

const app = express();
const PORT = process.env.PORT || 3000;

// Create uploads directory if not exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
const uploadsProducts = path.join(uploadsDir, 'products');
if (!fs.existsSync(uploadsProducts)) {
    fs.mkdirSync(uploadsProducts, { recursive: true });
}
const uploadsBanners = path.join(uploadsDir, 'banners');
if (!fs.existsSync(uploadsBanners)) {
    fs.mkdirSync(uploadsBanners, { recursive: true });
}
const uploadsAvatars = path.join(uploadsDir, 'avatars');
if (!fs.existsSync(uploadsAvatars)) {
    fs.mkdirSync(uploadsAvatars, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes

// Import routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const categoryRoutes = require('./routes/categories');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const reviewRoutes = require('./routes/reviews');
const deliveryRoutes = require('./routes/delivery');
const adminRoutes = require('./routes/admin');
const customerRoutes = require('./routes/customers');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/customers', customerRoutes);

// Public Settings Endpoint for Storefront & Visitors
app.get('/api/settings', (req, res) => {
    try {
        const { getDb } = require('./database/init');
        const db = getDb();
        const rows = db.prepare('SELECT key, value FROM settings').all();
        const settings = {};
        rows.forEach(r => { settings[r.key] = r.value; });
        res.json({ success: true, settings });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to fetch settings' });
    }
});

// Public Banners Endpoint for Storefront
app.get('/api/banners', (req, res) => {
    try {
        const { getDb } = require('./database/init');
        const db = getDb();
        const banners = db.prepare('SELECT * FROM banners WHERE is_active = 1 ORDER BY position ASC, created_at DESC').all();
        res.json({ success: true, banners });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to fetch banners' });
    }
});

// Dashboard route redirects to admin dashboard
app.use('/api/dashboard', (req, res, next) => {
    req.url = '/dashboard' + req.url;
    adminRoutes(req, res, next);
});

// Catch-all route serves index.html for SPA
app.use((req, res) => {
    // If asking for an API route that didn't match, return 404 JSON instead of HTML
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'API endpoint not found' });
    }
    const indexPath = path.resolve(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath, (err) => {
            if (err && !res.headersSent) {
                res.status(500).send('Error loading page');
            }
        });
    } else {
        res.status(404).json({ success: false, message: 'Not found' });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start Server after Database Initialization
async function startServer() {
    try {
        await initDatabase();
        app.listen(PORT, () => {
            console.log(`🛒 Shopezy E-Commerce Server running on port ${PORT}`);
            console.log(`📦 API available at http://localhost:${PORT}/api`);
            console.log(`🌐 Frontend at http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to initialize database and start server:', err);
        process.exit(1);
    }
}

startServer();

module.exports = app;
