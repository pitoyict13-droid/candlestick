const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api/binance',
    createProxyMiddleware({
      target: 'https://data-api.binance.vision',
      changeOrigin: true,
    })
  );

  // forex & indeks: Yahoo tidak mengirim header CORS, jadi lewat proxy dev
  app.use(
    '/api/yahoo',
    createProxyMiddleware({
      target: 'https://query2.finance.yahoo.com',
      changeOrigin: true,
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    })
  );
};
