const express = require("express");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const cors = require("cors");
const path = require("path");

dotenv.config();

const app = express();
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET,
});

app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// File Upload Configuration (using multer)
const storage = multer.memoryStorage();
const upload = multer({ storage });

const port = process.env.PORT || 3000;

// Route to fetch posts
app.get("/api/posts", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM posts ORDER BY id DESC");
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch posts" });
    }
});

// Route to upload media
app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        // Upload to Cloudinary
        cloudinary.uploader.upload_stream(
            { resource_type: "auto" },
            async (error, result) => {
                if (error) {
                    console.error(error);
                    return res.status(500).json({ error: "Upload to Cloudinary failed" });
                }

                try {
                    // Save the post to the database (ensure it's done after Cloudinary upload completes)
                    const newPost = await pool.query(
                        "INSERT INTO posts (url, type) VALUES ($1, $2) RETURNING *",
                        [result.secure_url, result.resource_type]
                    );

                    // Respond to the client with the new post data
                    res.json(newPost.rows[0]);
                } catch (dbError) {
                    console.error(dbError);
                    res.status(500).json({ error: "Database insert failed" });
                }
            }
        ).end(file.buffer);  // Important: we need to provide the file buffer to Cloudinary

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error uploading file" });
    }
});

// Route to like a post
app.post("/api/posts/:id/like", async (req, res) => {
    try {
        const postId = req.params.id;
        const userIp = req.ip;

        // Check if the user already liked the post
        const existingLike = await pool.query(
            "SELECT * FROM likes WHERE post_id = $1 AND user_ip = $2",
            [postId, userIp]
        );
        if (existingLike.rows.length > 0) {
            return res.status(400).json({ error: "You have already liked this post" });
        }

        // Add like to the post
        await pool.query("INSERT INTO likes (post_id, user_ip) VALUES ($1, $2)", [
            postId,
            userIp,
        ]);

        // Increment likes in posts table
        const result = await pool.query("UPDATE posts SET likes = likes + 1 WHERE id = $1 RETURNING *", [postId]);
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: "Error liking post" });
    }
});

// Route to get comments for a post
app.get("/api/posts/:id/comments", async (req, res) => {
    try {
        const postId = req.params.id;
        const result = await pool.query("SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at DESC", [postId]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch comments" });
    }
});

// Route to post a comment
app.post("/api/posts/:id/comment", async (req, res) => {
    try {
        const postId = req.params.id;
        const { text } = req.body;
        if (!text || !postId) return res.status(400).json({ error: "Comment text is required" });

        // Insert the comment into the database
        const result = await pool.query(
            "INSERT INTO comments (post_id, text) VALUES ($1, $2) RETURNING *",
            [postId, text]
        );

        // Increment the comment count on the post
        await pool.query("UPDATE posts SET comments = comments + 1 WHERE id = $1", [postId]);

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: "Error posting comment" });
    }
});

// Route to handle post download
app.get("/api/posts/:id/download", async (req, res) => {
    try {
        const postId = req.params.id;
        const result = await pool.query("SELECT * FROM posts WHERE id = $1", [postId]);
        const post = result.rows[0];
        if (!post) return res.status(404).json({ error: "Post not found" });

        // Redirect the user to the file URL for download
        res.redirect(post.url);
    } catch (error) {
        res.status(500).json({ error: "Error downloading post" });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
