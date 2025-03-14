const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const session = require("express-session");
const bodyParser = require("body-parser");

const app = express();
const db = new sqlite3.Database("./blog.db");

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
    session({
        secret: "secret_key",
        resave: false,
        saveUninitialized: true,
    })
);

// Tạo bảng Users, Posts và Comments nếu chưa có
db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user'  -- 'user' hoặc 'admin'
    )
`);
db.run(`
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT,
        image_url TEXT,
        follows INTEGER DEFAULT 0
    )
`);
db.run(`
    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER,
        user_id INTEGER,
        content TEXT,
        FOREIGN KEY (post_id) REFERENCES posts(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`);

db.run(`
    CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    post_id INTEGER,
    UNIQUE(user_id, post_id), -- Đảm bảo mỗi user chỉ follow một post một lần
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (post_id) REFERENCES posts(id)
    )
`);

// Middleware kiểm tra đăng nhập
function checkAuth(req, res, next) {
    if (!req.session.user) return res.redirect("/login");
    next();
}

// Kiểm tra quyền Admin
function checkAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== "admin") {
        return res.send("Bạn không có quyền truy cập!");
    }
    next();
}

app.get("/", checkAuth, (req, res) => {
    const userId = req.session.user ? req.session.user.id : null;

    // Lấy danh sách tất cả bài viết
    const postsQuery = "SELECT * FROM posts";

    // Lấy danh sách tất cả bình luận cùng với tên người dùng
    const commentsQuery = `
        SELECT comments.*, users.username 
        FROM comments 
        JOIN users ON comments.user_id = users.id
    `;

    // Nếu có user đăng nhập, lấy danh sách bài viết mà user đã follow
    const followsQuery = `
        SELECT post_id FROM follows WHERE user_id = ?
    `;

    db.all(postsQuery, [], (err, posts) => {
        if (err) return res.send("Lỗi lấy bài viết");

        db.all(commentsQuery, [], (err, comments) => {
            if (err) return res.send("Lỗi lấy bình luận");

            if (userId) {
                db.all(followsQuery, [userId], (err, followedPosts) => {
                    if (err) return res.send("Lỗi lấy danh sách follow");

                    // Chuyển danh sách follow thành một mảng ID
                    const followedPostIds = followedPosts.map(f => f.post_id);

                    res.render("index", {
                        user: req.session.user,
                        posts,
                        comments,
                        followedPostIds, // Danh sách bài viết mà user đã follow
                    });
                });
            } else {
                res.render("index", {
                    user: null,
                    posts,
                    comments,
                    followedPostIds: [],
                });
            }
        });
    });
});


// Hiển thị trang đăng ký
app.get("/register", (req, res) => {
    res.render("register");
});

// Xử lý đăng ký (Nếu username = 'admin', role = 'admin')
app.post("/register", (req, res) => {
    const { username, password } = req.body;
    const role = username === "admin" ? "admin" : "user"; // Tự động gán quyền admin nếu username là 'admin'
    
    bcrypt.hash(password, 10, (err, hash) => {
        db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", [username, hash, role], (err) => {
            if (err) return res.send("Username đã tồn tại.");
            res.redirect("/login");
        });
    });
});

// Hiển thị trang đăng nhập
app.get("/login", (req, res) => {
    res.render("login");
});

// Xử lý đăng nhập
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (!user) return res.send("Sai tài khoản hoặc mật khẩu!");
        bcrypt.compare(password, user.password, (err, result) => {
            if (result) {
                req.session.user = user;
                res.redirect("/");
            } else {
                res.send("Sai tài khoản hoặc mật khẩu!");
            }
        });
    });
});

// Đăng xuất
app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/"));
});

// Thêm bài viết
app.post("/add", checkAuth, (req, res) => {
    const { title, content } = req.body;
    const imageUrl = `https://picsum.photos/300/200?random=${Math.random()}`;
    db.run("INSERT INTO posts (title, content, image_url) VALUES (?, ?, ?)", [title, content, imageUrl], () => {
        res.redirect("/");
    });
});

// Follow bài viết
app.post("/follow/:id", checkAuth, (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    // Kiểm tra xem user đã follow bài viết chưa
    db.get("SELECT * FROM follows WHERE user_id = ? AND post_id = ?", [userId, id], (err, row) => {
        if (row) {
            // Nếu đã follow -> Unfollow (xóa khỏi bảng follows, giảm số follow)
            db.run("DELETE FROM follows WHERE user_id = ? AND post_id = ?", [userId, id], (err) => {
                if (err) return res.send("Có lỗi xảy ra!");
                db.run("UPDATE posts SET follows = follows - 1 WHERE id = ?", [id], () => {
                    res.redirect("/");
                });
            });
        } else {
            // Nếu chưa follow -> Follow (thêm vào bảng follows, tăng số follow)
            db.run("INSERT INTO follows (user_id, post_id) VALUES (?, ?)", [userId, id], (err) => {
                if (err) return res.send("Có lỗi xảy ra!");
                db.run("UPDATE posts SET follows = follows + 1 WHERE id = ?", [id], () => {
                    res.redirect("/");
                });
            });
        }
    });
});




// Thêm bình luận
app.post("/comment/:postId", checkAuth, (req, res) => {
    const { postId } = req.params;
    const { content } = req.body;
    db.run("INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)", [postId, req.session.user.id, content], () => {
        res.redirect("/");
    });
});

// Xóa bình luận (chỉ admin)
app.post("/delete-comment/:id", checkAdmin, (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM comments WHERE id = ?", [id], () => {
        res.redirect("/");
    });
});

// Xóa bài viết (chỉ admin)
app.post("/delete-post/:id", checkAdmin, (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM posts WHERE id = ?", [id], () => {
        res.redirect("/");
    });
});

// Trang quản trị Admin
app.get("/admin", checkAdmin, (req, res) => {
    db.all("SELECT * FROM posts", [], (err, posts) => {
        res.render("admin", { posts, user: req.session.user });
    });
});

app.listen(3000, () => console.log("Server running at http://localhost:3000"));
