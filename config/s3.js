require('dotenv').config(); 
const AWS = require('aws-sdk');
const fs = require('fs');

// Cấu hình S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

export default s3;