import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 3000;

const SECRET =
  process.env.JWT_SECRET ||
  "STYLE_MANIA_CHANGE_THIS_SECRET";

/* =====================================================
   PATHS
===================================================== */

const ROOT = __dirname;

const DATA = path.join(ROOT, "data.json");

const PUBLIC = path.join(ROOT, "public");

const UPLOADS = path.join(PUBLIC, "uploads");

fs.mkdirSync(PUBLIC, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

/* =====================================================
   DATABASE
===================================================== */

function createDatabase() {
  return {
    admins: [],
    products: [],
    orders: [],
    discounts: []
  };
}

if (!fs.existsSync(DATA)) {
  fs.writeFileSync(
    DATA,
    JSON.stringify(createDatabase(), null, 2)
  );
}

function readDB() {
  try {
    const data = JSON.parse(
      fs.readFileSync(DATA, "utf8")
    );

    if (!Array.isArray(data.admins)) data.admins = [];
    if (!Array.isArray(data.products)) data.products = [];
    if (!Array.isArray(data.orders)) data.orders = [];
    if (!Array.isArray(data.discounts)) data.discounts = [];

    return data;
  } catch (error) {
    console.error("Database read error:", error);
    return createDatabase();
  }
}

function writeDB(data) {
  fs.writeFileSync(
    DATA,
    JSON.stringify(data, null, 2)
  );
}

let db = readDB();

/* =====================================================
   ADMIN
===================================================== */

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL ||
  "admin@stylemania.local";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  "ChangeMe123!";

if (db.admins.length === 0) {
  db.admins.push({
    id: "admin-1",
    email: ADMIN_EMAIL,
    password_hash: bcrypt.hashSync(
      ADMIN_PASSWORD,
      12
    )
  });

  writeDB(db);

  console.log("");
  console.log("=================================");
  console.log("STYLE MANIA ADMIN");
  console.log("Email:", ADMIN_EMAIL);
  console.log("Password:", ADMIN_PASSWORD);
  console.log("=================================");
  console.log("");
}

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(
  express.json({
    limit: "10mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(cookieParser());

/* =====================================================
   HELPERS
===================================================== */

function newId() {
  return (
    Date.now().toString(36) +
    Math.random()
      .toString(36)
      .substring(2, 10)
  );
}

function productStatus(stock, lowStock) {
  stock = Number(stock) || 0;
  lowStock = Number(lowStock) || 5;

  if (stock <= 0) return "sold_out";

  if (stock <= lowStock) {
    return "low_stock";
  }

  return "active";
}

/* =====================================================
   AUTH
===================================================== */

function requireAdmin(req, res, next) {
  try {
    const token = req.cookies.sm_admin;

    if (!token) {
      return res.status(401).json({
        error: "Authentication required"
      });
    }

    req.admin = jwt.verify(
      token,
      SECRET
    );

    next();
  } catch (error) {
    return res.status(401).json({
      error: "Authentication required"
    });
  }
}

/* =====================================================
   HEALTH
===================================================== */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    server: "Style Mania",
    time: new Date().toISOString()
  });
});

/* =====================================================
   ADMIN LOGIN
===================================================== */

app.post("/api/admin/login", (req, res) => {
  try {
    const email = String(
      req.body?.email || ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      req.body?.password || ""
    );

    const admin = db.admins.find(
      item =>
        String(item.email || "")
          .toLowerCase() === email
    );

    if (
      !admin ||
      !bcrypt.compareSync(
        password,
        admin.password_hash
      )
    ) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email
      },
      SECRET,
      {
        expiresIn: "8h"
      }
    );

    res.cookie(
      "sm_admin",
      token,
      {
        httpOnly: true,
        sameSite: "lax",
        secure:
          process.env.NODE_ENV === "production",
        maxAge:
          8 * 60 * 60 * 1000
      }
    );

    res.json({
      ok: true,
      email: admin.email
    });
  } catch (error) {
    console.error(
      "Login error:",
      error
    );

    res.status(500).json({
      error: "Login failed"
    });
  }
});

/* =====================================================
   LOGOUT
===================================================== */

app.post(
  "/api/admin/logout",
  (req, res) => {
    res.clearCookie("sm_admin");

    res.json({
      ok: true
    });
  }
);

/* =====================================================
   ADMIN ME
===================================================== */

app.get(
  "/api/admin/me",
  requireAdmin,
  (req, res) => {
    res.json({
      ok: true,
      email: req.admin.email
    });
  }
);

/* =====================================================
   DASHBOARD
===================================================== */

app.get(
  "/api/dashboard",
  requireAdmin,
  (req, res) => {
    const revenue =
      db.orders
        .filter(
          order =>
            order.payment_status ===
            "paid"
        )
        .reduce(
          (total, order) =>
            total +
            Number(order.total || 0),
          0
        );

    res.json({
      products:
        db.products.length,

      low:
        db.products.filter(
          product =>
            Number(product.stock) > 0 &&
            Number(product.stock) <=
              Number(
                product.low_stock || 5
              )
        ).length,

      sold:
        db.products.filter(
          product =>
            Number(product.stock) <= 0
        ).length,

      orders:
        db.orders.length,

      revenue
    });
  }
);

/* =====================================================
   PRODUCTS
===================================================== */

app.get(
  "/api/products",
  (req, res) => {
    const search =
      String(req.query.q || "")
        .trim()
        .toLowerCase();

    let products = db.products;

    if (search) {
      products =
        products.filter(product => {
          const text = [
            product.name,
            product.sku,
            product.vehicle,
            product.series,
            product.category,
            product.description
          ]
            .join(" ")
            .toLowerCase();

          return text.includes(search);
        });
    }

    res.json(products);
  }
);

/* =====================================================
   CREATE PRODUCT
===================================================== */

app.post(
  "/api/products",
  requireAdmin,
  (req, res) => {
    try {
      const data = req.body || {};

      if (
        !data.name ||
        data.price === undefined
      ) {
        return res.status(400).json({
          error:
            "Product name and price are required"
        });
      }

      const sku =
        String(data.sku || "").trim();

      if (
        sku &&
        db.products.some(
          product =>
            String(
              product.sku || ""
            )
              .toLowerCase() ===
            sku.toLowerCase()
        )
      ) {
        return res.status(400).json({
          error:
            "SKU already exists"
        });
      }

      const stock = Math.max(
        0,
        Number(data.stock) || 0
      );

      const lowStock = Math.max(
        0,
        Number(data.low_stock) || 5
      );

      const product = {
        id: newId(),

        name:
          String(data.name).trim(),

        sku,

        vehicle:
          String(
            data.vehicle || ""
          ).trim(),

        category:
          String(
            data.category ||
              "Custom"
          ).trim(),

        description:
          String(
            data.description || ""
          ).trim(),

        price:
          Number(data.price) || 0,

        stock,

        low_stock:
          lowStock,

        series:
          String(
            data.series || ""
          ).trim(),

        status:
          productStatus(
            stock,
            lowStock
          ),

        image:
          String(
            data.image || ""
          ).trim(),

        created_at:
          new Date().toISOString()
      };

      db.products.unshift(product);

      writeDB(db);

      res.status(201).json(product);
    } catch (error) {
      console.error(
        "Create product error:",
        error
      );

      res.status(500).json({
        error:
          "Could not create product"
      });
    }
  }
);

/* =====================================================
   UPDATE PRODUCT
===================================================== */

app.put(
  "/api/products/:id",
  requireAdmin,
  (req, res) => {
    try {
      const product =
        db.products.find(
          item =>
            item.id ===
            req.params.id
        );

      if (!product) {
        return res.status(404).json({
          error:
            "Product not found"
        });
      }

      Object.assign(
        product,
        req.body
      );

      product.price =
        Number(product.price) || 0;

      product.stock =
        Math.max(
          0,
          Number(product.stock) || 0
        );

      product.low_stock =
        Math.max(
          0,
          Number(
            product.low_stock
          ) || 5
        );

      product.status =
        productStatus(
          product.stock,
          product.low_stock
        );

      writeDB(db);

      res.json(product);
    } catch (error) {
      console.error(
        "Update product error:",
        error
      );

      res.status(500).json({
        error:
          "Could not update product"
      });
    }
  }
);

/* =====================================================
   DELETE PRODUCT
===================================================== */

app.delete(
  "/api/products/:id",
  requireAdmin,
  (req, res) => {
    const product =
      db.products.find(
        item =>
          item.id ===
          req.params.id
      );

    if (!product) {
      return res.status(404).json({
        error:
          "Product not found"
      });
    }

    db.products =
      db.products.filter(
        item =>
          item.id !==
          req.params.id
      );

    writeDB(db);

    res.status(204).end();
  }
);

/* =====================================================
   IMAGE UPLOAD
===================================================== */

const upload = multer({
  dest: UPLOADS
});

app.post(
  "/api/upload",
  requireAdmin,
  upload.single("image"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error:
          "No image uploaded"
      });
    }

    res.json({
      ok: true,
      url:
        "/uploads/" +
        req.file.filename
    });
  }
);

/* =====================================================
   ORDERS
===================================================== */

app.post(
  "/api/orders",
  (req, res) => {
    try {
      const {
        customer,
        items
      } = req.body || {};

      if (
        !customer ||
        !customer.name ||
        !customer.email ||
        !customer.phone ||
        !customer.address
      ) {
        return res.status(400).json({
          error:
            "Customer details are required"
        });
      }

      if (
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return res.status(400).json({
          error:
            "Your cart is empty"
        });
      }

      let total = 0;

      const orderItems = [];

      for (
        const cartItem of items
      ) {
        const product =
          db.products.find(
            item =>
              item.id ===
              cartItem.id
          );

        if (!product) {
          return res.status(400).json({
            error:
              "A product in your cart is no longer available"
          });
        }

        const quantity =
          Math.max(
            1,
            Number(
              cartItem.qty
            ) || 1
          );

        if (
          Number(product.stock) <
          quantity
        ) {
          return res.status(400).json({
            error:
              "Not enough stock for " +
              product.name
          });
        }

        const price =
          Number(product.price) || 0;

        total +=
          price * quantity;

        orderItems.push({
          product_id:
            product.id,

          name:
            product.name,

          sku:
            product.sku || "",

          price,

          quantity
        });
      }

      for (
        const item of orderItems
      ) {
        const product =
          db.products.find(
            p =>
              p.id ===
              item.product_id
          );

        if (!product) continue;

        product.stock =
          Math.max(
            0,
            Number(
              product.stock
            ) -
            Number(
              item.quantity
            )
          );

        product.status =
          productStatus(
            product.stock,
            product.low_stock
          );
      }

      const order = {
        id: newId(),

        order_number:
          "SM-" +
          Date.now()
            .toString()
            .slice(-8),

        customer: {
          name:
            String(
              customer.name
            ).trim(),

          email:
            String(
              customer.email
            ).trim(),

          phone:
            String(
              customer.phone
            ).trim(),

          address:
            String(
              customer.address
            ).trim()
        },

        items:
          orderItems,

        total:
          Math.round(
            total * 100
          ) / 100,

        payment_status:
          "pending",

        order_status:
          "new",

        created_at:
          new Date().toISOString()
      };

      db.orders.unshift(order);

      writeDB(db);

      res.status(201).json({
        ok: true,
        order
      });
    } catch (error) {
      console.error(
        "ORDER ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Could not create order"
      });
    }
  }
);

/* =====================================================
   ADMIN ORDERS
===================================================== */

app.get(
  "/api/orders",
  requireAdmin,
  (req, res) => {
    res.json(db.orders);
  }
);

app.put(
  "/api/orders/:id",
  requireAdmin,
  (req, res) => {
    const order =
      db.orders.find(
        item =>
          item.id ===
          req.params.id
      );

    if (!order) {
      return res.status(404).json({
        error:
          "Order not found"
      });
    }

    if (
      req.body.order_status
    ) {
      order.order_status =
        req.body.order_status;
    }

    if (
      req.body.payment_status
    ) {
      order.payment_status =
        req.body.payment_status;
    }

    writeDB(db);

    res.json(order);
  }
);

/* =====================================================
   STATIC WEBSITE
===================================================== */

app.use(
  express.static(PUBLIC)
);

/* =====================================================
   API 404
===================================================== */

app.use(
  "/api",
  (req, res) => {
    res.status(404).json({
      error:
        "API endpoint not found"
    });
  }
);

/* =====================================================
   WEBSITE
===================================================== */

app.get(
  "*",
  (req, res) => {
    res.sendFile(
      path.join(
        PUBLIC,
        "index.html"
      )
    );
  }
);

/* =====================================================
   START
===================================================== */

app.listen(
  PORT,
  () => {
    console.log("");
    console.log(
      "================================="
    );
    console.log(
      "STYLE MANIA SERVER"
    );
    console.log(
      "Running:"
    );
    console.log(
      `http://localhost:${PORT}`
    );
    console.log(
      "Health:"
    );
    console.log(
      `http://localhost:${PORT}/api/health`
    );
    console.log(
      "================================="
    );
    console.log("");
  }
);