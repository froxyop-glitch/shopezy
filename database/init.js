const { initSqlEngine, getDatabase } = require('./sqliteAdapter');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './database.sqlite';

async function initDatabase() {
    await initSqlEngine();
    const dbPath = path.resolve(DB_PATH);
    const db = getDatabase(dbPath);

    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create tables
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer', 'admin', 'delivery')),
            avatar TEXT,
            address TEXT,
            city TEXT,
            state TEXT,
            pincode TEXT,
            lat REAL,
            lng REAL,
            is_active INTEGER NOT NULL DEFAULT 1,
            reset_token TEXT,
            reset_token_expires TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            description TEXT,
            image TEXT,
            parent_id INTEGER,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            compare_price REAL,
            cost_price REAL,
            sku TEXT,
            stock INTEGER NOT NULL DEFAULT 0,
            category_id INTEGER,
            brand TEXT,
            weight REAL,
            dimensions TEXT,
            images TEXT DEFAULT '[]',
            thumbnail TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            is_featured INTEGER NOT NULL DEFAULT 0,
            rating_avg REAL NOT NULL DEFAULT 0,
            rating_count INTEGER NOT NULL DEFAULT 0,
            sold_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS product_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            sku TEXT,
            price REAL,
            stock INTEGER NOT NULL DEFAULT 0,
            attributes TEXT DEFAULT '{}',
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS cart_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            variant_id INTEGER,
            quantity INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            delivery_boy_id INTEGER,
            subtotal REAL NOT NULL DEFAULT 0,
            shipping_fee REAL NOT NULL DEFAULT 0,
            tax REAL NOT NULL DEFAULT 0,
            discount REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            coupon_code TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','processing','shipped','out_for_delivery','delivered','cancelled','returned')),
            payment_method TEXT NOT NULL DEFAULT 'cod',
            payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','refunded')),
            shipping_address TEXT DEFAULT '{}',
            billing_address TEXT DEFAULT '{}',
            notes TEXT,
            estimated_delivery TEXT,
            delivered_at TEXT,
            cancelled_at TEXT,
            cancel_reason TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (delivery_boy_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id INTEGER,
            variant_id INTEGER,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            total REAL NOT NULL,
            image TEXT,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
            FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
            title TEXT,
            comment TEXT,
            images TEXT DEFAULT '[]',
            is_approved INTEGER NOT NULL DEFAULT 0,
            admin_reply TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS wishlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            UNIQUE(user_id, product_id)
        );

        CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            description TEXT,
            discount_type TEXT NOT NULL DEFAULT 'percentage' CHECK(discount_type IN ('percentage', 'fixed')),
            discount_value REAL NOT NULL DEFAULT 0,
            min_order REAL NOT NULL DEFAULT 0,
            max_discount REAL,
            usage_limit INTEGER,
            used_count INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            expires_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS delivery_tracking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            delivery_boy_id INTEGER,
            status TEXT NOT NULL,
            lat REAL,
            lng REAL,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (delivery_boy_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            message TEXT,
            type TEXT DEFAULT 'general',
            is_read INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS banners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            image TEXT NOT NULL,
            link TEXT,
            position INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT
        );
    `);

    // Create indexes
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
        CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
        CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
        CREATE INDEX IF NOT EXISTS idx_products_featured ON products(is_featured);
        CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_delivery ON orders(delivery_boy_id);
        CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
        CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
        CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
        CREATE INDEX IF NOT EXISTS idx_wishlists_user ON wishlists(user_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
        CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
        CREATE INDEX IF NOT EXISTS idx_delivery_tracking_order ON delivery_tracking(order_id);
    `);

    // Seed data only if tables are empty
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    if (userCount === 0) {
        console.log('🌱 Seeding database with initial data...');
        seedDatabase(db);
        console.log('✅ Database seeded successfully!');
    }

    db.close();
    console.log('✅ Database initialized successfully!');
}

function seedDatabase(db) {
    // Seed Admin User
    const adminPassword = bcrypt.hashSync(process.env.ADMIN_DEFAULT_PASSWORD || 'admin123', 10);
    db.prepare(`
        INSERT INTO users (name, email, phone, password, role, address, city, state, pincode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('Admin', 'admin@coochbehar.com', '9876543210', adminPassword, 'admin', 'Main Road, Cooch Behar', 'Cooch Behar', 'West Bengal', '736101');

    // Seed Delivery Boys
    const deliveryPassword = bcrypt.hashSync('delivery123', 10);
    const deliveryBoys = [
        ['Raju Das', 'raju@delivery.com', '9876543211', deliveryPassword, 'delivery', 'Ward 5, Cooch Behar', 'Cooch Behar', 'West Bengal', '736101', 26.3249, 89.4487],
        ['Bikash Roy', 'bikash@delivery.com', '9876543212', deliveryPassword, 'delivery', 'Ward 8, Cooch Behar', 'Cooch Behar', 'West Bengal', '736101', 26.3300, 89.4500],
        ['Sunil Barman', 'sunil@delivery.com', '9876543213', deliveryPassword, 'delivery', 'Ward 12, Cooch Behar', 'Cooch Behar', 'West Bengal', '736101', 26.3200, 89.4450]
    ];

    const insertDelivery = db.prepare(`
        INSERT INTO users (name, email, phone, password, role, address, city, state, pincode, lat, lng)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of deliveryBoys) {
        insertDelivery.run(...d);
    }

    // Seed sample customers
    const customerPassword = bcrypt.hashSync('customer123', 10);
    const customers = [
        ['Anita Sharma', 'anita@example.com', '9876500001', customerPassword, 'customer', 'MG Road, Cooch Behar', 'Cooch Behar', 'West Bengal', '736101'],
        ['Dipak Ghosh', 'dipak@example.com', '9876500002', customerPassword, 'customer', 'Station Road, Cooch Behar', 'Cooch Behar', 'West Bengal', '736101']
    ];
    const insertCustomer = db.prepare(`
        INSERT INTO users (name, email, phone, password, role, address, city, state, pincode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of customers) {
        insertCustomer.run(...c);
    }

    // Seed Categories
    const categories = [
        ['Electronics', 'electronics', 'Smartphones, Laptops, Gadgets and more', 'https://picsum.photos/seed/cat-electronics/400/400'],
        ['Fashion', 'fashion', 'Clothing, Footwear, Accessories for Men & Women', 'https://picsum.photos/seed/cat-fashion/400/400'],
        ['Home & Kitchen', 'home-kitchen', 'Furniture, Cookware, Home Decor', 'https://picsum.photos/seed/cat-home/400/400'],
        ['Books', 'books', 'Fiction, Non-fiction, Academic and Children Books', 'https://picsum.photos/seed/cat-books/400/400'],
        ['Sports', 'sports', 'Sports Equipment, Fitness Gear, Outdoor', 'https://picsum.photos/seed/cat-sports/400/400'],
        ['Beauty', 'beauty', 'Skincare, Makeup, Personal Care', 'https://picsum.photos/seed/cat-beauty/400/400'],
        ['Grocery', 'grocery', 'Daily Essentials, Organic, Beverages', 'https://picsum.photos/seed/cat-grocery/400/400'],
        ['Toys', 'toys', 'Kids Toys, Board Games, Educational', 'https://picsum.photos/seed/cat-toys/400/400']
    ];

    const insertCategory = db.prepare(`
        INSERT INTO categories (name, slug, description, image) VALUES (?, ?, ?, ?)
    `);
    for (const cat of categories) {
        insertCategory.run(...cat);
    }

    // Seed Products
    const products = [
        {
            name: 'Samsung Galaxy M34 5G',
            slug: 'samsung-galaxy-m34-5g',
            description: 'Samsung Galaxy M34 5G with 6000mAh battery, 50MP triple camera, 6GB RAM, 128GB storage. Enjoy stunning display and blazing fast 5G connectivity in Cooch Behar.',
            price: 16999,
            compare_price: 21999,
            cost_price: 14000,
            sku: 'ELEC-SAM-M34',
            stock: 25,
            category_id: 1,
            brand: 'Samsung',
            weight: 0.21,
            dimensions: '161.7 x 77.2 x 8.8 mm',
            images: JSON.stringify(['https://picsum.photos/seed/product1/400/400', 'https://picsum.photos/seed/product1b/400/400']),
            thumbnail: 'https://picsum.photos/seed/product1/400/400',
            is_featured: 1
        },
        {
            name: 'boAt Rockerz 450 Wireless Headphone',
            slug: 'boat-rockerz-450-wireless-headphone',
            description: 'boAt Rockerz 450 Bluetooth On Ear Headphones with Mic, Upto 15 Hours Playback, Padded Ear Cushions, Integrated Controls. Perfect for music lovers.',
            price: 1299,
            compare_price: 2990,
            cost_price: 800,
            sku: 'ELEC-BOAT-450',
            stock: 50,
            category_id: 1,
            brand: 'boAt',
            weight: 0.18,
            dimensions: '18 x 15 x 7 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product2/400/400', 'https://picsum.photos/seed/product2b/400/400']),
            thumbnail: 'https://picsum.photos/seed/product2/400/400',
            is_featured: 1
        },
        {
            name: 'HP 15s Laptop Intel i5 12th Gen',
            slug: 'hp-15s-laptop-intel-i5',
            description: 'HP 15s Laptop with 12th Gen Intel Core i5, 8GB DDR4 RAM, 512GB SSD, 15.6 inch FHD display, Windows 11. Ideal for students and professionals in Cooch Behar.',
            price: 52990,
            compare_price: 62000,
            cost_price: 45000,
            sku: 'ELEC-HP-15S',
            stock: 10,
            category_id: 1,
            brand: 'HP',
            weight: 1.69,
            dimensions: '35.8 x 24.2 x 1.79 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product3/400/400']),
            thumbnail: 'https://picsum.photos/seed/product3/400/400',
            is_featured: 1
        },
        {
            name: 'Allen Solly Men Formal Shirt',
            slug: 'allen-solly-men-formal-shirt',
            description: 'Allen Solly Men Regular Fit Solid Formal Shirt. Premium cotton fabric, comfortable fit for office and formal occasions.',
            price: 1199,
            compare_price: 1799,
            cost_price: 700,
            sku: 'FASH-AS-SHIRT',
            stock: 40,
            category_id: 2,
            brand: 'Allen Solly',
            weight: 0.25,
            dimensions: '30 x 22 x 3 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product4/400/400', 'https://picsum.photos/seed/product4b/400/400']),
            thumbnail: 'https://picsum.photos/seed/product4/400/400',
            is_featured: 0
        },
        {
            name: 'Levi\'s Women Skinny Jeans',
            slug: 'levis-women-skinny-jeans',
            description: 'Levi\'s Women 711 Skinny Fit Mid-Rise Clean Look Stretchable Jeans. Classic indigo wash, comfortable all-day wear.',
            price: 2499,
            compare_price: 3999,
            cost_price: 1800,
            sku: 'FASH-LEV-JEANS',
            stock: 30,
            category_id: 2,
            brand: 'Levi\'s',
            weight: 0.5,
            dimensions: '35 x 28 x 4 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product5/400/400']),
            thumbnail: 'https://picsum.photos/seed/product5/400/400',
            is_featured: 1
        },
        {
            name: 'Prestige Iris 750 Watt Mixer Grinder',
            slug: 'prestige-iris-750-mixer-grinder',
            description: 'Prestige Iris 750 Watt Mixer Grinder with 3 Stainless Steel Jars. Powerful motor, stainless steel blades, perfect for Indian kitchen in Cooch Behar.',
            price: 3299,
            compare_price: 4495,
            cost_price: 2500,
            sku: 'HOME-PRES-MIX',
            stock: 20,
            category_id: 3,
            brand: 'Prestige',
            weight: 3.5,
            dimensions: '40 x 22 x 30 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product6/400/400']),
            thumbnail: 'https://picsum.photos/seed/product6/400/400',
            is_featured: 0
        },
        {
            name: 'Pigeon Stovekraft 12 Pcs Non-Stick Cookware Set',
            slug: 'pigeon-nonstick-cookware-set',
            description: 'Pigeon by Stovekraft Non-Stick Cookware Set of 12 pieces. Includes kadhai, tawa, fry pan, saucepan with glass lids. PFOA-free coating.',
            price: 1899,
            compare_price: 3195,
            cost_price: 1200,
            sku: 'HOME-PIG-COOK',
            stock: 15,
            category_id: 3,
            brand: 'Pigeon',
            weight: 4.2,
            dimensions: '45 x 35 x 25 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product7/400/400']),
            thumbnail: 'https://picsum.photos/seed/product7/400/400',
            is_featured: 1
        },
        {
            name: 'The Alchemist by Paulo Coelho',
            slug: 'the-alchemist-paulo-coelho',
            description: 'The Alchemist by Paulo Coelho - A magical tale of Santiago, an Andalusian shepherd boy who yearns to travel in search of a worldly treasure. International bestseller.',
            price: 299,
            compare_price: 350,
            cost_price: 150,
            sku: 'BOOK-ALC-001',
            stock: 100,
            category_id: 4,
            brand: 'HarperCollins',
            weight: 0.2,
            dimensions: '20 x 13 x 1.5 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product8/400/400']),
            thumbnail: 'https://picsum.photos/seed/product8/400/400',
            is_featured: 0
        },
        {
            name: 'Atomic Habits by James Clear',
            slug: 'atomic-habits-james-clear',
            description: 'Atomic Habits: An Easy & Proven Way to Build Good Habits & Break Bad Ones. The #1 New York Times bestseller on habit formation.',
            price: 499,
            compare_price: 699,
            cost_price: 280,
            sku: 'BOOK-ATM-002',
            stock: 75,
            category_id: 4,
            brand: 'Penguin',
            weight: 0.3,
            dimensions: '21 x 14 x 2 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product9/400/400']),
            thumbnail: 'https://picsum.photos/seed/product9/400/400',
            is_featured: 1
        },
        {
            name: 'Yonex Badminton Racket Nanoray Light 18i',
            slug: 'yonex-nanoray-light-18i',
            description: 'Yonex Nanoray Light 18i Graphite Badminton Racquet. Lightweight, isometric head shape, built-in T-joint. Great for recreational and intermediate players.',
            price: 1850,
            compare_price: 2490,
            cost_price: 1200,
            sku: 'SPRT-YNX-NR18',
            stock: 20,
            category_id: 5,
            brand: 'Yonex',
            weight: 0.077,
            dimensions: '68 x 22 x 3 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product10/400/400']),
            thumbnail: 'https://picsum.photos/seed/product10/400/400',
            is_featured: 0
        },
        {
            name: 'Nivia Storm Football Size 5',
            slug: 'nivia-storm-football-size-5',
            description: 'Nivia Storm Football Size 5, Machine Stitched, PVC Material. Ideal for training and recreational play on grass and turf.',
            price: 699,
            compare_price: 999,
            cost_price: 400,
            sku: 'SPRT-NIV-FB5',
            stock: 35,
            category_id: 5,
            brand: 'Nivia',
            weight: 0.43,
            dimensions: '22 x 22 x 22 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product11/400/400']),
            thumbnail: 'https://picsum.photos/seed/product11/400/400',
            is_featured: 0
        },
        {
            name: 'Biotique Bio Morning Nectar Flawless Lotion',
            slug: 'biotique-morning-nectar-lotion',
            description: 'Biotique Bio Morning Nectar Flawless Skin Lotion 120ml. Enriched with morning nectar, this lotion nourishes and moisturizes skin, leaving it soft and supple.',
            price: 249,
            compare_price: 299,
            cost_price: 150,
            sku: 'BEAU-BIO-MNL',
            stock: 60,
            category_id: 6,
            brand: 'Biotique',
            weight: 0.15,
            dimensions: '12 x 5 x 5 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product12/400/400']),
            thumbnail: 'https://picsum.photos/seed/product12/400/400',
            is_featured: 0
        },
        {
            name: 'Lakme Absolute Skin Dew Serum Foundation',
            slug: 'lakme-absolute-serum-foundation',
            description: 'Lakme Absolute Skin Dew Serum Foundation 35ml. Lightweight, buildable coverage with a dewy finish. SPF 20 for sun protection.',
            price: 799,
            compare_price: 950,
            cost_price: 500,
            sku: 'BEAU-LAK-FNDN',
            stock: 45,
            category_id: 6,
            brand: 'Lakme',
            weight: 0.05,
            dimensions: '10 x 4 x 4 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product13/400/400']),
            thumbnail: 'https://picsum.photos/seed/product13/400/400',
            is_featured: 1
        },
        {
            name: 'Tata Sampann Chana Dal 1kg',
            slug: 'tata-sampann-chana-dal-1kg',
            description: 'Tata Sampann Unpolished Chana Dal 1kg. Rich in protein, sourced from the finest farms. No added color or polish.',
            price: 149,
            compare_price: 180,
            cost_price: 100,
            sku: 'GROC-TAT-CD1',
            stock: 200,
            category_id: 7,
            brand: 'Tata Sampann',
            weight: 1.0,
            dimensions: '25 x 18 x 8 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product14/400/400']),
            thumbnail: 'https://picsum.photos/seed/product14/400/400',
            is_featured: 0
        },
        {
            name: 'Fortune Sunlite Refined Sunflower Oil 5L',
            slug: 'fortune-sunlite-sunflower-oil-5l',
            description: 'Fortune Sunlite Refined Sunflower Oil 5 Litre. Light and healthy cooking oil, rich in Vitamin E. Perfect for everyday cooking.',
            price: 699,
            compare_price: 810,
            cost_price: 580,
            sku: 'GROC-FOR-SFO5',
            stock: 80,
            category_id: 7,
            brand: 'Fortune',
            weight: 5.0,
            dimensions: '30 x 15 x 20 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product15/400/400']),
            thumbnail: 'https://picsum.photos/seed/product15/400/400',
            is_featured: 0
        },
        {
            name: 'LEGO Classic Creative Bricks Box',
            slug: 'lego-classic-creative-bricks',
            description: 'LEGO Classic Medium Creative Brick Box 10696. 484 pieces, vibrant colors, endless building possibilities. For ages 4-99.',
            price: 2499,
            compare_price: 3499,
            cost_price: 1800,
            sku: 'TOYS-LEG-MCB',
            stock: 15,
            category_id: 8,
            brand: 'LEGO',
            weight: 0.95,
            dimensions: '37 x 18 x 18 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product16/400/400']),
            thumbnail: 'https://picsum.photos/seed/product16/400/400',
            is_featured: 1
        },
        {
            name: 'Hot Wheels 10 Car Pack',
            slug: 'hot-wheels-10-car-pack',
            description: 'Hot Wheels 10-Car Pack of 1:64 Scale Vehicles. Exciting designs, high-quality die-cast models. Great gift for car enthusiasts of all ages.',
            price: 999,
            compare_price: 1499,
            cost_price: 600,
            sku: 'TOYS-HW-10PK',
            stock: 25,
            category_id: 8,
            brand: 'Hot Wheels',
            weight: 0.5,
            dimensions: '30 x 20 x 5 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product17/400/400']),
            thumbnail: 'https://picsum.photos/seed/product17/400/400',
            is_featured: 0
        },
        {
            name: 'Redmi 12 5G 6GB 128GB',
            slug: 'redmi-12-5g-6gb-128gb',
            description: 'Redmi 12 5G with Snapdragon 4 Gen 2, 6GB RAM, 128GB Storage, 50MP AI Dual Camera, 5000mAh Battery. Best budget 5G phone for Cooch Behar.',
            price: 11999,
            compare_price: 14999,
            cost_price: 9500,
            sku: 'ELEC-RED-12-5G',
            stock: 30,
            category_id: 1,
            brand: 'Xiaomi',
            weight: 0.20,
            dimensions: '168.6 x 76.3 x 8.2 mm',
            images: JSON.stringify(['https://picsum.photos/seed/product18/400/400', 'https://picsum.photos/seed/product18b/400/400']),
            thumbnail: 'https://picsum.photos/seed/product18/400/400',
            is_featured: 1
        },
        {
            name: 'Nike Men Revolution 6 Running Shoes',
            slug: 'nike-men-revolution-6-running-shoes',
            description: 'Nike Men Revolution 6 Running Shoes. Lightweight, breathable mesh upper, soft foam midsole. Ideal for jogging and daily wear.',
            price: 3495,
            compare_price: 4995,
            cost_price: 2200,
            sku: 'FASH-NIKE-R6',
            stock: 18,
            category_id: 2,
            brand: 'Nike',
            weight: 0.6,
            dimensions: '33 x 22 x 12 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product19/400/400']),
            thumbnail: 'https://picsum.photos/seed/product19/400/400',
            is_featured: 0
        },
        {
            name: 'Havells Pacer 1200mm Ceiling Fan',
            slug: 'havells-pacer-ceiling-fan-1200mm',
            description: 'Havells Pacer 1200mm Ceiling Fan with powerful motor, aerodynamic blades, and elegant design. Energy efficient, low noise operation. Perfect for Cooch Behar climate.',
            price: 1699,
            compare_price: 2100,
            cost_price: 1200,
            sku: 'HOME-HAV-FAN',
            stock: 22,
            category_id: 3,
            brand: 'Havells',
            weight: 4.0,
            dimensions: '120 x 120 x 35 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product20/400/400']),
            thumbnail: 'https://picsum.photos/seed/product20/400/400',
            is_featured: 0
        },
        {
            name: 'Himalaya Neem Face Wash 200ml',
            slug: 'himalaya-neem-face-wash-200ml',
            description: 'Himalaya Herbals Purifying Neem Face Wash 200ml. Soap-free, herbal formulation with Neem and Turmeric. Prevents pimples and helps clear acne.',
            price: 199,
            compare_price: 230,
            cost_price: 120,
            sku: 'BEAU-HIM-NFW',
            stock: 90,
            category_id: 6,
            brand: 'Himalaya',
            weight: 0.22,
            dimensions: '15 x 6 x 4 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product21/400/400']),
            thumbnail: 'https://picsum.photos/seed/product21/400/400',
            is_featured: 0
        },
        {
            name: 'Aashirvaad Superior MP Atta 5kg',
            slug: 'aashirvaad-superior-mp-atta-5kg',
            description: 'Aashirvaad Superior MP Atta 5kg. Made from the choicest grains from Madhya Pradesh. Soft rotis every time. 0% Maida.',
            price: 299,
            compare_price: 350,
            cost_price: 230,
            sku: 'GROC-AASH-AT5',
            stock: 150,
            category_id: 7,
            brand: 'Aashirvaad',
            weight: 5.0,
            dimensions: '35 x 25 x 10 cm',
            images: JSON.stringify(['https://picsum.photos/seed/product22/400/400']),
            thumbnail: 'https://picsum.photos/seed/product22/400/400',
            is_featured: 0
        }
    ];

    const insertProduct = db.prepare(`
        INSERT INTO products (name, slug, description, price, compare_price, cost_price, sku, stock, category_id, brand, weight, dimensions, images, thumbnail, is_featured)
        VALUES (@name, @slug, @description, @price, @compare_price, @cost_price, @sku, @stock, @category_id, @brand, @weight, @dimensions, @images, @thumbnail, @is_featured)
    `);

    for (const product of products) {
        insertProduct.run(product);
    }

    // Seed Banners
    const banners = [
        ['Diwali Mega Sale - Up to 70% Off!', 'https://picsum.photos/seed/banner1/1200/400', '/products?sort=popular', 1],
        ['New Electronics Arrivals', 'https://picsum.photos/seed/banner2/1200/400', '/category/electronics', 2],
        ['Fashion Week Special', 'https://picsum.photos/seed/banner3/1200/400', '/category/fashion', 3],
        ['Free Delivery in Cooch Behar', 'https://picsum.photos/seed/banner4/1200/400', '/products', 4],
        ['Grocery Essentials at Best Prices', 'https://picsum.photos/seed/banner5/1200/400', '/category/grocery', 5]
    ];

    const insertBanner = db.prepare(`
        INSERT INTO banners (title, image, link, position) VALUES (?, ?, ?, ?)
    `);
    for (const banner of banners) {
        insertBanner.run(...banner);
    }

    // Seed Coupons
    const coupons = [
        ['WELCOME10', 'Get 10% off on your first order', 'percentage', 10, 500, 200, 100, 0, 1, '2025-12-31'],
        ['COOCHBEHAR50', 'Flat ₹50 off on orders above ₹999', 'fixed', 50, 999, null, 200, 0, 1, '2025-06-30'],
        ['FESTIVE25', 'Festive season special - 25% off', 'percentage', 25, 1000, 500, 50, 0, 1, '2025-03-31']
    ];

    const insertCoupon = db.prepare(`
        INSERT INTO coupons (code, description, discount_type, discount_value, min_order, max_discount, usage_limit, used_count, is_active, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const coupon of coupons) {
        insertCoupon.run(...coupon);
    }

    // Seed Settings
    const settingsData = [
        ['site_name', 'CoochBehar Market'],
        ['site_description', 'Your local e-commerce platform for Cooch Behar'],
        ['currency', 'INR'],
        ['currency_symbol', '₹'],
        ['tax_rate', '18'],
        ['shipping_fee', '40'],
        ['free_shipping_threshold', '999'],
        ['min_order_amount', '100'],
        ['max_order_amount', '500000'],
        ['delivery_radius_km', '25'],
        ['contact_email', 'support@coochbehar-market.com'],
        ['contact_phone', '+91 9876543210'],
        ['contact_address', 'Main Road, Cooch Behar, West Bengal 736101'],
        ['razorpay_key', ''],
        ['razorpay_secret', ''],
        ['cod_enabled', 'true'],
        ['online_payment_enabled', 'false']
    ];

    const insertSetting = db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
    `);
    for (const setting of settingsData) {
        insertSetting.run(...setting);
    }

    // Seed some product variants
    const variants = [
        [1, '6GB/128GB - Midnight Blue', 'SAM-M34-BLUE', 16999, 12, JSON.stringify({ color: 'Midnight Blue', ram: '6GB', storage: '128GB' })],
        [1, '8GB/128GB - Prism Silver', 'SAM-M34-SILVER', 18999, 8, JSON.stringify({ color: 'Prism Silver', ram: '8GB', storage: '128GB' })],
        [4, 'Size M - White', 'AS-SHIRT-M-W', 1199, 15, JSON.stringify({ size: 'M', color: 'White' })],
        [4, 'Size L - Blue', 'AS-SHIRT-L-B', 1199, 10, JSON.stringify({ size: 'L', color: 'Blue' })],
        [4, 'Size XL - White', 'AS-SHIRT-XL-W', 1299, 8, JSON.stringify({ size: 'XL', color: 'White' })],
        [5, 'Size 28 - Dark Blue', 'LEV-JEANS-28', 2499, 10, JSON.stringify({ size: '28', color: 'Dark Blue' })],
        [5, 'Size 30 - Dark Blue', 'LEV-JEANS-30', 2499, 12, JSON.stringify({ size: '30', color: 'Dark Blue' })],
        [19, 'UK 8 - Black', 'NIKE-R6-8-BLK', 3495, 5, JSON.stringify({ size: 'UK 8', color: 'Black' })],
        [19, 'UK 9 - Black', 'NIKE-R6-9-BLK', 3495, 6, JSON.stringify({ size: 'UK 9', color: 'Black' })],
        [19, 'UK 10 - White', 'NIKE-R6-10-WHT', 3495, 4, JSON.stringify({ size: 'UK 10', color: 'White' })]
    ];

    const insertVariant = db.prepare(`
        INSERT INTO product_variants (product_id, name, sku, price, stock, attributes) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const variant of variants) {
        insertVariant.run(...variant);
    }
}

function getDb() {
    const dbPath = path.resolve(DB_PATH);
    const db = getDatabase(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
}

module.exports = { initDatabase, getDb };
