const express = require("express");
const multer = require("multer");
const client = require("./config/db");
const { ObjectId } = require("mongodb");
const {S3Client, PutObjectCommand, DeleteObjectCommand} = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const port = 3000;


// Middleware to verify token
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1]; 

  if (!token) {
      return res.status(403).json({ message: 'Access denied' });
  }
  try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET); 
      req.user = decoded; 
      if (req.user.role !== 'admin') {
          return res.status(403).json({ message: 'Access denied' });
      }
      next(); 
  } catch (err) {
      if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ message: 'Token expired' });
      }
      return res.status(401).json({ message: 'Invalid token' });
  }
};

// post new message
app.post("/api/message", async (req, res) => {
  const { nameOfCustomer, phone, message, service } = req.body;

  await client.connect();
  const db = client.db("dbThuanHighClean");
  const collection = db.collection("messages");
  const order = {
    nameOfCustomer: nameOfCustomer,
    phone: phone,
    message: message,
    service: service,
    createdAt: new Date(),
  };

  const result = await collection.insertOne(order);
  res.send(result);
});
// get all message
app.get("/api/message", async (req, res) => {
  await client.connect();
  const db = client.db("dbThuanHighClean");
  const collection = db.collection("messages");
  const result = await collection.find({}).sort({ createdAt: 1 }).toArray();
  res.send(result);
});
// Delete message by id
app.delete("/api/message/:id", verifyToken ,async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  await client.connect();
  const db = client.db("dbThuanHighClean");
  const collection = db.collection("messages");

  const result = await collection.deleteOne({ _id: new ObjectId(id) });  

  res.send(result);
});

// upload one image
const singleUpload = async (file) => {
  let url = "";
  const s3Client = new S3Client({});
  const uploadParams = {
    Bucket: process.env.S3_BUCKET_NAME, 
    Key: uuidv4(),
    Body: file.buffer,
    ContentType: "image/jpeg" || "image/png" || "image/jpg",
  };
  try {
    const command = new PutObjectCommand(uploadParams);
    const result = await s3Client.send(command);
    url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${uploadParams.Key}`;
  } catch (err) {
    console.error("Lỗi khi upload:", err);
  }
  return url;
};
// upload multiple images
const multipleUpload = async (files) => {
  const urls = [];
  for (const file of files) {
    const url = await singleUpload(file);
    urls.push(url);
  }
  return urls;
};
// Delete file from S3
async function deleteFileFromS3(fileUrl) {
  try {
      const urlParts = new URL(fileUrl);
      const bucketName = process.env.S3_BUCKET_NAME;
      const fileKey = decodeURIComponent(urlParts.pathname.slice(1));
      const s3Client = new S3Client({});

      const deleteParams = {
          Bucket: bucketName,
          Key: fileKey
      };

      const deleteCommand = new DeleteObjectCommand(deleteParams);
      const data = await s3Client.send(deleteCommand);

      return data;
  } catch (err) {
      console.error("Error:", err);
      throw new Error("Cannot delete file from S3");
  }
};

// post new order
app.post("/api/order", verifyToken, upload.fields([
  { name: 'mainBeforeImg', maxCount: 1 },
  { name: 'mainAfterImg', maxCount: 1 },
  { name: 'beforeImgs', maxCount: 3 }, 
  { name: 'afterImgs', maxCount: 3 }
]), async (req, res) => {
  const { nameOfCustomer, phone, address, service, dateOfOrder } = req.body;
  const mainBeforeImg = req.files["mainBeforeImg"];
  const mainAfterImg = req.files["mainAfterImg"];
  const beforeImgs = req.files["beforeImgs"];
  const afterImgs = req.files["afterImgs"];

  await client.connect();
  const db = client.db("dbThuanHighClean");
  const collection = db.collection("orders");
  const beforeImgUrls = await multipleUpload(beforeImgs);
  const afterImgUrls = await multipleUpload(afterImgs);
  const mainBeforeImgUrl = await singleUpload(mainBeforeImg[0]);
  const mainAfterImgUrl = await singleUpload(mainAfterImg[0]);

  const order = {
    nameOfCustomer: nameOfCustomer,
    phone: phone,
    address: address,
    service: service,
    mainBeforeImg: mainBeforeImgUrl,
    mainAfterImg: mainAfterImgUrl,
    beforeImgs: beforeImgUrls,
    afterImgs: afterImgUrls,
    dateOfOrder: new Date(dateOfOrder),
  };

  const result = await collection.insertOne(order);

  // Check size of order in DB
  const orders = await collection.find({}).sort({ dateOfOrder: 1 }).toArray();
  let idx = 0;
  while (orders.length - idx > 20) {
    const orderToDelete = orders[idx];
    await deleteFileFromS3(orderToDelete.mainBeforeImg);
    await deleteFileFromS3(orderToDelete.mainAfterImg);
    for (const img of orderToDelete.beforeImgs) {
      await deleteFileFromS3(img);
    }
    for (const img of orderToDelete.afterImgs) {
      await deleteFileFromS3(img);
    }
    await collection.deleteOne({ _id: orderToDelete._id });
    idx++;
  }
  res.send(result);
});
// get all order
app.get("/api/order", async (req, res) => {
  await client.connect();
  const db = client.db("dbThuanHighClean");
  const collection = db.collection("orders");
  const result = await collection.find({}).sort({ dateOfOrder: -1 }).toArray();
  res.send(result);
});

app.get("/api/order/:id", async (req, res) => {
  const { id } = req.params;
  await client.connect();
  const db = client.db("dbThuanHighClean");
  const collection = db.collection("orders");
  const result = await collection.findOne({ _id: new ObjectId(id) });
  res.send(result);
})

// delete order by id
app.delete("/api/order/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  await client.connect();
  const db = client.db("dbThuanHighClean");
  const collection = db.collection("orders");

  const orderToDelete = await collection.findOne({ _id: new ObjectId(id) });
  await deleteFileFromS3(orderToDelete.mainBeforeImg);
  await deleteFileFromS3(orderToDelete.mainAfterImg);
  for (const img of orderToDelete.beforeImgs) {
    await deleteFileFromS3(img);
  }
  for (const img of orderToDelete.afterImgs) {
    await deleteFileFromS3(img);
  }

  const result = await collection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;

  const isPasswordValid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD);
  if (!isPasswordValid || username != "admin") {
      return res.json({ message: 'Invalid credentials' });
  }

  const token = jwt.sign(
      { username: username, role: 'admin' }, 
      process.env.JWT_SECRET, 
      { expiresIn: '1h' } 
  );

  res.json({ token });
});

// Test token
app.get("/", verifyToken ,async (req, res) => {
  res.send("Hello World");
});

app.listen(port, () => {
  console.log("Server is running on port " + port);
});
