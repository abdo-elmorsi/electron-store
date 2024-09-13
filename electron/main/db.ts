import path from "node:path";
import betterSqlite3 from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { format } from "date-fns";

interface Result {
    lastInsertRowid: number;
}

class DatabaseManager {
    private static db: betterSqlite3.Database | null = null;

    private static getDatabasePath(): string {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        return app.isPackaged
            ? path.join(app.getPath("userData"), "databases/database.db")
            : path.join(__dirname, "../../src/db/database.db");
    }

    public static initializeDatabase(): void {
        const dbPath = this.getDatabasePath();
        try {
            this.db = betterSqlite3(dbPath);
            console.log("Connected to the database.");

            // Create tables if they do not exist
            this.createTables();
        } catch (err) {
            console.error("Could not open database:", err);
        }
    }

    private static createTables(): void {
        const queries = [
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                storeId INTEGER,
                unitId INTEGER,
                createdDate TEXT,
                expiryDate TEXT,
                description TEXT,
                FOREIGN KEY (storeId) REFERENCES stores(id),
                FOREIGN KEY (unitId) REFERENCES units(id)
            )`,
            `CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                productId INTEGER NOT NULL,
                increase INTEGER NOT NULL DEFAULT 0,
                decrease INTEGER NOT NULL DEFAULT 0,
                createdAt TEXT NOT NULL,
                FOREIGN KEY (productId) REFERENCES products(id)
            )`,
            `CREATE TABLE IF NOT EXISTS stores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS units (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL
            )`,
        ];

        queries.forEach((query) => {
            this.db?.exec(query);
        });
    }

    private static prepareStatement(
        query: string
    ): betterSqlite3.Statement | undefined {
        try {
            return this.db?.prepare(query);
        } catch (err) {
            console.error("Error preparing statement:", err);
            throw err;
        }
    }

    // ******************** Users ********************
    public static getUsers(): any[] {
        const query = "SELECT * FROM users";
        return this.executeQuery(query);
    }

    public static addUser(
        username: string,
        password: string,
        role: string
    ): { id?: number; username: string; role: string } {
        const stmt = this.prepareStatement(
            "INSERT INTO users (username, password, role) VALUES (?, ?, ?)"
        );
        const result = stmt?.run(username, password, role) as Result;
        return { id: result?.lastInsertRowid, username, role };
    }

    public static updateUser(
        id: number,
        username: string,
        password: string,
        role: string
    ): { id: number; username: string; role: string } {
        const stmt = this.prepareStatement(
            "UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?"
        );
        stmt?.run(username, password, role, id);
        return { id, username, role };
    }

    public static deleteUser(id: number): { success: boolean } {
        const stmt = this.prepareStatement("DELETE FROM users WHERE id = ?");
        stmt?.run(id);
        return { success: true };
    }

    // ******************** Products ********************
    public static async getProducts(endDate?: string): Promise<any[]> {
        const baseQuery = `
            SELECT 
                products.*, 
                stores.name AS storeName, 
                units.name AS unitName
            FROM 
                products
            LEFT JOIN 
                stores ON products.storeId = stores.id
            LEFT JOIN 
                units ON products.unitId = units.id
        `;

        const statement = this.prepareStatement(baseQuery);
        if (!statement) return [];

        let rows = statement.all();

        const getTransactionsForProduct = async (productId: number) => {
            try {
                const transactions = await this.getTransactions(
                    productId,
                    endDate
                );
                const totalIncrease = transactions.reduce(
                    (sum, tx) => sum + (tx.increase || 0),
                    0
                );
                const totalDecrease = transactions.reduce(
                    (sum, tx) => sum + (tx.decrease || 0),
                    0
                );
                return totalIncrease - totalDecrease;
            } catch (error) {
                console.error(
                    `Error fetching transactions for product ${productId}:`,
                    error
                );
                return 0;
            }
        };

        const productsWithBalances = await Promise.all(
            rows.map(async (product: any) => {
                const balance = await getTransactionsForProduct(product.id);
                return { ...product, balance };
            })
        );

        return productsWithBalances;
    }

    public static getProductById(productId: number): any {
        const query = `
            SELECT 
                products.*, 
                stores.name AS storeName, 
                units.name AS unitName
            FROM 
                products
            LEFT JOIN 
                stores ON products.storeId = stores.id
            LEFT JOIN 
                units ON products.unitId = units.id
            WHERE 
                products.id = ?
        `;
        const stmt = this.prepareStatement(query);
        return stmt?.get(productId) || null;
    }

    public static addProduct(
        name: string,
        storeId: number | null,
        unitId: number | null,
        createdDate: string | null,
        expiryDate: string | null,
        description: string
    ): {
        id?: number;
        name: string;
        storeId: number | null;
        unitId: number | null;
        createdDate: string | null;
        expiryDate: string | null;
        description: string;
    } {
        const stmt = this.prepareStatement(
            `INSERT INTO products (name, storeId, unitId, createdDate, expiryDate, description) VALUES (?, ?, ?, ?, ?, ?)`
        );
        const result = stmt?.run(
            name,
            storeId ?? null,
            unitId ?? null,
            createdDate ?? null,
            expiryDate ?? null,
            description
        ) as Result;
        return {
            id: result?.lastInsertRowid,
            name,
            storeId,
            unitId,
            createdDate,
            expiryDate,
            description,
        };
    }

    public static updateProduct(
        id: number,
        name: string,
        storeId: number | null,
        unitId: number | null,
        createdDate: string | null,
        expiryDate: string | null,
        description: string
    ): {
        id: number;
        name: string;
        storeId: number | null;
        unitId: number | null;
        createdDate: string | null;
        expiryDate: string | null;
        description: string;
    } {
        const stmt = this.prepareStatement(
            `UPDATE products SET name = ?, storeId = ?, unitId = ?, createdDate = ?, expiryDate = ?, description = ? WHERE id = ?`
        );
        stmt?.run(
            name,
            storeId ?? null,
            unitId ?? null,
            createdDate ?? null,
            expiryDate ?? null,
            description,
            id
        );
        return {
            id,
            name,
            storeId,
            unitId,
            createdDate,
            expiryDate,
            description,
        };
    }

    public static deleteProduct(id: number): { success: boolean } {
        const stmt = this.prepareStatement("DELETE FROM products WHERE id = ?");
        stmt?.run(id);
        return { success: true };
    }

    // ******************** Transactions ********************
    public static async getTransactions(
        productId?: number,
        endDate?: string
    ): Promise<any[]> {
        // Format endDate if provided
        endDate = endDate ? format(new Date(endDate), "yyyy-MM-dd") : undefined;

        // Base query to fetch transactions and join with product names
        let query = `
            SELECT 
                transactions.*, 
                products.name AS productName 
            FROM 
                transactions
            LEFT JOIN 
                products ON transactions.productId = products.id
        `;
        const conditions: string[] = [];
        const params: any[] = [];

        // Add productId filter if provided
        if (productId) {
            conditions.push("transactions.productId = ?");
            params.push(productId);
        }

        // If endDate is provided, fetch all transactions until this date
        if (endDate) {
            conditions.push("transactions.createdAt <= ?");
            params.push(endDate);
        }

        // Append conditions to the query if there are any
        if (conditions.length) {
            query += ` WHERE ${conditions.join(" AND ")}`;
        }

        // Sort transactions by createdAt date in descending order (latest first)
        query += " ORDER BY transactions.createdAt DESC";

        // Prepare and execute the SQL statement
        const stmt = this.prepareStatement(query);
        return stmt?.all(...params) || [];
    }

    public static addTransaction(
        productId: number,
        increase: number,
        decrease: number
    ): { id?: number; productId: number; increase: number; decrease: number } {
        const createdAt = format(new Date(), "yyyy-MM-dd");
        // const createdAt = format(subDays(new Date(), 1), "yyyy-MM-dd");

        const stmt = this.prepareStatement(
            "INSERT INTO transactions (productId, increase, decrease, createdAt) VALUES (?, ?, ?, ?)"
        );
        const result = stmt?.run(
            productId,
            increase,
            decrease,
            createdAt
        ) as Result;
        return {
            id: result?.lastInsertRowid,
            productId,
            increase,
            decrease,
        };
    }

    public static updateTransaction(
        id: number,
        increase: number,
        decrease: number
    ): {
        id: number;
        increase: number;
        decrease: number;
    } {
        const stmt = this.prepareStatement(
            "UPDATE transactions SET  increase = ?, decrease = ? WHERE id = ?"
        );
        stmt?.run(increase, decrease, id);
        return { id, increase, decrease };
    }

    public static deleteTransaction(id: number): { success: boolean } {
        const stmt = this.prepareStatement(
            "DELETE FROM transactions WHERE id = ?"
        );
        stmt?.run(id);
        return { success: true };
    }

    // ******************** Stores ********************
    public static getStores(): any[] {
        const query = "SELECT * FROM stores";
        return this.executeQuery(query);
    }

    public static addStore(
        name: string,
        description: string
    ): { id?: number; name: string; description: string } {
        const stmt = this.prepareStatement(
            "INSERT INTO stores (name, description) VALUES (?, ?)"
        );
        const result = stmt?.run(name, description) as Result;
        return { id: result?.lastInsertRowid, name, description };
    }

    public static updateStore(
        id: number,
        name: string,
        description: string
    ): { id: number; name: string; description: string } {
        const stmt = this.prepareStatement(
            "UPDATE stores SET name = ?, description = ? WHERE id = ?"
        );
        stmt?.run(name, description, id);
        return { id, name, description };
    }

    public static deleteStore(id: number): { success: boolean } {
        const stmt = this.prepareStatement("DELETE FROM stores WHERE id = ?");
        stmt?.run(id);
        return { success: true };
    }

    // ******************** Units ********************
    public static getUnits(): any[] {
        const query = "SELECT * FROM units";
        return this.executeQuery(query);
    }

    public static addUnit(
        name: string,
        description: string
    ): { id?: number; name: string; description: string } {
        const stmt = this.prepareStatement(
            "INSERT INTO units (name, description) VALUES (?, ?)"
        );
        const result = stmt?.run(name, description) as Result;
        return { id: result?.lastInsertRowid, name, description };
    }

    public static updateUnit(
        id: number,
        name: string,
        description: string
    ): { id: number; name: string; description: string } {
        const stmt = this.prepareStatement(
            "UPDATE units SET name = ?, description = ? WHERE id = ?"
        );
        stmt?.run(name, description, id);
        return { id, name, description };
    }

    public static deleteUnit(id: number): { success: boolean } {
        const stmt = this.prepareStatement("DELETE FROM units WHERE id = ?");
        stmt?.run(id);
        return { success: true };
    }

    private static executeQuery(query: string): any[] {
        try {
            const rows = this.db?.prepare(query).all();
            return rows || [];
        } catch (err) {
            console.error("Error executing query:", err);
            throw err;
        }
    }

    public static closeDatabase(): void {
        // No explicit close needed for better-sqlite3
        console.log("Database connection is closed.");
    }
}

export default DatabaseManager;
