const express = require('express');
const { ExpressPeerServer } = require('peer');
const app = express();
const server = app.listen(9000, '127.0.0.1', () => console.log('peer server up'));
app.use('/', ExpressPeerServer(server, { path: '/' }));
