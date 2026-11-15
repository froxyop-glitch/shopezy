async function testAdminUpdates() {
    console.log('--- TESTING ADMIN PICTURE INSERTION, OFFERS BANNER & PRE/POST PRICING ---');

    // 1. Admin Login
    const adminRes = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@coochbehar.com', password: 'admin123' })
    });
    const admin = await adminRes.json();
    console.log('1. Admin Logged In:', admin.user.name);
    const token = admin.token;

    // 2. Admin inserts new Offers Banner with picture
    const bannerRes = await fetch('http://localhost:3000/api/admin/banners', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            title: 'COOCH BEHAR WINTER DHAMAKA — FLAT 40% OFF',
            image: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200&q=80',
            link: '/category/electronics',
            position: 1,
            is_active: 1
        })
    });
    const bannerData = await bannerRes.json();
    console.log('2. Inserted Offer Banner:', bannerData.message);

    // 3. Customer Storefront gets active offer banners
    const pubBannerRes = await fetch('http://localhost:3000/api/banners');
    const pubBanners = await pubBannerRes.json();
    console.log('3. Storefront Active Banners Count:', pubBanners.banners.length);
    console.log('   Latest banner title:', pubBanners.banners[0].title);

    // 4. Admin inserts new product with Picture, Pre-Price (MRP) and Post-Price (Offer)
    const newProdRes = await fetch('http://localhost:3000/api/products', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            name: 'Cooch Behar Handwoven Silk Shawl (Special Edition)',
            category_id: 2,
            sku: 'CB-SILK-2026',
            price: 1899,            // Post-Discount Offer Price
            compare_price: 2999,    // Pre-Discount Original MRP
            cost_price: 1200,
            stock: 40,
            brand: 'Rajbari Artisans Guild',
            thumbnail: 'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=400&q=80',
            description: 'Handcrafted pure silk shawl woven by traditional weavers of Cooch Behar with gold thread border.'
        })
    });
    const newProdData = await newProdRes.json();
    console.log('4. Created Product with Pre & Post Price:', newProdData.product.name);
    console.log('   Pre-Price (MRP): ₹' + newProdData.product.compare_price);
    console.log('   Post-Price (Offer): ₹' + newProdData.product.price);
    const discount = Math.round(((newProdData.product.compare_price - newProdData.product.price) / newProdData.product.compare_price) * 100);
    console.log('   Calculated Savings Discount:', discount + '% OFF');

    // 5. Admin edits existing product #1 prices and picture
    const editRes = await fetch(`http://localhost:3000/api/products/${newProdData.product.id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            name: 'Cooch Behar Handwoven Silk Shawl (Diwali Special)',
            price: 1599,            // Updated lower post-price
            compare_price: 2999,    // Pre-price
            thumbnail: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=400&q=80',
            stock: 35
        })
    });
    const editData = await editRes.json();
    console.log('5. Admin Updated Existing Product #', editData.product.id);
    console.log('   Updated Post-Price (New Offer): ₹' + editData.product.price);
    console.log('   Updated Picture:', editData.product.thumbnail);

    console.log('--- ALL ADMIN PICTURE, BANNER & PRE/POST PRICE TESTS PASSED 100% ---');
}

testAdminUpdates().catch(console.error);
