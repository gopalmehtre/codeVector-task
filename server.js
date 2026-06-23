require('dotenv').config();
const path = require('path');
const express = require('express');

const productsRouter = require('./routes/products');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', productsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
