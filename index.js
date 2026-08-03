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

const ROOT = path.join(__dirname, "..");

const DATA = path.join(
  ROOT,
  "data.json"
);

const PUBLIC = path.join(
  ROOT,
  "public"
);

const UPLOADS = path.join(
  PUBLIC,
  "uploads"
);

fs.mkdirSync(
  UPLOADS,
  { recursive: true }
);


/* =====================================================
   DATABASE
===================================================== */

function createDatabase() {

  return {
    admins: [],
    products: [],
    orders: []
  };

}


if (!fs.existsSync(DATA)) {

  fs.writeFileSync(
    DATA,
    JSON.stringify(
      createDatabase(),
      null,
      2
    )
  );

}


function readDB() {

  try {

    const raw =
      fs.readFileSync(
        DATA,
        "utf8"
      );

    const data =
      JSON.parse(raw);

    if (!Array.isArray(data.admins)) {
      data.admins = [];
    }

    if (!Array.isArray(data.products)) {
      data.products = [];
    }

    if (!Array.isArray(data.orders)) {
      data.orders = [];
    }

    return data;

  } catch (error) {

    console.error(
      "Database read error:",
      error
    );

    return createDatabase();

  }

}


function writeDB(data) {

  fs.writeFileSync(
    DATA,
    JSON.stringify(
      data,
      null,
      2
    )
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

    id:
      "admin-1",

    email:
      ADMIN_EMAIL,

    password_hash:
      bcrypt.hashSync(
        ADMIN_PASSWORD,
        12
      )

  });

  writeDB(db);

}


/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(
  express.json({
    limit: "5mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(
  cookieParser()
);


/* =====================================================
   HELPERS
===================================================== */

function newId() {

  return (
    Date.now().toString(36) +
    Math.random()
      .toString(36)
      .substring(2, 9)
  );

}


function productStatus(
  stock,
  lowStock
) {

  if (
    Number(stock) <= 0
  ) {

    return "sold_out";

  }

  if (
    Number(stock) <=
    Number(lowStock)
  ) {

    return "low_stock";

  }

  return "active";

}


/* =====================================================
   ADMIN AUTH
===================================================== */

function requireAdmin(
  req,
  res,
  next
) {

  try {

    const token =
      req.cookies.sm_admin;

    if (!token) {

      return res
        .status(401)
        .json({
          error:
            "Authentication required"
        });

    }

    req.admin =
      jwt.verify(
        token,
        SECRET
      );

    next();

  } catch (error) {

    return res
      .status(401)
      .json({
        error:
          "Authentication required"
      });

  }

}


/* =====================================================
   HEALTH CHECK
===================================================== */

app.get(
  "/api/health",
  (req, res) => {

    res.json({

      ok: true,

      server:
        "Style Mania",

      time:
        new Date()
          .toISOString()

    });

  }
);


/* =====================================================
   ADMIN LOGIN
===================================================== */

app.post(
  "/api/admin/login",
  (req, res) => {

    try {

      const email =
        String(
          req.body?.email || ""
        ).trim();

      const password =
        String(
          req.body?.password || ""
        );

      const admin =
        db.admins.find(
          item =>
            item.email ===
            email
        );

      if (
        !admin ||
        !bcrypt.compareSync(
          password,
          admin.password_hash
        )
      ) {

        return res
          .status(401)
          .json({
            error:
              "Invalid login"
          });

      }

      const token =
        jwt.sign(
          {
            id:
              admin.id,

            email:
              admin.email
          },

          SECRET,

          {
            expiresIn:
              "8h"
          }
        );

      res.cookie(
        "sm_admin",
        token,
        {
          httpOnly:
            true,

          sameSite:
            "lax",

          maxAge:
            8 *
            60 *
            60 *
            1000
        }
      );

      res.json({
        ok: true
      });

    } catch (error) {

      console.error(
        "Login error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Login failed"
        });

    }

  }
);


/* =====================================================
   LOGOUT
===================================================== */

app.post(
  "/api/admin/logout",
  (req, res) => {

    res.clearCookie(
      "sm_admin"
    );

    res.json({
      ok: true
    });

  }
);


/* =====================================================
   CURRENT ADMIN
===================================================== */

app.get(
  "/api/admin/me",
  requireAdmin,
  (req, res) => {

    res.json({

      email:
        req.admin.email

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
          (
            total,
            order
          ) => {

            return (
              total +
              Number(
                order.total || 0
              )
            );

          },
          0
        );

    res.json({

      products:
        db.products.length,

      low:
        db.products.filter(
          product =>
            Number(
              product.stock
            ) > 0 &&
            Number(
              product.stock
            ) <=
            Number(
              product.low_stock
            )
        ).length,

      sold:
        db.products.filter(
          product =>
            Number(
              product.stock
            ) <= 0
        ).length,

      orders:
        db.orders.length,

      revenue

    });

  }
);


/* =====================================================
   PRODUCTS - GET
===================================================== */

app.get(
  "/api/products",
  (req, res) => {

    const search =
      String(
        req.query.q || ""
      )
      .toLowerCase()
      .trim();

    const products =
      db.products.filter(
        product => {

          if (!search) {
            return true;
          }

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

          return text.includes(
            search
          );

        }
      );

    res.json(
      products
    );

  }
);


/* =====================================================
   PRODUCTS - CREATE
===================================================== */

app.post(
  "/api/products",
  requireAdmin,
  (req, res) => {

    try {

      const p =
        req.body || {};

      if (
        !p.name ||
        p.price === undefined ||
        p.price === null
      ) {

        return res
          .status(400)
          .json({
            error:
              "Name and price are required"
          });

      }

      const sku =
        String(
          p.sku || ""
        ).trim();

      if (
        sku &&
        db.products.some(
          product =>
            String(
              product.sku || ""
            ).toLowerCase() ===
            sku.toLowerCase()
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              "SKU already exists"
          });

      }

      const stock =
        Math.max(
          0,
          Number(
            p.stock
          ) || 0
        );

      const lowStock =
        Math.max(
          0,
          Number(
            p.low_stock
          ) || 5
        );

      const product = {

        id:
          newId(),

        name:
          String(
            p.name
          ).trim(),

        sku,

        vehicle:
          p.vehicle || "",

        category:
          p.category ||
          "Custom",

        description:
          p.description ||
          "",

        price:
          Number(
            p.price
          ),

        stock,

        low_stock:
          lowStock,

        series:
          p.series || "",

        status:
          productStatus(
            stock,
            lowStock
          ),

        image:
          p.image || "",

        created_at:
          new Date()
            .toISOString()

      };

      db.products.unshift(
        product
      );

      writeDB(db);

      res
        .status(201)
        .json(product);

    } catch (error) {

      console.error(
        "Create product error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not create product"
        });

    }

  }
);


/* =====================================================
   PRODUCTS - UPDATE
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

        return res
          .status(404)
          .json({
            error:
              "Product not found"
          });

      }

      Object.assign(
        product,
        req.body
      );

      product.price =
        Number(
          product.price
        ) || 0;

      product.stock =
        Math.max(
          0,
          Number(
            product.stock
          ) || 0
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

      res.json(
        product
      );

    } catch (error) {

      console.error(
        "Update product error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not update product"
        });

    }

  }
);


/* =====================================================
   PRODUCTS - DELETE
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

      return res
        .status(404)
        .json({
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

    res
      .status(204)
      .end();

  }
);


/* =====================================================
   IMAGE UPLOAD
===================================================== */

const upload =
  multer({
    dest:
      UPLOADS
  });


app.post(
  "/api/upload",
  requireAdmin,
  upload.single(
    "image"
  ),
  (req, res) => {

    if (!req.file) {

      return res
        .status(400)
        .json({
          error:
            "No image uploaded"
        });

    }

    res.json({

      url:
        "/uploads/" +
        req.file.filename

    });

  }
);


/* =====================================================
   CREATE ORDER
===================================================== */

app.post(
  "/api/orders",
  (req, res) => {

    try {

      const body =
        req.body || {};

      const customer =
        body.customer;

      const items =
        body.items;


      /* CUSTOMER CHECK */

      if (
        !customer ||
        !customer.name ||
        !customer.email ||
        !customer.phone ||
        !customer.address
      ) {

        return res
          .status(400)
          .json({
            error:
              "Customer details are required"
          });

      }


      /* CART CHECK */

      if (
        !Array.isArray(items) ||
        items.length === 0
      ) {

        return res
          .status(400)
          .json({
            error:
              "Your cart is empty"
          });

      }


      let total = 0;

      const orderItems = [];


      /* CHECK STOCK */

      for (
        const cartItem
        of items
      ) {

        const product =
          db.products.find(
            item =>
              item.id ===
              cartItem.id
          );

        if (!product) {

          return res
            .status(400)
            .json({
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
          Number(
            product.stock
          ) < quantity
        ) {

          return res
            .status(400)
            .json({
              error:
                "Not enough stock for " +
                product.name
            });

        }


        const price =
          Number(
            product.price
          ) || 0;


        total +=
          price *
          quantity;


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


      /* REDUCE STOCK */

      for (
        const item
        of orderItems
      ) {

        const product =
          db.products.find(
            productItem =>
              productItem.id ===
              item.product_id
          );

        if (!product) {
          continue;
        }

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


      /* ORDER NUMBER */

      const orderNumber =
        "SM-" +
        Date.now()
          .toString()
          .slice(-8);


      /* ORDER */

      const order = {

        id:
          newId(),

        order_number:
          orderNumber,

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
          new Date()
            .toISOString()

      };


      /* SAVE */

      db.orders.unshift(
        order
      );

      writeDB(db);


      /* RESPONSE */

      return res
        .status(201)
        .json({

          ok:
            true,

          message:
            "Order received successfully",

          order

        });

    } catch (error) {

      console.error(
        "ORDER ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Could not create order"
        });

    }

  }
);


/* =====================================================
   ADMIN ORDERS - GET
===================================================== */

app.get(
  "/api/orders",
  requireAdmin,
  (req, res) => {

    res.json(
      db.orders
    );

  }
);


/* =====================================================
   ADMIN ORDERS - UPDATE
===================================================== */

app.put(
  "/api/orders/:id",
  requireAdmin,
  (req, res) => {

    try {

      const order =
        db.orders.find(
          item =>
            item.id ===
            req.params.id
        );

      if (!order) {

        return res
          .status(404)
          .json({
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

      res.json(
        order
      );

    } catch (error) {

      console.error(
        "Order update error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not update order"
        });

    }

  }
);


/* =====================================================
   STATIC FILES
===================================================== */

app.use(
  express.static(
    PUBLIC
  )
);


/* =====================================================
   API NOT FOUND
===================================================== */

app.use(
  "/api",
  (req, res) => {

    res
      .status(404)
      .json({
        error:
          "API endpoint not found"
      });

  }
);


/* =====================================================
   WEBSITE
===================================================== */

app.use(
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

    console.log(
      "================================="
    );

    console.log(
      "STYLE MANIA SERVER"
    );

    console.log(
      "Running on:"
    );

    console.log(
      "http://localhost:" +
      PORT
    );

    console.log(
      "Health:"
    );

    console.log(
      "http://localhost:" +
      PORT +
      "/api/health"
    );

    console.log(
      "================================="
    );

  }
);