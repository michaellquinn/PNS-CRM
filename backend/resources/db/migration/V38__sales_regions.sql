-- One region per salesperson (Michael, 2026-10-02). A deal's region follows its Sales
-- PIC. Sales CRM sends no region, so the sync stamped every import "GJ" and a person
-- like Dandy ended up in GJ and EJ at once. Keyed on the name as the tickets carry it
-- (Sales CRM's opportunity Owner), because most salespeople are not registered users.
CREATE TABLE sales_regions (
    sales_name VARCHAR(255) NOT NULL,
    region     VARCHAR(10)  NOT NULL,
    updated_by VARCHAR(255) NULL,
    updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (sales_name)
) DEFAULT CHARSET=utf8mb4;
