-- ============================================
-- LUMINAR Skincare Database Schema
-- DBMS Project — Full Relational Schema
-- ============================================

CREATE DATABASE IF NOT EXISTS luminar_db;
USE luminar_db;

-- ============================================
-- 1. Brand Table
-- ============================================
CREATE TABLE IF NOT EXISTS Brand (
    Brand_id INT AUTO_INCREMENT PRIMARY KEY,
    Brand_name VARCHAR(100) NOT NULL,
    Country VARCHAR(60) NOT NULL
);

-- ============================================
-- 2. Product Table
-- ============================================
CREATE TABLE IF NOT EXISTS Product (
    Product_id INT AUTO_INCREMENT PRIMARY KEY,
    Product_name VARCHAR(200) NOT NULL,
    Category VARCHAR(60) NOT NULL,
    P_Skin_type VARCHAR(60) NOT NULL,
    Price DECIMAL(10, 2) NOT NULL,
    Brand_id INT NOT NULL,
    Description TEXT,
    Image_url VARCHAR(500) DEFAULT '/images/default-product.png',
    Ingredients TEXT,
    How_to_use TEXT,
    FOREIGN KEY (Brand_id) REFERENCES Brand(Brand_id) ON DELETE CASCADE
);

-- ============================================
-- 3. Customer Table
-- ============================================
CREATE TABLE IF NOT EXISTS Customer (
    Cust_id INT AUTO_INCREMENT PRIMARY KEY,
    Cust_name VARCHAR(100) NOT NULL,
    Mail VARCHAR(150) NOT NULL UNIQUE,
    Password_hash VARCHAR(255) NOT NULL,
    C_Skin_type VARCHAR(60) DEFAULT NULL,
    City VARCHAR(100),
    Phone VARCHAR(20),
    Skin_concerns TEXT,
    Profile_image VARCHAR(500) DEFAULT '/images/default-avatar.png',
    Created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 4. Orders Table
-- ============================================
CREATE TABLE IF NOT EXISTS Orders (
    Order_id INT AUTO_INCREMENT PRIMARY KEY,
    Cust_id INT NOT NULL,
    Order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tot_amt DECIMAL(10, 2) NOT NULL,
    Order_status ENUM('Processing', 'Confirmed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled') DEFAULT 'Processing',
    Shipping_address TEXT,
    Tracking_number VARCHAR(100),
    FOREIGN KEY (Cust_id) REFERENCES Customer(Cust_id) ON DELETE CASCADE
);

-- ============================================
-- 5. Order_details Table
-- ============================================
CREATE TABLE IF NOT EXISTS Order_details (
    Order_id INT NOT NULL,
    Product_id INT NOT NULL,
    Quantity INT NOT NULL DEFAULT 1,
    Unit_price DECIMAL(10, 2) NOT NULL,
    PRIMARY KEY (Order_id, Product_id),
    FOREIGN KEY (Order_id) REFERENCES Orders(Order_id) ON DELETE CASCADE,
    FOREIGN KEY (Product_id) REFERENCES Product(Product_id) ON DELETE CASCADE
);

-- ============================================
-- 6. Review Table
-- ============================================
CREATE TABLE IF NOT EXISTS Review (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    Cust_id INT NOT NULL,
    Product_id INT NOT NULL,
    Rating INT NOT NULL CHECK (Rating >= 1 AND Rating <= 5),
    Comment TEXT,
    Created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Cust_id) REFERENCES Customer(Cust_id) ON DELETE CASCADE,
    FOREIGN KEY (Product_id) REFERENCES Product(Product_id) ON DELETE CASCADE
);

-- ============================================
-- 7. Payment Table
-- ============================================
CREATE TABLE IF NOT EXISTS Payment (
    Payment_id INT AUTO_INCREMENT PRIMARY KEY,
    Order_id INT NOT NULL,
    Payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    amount DECIMAL(10, 2) NOT NULL,
    Pay_method ENUM('Credit Card', 'Debit Card', 'UPI', 'Net Banking', 'Cash on Delivery') NOT NULL,
    Pay_status ENUM('Pending', 'Processing', 'Completed', 'Failed', 'Refunded') DEFAULT 'Pending',
    Transaction_id VARCHAR(100),
    FOREIGN KEY (Order_id) REFERENCES Orders(Order_id) ON DELETE CASCADE
);

-- ============================================
-- 8. Skin Quiz Responses Table
-- ============================================
CREATE TABLE IF NOT EXISTS Skin_quiz_responses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    Cust_id INT NOT NULL,
    responses JSON,
    determined_skin_type VARCHAR(60),
    match_percentage DECIMAL(5, 2),
    Created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Cust_id) REFERENCES Customer(Cust_id) ON DELETE CASCADE
);

-- ============================================
-- 9. Cart Table (Session-based shopping cart)
-- ============================================
CREATE TABLE IF NOT EXISTS Cart (
    Cart_id INT AUTO_INCREMENT PRIMARY KEY,
    Cust_id INT NOT NULL,
    Product_id INT NOT NULL,
    Quantity INT NOT NULL DEFAULT 1,
    Added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Cust_id) REFERENCES Customer(Cust_id) ON DELETE CASCADE,
    FOREIGN KEY (Product_id) REFERENCES Product(Product_id) ON DELETE CASCADE,
    UNIQUE KEY unique_cart_item (Cust_id, Product_id)
);

-- ============================================
-- 10. Skin Analysis Log (Face image analysis)
-- ============================================
CREATE TABLE IF NOT EXISTS Skin_analysis (
    analysis_id INT AUTO_INCREMENT PRIMARY KEY,
    Cust_id INT NOT NULL,
    Image_path VARCHAR(500),
    Analysis_result JSON,
    Detected_conditions TEXT,
    Recommendations TEXT,
    Created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Cust_id) REFERENCES Customer(Cust_id) ON DELETE CASCADE
);

-- ============================================
-- Indexes for performance
-- ============================================
CREATE INDEX idx_product_skin_type ON Product(P_Skin_type);
CREATE INDEX idx_product_category ON Product(Category);
CREATE INDEX idx_product_brand ON Product(Brand_id);
CREATE INDEX idx_orders_customer ON Orders(Cust_id);
CREATE INDEX idx_review_product ON Review(Product_id);
CREATE INDEX idx_payment_order ON Payment(Order_id);
