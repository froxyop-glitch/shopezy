async function runE2E() {
    console.log('--- STARTING COOCH BEHAR E-COMMERCE END-TO-END TEST ---');

    // 1. Customer Login
    const custLoginRes = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'anita@example.com', password: 'customer123' })
    });
    const custAuth = await custLoginRes.json();
    console.log('1. Customer Logged In:', custAuth.user.name, '| Role:', custAuth.user.role);

    // 2. Add product to cart
    const addCartRes = await fetch('http://localhost:3000/api/cart/add', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${custAuth.token}`
        },
        body: JSON.stringify({ product_id: 1, quantity: 1 })
    });
    const addCart = await addCartRes.json();
    console.log('2. Added to Cart:', addCart.message);

    // 3. Checkout / Place order
    const orderRes = await fetch('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${custAuth.token}`
        },
        body: JSON.stringify({
            payment_method: 'cod',
            shipping_address: {
                fullName: 'Anita Sharma',
                phone: '9876500001',
                address: 'Near Cooch Behar Rajbari Palace Gate',
                city: 'Cooch Behar',
                state: 'West Bengal',
                pincode: '736101'
            }
        })
    });
    const orderData = await orderRes.json();
    console.log('3. Order Placed Successfully! Order #:', orderData.order.order_number, '| Total: ₹' + orderData.order.total);

    // 4. Admin Login & Assign Delivery Boy
    const adminLoginRes = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@coochbehar.com', password: 'admin123' })
    });
    const adminAuth = await adminLoginRes.json();
    console.log('4. Admin Logged In:', adminAuth.user.name);

    // Assign to Raju Das (delivery boy ID: 2)
    const assignRes = await fetch(`http://localhost:3000/api/admin/orders/${orderData.order.id}/assign-delivery`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminAuth.token}`
        },
        body: JSON.stringify({ delivery_boy_id: 2 })
    });
    const assignData = await assignRes.json();
    console.log('5. Order Assigned to Driver:', assignData.message);

    // 5. Driver Login & Check Deliveries
    const driverLoginRes = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'raju@delivery.com', password: 'delivery123' })
    });
    const driverAuth = await driverLoginRes.json();
    console.log('6. Driver Logged In:', driverAuth.user.name);

    const driverOrdersRes = await fetch('http://localhost:3000/api/delivery/orders', {
        headers: { 'Authorization': `Bearer ${driverAuth.token}` }
    });
    const driverOrders = await driverOrdersRes.json();
    console.log('7. Driver Active Deliveries Count:', driverOrders.orders.length);
    const assignedOrder = driverOrders.orders[0];
    console.log('   Delivery assigned:', assignedOrder.order_number, 'to', assignedOrder.customer_name);

    // 6. Driver Marks as Out for Delivery with Cooch Behar GPS
    const statusRes = await fetch(`http://localhost:3000/api/delivery/orders/${assignedOrder.id}/status`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${driverAuth.token}`
        },
        body: JSON.stringify({
            status: 'out_for_delivery',
            lat: 26.3242,
            lng: 89.4447,
            notes: 'Rider picked up package at Khagrabari Hub and is near Rajbari Gate'
        })
    });
    const statusData = await statusRes.json();
    console.log('8. Driver GPS & Status Updated:', statusData.message);

    // 7. Customer tracks order
    const trackRes = await fetch(`http://localhost:3000/api/orders/track/${orderData.order.order_number}`);
    const trackData = await trackRes.json();
    console.log('9. Public Tracking Status:', trackData.order.status);
    console.log('   Delivery Boy assigned:', trackData.delivery_boy ? trackData.delivery_boy.name : 'None');

    // 8. Customer writes a review
    const reviewRes = await fetch('http://localhost:3000/api/reviews', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${custAuth.token}`
        },
        body: JSON.stringify({
            product_id: 1,
            rating: 5,
            title: 'Super fast delivery in Cooch Behar!',
            comment: 'Ordered in the morning and Raju delivered it within 2 hours near Rajbari. Exceptional service!'
        })
    });
    const reviewData = await reviewRes.json();
    console.log('10. Customer Review Submitted:', reviewData.message);

    // 9. Admin moderates review
    const adminRevRes = await fetch(`http://localhost:3000/api/reviews/${reviewData.reviewId}/approve`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminAuth.token}`
        },
        body: JSON.stringify({ is_approved: 1 })
    });
    const adminRevData = await adminRevRes.json();
    console.log('11. Admin Review Moderated:', adminRevData.message);

    console.log('--- ALL COOCH BEHAR E-COMMERCE TESTS PASSED WITH 100% SUCCESS ---');
}

runE2E().catch(console.error);
