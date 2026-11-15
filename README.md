# 🛍️ Shopezy — Enterprise Full-Stack E-Commerce Platform

A production-ready, fully functional e-commerce platform named **Shopezy**, designed for seamless online shopping inspired by Flipkart and Amazon, serving **Cooch Behar, West Bengal**. 

It includes a **Customer Storefront**, an **Admin Control Panel**, and a **Dedicated Delivery Boy (Rider) App** with real-time **Cooch Behar Map Tracking** (Leaflet & OpenStreetMap).

---

## 🌟 Key Features

### 🛒 1. Customer Storefront (`/`)
- **Flipkart/Amazon Experience**: Sticky search bar, category navigation bar, deal sliders, product cards with discount badges.
- **Product Catalog**: Over 22 pre-seeded products across Electronics, Fashion, Home & Kitchen, Books, Groceries, Local Cooch Behar Specials (Handloom, Terai tea), etc.
- **Dynamic Cart & Checkout**: Real-time price breakdown (Subtotal, GST, Delivery Fee, Coupons).
- **Address & Landmarks**: Pre-configured with Cooch Behar localities (Rajbari, Sagardighi, Dinhata, Tufanganj, Mathabhanga, Mekhliganj, Baneswar, Khagrabari).
- **Live Order Tracking**: Visual progress timeline (*Placed ➔ Confirmed ➔ Shipped ➔ Out for Delivery ➔ Delivered*) with interactive delivery map.
- **Customer Reviews**: Star rating system (1-5 stars), verified review submission, and admin review replies.
- **Profile & Password Management**: Customers can update personal details and **change their account password** directly from their profile.

### 👑 2. Admin Control Panel (`/admin.html`)
- **Executive Analytics**: Total revenue, order count, active products, delivery fleet count, and sales charts.
- **Product Management**: Create, edit, and delete catalog items with stock alerts and image upload support.
- **Order Dispatch & Assignment**: View all incoming customer orders, update statuses, and **assign delivery boys** with one click.
- **Customer Reviews Moderation**: View all customer feedback, approve/hide reviews, and post official store replies.
- **Delivery Fleet & Cooch Behar Map**: View active drivers pinned across Cooch Behar locations. Add new delivery boys.
- **Customer Management**: View registered customers, total spend, and activate/block accounts.
- **Coupons & Promotions**: Create percentage or flat discounts with minimum order thresholds.
- **Admin Password Management**: Dedicated security tab to securely **change the Admin password**.

### 🛵 3. Delivery Boy / Driver Panel (`/driver.html`)
- **Mobile-First Rider Experience**: Designed for delivery boys on two-wheelers across Cooch Behar.
- **Shift Status Toggle**: Switch between *ON DUTY* and *OFFLINE*.
- **Assigned Orders**: Instant alerts for assigned orders, customer name, delivery address, and one-tap **Call Customer** button.
- **Payment Verification**: Clear display of Cash on Delivery (COD amount to collect) or Prepaid status.
- **Interactive Cooch Behar Map**:
  - Centered on Cooch Behar (Latitude: `26.3239° N`, Longitude: `89.4510° E`).
  - Displays Central Warehouse Hub at Khagrabari and landmark destinations.
  - Interactive route preview and simulated GPS navigation along Cooch Behar roads.
- **Status Updates**: One-tap buttons for *Start Delivery (Out for Delivery)* and *Mark Delivered*.
- **Driver Password Management**: Riders can **change their own account password** directly from their profile tab.

---

## 🔑 Pre-Configured Accounts for Instant Testing

| Role | Email | Default Password | Panel URL |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `admin@coochbehar.com` | `admin123` | [`http://localhost:3000/admin.html`](http://localhost:3000/admin.html) |
| **Delivery Rider** | `raju@delivery.com` | `delivery123` | [`http://localhost:3000/driver.html`](http://localhost:3000/driver.html) |
| **Customer** | `anita@example.com` | `customer123` | [`http://localhost:3000/`](http://localhost:3000/) |

> 🔒 **Password Changing**: Every role (Admin, Customer, Delivery Driver) can change their password inside their respective panel!

---

## 🚀 Quick Start & Running the Project

### 1. Requirements
- Node.js (v18 or higher)
- npm

### 2. Start the Server
```bash
cd "C:\Users\Service PC\.gemini\antigravity\scratch\coochbehar-ecommerce"
npm start
```

### 3. Open in Browser
- **Customer Storefront**: [http://localhost:3000](http://localhost:3000)
- **Admin Dashboard**: [http://localhost:3000/admin.html](http://localhost:3000/admin.html)
- **Delivery Partner App**: [http://localhost:3000/driver.html](http://localhost:3000/driver.html)

---

## 🗺️ Cooch Behar Map Landmarks Integrated

The Leaflet & OpenStreetMap module includes pre-configured coordinates for major Cooch Behar hubs:
- **Central Dispatch Hub (Khagrabari Junction)**: `26.3350, 89.4350`
- **Cooch Behar Rajbari (Palace Gate)**: `26.3242, 89.4447`
- **Sagardighi & District Collectorate**: `26.3218, 89.4495`
- **Madan Mohan Temple (Ward 6)**: `26.3210, 89.4475`
- **New Cooch Behar Railway Station**: `26.3475, 89.4670`
- **Baneswar Shiva Temple**: `26.3980, 89.4970`
- **Dinhata Town Market**: `26.1302, 89.4627`
- **Tufanganj Chowpathi**: `26.3150, 89.6730`
- **Mathabhanga Sub-division**: `26.3385, 89.2173`

---

## 📁 Project Architecture

```
coochbehar-ecommerce/
├── server.js               # Express server, route orchestration, static file server
├── package.json            # Project dependencies & scripts
├── .env                    # Environment variables (JWT secret, ports, DB path)
├── database/
│   ├── init.js             # Table schemas, relational constraints, sample seeds
│   └── sqliteAdapter.js    # Synchronous SQLite engine (sql.js Wasm) with auto-save
├── middleware/
│   └── auth.js             # JWT authentication, role guards (Customer, Admin, Driver)
├── routes/
│   ├── auth.js             # Signup, login, profile, change password
│   ├── products.js         # Product listing, search, category filters, CRUD
│   ├── categories.js       # Product categories API
│   ├── cart.js             # Cart management, coupons calculation
│   ├── orders.js           # Order creation, order history, public tracking
│   ├── reviews.js          # Customer reviews submission, admin moderation
│   ├── delivery.js         # Driver assigned orders, GPS tracking, rider password
│   ├── admin.js            # Admin analytics, driver assignment, customer management
│   └── customers.js        # Customer wishlists and notifications
├── public/
│   ├── index.html          # Flipkart/Amazon style responsive customer SPA
│   ├── admin.html          # Full-featured Admin management console
│   └── driver.html         # Mobile delivery boy dispatch & Cooch Behar map app
└── test_e2e.js             # Automated 11-step end-to-end integration test
```

---

## 🚢 Production Deployment

### Option A: Node Process Manager (PM2 on Linux/Windows VPS)
```bash
npm install -g pm2
pm2 start server.js --name "coochbehar-ecommerce"
pm2 save
```

### Option B: Cloud Hosting (Render / Railway / DigitalOcean)
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Port**: Set `PORT=3000` (or host assigned `$PORT`)
