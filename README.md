# LUMINAR — AI-Powered Skincare Website

<p align="center">
  <strong>✦ LUMINAR</strong><br>
  Discover Your Perfect Glow with AI-Powered Skincare
</p>

---

## 🌟 Features

- **Skin Type Quiz** — 10-question scoring algorithm determines your skin type with up to 99% accuracy
- **AI Skincare Assistant** — Powered by OpenAI GPT-4o for personalized product recommendations and skincare advice
- **Face Image Analysis** — Upload a face photo for AI-powered skin condition detection
- **Product Catalog** — 50+ skincare products from 12 brands, filterable by skin type, category, brand
- **Personalized Recommendations** — Products matched to your unique skin type and concerns
- **Full E-Commerce** — Cart, checkout, payment (Credit Card/UPI/Net Banking/COD), order tracking
- **Reviews & Ratings** — Customer reviews with star ratings and rating distribution
- **User Profiles** — Dashboard with skin profile, order history, and review history

## 🗃️ Database Schema (DBMS Project)

| Table | Description |
|-------|-------------|
| **Brand** | Brand_id (PK), Brand_name, Country |
| **Product** | Product_id (PK), Product_name, Category, P_Skin_type, Price, Brand_id (FK) |
| **Customer** | Cust_id (PK), Cust_name, Mail, Password_hash, C_Skin_type, City |
| **Orders** | Order_id (PK), Cust_id (FK), Order_date, tot_amt, Order_status |
| **Order_details** | Order_id (FK), Product_id (FK), Quantity, Unit_price |
| **Review** | review_id (PK), Cust_id (FK), Product_id (FK), Rating, Comment |
| **Payment** | Payment_id (PK), Order_id (FK), Payment_date, amount, Pay_method, Pay_status |
| **Cart** | Cart_id (PK), Cust_id (FK), Product_id (FK), Quantity |
| **Skin_quiz_responses** | id (PK), Cust_id (FK), responses (JSON), determined_skin_type |
| **Skin_analysis** | analysis_id (PK), Cust_id (FK), Analysis_result (JSON) |

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** MySQL
- **Frontend:** EJS Templates, Vanilla CSS/JS
- **AI:** OpenAI GPT-4o-mini (chat), GPT-4o (image analysis)
- **Auth:** bcryptjs + express-session

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- MySQL 8+
- OpenAI API Key (for AI features)

### Setup

1. **Clone the repo:**
   ```bash
   git clone https://github.com/Snigdha-s-collab/LUMINAR_dbms.git
   cd LUMINAR_dbms
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up MySQL database:**
   ```bash
   mysql -u root -p < db/schema.sql
   mysql -u root -p < db/seed.sql
   ```

4. **Configure environment:**
   Edit `.env` with your MySQL password and OpenAI API key:
   ```
   DB_PASSWORD=your_mysql_password
   OPENAI_API_KEY=your_openai_api_key
   ```

5. **Start the server:**
   ```bash
   npm start
   ```

6. **Open in browser:** [http://localhost:3000](http://localhost:3000)

## 📸 Pages

| Page | Route |
|------|-------|
| Home | `/` |
| Register | `/auth/register` |
| Login | `/auth/login` |
| Skin Quiz | `/quiz` |
| Products | `/products` |
| Product Detail | `/products/:id` |
| Cart | `/cart` |
| Checkout | `/orders/checkout` |
| My Orders | `/orders` |
| Order Detail | `/orders/:id` |
| AI Assistant | `/assistant` |
| My Profile | `/profile` |

---

**DBMS Project** | Built with ❤️